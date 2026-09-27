"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Loader2, NotebookPen, Pin, Plus, Search, X } from "lucide-react";
import { createNote as createNoteAction } from "@/app/actions/tasks-bridge";
import { useToast } from "@/components/providers/toast-provider";
import { EmptyState, PageHeader } from "@/components/ui";
import { cn, formatRelativeTime, truncate } from "@/lib/utils";

export type NoteListItem = {
  id: string;
  title: string;
  excerpt: string;
  pinned: boolean;
  projectId: string | null;
  projectName: string | null;
  updatedAt: string;
};

export function NotesView({
  notes,
  projects,
  isArabic,
  openComposer,
}: {
  notes: NoteListItem[];
  projects: Array<{ id: string; name: string; color: string }>;
  isArabic: boolean;
  openComposer: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [composerOpen, setComposerOpen] = useState(openComposer);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [projectId, setProjectId] = useState("");
  const [isSaving, startSaveTransition] = useTransition();

  const t = (ar: string, en: string) => (isArabic ? ar : en);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes.filter((note) => {
      if (projectFilter && note.projectId !== projectFilter) return false;
      if (!q) return true;
      return (
        note.title.toLowerCase().includes(q) ||
        note.excerpt.toLowerCase().includes(q) ||
        (note.projectName ?? "").toLowerCase().includes(q)
      );
    });
  }, [notes, query, projectFilter]);

  const pinned = filtered.filter((n) => n.pinned);
  const rest = filtered.filter((n) => !n.pinned);

  const save = () => {
    if (!title.trim() && !body.trim()) return;
    startSaveTransition(async () => {
      const blocks = body
        .split("\n")
        .filter((line) => line.trim().length > 0 || true)
        .map((line, index) => ({
          id: `b${index}`,
          type: "paragraph" as const,
          text: line,
        }));

      const result = await createNoteAction({
        title: title.trim(),
        content: blocks.length > 0 ? blocks : [{ id: "b0", type: "paragraph", text: "" }],
        projectId: projectId || null,
      });

      if (result.ok && result.data) {
        toast.success(t("أُنشئت الملاحظة", "Note created"));
        setTitle("");
        setBody("");
        setProjectId("");
        setComposerOpen(false);
        router.push(`/notes/${result.data.id}`);
      } else {
        toast.error(t("تعذّر الإنشاء", "Could not create the note"), result.error);
      }
    });
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 lg:px-8 lg:py-8">
      <PageHeader
        title={t("الملاحظات", "Notes")}
        subtitle={t(`${notes.length} ملاحظة`, `${notes.length} notes`)}
        action={
          <button type="button" onClick={() => setComposerOpen((v) => !v)} className="btn-primary">
            {composerOpen ? <X className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
            {t("ملاحظة", "Note")}
          </button>
        }
      />

      {composerOpen ? (
        <div className="card mb-5 p-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("عنوان الملاحظة", "Note title")}
            className="w-full border-0 bg-transparent px-1 text-base font-medium text-ink placeholder:text-ink-faint focus:outline-none"
            autoFocus
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("ابدأ الكتابة...", "Start writing…")}
            rows={5}
            className="mt-2 w-full resize-none border-0 bg-transparent px-1 text-sm leading-relaxed text-ink-soft placeholder:text-ink-faint focus:outline-none"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="input max-w-[200px] text-xs"
              aria-label={t("المشروع", "Project")}
            >
              <option value="">{t("بدون مشروع", "No project")}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button type="button" onClick={() => setComposerOpen(false)} className="btn-secondary">
                {t("إلغاء", "Cancel")}
              </button>
              <button
                type="button"
                onClick={save}
                disabled={isSaving || (!title.trim() && !body.trim())}
                className="btn-primary"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {t("إنشاء وفتح", "Create & open")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("ابحث في الملاحظات...", "Search notes…")}
            className="input ps-9"
          />
        </div>
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="input w-auto text-xs"
          aria-label={t("تصفية بالمشروع", "Filter by project")}
        >
          <option value="">{t("كل المشاريع", "All projects")}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<NotebookPen className="h-5 w-5" aria-hidden />}
          title={query ? t("لا نتائج", "No matches") : t("لا ملاحظات بعد", "No notes yet")}
          description={
            query
              ? t("جرّب كلمة أخرى.", "Try a different word.")
              : t(
                  "الملاحظات هي ذاكرتك الخارجية — ابدأ بواحدة.",
                  "Notes are your external memory — start with one.",
                )
          }
          action={
            !query ? (
              <button type="button" onClick={() => setComposerOpen(true)} className="btn-primary">
                <Plus className="h-4 w-4" aria-hidden />
                {t("ملاحظة جديدة", "New note")}
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          {pinned.length > 0 ? (
            <section>
              <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
                <Pin className="h-3 w-3" aria-hidden />
                {t("مثبّتة", "Pinned")}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {pinned.map((note) => (
                  <NoteCard key={note.id} note={note} isArabic={isArabic} />
                ))}
              </div>
            </section>
          ) : null}

          {rest.length > 0 ? (
            <section>
              {pinned.length > 0 ? (
                <h2 className="mb-2 text-xs font-semibold text-ink-muted">{t("الأحدث", "Recent")}</h2>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {rest.map((note) => (
                  <NoteCard key={note.id} note={note} isArabic={isArabic} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function NoteCard({ note, isArabic }: { note: NoteListItem; isArabic: boolean }) {
  return (
    <Link href={`/notes/${note.id}`} className="card-interactive flex flex-col p-4">
      <div className="flex items-start gap-2">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
        <h3 className="min-w-0 flex-1 text-sm font-medium leading-snug text-ink">
          {note.title || (isArabic ? "بدون عنوان" : "Untitled")}
        </h3>
        {note.pinned ? <Pin className="h-3 w-3 shrink-0 text-brand-500" aria-hidden /> : null}
      </div>

      <p className="mt-2 line-clamp-3 flex-1 text-xs leading-relaxed text-ink-muted">
        {note.excerpt || (isArabic ? "ملاحظة فارغة" : "Empty note")}
      </p>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
        <span className="text-[11px] text-ink-faint">
          {formatRelativeTime(note.updatedAt, isArabic ? "ar" : "en")}
        </span>
        {note.projectName ? (
          <span className={cn("chip bg-slate-100 text-ink-muted")}>{truncate(note.projectName, 18)}</span>
        ) : null}
      </div>
    </Link>
  );
}
