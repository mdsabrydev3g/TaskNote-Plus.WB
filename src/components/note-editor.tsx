"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Check,
  ChevronLeft,
  Loader2,
  Pin,
  PinOff,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import {
  updateNote as updateNoteAction,
  deleteNote as deleteNoteAction,
  summarizeNote as summarizeNoteAction,
  extractTasks as extractTasksAction,
  confirmExtractedTasks as confirmExtractedTasksAction,
  type ProposedTask,
} from "@/app/actions/tasks-bridge";
import { useToast } from "@/components/providers/toast-provider";
import { ConfirmDialog } from "@/components/ui";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { NoteBlock } from "@/db/schema";

type NoteDraft = {
  id: string;
  title: string;
  content: NoteBlock[];
  projectId: string | null;
  pinned: boolean;
  aiAccessible: boolean;
  updatedAt: string;
};

export function NoteEditor({
  note,
  projects,
  isArabic,
}: {
  note: NoteDraft;
  projects: Array<{ id: string; name: string }>;
  isArabic: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(
    note.content.map((b) => b.text).join("\n") || "",
  );
  const [pinned, setPinned] = useState(note.pinned);
  const [projectId, setProjectId] = useState(note.projectId ?? "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [summary, setSummary] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ProposedTask[] | null>(null);
  const [selectedProposals, setSelectedProposals] = useState<Set<number>>(new Set());
  const [aiLogId, setAiLogId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isAiPending, startAiTransition] = useTransition();
  const [isBusy, startBusyTransition] = useTransition();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(`${note.title}\u0000${note.content.map((b) => b.text).join("\n")}`);

  const t = useCallback((ar: string, en: string) => (isArabic ? ar : en), [isArabic]);

  const persist = useCallback(
    async (patch: { title?: string; body?: string; pinned?: boolean; projectId?: string | null }) => {
      const nextTitle = patch.title ?? title;
      const nextBody = patch.body ?? body;
      const key = `${nextTitle}\u0000${nextBody}`;
      if (key === lastSaved.current) return;

      setSaveState("saving");
      const blocks: NoteBlock[] = nextBody
        .split("\n")
        .map((line, index) => ({ id: `b${index}`, type: "paragraph" as const, text: line }));

      const result = await updateNoteAction(note.id, {
        title: nextTitle,
        content: blocks,
        pinned: patch.pinned ?? pinned,
        projectId: patch.projectId !== undefined ? patch.projectId : projectId || null,
      });

      if (result.ok) {
        lastSaved.current = key;
        setSaveState("saved");
        window.setTimeout(() => setSaveState("idle"), 1500);
      } else {
        setSaveState("idle");
        toast.error(t("تعذّر الحفظ", "Could not save"), result.error);
      }
    },
    [note.id, title, body, pinned, projectId, toast, t],
  );

  // Debounced autosave — the editor should never need a "save" button.
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void persist({});
    }, 900);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [title, body, persist]);

  const runSummarize = () => {
    startAiTransition(async () => {
      await persist({});
      const result = await summarizeNoteAction(note.id);
      if (result.ok && result.data) {
        setSummary(result.data.summary);
      } else {
        toast.warning(t("تعذّر التلخيص", "Could not summarise"), result.error);
      }
    });
  };

  const runExtract = () => {
    startAiTransition(async () => {
      await persist({});
      const result = await extractTasksAction(note.id);
      if (result.ok && result.data) {
        if (result.data.proposals.length === 0) {
          toast.info(
            t("لا عناصر قابلة للتنفيذ", "No action items found"),
            t("لم نجد مهاماً واضحة في هذه الملاحظة.", "We did not find clear tasks in this note."),
          );
          return;
        }
        setProposals(result.data.proposals);
        setAiLogId(result.data.aiLogId);
        // Everything is pre-selected; the user unchecks what they don't want.
        setSelectedProposals(new Set(result.data.proposals.map((_, i) => i)));
      } else {
        toast.warning(t("تعذّر الاستخراج", "Could not extract tasks"), result.error);
      }
    });
  };

  const confirmProposals = () => {
    if (!proposals || !aiLogId) return;
    const chosen = proposals.filter((_, i) => selectedProposals.has(i));
    if (chosen.length === 0) return;

    startBusyTransition(async () => {
      const result = await confirmExtractedTasksAction(note.id, aiLogId, chosen, projectId || null);
      if (result.ok && result.data) {
        toast.success(
          t(`أُضيفت ${result.data.created} مهمة`, `Added ${result.data.created} task(s)`),
          t("يمكنك التراجع من سجل النشاط.", "You can undo this from the activity log."),
        );
        setProposals(null);
        setAiLogId(null);
        router.refresh();
      } else {
        toast.error(t("تعذّرت الإضافة", "Could not add the tasks"), result.error);
      }
    });
  };

  const handleDelete = () => {
    startBusyTransition(async () => {
      const result = await deleteNoteAction(note.id);
      if (result.ok) {
        toast.success(t("حُذفت الملاحظة", "Note deleted"));
        router.push("/notes");
      } else {
        toast.error(t("تعذّر الحذف", "Could not delete"), result.error);
      }
      setConfirmingDelete(false);
    });
  };

  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    void persist({ pinned: next });
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 lg:px-8 lg:py-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link href="/notes" className="flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-ink">
          <ChevronLeft className="h-3.5 w-3.5 flip-rtl" aria-hidden />
          {t("كل الملاحظات", "All notes")}
        </Link>

        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "text-[11px] transition-opacity",
              saveState === "idle" ? "opacity-0" : "opacity-100 text-ink-faint",
            )}
          >
            {saveState === "saving" ? t("جارٍ الحفظ...", "Saving…") : t("محفوظ", "Saved")}
          </span>
          <button
            type="button"
            onClick={togglePin}
            className="rounded-xl p-2 text-ink-faint transition-colors hover:bg-slate-100 hover:text-ink"
            aria-label={pinned ? t("إلغاء التثبيت", "Unpin") : t("تثبيت", "Pin")}
          >
            {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="rounded-xl p-2 text-ink-faint transition-colors hover:bg-red-50 hover:text-red-600"
            aria-label={t("حذف", "Delete")}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("عنوان الملاحظة", "Note title")}
        className="w-full border-0 bg-transparent text-2xl font-semibold tracking-tight text-ink placeholder:text-ink-faint focus:outline-none"
        aria-label={t("العنوان", "Title")}
      />

      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-ink-faint">
        <span>{formatRelativeTime(note.updatedAt, isArabic ? "ar" : "en")}</span>
        <select
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            void persist({ projectId: e.target.value || null });
          }}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-ink-soft focus:outline-none"
          aria-label={t("المشروع", "Project")}
        >
          <option value="">{t("بدون مشروع", "No project")}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* AI action bar */}
      <div className="mt-5 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2">
        <button
          type="button"
          onClick={runSummarize}
          disabled={isAiPending}
          className="btn-ghost text-xs"
        >
          {isAiPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
          {t("لخّص", "Summarise")}
        </button>
        <button type="button" onClick={runExtract} disabled={isAiPending} className="btn-ghost text-xs">
          <Wand2 className="h-3.5 w-3.5" aria-hidden />
          {t("استخرج مهاماً", "Extract tasks")}
        </button>
        <span className="ms-auto pe-2 text-[11px] text-ink-faint">
          {t("كل إجراء قابل للمراجعة والتراجع", "Every action is reviewable and reversible")}
        </span>
      </div>

      {summary ? (
        <section className="mt-4 rounded-2xl border border-brand-200 bg-brand-50/60 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold text-brand-900">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              {t("ملخص المساعد", "Assistant summary")}
            </h2>
            <button
              type="button"
              onClick={() => setSummary(null)}
              className="rounded-lg p-1 text-brand-700/60 hover:bg-white hover:text-brand-800"
              aria-label={t("إخفاء", "Dismiss")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-brand-900/90">{summary}</p>
          <p className="mt-2.5 text-[11px] text-brand-800/60">
            {t("مُقترح — لم يُعدّل شيئاً في ملاحظتك.", "A suggestion — nothing in your note was changed.")}
          </p>
        </section>
      ) : null}

      {proposals ? (
        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-ink">
              {t("مهام مقترحة", "Proposed tasks")} · {selectedProposals.size}/{proposals.length}
            </h2>
            <button
              type="button"
              onClick={() => {
                setProposals(null);
                setAiLogId(null);
              }}
              className="rounded-lg p-1 text-ink-faint hover:bg-slate-100"
              aria-label={t("إغلاق", "Close")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <ul className="space-y-1.5">
            {proposals.map((proposal, index) => {
              const selected = selectedProposals.has(index);
              return (
                <li key={`${proposal.title}-${index}`}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
                      selected ? "border-brand-300 bg-brand-50/50" : "border-slate-200",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => {
                        setSelectedProposals((prev) => {
                          const next = new Set(prev);
                          if (next.has(index)) next.delete(index);
                          else next.add(index);
                          return next;
                        });
                      }}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-ink">{proposal.title}</span>
                      <span className="mt-1 flex flex-wrap gap-2 text-[11px] text-ink-faint">
                        <span>{proposal.priority}</span>
                        <span>·</span>
                        <span>{proposal.energy}</span>
                        {proposal.dueInDays !== null ? (
                          <>
                            <span>·</span>
                            <span>
                              {t(`بعد ${proposal.dueInDays} يوم`, `in ${proposal.dueInDays}d`)}
                            </span>
                          </>
                        ) : null}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setProposals(null);
                setAiLogId(null);
              }}
              className="btn-secondary"
            >
              {t("تجاهل", "Discard")}
            </button>
            <button
              type="button"
              onClick={confirmProposals}
              disabled={isBusy || selectedProposals.size === 0}
              className="btn-primary"
            >
              {isBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
              {t(`أضف ${selectedProposals.size}`, `Add ${selectedProposals.size}`)}
            </button>
          </div>
        </section>
      ) : null}

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t("ابدأ الكتابة...", "Start writing…")}
        rows={20}
        className="mt-5 w-full resize-none rounded-2xl border border-slate-200 bg-white p-5 text-[15px] leading-[1.9] text-ink-soft placeholder:text-ink-faint focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
        aria-label={t("محتوى الملاحظة", "Note content")}
      />

      <ConfirmDialog
        open={confirmingDelete}
        tone="danger"
        title={t("حذف الملاحظة؟", "Delete this note?")}
        description={t(
          "ستُنقل إلى المهملات ويمكن استعادتها لفترة محدودة.",
          "It moves to trash and can be restored for a limited time.",
        )}
        confirmLabel={t("حذف", "Delete")}
        cancelLabel={t("إلغاء", "Cancel")}
        onConfirm={handleDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
    </div>
  );
}
