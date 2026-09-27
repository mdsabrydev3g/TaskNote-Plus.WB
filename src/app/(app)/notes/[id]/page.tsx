import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { notes, projects } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { UserScope } from "@/lib/db/scope";
import { NoteEditor } from "@/components/note-editor";

export const metadata: Metadata = { title: "Note" };

export default async function NoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const scope = new UserScope(user.id);
  const { id } = await params;

  const rows = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), scope.where(notes)))
    .limit(1);

  if (rows.length === 0) notFound();
  const note = rows[0];

  const projectRows = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(scope.where(projects), eq(projects.status, "active")))
    .orderBy(projects.name);

  return (
    <NoteEditor
      isArabic={user.locale === "ar"}
      projects={projectRows}
      note={{
        id: note.id,
        title: note.title,
        content: note.content ?? [],
        projectId: note.projectId,
        pinned: note.pinned,
        aiAccessible: note.aiAccessible,
        updatedAt: note.updatedAt.toISOString(),
      }}
    />
  );
}
