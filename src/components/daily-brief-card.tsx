"use client";

import { useState, useTransition } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { generateBrief as generateBriefAction, aiStatus as getAiStatusAction } from "@/app/actions/tasks-bridge";
import { useToast } from "@/components/providers/toast-provider";
import { cn } from "@/lib/utils";

/**
 * The brief is always a *draft* the user can read and dismiss — §7.9 requires
 * AI output to be reviewed, and §8.11 requires a clean fallback when no
 * provider is configured.
 */
export function DailyBriefCard({ isArabic }: { isArabic: boolean }) {
  const toast = useToast();
  const [brief, setBrief] = useState<string | null>(null);
  const [kind, setKind] = useState<"daily" | "weekly">("daily");
  const [isPending, startTransition] = useTransition();

  const t = (ar: string, en: string) => (isArabic ? ar : en);

  const load = (nextKind: "daily" | "weekly") => {
    setKind(nextKind);
    startTransition(async () => {
      const status = await getAiStatusAction();
      if (!status.available) {
        toast.info(
          t("المساعد غير مُهيّأ", "Assistant not configured"),
          t(
            "أضف مفتاح مزوّد مجاني من الإعدادات لتفعيل الملخصات. كل شيء آخر يعمل.",
            "Add a free provider key in settings to enable briefs. Everything else works.",
          ),
        );
        setBrief(null);
        return;
      }

      const result = await generateBriefAction(nextKind);
      if (result.ok && result.data) {
        setBrief(result.data.brief);
      } else {
        toast.warning(
          t("تعذّر إنشاء الملخص", "Could not generate the brief"),
          result.error,
        );
      }
    });
  };

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-600" aria-hidden />
          <h2 className="text-sm font-semibold text-ink">{t("ملخصك اليومي", "Your brief")}</h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => load("daily")}
            disabled={isPending}
            className={cn(
              "rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors",
              kind === "daily" && brief ? "bg-brand-50 text-brand-700" : "text-ink-muted hover:bg-slate-100",
            )}
          >
            {t("يومي", "Daily")}
          </button>
          <button
            type="button"
            onClick={() => load("weekly")}
            disabled={isPending}
            className={cn(
              "rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors",
              kind === "weekly" && brief ? "bg-brand-50 text-brand-700" : "text-ink-muted hover:bg-slate-100",
            )}
          >
            {t("أسبوعي", "Weekly")}
          </button>
          {brief ? (
            <button
              type="button"
              onClick={() => load(kind)}
              disabled={isPending}
              className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-slate-100 hover:text-ink"
              aria-label={t("تحديث", "Refresh")}
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </button>
          ) : null}
        </div>
      </div>

      <div className="px-4 py-4">
        {isPending ? (
          <div className="space-y-2">
            <div className="skeleton h-3.5 w-full" />
            <div className="skeleton h-3.5 w-5/6" />
            <div className="skeleton h-3.5 w-4/6" />
          </div>
        ) : brief ? (
          <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-soft">{brief}</div>
        ) : (
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-relaxed text-ink-muted">
              {t(
                "اطلب ملخصاً سريعاً لما يهم اليوم، أو مراجعة أسبوعية لما أُنجز وما تعثّر.",
                "Get a quick read on what matters today, or a weekly review of what moved and what slipped.",
              )}
            </p>
            <button type="button" onClick={() => load("daily")} className="btn-secondary shrink-0">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              {t("أنشئ الملخص", "Generate")}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
