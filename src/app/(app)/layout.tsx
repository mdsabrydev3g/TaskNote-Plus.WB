import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { AppShell, type NavCounts } from "@/components/app-shell";
import { db } from "@/db";
import { captures, events, goals, notes, projects, tasks } from "@/db/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  // Sidebar badges. Wrapped so a database hiccup never blocks the whole app;
  // counts degrade to 0 rather than taking the shell down.
  const counts: NavCounts = { inbox: 0, tasks: 0, notes: 0, projects: 0, events: 0, goals: 0 };
  try {
    const [inboxRow, taskRow, noteRow, projectRow, eventRow, goalRow] = await Promise.all([
      // Untriaged captures only — these are what still need attention.
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(captures)
        .where(and(eq(captures.userId, user.id), eq(captures.processed, false))),
      // Open tasks: completing or cancelling a task lowers this count.
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(tasks)
        .where(and(eq(tasks.userId, user.id), inArray(tasks.status, ["todo", "in_progress", "blocked"]))),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(notes)
        .where(and(eq(notes.userId, user.id), isNull(notes.deletedAt))),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(projects)
        .where(and(eq(projects.userId, user.id), inArray(projects.status, ["active", "on_hold"]))),
      // Upcoming and in-progress events only, not the entire history.
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(events)
        .where(and(eq(events.userId, user.id), sql`${events.endAt} >= now()`)),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(goals)
        .where(and(eq(goals.userId, user.id), eq(goals.status, "active"))),
    ]);

    counts.inbox = inboxRow[0]?.n ?? 0;
    counts.tasks = taskRow[0]?.n ?? 0;
    counts.notes = noteRow[0]?.n ?? 0;
    counts.projects = projectRow[0]?.n ?? 0;
    counts.events = eventRow[0]?.n ?? 0;
    counts.goals = goalRow[0]?.n ?? 0;
  } catch {
    // Leave the zeroed defaults.
  }

  return (
    <AppShell user={user} counts={counts}>
      {children}
    </AppShell>
  );
}
