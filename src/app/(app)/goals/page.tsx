import type { Metadata } from "next";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { goalTasks, goals, projects, tasks } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { UserScope } from "@/lib/db/scope";
import { GoalsView } from "@/components/goals-view";

export const metadata: Metadata = { title: "Goals" };

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const user = await requireUser();
  const scope = new UserScope(user.id);
  const params = await searchParams;

  const [goalRows, projectRows, linkCounts] = await Promise.all([
    db
      .select()
      .from(goals)
      .where(scope.where(goals))
      .orderBy(asc(goals.status), desc(goals.updatedAt)),
    db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(scope.where(projects), eq(projects.status, "active")))
      .orderBy(projects.name),
    db
      .select({
        goalId: goalTasks.goalId,
        total: sql<number>`count(*)::int`,
        done: sql<number>`count(*) filter (where ${tasks.status} = 'done')::int`,
      })
      .from(goalTasks)
      .innerJoin(tasks, eq(goalTasks.taskId, tasks.id))
      .where(and(eq(goalTasks.userId, user.id), scope.where(tasks)))
      .groupBy(goalTasks.goalId),
  ]);

  const linkMap = new Map(linkCounts.map((r) => [r.goalId, r]));

  return (
    <GoalsView
      isArabic={user.locale === "ar"}
      openComposer={params.new === "1"}
      projects={projectRows}
      goals={goalRows.map((goal) => ({
        id: goal.id,
        title: goal.title,
        description: goal.description,
        kind: goal.kind,
        metricType: goal.metricType,
        targetValue: goal.targetValue,
        currentValue: goal.currentValue,
        unit: goal.unit,
        dueDate: goal.dueDate ? goal.dueDate.toISOString() : null,
        status: goal.status,
        streakCurrent: goal.streakCurrent,
        streakBest: goal.streakBest,
        linkedTasks: linkMap.get(goal.id)?.total ?? 0,
        linkedDone: linkMap.get(goal.id)?.done ?? 0,
      }))}
    />
  );
}
