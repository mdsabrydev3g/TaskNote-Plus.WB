"use client";

import { useOptimistic, useTransition } from "react";
import Link from "next/link";
import { CalendarClock, Check, Flame, Loader2 } from "lucide-react";
import { toggleTask as toggleTaskAction } from "@/app/actions/tasks-bridge";
import { useToast } from "@/components/providers/toast-provider";
import { cn, formatRelativeTime, isOverdue } from "@/lib/utils";
import { PRIORITY_META } from "@/lib/config";

export type TaskRowData = {
  id: string;
  title: string;
  status: string;
  priority: string;
  energy: string;
  dueAt: string | null;
  projectId: string | null;
  projectName?: string | null;
};

export function TaskRow({
  task,
  isArabic,
  compact = false,
  onSelect,
}: {
  task: TaskRowData;
  isArabic: boolean;
  compact?: boolean;
  onSelect?: (id: string) => void;
}) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [optimisticDone, setOptimisticDone] = useOptimistic(task.status === "done");

  const done = optimisticDone;
  const overdue = !done && isOverdue(task.dueAt);
  const priorityMeta = PRIORITY_META[task.priority as keyof typeof PRIORITY_META] ?? PRIORITY_META.medium;

  const handleToggle = () => {
    startTransition(async () => {
      setOptimisticDone(!done);
      const result = await toggleTaskAction(task.id);
      if (!result.ok) {
        toast.error(
          isArabic ? "تعذّر تحديث المهمة" : "Could not update the task",
          result.error,
        );
      } else if (!done) {
        // Completing is the moment worth acknowledging — briefly.
        toast.success(isArabic ? "أُنجزت" : "Task completed");
      }
    });
  };

  return (
    <li
      className={cn(
        "group flex items-start gap-3 rounded-xl border border-transparent bg-white px-3 py-2.5 transition-colors",
        "hover:border-slate-200 hover:shadow-card",
        done && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={handleToggle}
        disabled={isPending}
        aria-label={done ? (isArabic ? "إعادة فتح المهمة" : "Reopen task") : isArabic ? "إكمال المهمة" : "Complete task"}
        aria-pressed={done}
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all",
          done
            ? "border-emerald-500 bg-emerald-500 text-white"
            : "border-slate-300 bg-white hover:border-brand-400 hover:bg-brand-50",
        )}
      >
        {isPending ? (
          <Loader2 className="h-3 w-3 animate-spin text-ink-faint" aria-hidden />
        ) : done ? (
          <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
        ) : null}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => onSelect?.(task.id)}
            className={cn(
              "min-w-0 flex-1 text-start text-sm leading-snug text-ink",
              done && "line-through decoration-slate-400",
              onSelect && "hover:text-brand-700",
            )}
          >
            {task.title}
          </button>
          {task.priority === "urgent" || task.priority === "high" ? (
            <span
              className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: priorityMeta.color }}
              title={isArabic ? priorityMeta.labelAr : priorityMeta.labelEn}
              aria-hidden
            />
          ) : null}
        </div>

        {!compact ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
            {task.dueAt ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[11px]",
                  overdue ? "font-medium text-red-600" : "text-ink-faint",
                )}
              >
                <CalendarClock className="h-3 w-3" aria-hidden />
                {formatRelativeTime(task.dueAt, isArabic ? "ar" : "en")}
              </span>
            ) : null}
            {task.energy === "deep" ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-ink-faint">
                <Flame className="h-3 w-3" aria-hidden />
                {isArabic ? "تركيز" : "Deep"}
              </span>
            ) : null}
            {task.projectName ? (
              <Link href={`/projects/${task.projectId}`} className="text-[11px] text-brand-600 hover:text-brand-700">
                {task.projectName}
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}
