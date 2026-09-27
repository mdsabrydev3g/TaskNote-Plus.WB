"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Calendar,
  CheckSquare,
  Folder,
  Inbox,
  Loader2,
  NotebookPen,
  Search,
  Sparkles,
  Target,
} from "lucide-react";
import { searchAction, type SearchHit } from "@/app/actions/content";import { cn, truncate } from "@/lib/utils";

const TYPE_META: Record<SearchHit["type"], { Icon: typeof Search; labelAr: string; labelEn: string; href: (id: string) => string }> = {
  task: { Icon: CheckSquare, labelAr: "مهمة", labelEn: "Task", href: () => "/tasks" },
  note: { Icon: NotebookPen, labelAr: "ملاحظة", labelEn: "Note", href: (id) => `/notes/${id}` },
  project: { Icon: Folder, labelAr: "مشروع", labelEn: "Project", href: (id) => `/projects/${id}` },
  goal: { Icon: Target, labelAr: "هدف", labelEn: "Goal", href: () => "/goals" },
  event: { Icon: Calendar, labelAr: "موعد", labelEn: "Event", href: () => "/calendar" },
  capture: { Icon: Inbox, labelAr: "وارد", labelEn: "Capture", href: () => "/inbox" },
};

const ACTIONS: Array<{ labelAr: string; labelEn: string; href: string; Icon: typeof Search }> = [
  { labelAr: "التقاط سريع", labelEn: "Quick capture", href: "/capture", Icon: Sparkles },
  { labelAr: "مهمة جديدة", labelEn: "New task", href: "/tasks?new=1", Icon: CheckSquare },
  { labelAr: "ملاحظة جديدة", labelEn: "New note", href: "/notes?new=1", Icon: NotebookPen },
  { labelAr: "موعد جديد", labelEn: "New event", href: "/calendar?new=1", Icon: Calendar },
  { labelAr: "مراجعة الوارد", labelEn: "Review inbox", href: "/inbox", Icon: Inbox },
];

export function CommandPalette({
  open,
  onClose,
  isArabic,
}: {
  open: boolean;
  onClose: () => void;
  isArabic: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPending, startTransition] = useTransition();

  const t = useCallback((ar: string, en: string) => (isArabic ? ar : en), [isArabic]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHits([]);
      setActiveIndex(0);
      // Focus after the transition settles so the input actually receives it.
      window.setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const term = query.trim();
    if (term.length < 1) {
      setHits([]);
      return;
    }
    const timer = window.setTimeout(() => {
      startTransition(async () => {
        try {
          const results = await searchAction(term, 12);
          setHits(results);
          setActiveIndex(0);
        } catch {
          setHits([]);
        }
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, open]);

  const rows = useMemo(() => {
    if (query.trim().length === 0) {
      return ACTIONS.map((a) => ({
        key: a.href,
        title: t(a.labelAr, a.labelEn),
        subtitle: t("إجراء", "Action"),
        href: a.href,
        Icon: a.Icon,
      }));
    }
    return hits.map((h) => {
      const meta = TYPE_META[h.type];
      return {
        key: `${h.type}-${h.id}`,
        title: h.title,
        subtitle: `${t(meta.labelAr, meta.labelEn)}${h.snippet ? ` · ${truncate(h.snippet, 60)}` : ""}`,
        href: meta.href(h.id),
        Icon: meta.Icon,
      };
    });
  }, [query, hits, t]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, rows.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const row = rows[activeIndex];
        if (row) {
          router.push(row.href);
          onClose();
        }
      } else if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, rows, activeIndex, router, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[12vh]">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("لوحة الأوامر", "Command palette")}
        className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-pop"
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin text-brand-500" aria-hidden />
          ) : (
            <Search className="h-4 w-4 text-ink-faint" aria-hidden />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("ابحث أو نفّذ إجراءً...", "Search or run an action...")}
            className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
            aria-label={t("بحث", "Search")}
          />
          <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
            ESC
          </kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto scrollbar-thin p-2">
          {rows.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-ink-faint">
              {query.trim()
                ? t("لا توجد نتائج مطابقة", "No matching results")
                : t("ابدأ الكتابة للبحث", "Start typing to search")}
            </p>
          ) : (
            rows.map((row, index) => {
              const Icon = row.Icon;
              const active = index === activeIndex;
              return (
                <button
                  key={row.key}
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => {
                    router.push(row.href);
                    onClose();
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start transition-colors",
                    active ? "bg-brand-50" : "hover:bg-slate-50",
                  )}
                >
                  <Icon className={cn("h-4 w-4 shrink-0", active ? "text-brand-600" : "text-ink-faint")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{row.title}</span>
                    {row.subtitle ? (
                      <span className="block truncate text-xs text-ink-faint">{row.subtitle}</span>
                    ) : null}
                  </span>
                  {active ? <ArrowRight className="h-3.5 w-3.5 shrink-0 text-brand-500 flip-rtl" aria-hidden /> : null}
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-slate-200 px-4 py-2 text-[11px] text-ink-faint">
          <span>↑↓ {t("تنقّل", "navigate")}</span>
          <span>↵ {t("فتح", "open")}</span>
          <span className="ms-auto">⌘K {t("إغلاق", "toggle")}</span>
        </div>
      </div>
    </div>
  );
}
