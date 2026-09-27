import type { Metadata } from "next";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { notes, projects } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { UserScope } from "@/lib/db/scope";
import { NotesView } from "@/components/notes-view";

export const metadata: Metadata = { title: "Notes" };

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; project?: string }>;
}) {
  const user = await requireUser();
  const scope = new UserScope(user.id);
  const params = await searchParams;

  const [noteRows, projectRows] = await Promise.all([
    db
      .select()
      .from(notes)
      .where(scope.where(notes))
      .orderBy(desc(notes.pinned), desc(notes.updatedAt))
      .limit(300),
    db
      .select({ id: projects.id, name: projects.name, color: projects.color })
      .from(projects)
      .where(and(scope.where(projects), eq(projects.status, "active")))
      .orderBy(projects.name),
  ]);

  return (
    <NotesView
      isArabic={user.locale === "ar"}
      openComposer={params.new === "1"}
      projects={projectRows}
      notes={noteRows.map((note) => ({
        id: note.id,
        title: note.title,
        excerpt: note.contentText.slice(0, 220),
        pinned: note.pinned,
        projectId: note.projectId,
        projectName: note.projectId ? projectRows.find((p) => p.id === note.projectId)?.name ?? null : null,
        updatedAt: note.updatedAt.toISOString(),
      }))}
    />
  );
}
