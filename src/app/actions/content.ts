"use server";

import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  captures,
  changeEvents,
  events,
  goalTasks,
  goals,
  notes,
  projects,
  tags,
  taskTags,
  tasks,
  type NoteBlock,
} from "@/db/schema";
import { UserScope, assertOwnership, ForbiddenError } from "@/lib/db/scope";
import { requireUser } from "@/lib/session";
import {
  captureInputSchema,
  eventInputSchema,
  eventUpdateSchema,
  goalInputSchema,
  noteInputSchema,
  noteUpdateSchema,
  projectInputSchema,
  projectUpdateSchema,
  taskInputSchema,
  taskUpdateSchema,
} from "@/lib/validation";
import { sha256 } from "@/lib/auth";
import { addDays } from "@/lib/utils";

export type ActionResult<T = unknown> = {
  ok: boolean;
  error?: string;
  data?: T;
};

/**
 * Records a ChangeEvent so the sync layer (§6.4) has an ordered log to replay
 * and so a future realtime transport can fan out without touching callers.
 */
async function recordChange(
  userId: string,
  entityType: string,
  entityId: string,
  operation: "create" | "update" | "delete",
  payload?: Record<string, unknown>,
) {
  const maxRow = await db
    .select({ clock: sql<number>`coalesce(max(${changeEvents.lamportClock}), 0)` })
    .from(changeEvents)
    .where(eq(changeEvents.userId, userId));

  await db.insert(changeEvents).values({
    userId,
    entityType,
    entityId,
    operation,
    payload: payload ?? null,
    lamportClock: (maxRow[0]?.clock ?? 0) + 1,
  });
}

function blocksToPlainText(blocks: NoteBlock[]): string {
  return blocks
    .map((b) => (b.type === "todo" ? `${b.checked ? "[x]" : "[ ]"} ${b.text}` : b.text))
    .join("\n");
}

// ── Notes ───────────────────────────────────────────────────────────────────

export async function createNoteAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const scope = new UserScope(user.id);
  const parsed = noteInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const { title, content, projectId, pinned, aiAccessible } = parsed.data;

  if (projectId) {
    const project = await db
      .select({ id: projects.id, userId: projects.userId })
      .from(projects)
      .where(and(eq(projects.id, projectId), scope.where(projects)))
      .limit(1);
    assertOwnership(project[0], scope);
  }

  const inserted = await db
    .insert(notes)
    .values({
      userId: user.id,
      projectId: projectId ?? null,
      title,
      content,
      contentText: blocksToPlainText(content),
      pinned: pinned ?? false,
      aiAccessible: aiAccessible ?? true,
    })
    .returning({ id: notes.id });

  await recordChange(user.id, "note", inserted[0].id, "create", { title });
  revalidatePath("/notes");
  revalidatePath("/dashboard");
  return { ok: true, data: { id: inserted[0].id } };
}

export async function updateNoteAction(
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const user = await requireUser();
  const scope = new UserScope(user.id);
  const parsed = noteUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const existing = await db
    .select({ id: notes.id, userId: notes.userId, version: notes.version })
    .from(notes)
    .where(and(eq(notes.id, id), scope.where(notes)))
    .limit(1);
  const note = assertOwnership(existing[0], scope);

  const patch: Record<string, unknown> = { updatedAt: new Date(), version: note.version + 1 };
  const { content, projectId, ...rest } = parsed.data;
  Object.assign(patch, rest);
  if (projectId !== undefined) patch.projectId = projectId;
  if (content !== undefined) {
    patch.content = content;
    patch.contentText = blocksToPlainText(content);
  }

  await db.update(notes).set(patch).where(and(eq(notes.id, id), scope.where(notes)));
  await recordChange(user.id, "note", id, "update");
  revalidatePath("/notes");
  revalidatePath(`/notes/${id}`);
  return { ok: true };
}

export async function deleteNoteAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  const scope = new UserScope(user.id);

  const existing = await db
    .select({ id: notes.id, userId: notes.userId })
    .from(notes)
    .where(and(eq(notes.id, id), scope.where(notes)))
    .limit(1);
  assertOwnership(existing[0], scope);

  // Soft delete keeps the row available for sync and undo (§15.4).
  await db.update(notes).set({ deletedAt: new Date() }).where(and(eq(notes.id, id), scope.where(notes)));
  await recordChange(user.id, "note", id, "delete");
  revalidatePath("/notes");
  return { ok: true };
}

export async function listNotesAction(options?: { projectId?: string | null; limit?: number }) {
  const user = await requireUser();
  const scope = new UserScope(user.id);
  const limit = options?.limit ?? 100;

  const conditions = [scope.where(notes)];
  if (options?.projectId) conditions.push(eq(notes.projectId, options.projectId));

  return db
    .select()
    .from(notes)
    .where(and(...conditions))
    .orderBy(desc(notes.pinned), desc(notes.updatedAt))
    .limit(limit);
}

// ── Tasks ───────────────────────────────────────────────────────────────────

export async function createTaskAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const scope = new UserScope(user.id);
  const parsed = taskInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  if (parsed.data.projectId) {
    const project = await db
      .select({ id: projects.id, userId: projects.userId })
      .from(projects)
      .where(and(eq(projects.id, parsed.data.projectId), scope.where(projects)))
      .limit(1);
    assertOwnership(project[0], scope);
  }

  const inserted = await db
    .insert(tasks)
    .values({
      userId: user.id,
      ...parsed.data,
      projectId: parsed.data.projectId ?? null,
      parentId: parsed.data.parentId ?? null,
    })
    .returning({ id: tasks.id });

  await recordChange(user.id, "task", inserted[0].id, "create", { title: parsed.data.title });
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  revalidatePath("/inbox");
  return { ok: true, data: { id: inserted[0].id } };
}

export async function updateTaskAction(id: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const scope = new UserScope(user.id);
  const parsed = taskUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const existing = await db
    .select({ id: tasks.id, userId: tasks.userId, version: tasks.version, status: tasks.status })
    .from(tasks)
    .where(and(eq(tasks.id, id), scope.where(tasks)))
    .limit(1);
  const task = assertOwnership(existing[0], scope);

  const patch: Record<string, unknown> = { updatedAt: new Date(), version: task.version + 1 };
  Object.assign(patch, parsed.data);

  // Completing a task stamps completedAt; reopening clears it.
  if (parsed.data.status && parsed.data.status !== task.status) {
    patch.completedAt = parsed.data.status === "done" ? new Date() : null;
  }

  await db.update(tasks).set(patch).where(and(eq(tasks.id, id), scope.where(tasks)));
  await recordChange(user.id, "task", id, "update");
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function toggleTaskAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  const scope = new UserScope(user.id);

  const existing = await db
    .select({ id: tasks.id, userId: tasks.userId, status: tasks.status, version: tasks.version })
    .from(tasks)
    .where(and(eq(tasks.id, id), scope.where(tasks)))
    .limit(1);
  const task = assertOwnership(existing[0], scope);

  const nextStatus = task.status === "done" ? "todo" : "done";
  await db
    .update(tasks)
    .set({
      status: nextStatus,
      completedAt: nextStatus === "done" ? new Date() : null,
      updatedAt: new Date(),
      version: task.version + 1,
    })
    .where(and(eq(tasks.id, id), scope.where(tasks)));

  await recordChange(user.id, "task", id, "update", { status: nextStatus });
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  revalidatePath("/goals");
  return { ok: true };
}

export async function deleteTaskAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  const scope = new UserScope(user.id);

  const existing = await db
    .select({ id: tasks.id, userId: tasks.userId })
    .from(tasks)
    .where(and(eq(tasks.id, id), scope.where(tasks)))
    .limit(1);
  assertOwnership(existing[0], scope);

  await db.update(tasks).set({ deletedAt: new Date() }).where(and(eq(tasks.id, id), scope.where(tasks)));
  await recordChange(user.id, "task", id, "delete");
  revalidatePath("/tasks");
  return { ok: true };
}

export async function listTasksAction(options?: {
  status?: string[];
  projectId?: string | null;
  inboxOnly?: boolean;
  dueBefore?: Date;
  limit?: number;
}) {
  const user = await requireUser();
  const scope = new UserScope(user.id);
  const conditions = [scope.where(tasks)];

  if (options?.status?.length) {
    conditions.push(inArray(tasks.status, options.status as never[]));
  }
  if (options?.projectId) conditions.push(eq(tasks.projectId, options.projectId));
  if (options?.inboxOnly) conditions.push(eq(tasks.isInbox, true));
  if (options?.dueBefore) conditions.push(sql`${tasks.dueAt} <= ${options.dueBefore}`);

  return db
    .select()
    .from(tasks)
    .where(and(...conditions))
    .orderBy(asc(tasks.position), desc(tasks.createdAt))
    .limit(options?.limit ?? 300);
}

// ── Projects ────────────────────────────────────────────────────────────────

export async function createProjectAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = projectInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const inserted = await db
    .insert(projects)
    .values({ userId: user.id, ...parsed.data })
    .returning({ id: projects.id });

  await recordChange(user.id, "project", inserted[0].id, "create", { name: parsed.data.name });
  revalidatePath("/projects");
  return { ok: true, data: { id: inserted[0].id } };
}

export async function updateProjectAction(id: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const scope = new UserScope(user.id);
  const parsed = projectUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const existing = await db
    .select({ id: projects.id, userId: projects.userId })
    .from(projects)
    .where(and(eq(projects.id, id), scope.where(projects)))
    .limit(1);
  assertOwnership(existing[0], scope);

  await db
    .update(projects)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(projects.id, id), scope.where(projects)));

  await recordChange(user.id, "project", id, "update");
  revalidatePath("/projects");
  revalidatePath(`/projects/${id}`);
  return { ok: true };
}

export async function deleteProjectAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  const scope = new UserScope(user.id);

  const existing = await db
    .select({ id: projects.id, userId: projects.userId })
    .from(projects)
    .where(and(eq(projects.id, id), scope.where(projects)))
    .limit(1);
  assertOwnership(existing[0], scope);

  await db
    .update(projects)
    .set({ deletedAt: new Date() })
    .where(and(eq(projects.id, id), scope.where(projects)));

  await recordChange(user.id, "project", id, "delete");
  revalidatePath("/projects");
  return { ok: true };
}

/** Progress rolls up from child task completion (§7.4). */
export async function projectProgressAction(projectId: string) {
  const user = await requireUser();
  const scope = new UserScope(user.id);

  const project = await db
    .select({ id: projects.id, userId: projects.userId })
    .from(projects)
    .where(and(eq(projects.id, projectId), scope.where(projects)))
    .limit(1);
  assertOwnership(project[0], scope);

  const rows = await db
    .select({ total: sql<number>`count(*)::int`, done: sql<number>`count(*) filter (where ${tasks.status} = 'done')::int` })
    .from(tasks)
    .where(and(scope.where(tasks), eq(tasks.projectId, projectId)));

  const total = rows[0]?.total ?? 0;
  const done = rows[0]?.done ?? 0;
  return { total, done, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

// ── Goals ───────────────────────────────────────────────────────────────────

export async function createGoalAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = goalInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const inserted = await db
    .insert(goals)
    .values({ userId: user.id, ...parsed.data, projectId: parsed.data.projectId ?? null })
    .returning({ id: goals.id });

  await recordChange(user.id, "goal", inserted[0].id, "create", { title: parsed.data.title });
  revalidatePath("/goals");
  return { ok: true, data: { id: inserted[0].id } };
}

export async function updateGoalAction(id: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const scope = new UserScope(user.id);
  const parsed = goalInputSchema.partial().safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const existing = await db
    .select({ id: goals.id, userId: goals.userId })
    .from(goals)
    .where(and(eq(goals.id, id), scope.where(goals)))
    .limit(1);
  assertOwnership(existing[0], scope);

  await db
    .update(goals)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(goals.id, id), scope.where(goals)));

  await recordChange(user.id, "goal", id, "update");
  revalidatePath("/goals");
  return { ok: true };
}

/** §7.6 habit check-in with opt-in grace days — never a guilt mechanic. */
export async function checkInGoalAction(id: string): Promise<ActionResult<{ streak: number }>> {
  const user = await requireUser();
  const scope = new UserScope(user.id);

  const existing = await db
    .select()
    .from(goals)
    .where(and(eq(goals.id, id), scope.where(goals)))
    .limit(1);
  const goal = assertOwnership(existing[0], scope);

  const now = new Date();
  const last = goal.lastCheckInAt;
  let streak = goal.streakCurrent;

  if (!last) {
    streak = 1;
  } else {
    const gapDays = Math.floor((now.getTime() - last.getTime()) / 86400000);
    if (gapDays === 0) {
      return { ok: true, data: { streak } }; // already checked in today
    }
    // Grace days let a habit survive a missed day or two depending on the
    // weekly allowance the user chose, so a single slip does not reset months.
    const allowedGap = 1 + Math.floor(goal.graceDaysPerWeek / 2);
    streak = gapDays <= allowedGap ? streak + 1 : 1;
  }

  const nextValue = Math.min(goal.targetValue, goal.currentValue + 1);

  await db
    .update(goals)
    .set({
      streakCurrent: streak,
      streakBest: Math.max(streak, goal.streakBest),
      lastCheckInAt: now,
      currentValue: nextValue,
      status: nextValue >= goal.targetValue && goal.kind === "habit" ? "achieved" : goal.status,
      updatedAt: now,
    })
    .where(and(eq(goals.id, id), scope.where(goals)));

  await recordChange(user.id, "goal", id, "update", { streak });
  revalidatePath("/goals");
  return { ok: true, data: { streak } };
}

export async function linkTasksToGoalAction(goalId: string, taskIds: string[]): Promise<ActionResult> {
  const user = await requireUser();
  const scope = new UserScope(user.id);

  const goal = await db
    .select({ id: goals.id, userId: goals.userId })
    .from(goals)
    .where(and(eq(goals.id, goalId), scope.where(goals)))
    .limit(1);
  assertOwnership(goal[0], scope);

  if (taskIds.length > 0) {
    const owned = await db
      .select({ id: tasks.id, userId: tasks.userId })
      .from(tasks)
      .where(and(inArray(tasks.id, taskIds), scope.where(tasks)));

    if (owned.length !== taskIds.length) throw new ForbiddenError();

    await db
      .insert(goalTasks)
      .values(taskIds.map((taskId) => ({ goalId, taskId, userId: user.id })))
      .onConflictDoNothing();
  }

  revalidatePath("/goals");
  return { ok: true };
}

/** Progress computed bottom-up from linked task completion (§7.6). */
export async function goalProgressAction(goalId: string) {
  const user = await requireUser();
  const scope = new UserScope(user.id);

  const rows = await db
    .select({
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(*) filter (where ${tasks.status} = 'done')::int`,
    })
    .from(goalTasks)
    .innerJoin(tasks, eq(goalTasks.taskId, tasks.id))
    .where(and(eq(goalTasks.goalId, goalId), eq(goalTasks.userId, user.id), scope.where(tasks)));

  const total = rows[0]?.total ?? 0;
  const done = rows[0]?.done ?? 0;
  return { total, done, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

// ── Calendar ────────────────────────────────────────────────────────────────

export async function createEventAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = eventInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const inserted = await db
    .insert(events)
    .values({
      userId: user.id,
      ...parsed.data,
      projectId: parsed.data.projectId ?? null,
      taskId: parsed.data.taskId ?? null,
    })
    .returning({ id: events.id });

  await recordChange(user.id, "event", inserted[0].id, "create", { title: parsed.data.title });
  revalidatePath("/calendar");
  return { ok: true, data: { id: inserted[0].id } };
}

export async function updateEventAction(id: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const scope = new UserScope(user.id);
  const parsed = eventUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const existing = await db
    .select({ id: events.id, userId: events.userId })
    .from(events)
    .where(and(eq(events.id, id), scope.where(events)))
    .limit(1);
  assertOwnership(existing[0], scope);

  await db
    .update(events)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(events.id, id), scope.where(events)));

  await recordChange(user.id, "event", id, "update");
  revalidatePath("/calendar");
  return { ok: true };
}

export async function deleteEventAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  const scope = new UserScope(user.id);

  const existing = await db
    .select({ id: events.id, userId: events.userId })
    .from(events)
    .where(and(eq(events.id, id), scope.where(events)))
    .limit(1);
  assertOwnership(existing[0], scope);

  await db.update(events).set({ deletedAt: new Date() }).where(and(eq(events.id, id), scope.where(events)));
  await recordChange(user.id, "event", id, "delete");
  revalidatePath("/calendar");
  return { ok: true };
}

export async function listEventsAction(rangeStart: Date, rangeEnd: Date) {
  const user = await requireUser();
  const scope = new UserScope(user.id);

  return db
    .select()
    .from(events)
    .where(
      and(
        scope.where(events),
        sql`${events.startAt} <= ${rangeEnd}`,
        or(sql`${events.endAt} >= ${rangeStart}`, sql`${events.recurrence} is not null`),
      ),
    )
    .orderBy(asc(events.startAt))
    .limit(500);
}

// ── Capture inbox (§7.1) ────────────────────────────────────────────────────

export async function captureAction(input: unknown): Promise<ActionResult<{ id: string; duplicate: boolean }>> {
  const user = await requireUser();
  const scope = new UserScope(user.id);
  const parsed = captureInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const { raw, kind, sourceUrl } = parsed.data;
  const contentHash = sha256(`${kind}:${raw.trim()}`);

  // Idempotency: identical content never creates a duplicate row (§7.1).
  const existing = await db
    .select({ id: captures.id })
    .from(captures)
    .where(and(scope.where(captures), eq(captures.contentHash, contentHash)))
    .limit(1);

  if (existing.length > 0) {
    return { ok: true, data: { id: existing[0].id, duplicate: true } };
  }

  const inserted = await db
    .insert(captures)
    .values({
      userId: user.id,
      kind,
      raw,
      contentHash,
      sourceUrl: sourceUrl ?? null,
    })
    .returning({ id: captures.id });

  await recordChange(user.id, "capture", inserted[0].id, "create");
  revalidatePath("/inbox");
  revalidatePath("/dashboard");
  return { ok: true, data: { id: inserted[0].id, duplicate: false } };
}

export async function listCapturesAction(inboxOnly = true) {
  const user = await requireUser();
  const scope = new UserScope(user.id);
  const conditions = [scope.where(captures)];
  if (inboxOnly) conditions.push(eq(captures.processed, false));

  return db
    .select()
    .from(captures)
    .where(and(...conditions))
    .orderBy(desc(captures.createdAt))
    .limit(200);
}

/** Routes a capture to a real entity and marks it processed. */
export async function routeCaptureAction(
  captureId: string,
  target: { type: "task" | "note" | "event"; title?: string },
): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const scope = new UserScope(user.id);

  const rows = await db
    .select()
    .from(captures)
    .where(and(eq(captures.id, captureId), scope.where(captures)))
    .limit(1);
  const capture = assertOwnership(rows[0], scope);

  const title = target.title?.trim() || capture.raw.split("\n")[0].slice(0, 200);
  let createdId = "";

  if (target.type === "task") {
    const r = await db
      .insert(tasks)
      .values({ userId: user.id, title, description: capture.raw })
      .returning({ id: tasks.id });
    createdId = r[0].id;
  } else if (target.type === "note") {
    const blocks: NoteBlock[] = [
      { id: "b1", type: "paragraph", text: capture.raw },
    ];
    const r = await db
      .insert(notes)
      .values({
        userId: user.id,
        title,
        content: blocks,
        contentText: capture.raw,
      })
      .returning({ id: notes.id });
    createdId = r[0].id;
  } else {
    const start = addDays(new Date(), 0);
    start.setHours(9, 0, 0, 0);
    const end = new Date(start.getTime() + 3600000);
    const r = await db
      .insert(events)
      .values({
        userId: user.id,
        title,
        description: capture.raw,
        startAt: start,
        endAt: end,
        timezone: user.timezone,
      })
      .returning({ id: events.id });
    createdId = r[0].id;
  }

  await db
    .update(captures)
    .set({
      processed: true,
      routedToType: target.type,
      routedToId: createdId,
      updatedAt: new Date(),
    })
    .where(and(eq(captures.id, captureId), scope.where(captures)));

  await recordChange(user.id, "capture", captureId, "update", { routedTo: target.type });
  revalidatePath("/inbox");
  revalidatePath("/tasks");
  revalidatePath("/notes");
  return { ok: true, data: { id: createdId } };
}

export async function deleteCaptureAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  const scope = new UserScope(user.id);

  const rows = await db
    .select({ id: captures.id, userId: captures.userId })
    .from(captures)
    .where(and(eq(captures.id, id), scope.where(captures)))
    .limit(1);
  assertOwnership(rows[0], scope);

  await db.update(captures).set({ deletedAt: new Date() }).where(and(eq(captures.id, id), scope.where(captures)));
  await recordChange(user.id, "capture", id, "delete");
  revalidatePath("/inbox");
  return { ok: true };
}

// ── Tags ────────────────────────────────────────────────────────────────────

export async function upsertTagAction(name: string, color?: string) {
  const user = await requireUser();
  const scope = new UserScope(user.id);
  const clean = name.trim().slice(0, 64);
  if (!clean) throw new ForbiddenError("Tag name is required");

  const existing = await db
    .select()
    .from(tags)
    .where(and(scope.whereWithDeleted(tags), eq(tags.name, clean)))
    .limit(1);

  if (existing.length > 0) return existing[0];

  const inserted = await db
    .insert(tags)
    .values({ userId: user.id, name: clean, color: color ?? "#64748b" })
    .returning();
  return inserted[0];
}

export async function listTagsAction() {
  const user = await requireUser();
  const scope = new UserScope(user.id);
  return db.select().from(tags).where(scope.whereWithDeleted(tags)).orderBy(asc(tags.name));
}

export async function tagTaskAction(taskId: string, tagId: string): Promise<ActionResult> {
  const user = await requireUser();
  const scope = new UserScope(user.id);

  const task = await db
    .select({ id: tasks.id, userId: tasks.userId })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), scope.where(tasks)))
    .limit(1);
  assertOwnership(task[0], scope);

  const tag = await db
    .select({ id: tags.id, userId: tags.userId })
    .from(tags)
    .where(and(eq(tags.id, tagId), scope.whereWithDeleted(tags)))
    .limit(1);
  assertOwnership(tag[0], scope);

  await db.insert(taskTags).values({ taskId, tagId, userId: user.id }).onConflictDoNothing();
  revalidatePath("/tasks");
  return { ok: true };
}

// ── Search (§7.10) ──────────────────────────────────────────────────────────

export type SearchHit = {
  type: "note" | "task" | "project" | "goal" | "event" | "capture";
  id: string;
  title: string;
  snippet: string;
  updatedAt: string;
  meta?: string;
};

/**
 * Hybrid-leaning search: Postgres full-text ranking via ILIKE + trigram-ish
 * matching for now, deliberately structured so a pgvector semantic pass can be
 * fused in later without changing the call sites (RRF fusion per §8.10).
 */
export async function searchAction(query: string, limit = 30): Promise<SearchHit[]> {
  const user = await requireUser();
  const scope = new UserScope(user.id);
  const q = query.trim();
  if (q.length < 1) return [];

  const like = `%${q}%`;
  const hits: SearchHit[] = [];

  const noteRows = await db
    .select({ id: notes.id, title: notes.title, text: notes.contentText, updatedAt: notes.updatedAt })
    .from(notes)
    .where(and(scope.where(notes), or(ilike(notes.title, like), ilike(notes.contentText, like))))
    .orderBy(desc(notes.updatedAt))
    .limit(limit);

  for (const row of noteRows) {
    hits.push({
      type: "note",
      id: row.id,
      title: row.title || "Untitled note",
      snippet: snippetAround(row.text, q),
      updatedAt: row.updatedAt.toISOString(),
    });
  }

  const taskRows = await db
    .select({ id: tasks.id, title: tasks.title, status: tasks.status, updatedAt: tasks.updatedAt })
    .from(tasks)
    .where(and(scope.where(tasks), ilike(tasks.title, like)))
    .orderBy(desc(tasks.updatedAt))
    .limit(limit);

  for (const row of taskRows) {
    hits.push({
      type: "task",
      id: row.id,
      title: row.title,
      snippet: "",
      updatedAt: row.updatedAt.toISOString(),
      meta: row.status,
    });
  }

  const projectRows = await db
    .select({ id: projects.id, name: projects.name, description: projects.description, updatedAt: projects.updatedAt })
    .from(projects)
    .where(and(scope.where(projects), or(ilike(projects.name, like), ilike(projects.description, like))))
    .orderBy(desc(projects.updatedAt))
    .limit(limit);

  for (const row of projectRows) {
    hits.push({
      type: "project",
      id: row.id,
      title: row.name,
      snippet: snippetAround(row.description ?? "", q),
      updatedAt: row.updatedAt.toISOString(),
    });
  }

  const goalRows = await db
    .select({ id: goals.id, title: goals.title, updatedAt: goals.updatedAt })
    .from(goals)
    .where(and(scope.where(goals), ilike(goals.title, like)))
    .orderBy(desc(goals.updatedAt))
    .limit(limit);

  for (const row of goalRows) {
    hits.push({
      type: "goal",
      id: row.id,
      title: row.title,
      snippet: "",
      updatedAt: row.updatedAt.toISOString(),
    });
  }

  const eventRows = await db
    .select({ id: events.id, title: events.title, startAt: events.startAt, updatedAt: events.updatedAt })
    .from(events)
    .where(and(scope.where(events), ilike(events.title, like)))
    .orderBy(desc(events.updatedAt))
    .limit(limit);

  for (const row of eventRows) {
    hits.push({
      type: "event",
      id: row.id,
      title: row.title,
      snippet: "",
      updatedAt: row.updatedAt.toISOString(),
      meta: row.startAt.toISOString(),
    });
  }

  const captureRows = await db
    .select({ id: captures.id, raw: captures.raw, updatedAt: captures.updatedAt })
    .from(captures)
    .where(and(scope.where(captures), ilike(captures.raw, like)))
    .orderBy(desc(captures.updatedAt))
    .limit(limit);

  for (const row of captureRows) {
    hits.push({
      type: "capture",
      id: row.id,
      title: row.raw.split("\n")[0].slice(0, 120),
      snippet: snippetAround(row.raw, q),
      updatedAt: row.updatedAt.toISOString(),
    });
  }

  // Blend recency with source priority so a recently touched item wins ties.
  const priority: Record<SearchHit["type"], number> = {
    task: 6, note: 5, project: 4, goal: 3, event: 2, capture: 1,
  };

  return hits
    .sort((a, b) => {
      const titleBoost =
        (b.title.toLowerCase().includes(q.toLowerCase()) ? 1 : 0) -
        (a.title.toLowerCase().includes(q.toLowerCase()) ? 1 : 0);
      if (titleBoost !== 0) return titleBoost;
      const age = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      if (Math.abs(age) > 86400000) return age;
      return priority[b.type] - priority[a.type];
    })
    .slice(0, limit);
}

function snippetAround(text: string, query: string, radius = 90): string {
  if (!text) return "";
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return text.slice(0, radius * 2);
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + query.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

// ── Dashboard aggregates ────────────────────────────────────────────────────

export async function dashboardAction() {
  const user = await requireUser();
  const scope = new UserScope(user.id);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const [openTasks, dueToday, overdue, doneThisWeek, inboxCount, activeProjects, activeGoals, todayEvents] =
    await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(and(scope.where(tasks), inArray(tasks.status, ["todo", "in_progress", "blocked"]))),
      db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(and(scope.where(tasks), sql`${tasks.dueAt} >= ${todayStart}`, sql`${tasks.dueAt} < ${todayEnd}`, sql`${tasks.status} <> 'done'`)),
      db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(and(scope.where(tasks), sql`${tasks.dueAt} < ${todayStart}`, sql`${tasks.status} <> 'done'`)),
      db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(and(scope.where(tasks), eq(tasks.status, "done"), sql`${tasks.completedAt} >= ${new Date(Date.now() - 7 * 86400000)}`)),
      db.select({ n: sql<number>`count(*)::int` }).from(captures).where(and(scope.where(captures), eq(captures.processed, false))),
      db.select({ n: sql<number>`count(*)::int` }).from(projects).where(and(scope.where(projects), eq(projects.status, "active"))),
      db.select({ n: sql<number>`count(*)::int` }).from(goals).where(and(scope.where(goals), eq(goals.status, "active"))),
      db.select().from(events).where(and(scope.where(events), sql`${events.startAt} >= ${todayStart}`, sql`${events.startAt} < ${todayEnd}`)).orderBy(asc(events.startAt)).limit(20),
    ]);

  return {
    openTasks: openTasks[0]?.n ?? 0,
    dueToday: dueToday[0]?.n ?? 0,
    overdue: overdue[0]?.n ?? 0,
    doneThisWeek: doneThisWeek[0]?.n ?? 0,
    inboxCount: inboxCount[0]?.n ?? 0,
    activeProjects: activeProjects[0]?.n ?? 0,
    activeGoals: activeGoals[0]?.n ?? 0,
    todayEvents,
  };
}
