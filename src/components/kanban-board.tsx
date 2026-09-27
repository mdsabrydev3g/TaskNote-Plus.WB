"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { CheckCircle2, Circle, Loader2, Trash2 } from "lucide-react";
import { updateTaskAction, deleteTaskAction } from "@/app/actions/content";
import { useToast } from "@/components/providers/toast-provider";
import { cn, formatRelativeTime, isOverdue } from "@/lib/utils";
import { KANBAN_COLUMNS, PRIORITY_META } from "@/lib/config";
import { ConfirmDialog } from "@/components/ui";

export type KanbanTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  energy: string;
  dueAt: string | null;
  projectId: string | null;
};

/**
 * Kanban view (§7.3). Moving a card is optimistically applied so the board
 * feels instant, then reconciled with the server result.
 */
export function KanbanBoard({
  tasks,
  isArabic,
}: {
  tasks: KanbanTask[];
  isArabic: boolean;
}) {
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [optimisticTasks, applyOptimistic] = useOptimistic(
    tasks,
    (state: KanbanTask[], action: { id: string; status: string }) =>
      state.map((t) => (t.id === action.id ? { ...t, status: action.status } : t)),
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const t = (ar: string, en: string) => (isArabic ? ar : en);

  const grouped = useMemo(() => {
    const map: Record<string, KanbanTask[]> = {};
    for (const column of KANBAN_COLUMNS) map[column.id] = [];
    for (const task of optimisticTasks) {
      const key = ["todo", "in_progress", "blocked", "done"].includes(task.status) ? task.status : "todo";
      map[key].push(task);
    }
    return map;
  }, [optimisticTasks]);

  const moveTask = (id: string, status: string) => {
    startTransition(async () => {
      applyOptimistic({ id, status });
      const result = await updateTaskAction(id, { status });
      if (!result.ok) {
        toast.error(t("تعذّر نقل المهمة", "Could not move the task"), result.error);
      }
    });
  };

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {KANBAN_COLUMNS.map((column) => {
        const items = grouped[column.id] ?? [];
        const isTarget = dropTarget === column.id;
        return (
          <section
            key={column.id}
            onDragOver={(e) => {
              e.preventDefault();
              setDropTarget(column.id);
            }}
            onDragLeave={() => setDropTarget((prev) => (prev === column.id ? null : prev))}
            onDrop={(e) => {
              e.preventDefault();
              setDropTarget(null);
              if (draggingId) moveTask(draggingId, column.id);
              setDraggingId(null);
            }}
            className={cn(
              "flex min-h-[200px] flex-col rounded-2xl border bg-slate-50/60 p-2.5 transition-colors",
              isTarget ? "border-brand-400 bg-brand-50/60" : "border-slate-200",
            )}
          >
            <header className="mb-2 flex items-center justify-between px-1.5 py-1">
              <h2 className="text-xs font-semibold text-ink-soft">
                {isArabic ? column.titleAr : column.titleEn}
              </h2>
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium tabular-nums text-ink-faint">
                {items.length}
              </span>
            </header>

            <div className="flex-1 space-y-2">
              {items.length === 0 ? (
                <p className="px-2 py-6 text-center text-[11px] text-ink-faint">
                  {t("اسحب مهمة هنا", "Drop a task here")}
                </p>
              ) : (
                items.map((task) => (
                  <KanbanCard
                    key={task.id}
                    task={task}
                    isArabic={isArabic}
                    isDragging={draggingId === task.id}
                    onDragStart={() => setDraggingId(task.id)}
                    onDragEnd={() => setDraggingId(null)}
                    onMove={moveTask}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function KanbanCard({
  task,
  isArabic,
  isDragging,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  task: KanbanTask;
  isArabic: boolean;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (id: string, status: string) => void;
}) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  const priorityMeta = PRIORITY_META[task.priority as keyof typeof PRIORITY_META] ?? PRIORITY_META.medium;
  const overdue = task.status !== "done" && isOverdue(task.dueAt);

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteTaskAction(task.id);
      if (!result.ok) {
        toast.error(isArabic ? "تعذّر الحذف" : "Could not delete", result.error);
      } else {
        toast.success(isArabic ? "حُذفت المهمة" : "Task deleted");
      }
      setConfirming(false);
    });
  };

  return (
    <>
      <article
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className={cn(
          "group cursor-grab rounded-xl border border-slate-200 bg-white p-3 shadow-card transition-all active:cursor-grabbing",
          isDragging && "opacity-50",
          isPending && "pointer-events-none opacity-60",
        )}
      >
        <div className="flex items-start gap-2">
          <span
            className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: priorityMeta.color }}
            title={isArabic ? priorityMeta.labelAr : priorityMeta.labelEn}
            aria-hidden
          />
          <p className={cn("min-w-0 flex-1 text-[13px] leading-snug text-ink", task.status === "done" && "line-through opacity-60")}>
            {task.title}
          </p>
        </div>

        <div className="mt-2.5 flex items-center justify-between gap-2">
          {task.dueAt ? (
            <span className={cn("text-[11px]", overdue ? "font-medium text-red-600" : "text-ink-faint")}>
              {formatRelativeTime(task.dueAt, isArabic ? "ar" : "en")}
            </span>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {task.status === "done" ? (
              <button
                type="button"
                onClick={() => onMove(task.id, "todo")}
                className="rounded-md p-1 text-ink-faint hover:bg-slate-100 hover:text-ink"
                aria-label={isArabic ? "إعادة فتح" : "Reopen"}
              >
                <Circle className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onMove(task.id, "done")}
                className="rounded-md p-1 text-ink-faint hover:bg-emerald-50 hover:text-emerald-600"
                aria-label={isArabic ? "إكمال" : "Complete"}
              >
                {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              </button>
            )}
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-md p-1 text-ink-faint hover:bg-red-50 hover:text-red-600"
              aria-label={isArabic ? "حذف" : "Delete"}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </article>

      <ConfirmDialog
        open={confirming}
        tone="danger"
        title={isArabic ? "حذف المهمة؟" : "Delete this task?"}
        description={
          isArabic
            ? "ستُنقل إلى المهملات ويمكن استعادتها من السجل لمدة محدودة."
            : "It moves to trash and can be restored from the activity log for a limited time."
        }
        confirmLabel={isArabic ? "حذف" : "Delete"}
        cancelLabel={isArabic ? "إلغاء" : "Cancel"}
        onConfirm={handleDelete}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
