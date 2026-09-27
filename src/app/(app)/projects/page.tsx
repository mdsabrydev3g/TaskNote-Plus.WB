import type { Metadata } from "next";
import { asc, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { notes, projects, tasks } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { UserScope } from "@/lib/db/scope";
import { ProjectsView } from "@/components/projects-view";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const user = await requireUser();
  const scope = new UserScope(user.id);
  const params = await searchParams;

  const projectRows = await db
    .select()
    .from(projects)
    .where(scope.where(projects))
    .orderBy(asc(projects.status), desc(projects.updatedAt));

  // Aggregate counts per project in two grouped queries rather than N queries.
  const [taskCounts, noteCounts] = await Promise.all([
    db
      .select({
        projectId: tasks.projectId,
        total: sql<number>`count(*)::int`,
        done: sql<number>`count(*) filter (where ${tasks.status} = 'done')::int`,
      })
      .from(tasks)
      .where(scope.where(tasks))
      .groupBy(tasks.projectId),
    db
      .select({ projectId: notes.projectId, total: sql<number>`count(*)::int` })
      .from(notes)
      .where(scope.where(notes))
      .groupBy(notes.projectId),
  ]);

  const taskMap = new Map(taskCounts.map((r) => [r.projectId ?? "", r]));
  const noteMap = new Map(noteCounts.map((r) => [r.projectId ?? "", r.total]));

  return (
    <ProjectsView
      isArabic={user.locale === "ar"}
      openComposer={params.new === "1"}
      projects={projectRows.map((project) => {
        const counts = taskMap.get(project.id);
        return {
          id: project.id,
          name: project.name,
          description: project.description,
          color: project.color,
          status: project.status,
          targetDate: project.targetDate ? project.targetDate.toISOString() : null,
          taskTotal: counts?.total ?? 0,
          taskDone: counts?.done ?? 0,
          noteCount: noteMap.get(project.id) ?? 0,
        };
      })}
    />
  );
}
