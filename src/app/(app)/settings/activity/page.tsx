import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { ChevronLeft, History, RotateCcw } from "lucide-react";
import { db } from "@/db";
import { aiActionLogs, tasks } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { PageHeader, EmptyState } from "@/components/ui";
import { UndoAiAction } from "@/components/undo-ai-action";
import { formatRelativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Assistant activity" };

/**
 * §8.2 Audit & explainability — the user can see every AI action, what it
 * touched, and undo anything still inside its reversibility window.
 */
export default async function ActivityPage() {
  const user = await requireUser();
  const isArabic = user.locale === "ar";
  const t = (ar: string, en: string) => (isArabic ? ar : en);

  const logs = await db
    .select()
    .from(aiActionLogs)
    .where(eq(aiActionLogs.userId, user.id))
    .orderBy(desc(aiActionLogs.createdAt))
    .limit(100);

  // Resolve which created tasks still exist, so undo can be shown accurately.
  const createdTaskIds = logs
    .flatMap((log) => ((log.payload ?? {}) as { createdTaskIds?: string[] }).createdTaskIds ?? [])
    .slice(0, 200);

  const liveTaskIds = new Set(
    createdTaskIds.length > 0
      ? (
          await db
            .select({ id: tasks.id })
            .from(tasks)
            .where(inArray(tasks.id, createdTaskIds))
        ).map((r) => r.id)
      : [],
  );

  const now = Date.now();

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 lg:px-8 lg:py-8">
      <Link
        href="/settings"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-ink"
      >
        <ChevronLeft className="h-3.5 w-3.5 flip-rtl" aria-hidden />
        {t("الإعدادات", "Settings")}
      </Link>

      <PageHeader
        title={t("سجل نشاط المساعد", "Assistant activity log")}
        subtitle={t(
          "كل قراءة وكتابة، مع السبب والمصادر وإمكانية التراجع.",
          "Every read and write, with its reason, sources, and undo.",
        )}
      />

      {logs.length === 0 ? (
        <EmptyState
          icon={<History className="h-5 w-5" aria-hidden />}
          title={t("لا نشاط بعد", "No activity yet")}
          description={t(
            "عندما يستخدم المساعد بياناتك، سيظهر كل إجراء هنا بالتفصيل.",
            "When the assistant uses your data, every action shows up here in detail.",
          )}
        />
      ) : (
        <ul className="space-y-2">
          {logs.map((log) => {
            const createdIds = ((log.payload ?? {}) as { createdTaskIds?: string[] }).createdTaskIds ?? [];
            const stillExists = createdIds.some((id) => liveTaskIds.has(id));
            const withinWindow = !log.reversibleUntil || log.reversibleUntil.getTime() > now;
            const canUndo = Boolean(log.revertedAt === null && createdIds.length > 0 && stillExists && withinWindow);

            return (
              <li key={log.id} className="card p-4">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="chip bg-brand-50 text-brand-700">
                    {labelForCapability(log.capability, isArabic)}
                  </span>
                  <span className="text-[11px] text-ink-faint">
                    {formatRelativeTime(log.createdAt, isArabic ? "ar" : "en")}
                  </span>
                  {log.outcome !== "success" ? (
                    <span className="chip bg-amber-50 text-amber-700">{log.outcome}</span>
                  ) : null}
                  {log.revertedAt ? (
                    <span className="chip bg-slate-100 text-ink-muted">
                      {t("تم التراجع", "Undone")}
                    </span>
                  ) : null}
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-4">
                  <div>
                    <dt className="text-ink-faint">{t("المزوّد", "Provider")}</dt>
                    <dd className="font-medium text-ink-soft" dir="ltr">
                      {log.provider}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-ink-faint">{t("الموديل", "Model")}</dt>
                    <dd className="truncate font-medium text-ink-soft" dir="ltr" title={log.model}>
                      {log.model}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">{t("الرموز", "Tokens")}</dt>
                    <dd className="font-medium tabular-nums text-ink-soft">
                      {log.tokensIn + log.tokensOut}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">{t("الزمن", "Latency")}</dt>
                    <dd className="font-medium tabular-nums text-ink-soft">{log.latencyMs}ms</dd>
                  </div>
                </dl>

                {log.inputRefs && log.inputRefs.length > 0 ? (
                  <div className="mt-2.5">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">
                      {t("قرأ من", "Read from")}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {log.inputRefs.slice(0, 8).map((ref) => (
                        <span key={ref} className="rounded-lg bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-ink-muted" dir="ltr">
                          {ref}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {createdIds.length > 0 ? (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                    <span className="text-[11px] text-ink-muted">
                      {t(`أنشأ ${createdIds.length} مهمة`, `Created ${createdIds.length} task(s)`)}
                    </span>
                    {canUndo ? (
                      <UndoAiAction
                        aiLogId={log.id}
                        label={t("تراجع", "Undo")}
                        icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}
                      />
                    ) : log.revertedAt ? null : (
                      <span className="text-[10px] text-ink-faint">
                        {t("انتهت مدة التراجع", "Undo window closed")}
                      </span>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function labelForCapability(capability: string, isArabic: boolean): string {
  const map: Record<string, { ar: string; en: string }> = {
    summarize_note: { ar: "تلخيص ملاحظة", en: "Summarise note" },
    extract_tasks: { ar: "استخراج مهام", en: "Extract tasks" },
    quick_add: { ar: "إضافة سريعة", en: "Quick add" },
    capture_triage: { ar: "فرز الوارد", en: "Inbox triage" },
    daily_brief: { ar: "ملخص يومي", en: "Daily brief" },
    weekly_review: { ar: "مراجعة أسبوعية", en: "Weekly review" },
    ask_assistant: { ar: "سؤال للمساعد", en: "Assistant question" },
  };
  const entry = map[capability];
  if (!entry) return capability;
  return isArabic ? entry.ar : entry.en;
}
