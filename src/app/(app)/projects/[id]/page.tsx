import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { ChevronLeft, FileText } from "lucide-react";
import { db } from "@/db";
import { notes, projects, tasks } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { UserScope } from "@/lib/db/scope";
import { EmptyState, ProgressRing, SectionHeading, StatCard } from "@/components/ui";
import { TaskRow } from "@/components/task-row";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const scope = new UserScope(user.id);
  const { id } = await params;
  const isArabic = user.locale === "ar";
  const t = (ar: string, en: string) => (isArabic ? ar : en);

  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), scope.where(projects)))
    .limit(1);

  if (rows.length === 0) notFound();
  const project = rows[0];

  const [projectTasks, projectNotes, counts] = await Promise.all([
    db
      .select()
      .from(tasks)
      .where(and(scope.where(tasks), eq(tasks.projectId, id)))
      .orderBy(asc(tasks.status), asc(tasks.position))
      .limit(200),
    db
      .select()
      .from(notes)
      .where(and(scope.where(notes), eq(notes.projectId, id)))
      .orderBy(desc(notes.updatedAt))
      .limit(30),
    db
      .select({
        total: sql<number>`count(*)::int`,
        done: sql<number>`count(*) filter (where ${tasks.status} = 'done')::int`,
        overdue: sql<number>`count(*) filter (where ${tasks.dueAt} < now() and ${tasks.status} <> 'done')::int`,
        open: sql<number>`count(*) filter (where ${tasks.status} in ('todo','in_progress','blocked'))::int`,
      })
      .from(tasks)
      .where(and(scope.where(tasks), eq(tasks.projectId, id))),
  ]);

  const stats = counts[0] ?? { total: 0, done: 0, overdue: 0, open: 0 };
  const percent = stats.total === 0 ? 0 : Math.round((stats.done / stats.total) * 100);
  const openTasks = projectTasks.filter((task) => task.status !== "done" && task.status !== "cancelled");

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 lg:px-8 lg:py-8">
      <Link
        href="/projects"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-ink"
      >
        <ChevronLeft className="h-3.5 w-3.5 flip-rtl" aria-hidden />
        {t("كل المشاريع", "All projects")}
      </Link>

      <div className="mb-6 flex flex-wrap items-start gap-4">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-lg font-semibold text-white"
          style={{ backgroundColor: project.color }}
          aria-hidden
        >
          {project.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{project.name}</h1>
          {project.description ? (
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-muted">{project.description}</p>
          ) : null}
          {project.targetDate ? (
            <p className="mt-2 text-xs text-ink-faint">
              {t("التاريخ المستهدف", "Target")}: {formatDate(project.targetDate, isArabic ? "ar" : "en")}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-2.5">
          <ProgressRing value={percent} />
          <div className="text-xs">
            <p className="font-medium text-ink">{t("الإنجاز", "Progress")}</p>
            <p className="text-ink-faint">
              {stats.done}/{stats.total} {t("مهمة", "tasks")}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t("مفتوحة", "Open")} value={stats.open} />
        <StatCard label={t("مكتملة", "Done")} value={stats.done} tone="success" />
        <StatCard label={t("متأخرة", "Overdue")} value={stats.overdue} tone={stats.overdue > 0 ? "danger" : "default"} />
        <StatCard label={t("ملاحظات", "Notes")} value={projectNotes.length} />
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <SectionHeading title={t("المهام", "Tasks")} href="/tasks" actionLabel={t("كل المهام", "All tasks")} />
          {openTasks.length === 0 ? (
            <EmptyState
              title={t("لا مهام مفتوحة", "No open tasks")}
              description={t("أضف مهمة لهذا المشروع.", "Add a task to this project.")}
            />
          ) : (
            <ul className="space-y-1">
              {openTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  isArabic={isArabic}
                  task={{
                    id: task.id,
                    title: task.title,
                    status: task.status,
                    priority: task.priority,
                    energy: task.energy,
                    dueAt: task.dueAt ? task.dueAt.toISOString() : null,
                    projectId: task.projectId,
                  }}
                />
              ))}
            </ul>
          )}

          {projectTasks.filter((task) => task.status === "done").length > 0 ? (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-medium text-ink-muted hover:text-ink">
                {t("المكتملة", "Completed")} ({projectTasks.filter((task) => task.status === "done").length})
              </summary>
              <ul className="mt-2 space-y-1">
                {projectTasks
                  .filter((task) => task.status === "done")
                  .map((task) => (
                    <TaskRow
                      key={task.id}
                      isArabic={isArabic}
                      compact
                      task={{
                        id: task.id,
                        title: task.title,
                        status: task.status,
                        priority: task.priority,
                        energy: task.energy,
                        dueAt: task.dueAt ? task.dueAt.toISOString() : null,
                        projectId: task.projectId,
                      }}
                    />
                  ))}
              </ul>
            </details>
          ) : null}
        </section>

        <section className="lg:col-span-2">
          <SectionHeading title={t("الملاحظات", "Notes")} href="/notes" actionLabel={t("كل الملاحظات", "All notes")} />
          {projectNotes.length === 0 ? (
            <div className="card p-4">
              <p className="text-xs text-ink-muted">{t("لا ملاحظات مرتبطة.", "No linked notes.")}</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {projectNotes.map((note) => (
                <li key={note.id}>
                  <Link href={`/notes/${note.id}`} className="card-interactive flex items-start gap-2.5 p-3.5">
                    <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-ink">
                        {note.title || t("بدون عنوان", "Untitled")}
                      </span>
                      <span className="mt-0.5 block line-clamp-2 text-[11px] leading-relaxed text-ink-muted">
                        {note.contentText.slice(0, 120)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
