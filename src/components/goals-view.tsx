"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Flame, Loader2, Minus, Plus, Target, TrendingUp, X } from "lucide-react";
import {
  checkInGoal as checkInGoalAction,
  createGoal as createGoalAction,
  updateGoal as updateGoalAction,
} from "@/app/actions/tasks-bridge";
import { useToast } from "@/components/providers/toast-provider";
import { EmptyState, PageHeader } from "@/components/ui";
import { cn } from "@/lib/utils";

export type GoalCard = {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  metricType: string;
  targetValue: number;
  currentValue: number;
  unit: string | null;
  dueDate: string | null;
  status: string;
  streakCurrent: number;
  streakBest: number;
  linkedTasks: number;
  linkedDone: number;
};

export function GoalsView({
  goals,
  projects,
  isArabic,
  openComposer,
}: {
  goals: GoalCard[];
  projects: Array<{ id: string; name: string }>;
  isArabic: boolean;
  openComposer: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [composerOpen, setComposerOpen] = useState(openComposer);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"goal" | "habit">("goal");
  const [targetValue, setTargetValue] = useState("100");
  const [unit, setUnit] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [projectId, setProjectId] = useState("");
  const [isSaving, startSaveTransition] = useTransition();
  const [, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const t = (ar: string, en: string) => (isArabic ? ar : en);

  const active = goals.filter((g) => g.status === "active");
  const finished = goals.filter((g) => g.status !== "active");

  const create = () => {
    if (!title.trim()) return;
    startSaveTransition(async () => {
      const result = await createGoalAction({
        title: title.trim(),
        kind,
        metricType: unit ? "count" : "percent",
        targetValue: kind === "habit" ? Number(targetValue) || 30 : Number(targetValue) || 100,
        unit: unit.trim() || null,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        projectId: projectId || null,
      });
      if (result.ok) {
        toast.success(t("أُضيف الهدف", "Goal added"));
        setTitle("");
        setUnit("");
        setDueDate("");
        setProjectId("");
        setComposerOpen(false);
        router.refresh();
      } else {
        toast.error(t("تعذّر الإنشاء", "Could not create the goal"), result.error);
      }
    });
  };

  const checkIn = (goal: GoalCard) => {
    setBusyId(goal.id);
    startTransition(async () => {
      const result = await checkInGoalAction(goal.id);
      setBusyId(null);
      if (result.ok && result.data) {
        toast.success(
          t(`سلسلة ${result.data.streak} يوم`, `${result.data.streak}-day streak`),
          t("استمر — بلا ضغط.", "Keep going — no pressure."),
        );
        router.refresh();
      } else {
        toast.error(t("تعذّر التسجيل", "Could not check in"), result.error);
      }
    });
  };

  const adjustProgress = (goal: GoalCard, delta: number) => {
    const next = Math.max(0, Math.min(goal.targetValue, goal.currentValue + delta));
    setBusyId(goal.id);
    startTransition(async () => {
      const result = await updateGoalAction(goal.id, {
        currentValue: next,
        status: next >= goal.targetValue ? "achieved" : "active",
      });
      setBusyId(null);
      if (result.ok) router.refresh();
      else toast.error(t("تعذّر التحديث", "Could not update"), result.error);
    });
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 lg:px-8 lg:py-8">
      <PageHeader
        title={t("الأهداف والعادات", "Goals & habits")}
        subtitle={t(
          `${active.length} نشط · ${finished.length} مكتمل`,
          `${active.length} active · ${finished.length} completed`,
        )}
        action={
          <button type="button" onClick={() => setComposerOpen((v) => !v)} className="btn-primary">
            {composerOpen ? <X className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
            {t("هدف", "Goal")}
          </button>
        }
      />

      {composerOpen ? (
        <div className="card mb-5 space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="goal-title" className="label">
                {t("الهدف", "Goal")}
              </label>
              <input
                id="goal-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input"
                placeholder={t("أقرأ 12 كتاباً هذا العام", "Read 12 books this year")}
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="goal-kind" className="label">
                {t("النوع", "Type")}
              </label>
              <select
                id="goal-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as "goal" | "habit")}
                className="input"
              >
                <option value="goal">{t("هدف", "Goal")}</option>
                <option value="habit">{t("عادة يومية", "Daily habit")}</option>
              </select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="goal-target" className="label">
                {kind === "habit" ? t("عدد الأيام", "Target days") : t("القيمة المستهدفة", "Target")}
              </label>
              <input
                id="goal-target"
                type="number"
                min="1"
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label htmlFor="goal-unit" className="label">
                {t("الوحدة", "Unit")}
              </label>
              <input
                id="goal-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="input"
                placeholder={t("كتاب، دقيقة...", "books, minutes…")}
              />
            </div>
            <div>
              <label htmlFor="goal-due" className="label">
                {t("الموعد", "Due")}
              </label>
              <input
                id="goal-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="input"
              />
            </div>
          </div>

          {projects.length > 0 ? (
            <div>
              <label htmlFor="goal-project" className="label">
                {t("مرتبط بمشروع", "Linked project")}
              </label>
              <select
                id="goal-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="input"
              >
                <option value="">{t("بدون", "None")}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setComposerOpen(false)} className="btn-secondary">
              {t("إلغاء", "Cancel")}
            </button>
            <button type="button" onClick={create} disabled={isSaving || !title.trim()} className="btn-primary">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("إنشاء", "Create")}
            </button>
          </div>
        </div>
      ) : null}

      {goals.length === 0 ? (
        <EmptyState
          icon={<Target className="h-5 w-5" aria-hidden />}
          title={t("لا أهداف بعد", "No goals yet")}
          description={t(
            "الهدف يربط المهام اليومية بشيء أكبر. ابدأ بواحد.",
            "A goal ties daily tasks to something larger. Start with one.",
          )}
          action={
            <button type="button" onClick={() => setComposerOpen(true)} className="btn-primary">
              <Plus className="h-4 w-4" aria-hidden />
              {t("هدف جديد", "New goal")}
            </button>
          }
        />
      ) : (
        <div className="space-y-8">
          {active.length > 0 ? (
            <section>
              <h2 className="mb-3 text-xs font-semibold text-ink-muted">{t("نشطة", "Active")}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {active.map((goal) => (
                  <GoalItem
                    key={goal.id}
                    goal={goal}
                    isArabic={isArabic}
                    busy={busyId === goal.id}
                    onCheckIn={() => checkIn(goal)}
                    onAdjust={(delta) => adjustProgress(goal, delta)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {finished.length > 0 ? (
            <section>
              <h2 className="mb-3 text-xs font-semibold text-ink-muted">{t("مكتملة", "Completed")}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {finished.map((goal) => (
                  <GoalItem
                    key={goal.id}
                    goal={goal}
                    isArabic={isArabic}
                    busy={busyId === goal.id}
                    onCheckIn={() => checkIn(goal)}
                    onAdjust={(delta) => adjustProgress(goal, delta)}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function GoalItem({
  goal,
  isArabic,
  busy,
  onCheckIn,
  onAdjust,
}: {
  goal: GoalCard;
  isArabic: boolean;
  busy: boolean;
  onCheckIn: () => void;
  onAdjust: (delta: number) => void;
}) {
  const t = (ar: string, en: string) => (isArabic ? ar : en);

  // §7.6 progress computed bottom-up from linked task completion when tasks
  // are linked; otherwise fall back to the manually tracked value.
  const usingTasks = goal.linkedTasks > 0;
  const percent = usingTasks
    ? Math.round((goal.linkedDone / goal.linkedTasks) * 100)
    : goal.targetValue === 0
      ? 0
      : Math.min(100, Math.round((goal.currentValue / goal.targetValue) * 100));

  const isHabit = goal.kind === "habit";

  return (
    <article className="card flex flex-col p-4">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
            isHabit ? "bg-amber-50 text-amber-600" : "bg-brand-50 text-brand-600",
          )}
        >
          {isHabit ? <Flame className="h-4 w-4" aria-hidden /> : <TrendingUp className="h-4 w-4" aria-hidden />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium leading-snug text-ink">{goal.title}</h3>
          {goal.description ? (
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-ink-muted">{goal.description}</p>
          ) : null}
        </div>
        {goal.status === "achieved" ? (
          <span className="chip shrink-0 bg-emerald-50 text-emerald-700">
            <Check className="h-3 w-3" aria-hidden />
            {t("تم", "Done")}
          </span>
        ) : null}
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-[11px]">
          <span className="text-ink-muted">
            {usingTasks
              ? t(`${goal.linkedDone} من ${goal.linkedTasks} مهمة`, `${goal.linkedDone} of ${goal.linkedTasks} tasks`)
              : `${goal.currentValue} / ${goal.targetValue}${goal.unit ? ` ${goal.unit}` : ""}`}
          </span>
          <span className="font-medium tabular-nums text-ink">{percent}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              percent >= 100 ? "bg-emerald-500" : isHabit ? "bg-amber-500" : "bg-brand-500",
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {isHabit ? (
        <div className="mt-3.5 flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px]">
            <Flame className={cn("h-3.5 w-3.5", goal.streakCurrent > 0 ? "text-amber-500" : "text-ink-faint")} aria-hidden />
            <span className="font-medium text-ink">{goal.streakCurrent}</span>
            <span className="text-ink-faint">
              {t(`يوم · الأفضل ${goal.streakBest}`, `days · best ${goal.streakBest}`)}
            </span>
          </div>
          <button
            type="button"
            onClick={onCheckIn}
            disabled={busy}
            className="btn bg-amber-100 text-amber-800 hover:bg-amber-200"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
            {t("سجّل اليوم", "Check in")}
          </button>
        </div>
      ) : !usingTasks ? (
        <div className="mt-3.5 flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => onAdjust(-1)}
            disabled={busy || goal.currentValue <= 0}
            className="rounded-lg border border-slate-200 p-1.5 text-ink-muted transition-colors hover:bg-slate-50 disabled:opacity-40"
            aria-label={t("تقليل", "Decrease")}
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onAdjust(1)}
            disabled={busy || goal.currentValue >= goal.targetValue}
            className="rounded-lg border border-slate-200 p-1.5 text-ink-muted transition-colors hover:bg-slate-50 disabled:opacity-40"
            aria-label={t("زيادة", "Increase")}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          </button>
        </div>
      ) : null}
    </article>
  );
}
