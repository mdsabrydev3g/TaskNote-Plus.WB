"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckSquare,
  Columns3,
  Filter,
  LayoutList,
  Loader2,
  Plus,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { createTask as createTaskAction, parseQuickAdd as parseQuickAddAction } from "@/app/actions/tasks-bridge";
import { useToast } from "@/components/providers/toast-provider";
import { KanbanBoard } from "@/components/kanban-board";
import { TaskRow } from "@/components/task-row";
import { EmptyState, PageHeader } from "@/components/ui";
import { cn } from "@/lib/utils";

export type TasksViewTask = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  energy: string;
  dueAt: string | null;
  projectId: string | null;
  projectName: string | null;
  createdAt: string;
};

type FilterKey = "open" | "today" | "overdue" | "done" | "all";

export function TasksView({
  tasks,
  projects,
  counts,
  isArabic,
  initialView,
  openComposer,
}: {
  tasks: TasksViewTask[];
  projects: Array<{ id: string; name: string; color: string }>;
  counts: { open: number; today: number; overdue: number; done: number };
  isArabic: boolean;
  initialView: "list" | "board";
  openComposer: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<"list" | "board">(initialView);
  const [filter, setFilter] = useState<FilterKey>("open");
  const [composerOpen, setComposerOpen] = useState(openComposer);
  const [isPending, startTransition] = useTransition();

  const t = (ar: string, en: string) => (isArabic ? ar : en);

  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);
  const todayEnd = todayStart + 86400000;

  const filtered = useMemo(() => {
    return tasks.filter((task) => {
      const due = task.dueAt ? new Date(task.dueAt).getTime() : null;
      switch (filter) {
        case "open":
          return task.status !== "done" && task.status !== "cancelled";
        case "today":
          return due !== null && due >= todayStart && due < todayEnd && task.status !== "done";
        case "overdue":
          return due !== null && due < todayStart && task.status !== "done";
        case "done":
          return task.status === "done";
        default:
          return true;
      }
    });
  }, [tasks, filter, todayStart, todayEnd]);

  const filters: Array<{ key: FilterKey; label: string; count: number }> = [
    { key: "open", label: t("مفتوحة", "Open"), count: counts.open },
    { key: "today", label: t("اليوم", "Today"), count: counts.today },
    { key: "overdue", label: t("متأخرة", "Overdue"), count: counts.overdue },
    { key: "done", label: t("مكتملة", "Done"), count: counts.done },
    { key: "all", label: t("الكل", "All"), count: tasks.length },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-8">
      <PageHeader
        title={t("المهام", "Tasks")}
        subtitle={t(
          `${counts.open} مهمة مفتوحة · ${counts.today} اليوم · ${counts.overdue} متأخرة`,
          `${counts.open} open · ${counts.today} due today · ${counts.overdue} overdue`,
        )}
        action={
          <>
            <div className="flex rounded-xl border border-slate-200 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setView("list")}
                aria-pressed={view === "list"}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                  view === "list" ? "bg-slate-100 text-ink" : "text-ink-faint hover:text-ink",
                )}
              >
                <LayoutList className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">{t("قائمة", "List")}</span>
              </button>
              <button
                type="button"
                onClick={() => setView("board")}
                aria-pressed={view === "board"}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                  view === "board" ? "bg-slate-100 text-ink" : "text-ink-faint hover:text-ink",
                )}
              >
                <Columns3 className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">{t("لوحة", "Board")}</span>
              </button>
            </div>
            <button type="button" onClick={() => setComposerOpen(true)} className="btn-primary">
              <Plus className="h-4 w-4" aria-hidden />
              {t("مهمة", "Task")}
            </button>
          </>
        }
      />

      {composerOpen ? (
        <TaskComposer
          isArabic={isArabic}
          projects={projects}
          onClose={() => setComposerOpen(false)}
          onCreated={() => {
            setComposerOpen(false);
            startTransition(() => router.refresh());
          }}
        />
      ) : null}

      {view === "list" ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-ink-faint" aria-hidden />
            {filters.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  filter === f.key
                    ? "bg-brand-600 text-white"
                    : "border border-slate-200 bg-white text-ink-soft hover:border-slate-300",
                )}
              >
                {f.label}
                <span className={cn("ms-1.5 tabular-nums", filter === f.key ? "text-brand-100" : "text-ink-faint")}>
                  {f.count}
                </span>
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={<CheckSquare className="h-5 w-5" aria-hidden />}
              title={t("لا مهام في هذا العرض", "Nothing in this view")}
              description={t(
                "جرّب مرشحاً آخر، أو أضف مهمة جديدة.",
                "Try another filter, or add a new task.",
              )}
              action={
                <button type="button" onClick={() => setComposerOpen(true)} className="btn-primary">
                  <Plus className="h-4 w-4" aria-hidden />
                  {t("مهمة جديدة", "New task")}
                </button>
              }
            />
          ) : (
            <ul className="space-y-1">
              {filtered.map((task) => (
                <TaskRow
                  key={task.id}
                  isArabic={isArabic}
                  task={{
                    id: task.id,
                    title: task.title,
                    status: task.status,
                    priority: task.priority,
                    energy: task.energy,
                    dueAt: task.dueAt,
                    projectId: task.projectId,
                    projectName: task.projectName,
                  }}
                />
              ))}
            </ul>
          )}
        </>
      ) : (
        <KanbanBoard
          isArabic={isArabic}
          tasks={filtered.map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            priority: task.priority,
            energy: task.energy,
            dueAt: task.dueAt,
            projectId: task.projectId,
          }))}
        />
      )}

      {isPending ? (
        <div className="fixed bottom-24 end-6 z-40 flex items-center gap-2 rounded-full bg-ink/90 px-3.5 py-2 text-xs text-white shadow-pop lg:bottom-8">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          {t("جارٍ الحفظ", "Saving")}
        </div>
      ) : null}
    </div>
  );
}

// ── Composer with AI-assisted natural-language quick add (§7.3) ─────────────

function TaskComposer({
  isArabic,
  projects,
  onClose,
  onCreated,
}: {
  isArabic: boolean;
  projects: Array<{ id: string; name: string; color: string }>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState("medium");
  const [energy, setEnergy] = useState("admin");
  const [projectId, setProjectId] = useState("");
  const [nlQuery, setNlQuery] = useState("");
  const [isAiPending, startAiTransition] = useTransition();
  const [isSaving, startSaveTransition] = useTransition();

  const t = (ar: string, en: string) => (isArabic ? ar : en);

  const runQuickAdd = () => {
    if (!nlQuery.trim()) return;
    startAiTransition(async () => {
      const result = await parseQuickAddAction(nlQuery);
      if (result.ok && result.data) {
        const { proposal } = result.data;
        setTitle(proposal.title);
        setPriority(proposal.priority);
        setEnergy(proposal.energy);
        if (proposal.dueAt) {
          const d = new Date(proposal.dueAt);
          const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
          setDueAt(local.toISOString().slice(0, 16));
        }
        const match = projects.find(
          (p) => proposal.projectHint && p.name.toLowerCase() === proposal.projectHint.toLowerCase(),
        );
        if (match) setProjectId(match.id);
        setNlQuery("");
        // §7.3 natural-language add must be *visible* before commit.
        toast.info(
          t("راجع التفاصيل ثم احفظ", "Review the details, then save"),
          t("لم يُحفظ شيء بعد.", "Nothing is saved yet."),
        );
      } else {
        toast.error(t("تعذّر التحليل", "Could not parse that"), result.error);
      }
    });
  };

  const save = () => {
    if (!title.trim()) return;
    startSaveTransition(async () => {
      const result = await createTaskAction({
        title: title.trim(),
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        priority,
        energy,
        projectId: projectId || null,
      });
      if (result.ok) {
        toast.success(t("أُضيفت المهمة", "Task added"));
        onCreated();
      } else {
        toast.error(t("تعذّر الحفظ", "Could not save"), result.error);
      }
    });
  };

  return (
    <div className="card mb-5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">{t("مهمة جديدة", "New task")}</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-ink-faint hover:bg-slate-100"
          aria-label={t("إغلاق", "Close")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Natural-language shortcut */}
      <div className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Wand2 className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-500" aria-hidden />
          <input
            value={nlQuery}
            onChange={(e) => setNlQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runQuickAdd();
              }
            }}
            placeholder={t(
              "اكتب بلغتك: \"اتصل بأحمد بكرة الصبح\"",
              "Type naturally: \"call Ahmed tomorrow morning\"",
            )}
            className="input ps-9"
          />
        </div>
        <button
          type="button"
          onClick={runQuickAdd}
          disabled={isAiPending || !nlQuery.trim()}
          className="btn-secondary shrink-0"
        >
          {isAiPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
          {t("حلّل", "Parse")}
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label htmlFor="task-title" className="label">
            {t("العنوان", "Title")}
          </label>
          <input
            id="task-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
            }}
            className="input"
            placeholder={t("ما الذي يحتاج أن يُنجز؟", "What needs to get done?")}
            autoFocus
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="task-due" className="label">
              {t("الاستحقاق", "Due")}
            </label>
            <input
              id="task-due"
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label htmlFor="task-priority" className="label">
              {t("الأولوية", "Priority")}
            </label>
            <select id="task-priority" value={priority} onChange={(e) => setPriority(e.target.value)} className="input">
              <option value="low">{t("منخفضة", "Low")}</option>
              <option value="medium">{t("متوسطة", "Medium")}</option>
              <option value="high">{t("مرتفعة", "High")}</option>
              <option value="urgent">{t("عاجلة", "Urgent")}</option>
            </select>
          </div>
          <div>
            <label htmlFor="task-energy" className="label">
              {t("نوع الجهد", "Energy")}
            </label>
            <select id="task-energy" value={energy} onChange={(e) => setEnergy(e.target.value)} className="input">
              <option value="deep">{t("تركيز عميق", "Deep work")}</option>
              <option value="light">{t("عمل خفيف", "Light work")}</option>
              <option value="admin">{t("إداري", "Admin")}</option>
            </select>
          </div>
          <div>
            <label htmlFor="task-project" className="label">
              {t("المشروع", "Project")}
            </label>
            <select id="task-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="input">
              <option value="">{t("بدون", "None")}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary">
            {t("إلغاء", "Cancel")}
          </button>
          <button type="button" onClick={save} disabled={isSaving || !title.trim()} className="btn-primary">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {t("حفظ المهمة", "Save task")}
          </button>
        </div>
      </div>
    </div>
  );
}
