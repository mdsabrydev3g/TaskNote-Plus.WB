"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar,
  CheckSquare,
  FileText,
  Inbox,
  Loader2,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import {
  deleteCapture as deleteCaptureAction,
  routeCapture as routeCaptureAction,
  suggestCaptureDestination as suggestCaptureDestinationAction,
} from "@/app/actions/tasks-bridge";
import { useToast } from "@/components/providers/toast-provider";
import { ConfirmDialog, EmptyState, PageHeader } from "@/components/ui";
import { cn, formatRelativeTime } from "@/lib/utils";

export type InboxItem = {
  id: string;
  raw: string;
  kind: string;
  createdAt: string;
  suggestedType: string | null;
  suggestedTitle: string | null;
  suggestionConfidence: string | null;
  suggestionReason: string | null;
};

/**
 * Triage surface (§7.1). Capture lands here first, always. Routing is a
 * deliberate, confirmed action — the AI suggestion is advisory only.
 */
export function InboxView({
  items,
  processedCount,
  isArabic,
}: {
  items: InboxItem[];
  processedCount: number;
  isArabic: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [triageId, setTriageId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const t = (ar: string, en: string) => (isArabic ? ar : en);

  const route = (id: string, type: "task" | "note" | "event", title?: string) => {
    setBusyId(id);
    startTransition(async () => {
      const result = await routeCaptureAction(id, { type, title });
      setBusyId(null);
      if (result.ok) {
        const label =
          type === "task" ? t("مهمة", "task") : type === "event" ? t("موعد", "event") : t("ملاحظة", "note");
        toast.success(t(`حُوّل إلى ${label}`, `Converted to a ${label}`));
        router.refresh();
      } else {
        toast.error(t("تعذّر التحويل", "Could not convert"), result.error);
      }
    });
  };

  const triage = (id: string) => {
    setTriageId(id);
    startTransition(async () => {
      const result = await suggestCaptureDestinationAction(id);
      setTriageId(null);
      if (result.ok) {
        router.refresh();
      } else {
        toast.warning(t("تعذّر التحليل", "Could not analyse this"), result.error);
      }
    });
  };

  const remove = (id: string) => {
    startTransition(async () => {
      const result = await deleteCaptureAction(id);
      setDeleteId(null);
      if (result.ok) {
        toast.success(t("حُذف العنصر", "Item removed"));
        router.refresh();
      } else {
        toast.error(t("تعذّر الحذف", "Could not delete"), result.error);
      }
    });
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 lg:px-8 lg:py-8">
      <PageHeader
        title={t("الوارد", "Inbox")}
        subtitle={t(
          `${items.length} عنصر بانتظار الفرز`,
          `${items.length} item(s) awaiting triage`,
        )}
      />

      {items.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-5 w-5" aria-hidden />}
          title={t("الوارد فارغ", "Inbox zero")}
          description={t(
            processedCount > 0
              ? `راجعت ${processedCount} عنصراً. كل شيء في مكانه.`
              : "التقط أي شيء وسيظهر هنا للفرز.",
            processedCount > 0
              ? `You've triaged ${processedCount} items. Everything is filed.`
              : "Capture anything and it will land here for triage.",
          )}
          action={
            <a href="/capture" className="btn-primary">
              <Sparkles className="h-4 w-4" aria-hidden />
              {t("التقاط", "Capture")}
            </a>
          }
        />
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const isBusy = busyId === item.id;
            const isTriaging = triageId === item.id;
            return (
              <li key={item.id} className="card p-4">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{item.raw}</p>

                    <div className="mt-2 flex flex-wrap items-center gap-2.5 text-[11px] text-ink-faint">
                      <span>{formatRelativeTime(item.createdAt, isArabic ? "ar" : "en")}</span>
                      {item.kind !== "text" ? (
                        <>
                          <span>·</span>
                          <span>{item.kind}</span>
                        </>
                      ) : null}
                    </div>

                    {item.suggestedType ? (
                      <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50/60 p-3">
                        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-900">
                          <Wand2 className="h-3 w-3" aria-hidden />
                          {t("اقتراح المساعد", "Assistant suggestion")}
                          {item.suggestionConfidence ? (
                            <span className="font-normal text-brand-700/70">
                              · {item.suggestionConfidence}
                            </span>
                          ) : null}
                        </p>
                        {item.suggestedTitle ? (
                          <p className="mt-1 text-[12px] font-medium text-brand-900">{item.suggestedTitle}</p>
                        ) : null}
                        {item.suggestionReason ? (
                          <p className="mt-0.5 text-[11px] leading-relaxed text-brand-800/70">
                            {item.suggestionReason}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={() => setDeleteId(item.id)}
                    className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-red-50 hover:text-red-600"
                    aria-label={t("حذف", "Delete")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    onClick={() => route(item.id, "task", item.suggestedTitle ?? undefined)}
                    disabled={isBusy}
                    className={cn("btn-secondary text-xs", item.suggestedType === "task" && "border-brand-300 bg-brand-50 text-brand-700")}
                  >
                    {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <CheckSquare className="h-3.5 w-3.5" aria-hidden />}
                    {t("مهمة", "Task")}
                  </button>
                  <button
                    type="button"
                    onClick={() => route(item.id, "note", item.suggestedTitle ?? undefined)}
                    disabled={isBusy}
                    className={cn("btn-secondary text-xs", item.suggestedType === "note" && "border-brand-300 bg-brand-50 text-brand-700")}
                  >
                    <FileText className="h-3.5 w-3.5" aria-hidden />
                    {t("ملاحظة", "Note")}
                  </button>
                  <button
                    type="button"
                    onClick={() => route(item.id, "event", item.suggestedTitle ?? undefined)}
                    disabled={isBusy}
                    className={cn("btn-secondary text-xs", item.suggestedType === "event" && "border-brand-300 bg-brand-50 text-brand-700")}
                  >
                    <Calendar className="h-3.5 w-3.5" aria-hidden />
                    {t("موعد", "Event")}
                  </button>

                  {!item.suggestedType ? (
                    <button
                      type="button"
                      onClick={() => triage(item.id)}
                      disabled={isTriaging}
                      className="btn-ghost ms-auto text-xs"
                    >
                      {isTriaging ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
                      {t("اقترح", "Suggest")}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={deleteId !== null}
        tone="danger"
        title={t("حذف هذا العنصر؟", "Delete this item?")}
        description={t(
          "لن ينتقل إلى أي مكان آخر. لا يمكن التراجع.",
          "It will not be filed anywhere. This cannot be undone.",
        )}
        confirmLabel={t("حذف", "Delete")}
        cancelLabel={t("إلغاء", "Cancel")}
        onConfirm={() => deleteId && remove(deleteId)}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
