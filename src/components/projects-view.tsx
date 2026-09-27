"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Folder, Loader2, Plus, Trash2, X } from "lucide-react";
import {
  createProject as createProjectAction,
  deleteProject as deleteProjectAction,
  updateProject as updateProjectAction,
} from "@/app/actions/tasks-bridge";
import { useToast } from "@/components/providers/toast-provider";
import { ConfirmDialog, EmptyState, PageHeader, ProgressRing } from "@/components/ui";
import { cn, colorFromString } from "@/lib/utils";

export type ProjectCard = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  status: string;
  targetDate: string | null;
  taskTotal: number;
  taskDone: number;
  noteCount: number;
};

const STATUS_LABEL: Record<string, { ar: string; en: string }> = {
  active: { ar: "نشط", en: "Active" },
  on_hold: { ar: "متوقف مؤقتاً", en: "On hold" },
  completed: { ar: "مكتمل", en: "Completed" },
  archived: { ar: "مؤرشف", en: "Archived" },
};

export function ProjectsView({
  projects,
  isArabic,
  openComposer,
}: {
  projects: ProjectCard[];
  isArabic: boolean;
  openComposer: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [composerOpen, setComposerOpen] = useState(openComposer);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ProjectCard | null>(null);
  const [isSaving, startSaveTransition] = useTransition();
  const [, startBusyTransition] = useTransition();

  const t = (ar: string, en: string) => (isArabic ? ar : en);

  const create = () => {
    if (!name.trim()) return;
    startSaveTransition(async () => {
      const result = await createProjectAction({
        name: name.trim(),
        description: description.trim() || null,
        color: colorFromString(name),
        targetDate: targetDate ? new Date(targetDate).toISOString() : null,
      });
      if (result.ok) {
        toast.success(t("أُنشئ المشروع", "Project created"));
        setName("");
        setDescription("");
        setTargetDate("");
        setComposerOpen(false);
        router.refresh();
      } else {
        toast.error(t("تعذّر الإنشاء", "Could not create the project"), result.error);
      }
    });
  };

  const remove = (project: ProjectCard) => {
    startBusyTransition(async () => {
      const result = await deleteProjectAction(project.id);
      setDeleteTarget(null);
      if (result.ok) {
        toast.success(t("حُذف المشروع", "Project deleted"), t("المهام المرتبطة بقيت في مكانها.", "Its tasks were kept."));
        router.refresh();
      } else {
        toast.error(t("تعذّر الحذف", "Could not delete"), result.error);
      }
    });
  };

  const setStatus = (project: ProjectCard, status: string) => {
    startBusyTransition(async () => {
      const result = await updateProjectAction(project.id, { status });
      if (result.ok) {
        router.refresh();
      } else {
        toast.error(t("تعذّر التحديث", "Could not update"), result.error);
      }
    });
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-8">
      <PageHeader
        title={t("المشاريع", "Projects")}
        subtitle={t(
          `${projects.filter((p) => p.status === "active").length} مشروع نشط`,
          `${projects.filter((p) => p.status === "active").length} active`,
        )}
        action={
          <button type="button" onClick={() => setComposerOpen((v) => !v)} className="btn-primary">
            {composerOpen ? <X className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
            {t("مشروع", "Project")}
          </button>
        }
      />

      {composerOpen ? (
        <div className="card mb-5 space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="project-name" className="label">
                {t("اسم المشروع", "Project name")}
              </label>
              <input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input"
                placeholder={t("إطلاق الموقع الجديد", "Launch the new site")}
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="project-target" className="label">
                {t("التاريخ المستهدف", "Target date")}
              </label>
              <input
                id="project-target"
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="input"
              />
            </div>
          </div>
          <div>
            <label htmlFor="project-desc" className="label">
              {t("الوصف", "Description")}
            </label>
            <textarea
              id="project-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="input resize-none"
              placeholder={t("ما الذي نريد تحقيقه؟", "What are we trying to achieve?")}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setComposerOpen(false)} className="btn-secondary">
              {t("إلغاء", "Cancel")}
            </button>
            <button type="button" onClick={create} disabled={isSaving || !name.trim()} className="btn-primary">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("إنشاء", "Create")}
            </button>
          </div>
        </div>
      ) : null}

      {projects.length === 0 ? (
        <EmptyState
          icon={<Folder className="h-5 w-5" aria-hidden />}
          title={t("لا مشاريع بعد", "No projects yet")}
          description={t(
            "المشروع يجمع المهام والملاحظات والأهداف على خط زمني واحد.",
            "A project gathers tasks, notes and goals onto one timeline.",
          )}
          action={
            <button type="button" onClick={() => setComposerOpen(true)} className="btn-primary">
              <Plus className="h-4 w-4" aria-hidden />
              {t("مشروع جديد", "New project")}
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const percent =
              project.taskTotal === 0 ? 0 : Math.round((project.taskDone / project.taskTotal) * 100);
            return (
              <article key={project.id} className="card group relative flex flex-col p-4">
                <div className="flex items-start gap-3">
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
                    style={{ backgroundColor: project.color }}
                    aria-hidden
                  >
                    <Folder className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link href={`/projects/${project.id}`} className="block">
                      <h3 className="truncate text-sm font-medium text-ink hover:text-brand-700">
                        {project.name}
                      </h3>
                    </Link>
                    <p className="mt-0.5 text-[11px] text-ink-faint">
                      {STATUS_LABEL[project.status]?.[isArabic ? "ar" : "en"] ?? project.status}
                      {project.targetDate
                        ? ` · ${new Intl.DateTimeFormat(isArabic ? "ar" : "en", { dateStyle: "medium" }).format(new Date(project.targetDate))}`
                        : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(project)}
                    className="rounded-lg p-1.5 text-ink-faint opacity-0 transition-all hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 focus:opacity-100"
                    aria-label={t("حذف", "Delete")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {project.description ? (
                  <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-ink-muted">
                    {project.description}
                  </p>
                ) : null}

                <div className="mt-4 flex items-center gap-3">
                  <ProgressRing value={percent} />
                  <div className="min-w-0 flex-1 text-[11px] text-ink-muted">
                    <p>
                      {project.taskDone}/{project.taskTotal} {t("مهمة", "tasks")}
                    </p>
                    <p className="text-ink-faint">
                      {project.noteCount} {t("ملاحظة", "notes")}
                    </p>
                  </div>
                </div>

                {project.status === "active" ? (
                  <button
                    type="button"
                    onClick={() => setStatus(project, "completed")}
                    className={cn(
                      "mt-3.5 w-full rounded-xl border border-slate-200 py-1.5 text-[11px] font-medium text-ink-muted",
                      "transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-ink",
                    )}
                  >
                    {t("وضع علامة مكتمل", "Mark complete")}
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        tone="danger"
        title={t("حذف المشروع؟", "Delete this project?")}
        description={t(
          "لن تُحذف المهام والملاحظات — ستبقى لكن بدون مشروع.",
          "Its tasks and notes are kept — they simply lose their project.",
        )}
        confirmLabel={t("حذف", "Delete")}
        cancelLabel={t("إلغاء", "Cancel")}
        onConfirm={() => deleteTarget && remove(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
