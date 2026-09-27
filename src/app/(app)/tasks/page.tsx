import type { Metadata } from "next";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { projects, tasks } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { UserScope } from "@/lib/db/scope";
import { TasksView } from "@/components/tasks-view";
import { startOfDay, endOfDay } from "@/lib/utils";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; new?: string; filter?: string }>;
}) {
  const user = await requireUser();
  const scope = new UserScope(user.id);
  const params = await searchParams;

  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());

  const [taskRows, projectRows, counts] = await Promise.all([
    db
      .select()
      .from(tasks)
      .where(scope.where(tasks))
      .orderBy(asc(tasks.position), desc(tasks.createdAt))
      .limit(500),
    db
      .select({ id: projects.id, name: projects.name, color: projects.color })
      .from(projects)
      .where(and(scope.where(projects), eq(projects.status, "active")))
      .orderBy(asc(projects.name)),
    db
      .select({
        open: sql<number>`count(*) filter (where ${tasks.status} in ('todo','in_progress','blocked'))::int`,
        today: sql<number>`count(*) filter (where ${tasks.dueAt} >= ${todayStart} and ${tasks.dueAt} <= ${todayEnd} and ${tasks.status} <> 'done')::int`,
        overdue: sql<number>`count(*) filter (where ${tasks.dueAt} < ${todayStart} and ${tasks.status} <> 'done')::int`,
        done: sql<number>`count(*) filter (where ${tasks.status} = 'done')::int`,
      })
      .from(tasks)
      .where(scope.where(tasks)),
  ]);

  const projectMap = new Map(projectRows.map((p) => [p.id, p]));

  return (
    <TasksView
      initialView={(params.view as "list" | "board") ?? "list"}
      openComposer={params.new === "1"}
      isArabic={user.locale === "ar"}
      counts={{
        open: counts[0]?.open ?? 0,
        today: counts[0]?.today ?? 0,
        overdue: counts[0]?.overdue ?? 0,
        done: counts[0]?.done ?? 0,
      }}
      projects={projectRows}
      tasks={taskRows.map((task) => ({
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        energy: task.energy,
        dueAt: task.dueAt ? task.dueAt.toISOString() : null,
        projectId: task.projectId,
        projectName: task.projectId ? projectMap.get(task.projectId)?.name ?? null : null,
        createdAt: task.createdAt.toISOString(),
      }))}
    />
  );
}
