"use server";

import { and, asc, desc, eq, gte, inArray, isNotNull, lt, lte, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  aiActionLogs,
  aiMemories,
  captures,
  chatMessages,
  chatThreads,
  events,
  goals,
  notes,
  permissionGrants,
  projects,
  tasks,
  type Citation,
} from "@/db/schema";
import { UserScope, assertOwnership } from "@/lib/db/scope";
import { requireUser } from "@/lib/session";
import { generate, aiStatus, parseJsonLoose, anyProviderSupportsTools, type ChatMessage } from "@/lib/ai/gateway";
import { TOOL_DEFINITIONS, runTool } from "@/lib/ai/tools";
import { ALL_SCOPES, SOURCE_SCOPE, TOOL_SCOPE } from "@/lib/ai/scopes";
import {
  DATA_BOUNDARY_INSTRUCTION,
  GENERAL_ASSISTANT_INSTRUCTION,
  detectPiiCategories,
  fenceUntrusted,
} from "@/lib/ai/safety";
import { chatInputSchema } from "@/lib/validation";
import {
  AI_REVERSIBLE_HOURS,
  ASSISTANT_MODE,
  ASSISTANT_TOOLS_ENABLED,
} from "@/lib/config";

export type AiResult<T = unknown> = {
  ok: boolean;
  error?: string;
  degraded?: boolean;
  data?: T;
};

export async function getAiStatusAction() {
  return aiStatus();
}

/**
 * The assistant's system prompt. Note that nothing user-authored is ever
 * interpolated here — workspace content only arrives through fenced blocks
 * in the user turn (§8.3).
 */
const SYSTEM_PROMPT = [
  "You are the TaskNote Plus assistant — a productivity assistant for one person's private workspace.",
  "You help with planning, summarising, extracting action items, and answering questions about the user's own notes, tasks, projects and goals.",
  "",
  ASSISTANT_MODE === "general" ? GENERAL_ASSISTANT_INSTRUCTION : DATA_BOUNDARY_INSTRUCTION,
  "",
  "When the user asks you to create or add something, you MUST call the tool whose destination matches what they named. Never substitute a different kind of item.",
  "",
  "Routing rules — pick the destination from the user's own wording:",
  "- They say project / مشروع / initiative / campaign / client → create_project (lands in /projects).",
  "- They say goal / هدف / target / habit / عادة / a measurable number to reach → create_goal (lands in /goals).",
  "- They say meeting / appointment / الاجتماع / موعد / a clock time → create_event (lands in /calendar).",
  "- They say task / todo / مهمة / remind me / 'I need to' → create_task (lands in /tasks).",
  "- They say note / ملاحظة / 'write down' / 'save this info' / reference text → create_note (lands in /notes).",
  "If two destinations seem plausible, prefer the more specific one (project or goal over note) and say which you chose.",
  "After a tool succeeds, tell the user the item's name and which section it now lives in.",
  "",
  "Style: concise, specific, no filler. Match the user's language (Arabic or English).",
  "Arabic responses should read as natural Modern Standard Arabic unless the user writes in a dialect, in which case mirror their tone.",
  "When you list action items, prefer short imperative sentences.",
  "Never invent details about the user's own data — if the workspace does not contain it, say so.",
].join("\n");

async function logAiAction(params: {
  userId: string;
  capability: string;
  provider: string;
  model: string;
  promptHash?: string;
  inputRefs?: string[];
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
  outcome?: string;
  payload?: Record<string, unknown>;
}) {
  await db.insert(aiActionLogs).values({
    userId: params.userId,
    capability: params.capability,
    provider: params.provider,
    model: params.model,
    promptHash: params.promptHash ?? null,
    inputRefs: params.inputRefs ?? [],
    tokensIn: params.tokensIn ?? 0,
    tokensOut: params.tokensOut ?? 0,
    latencyMs: params.latencyMs ?? 0,
    outcome: params.outcome ?? "success",
    payload: params.payload ?? null,
    reversibleUntil: new Date(Date.now() + AI_REVERSIBLE_HOURS * 3600000),
  });
}

// ── Summarise a note ────────────────────────────────────────────────────────

export async function summarizeNoteAction(noteId: string): Promise<AiResult<{ summary: string }>> {
  const user = await requireUser();
  const scope = new UserScope(user.id);

  const rows = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), scope.where(notes)))
    .limit(1);
  const note = assertOwnership(rows[0], scope);

  // Respect the per-entity AI access flag (§4 Understand).
  if (!note.aiAccessible) {
    return { ok: false, error: "AI access is disabled for this note. Enable it in the note menu first." };
  }

  const status = aiStatus();
  if (!status.available) {
    return {
      ok: false,
      degraded: true,
      error: "No AI provider is configured. Add a free provider key (Groq, Google AI, or OpenRouter) or run Ollama locally.",
    };
  }

  const body = fenceUntrusted(`note:${note.title || "untitled"}`, note.contentText || "(empty note)");

  const result = await generate({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          "Summarise the following note in 2–4 sentences, then list up to 5 key points as bullets.",
          "Use the same language as the note.",
          "",
          body,
        ].join("\n"),
      },
    ],
    temperature: 0.3,
    maxTokens: 700,
  });

  await logAiAction({
    userId: user.id,
    capability: "summarize_note",
    provider: result.provider,
    model: result.model,
    inputRefs: [`note:${noteId}`],
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    latencyMs: result.latencyMs,
    outcome: result.available ? "success" : "failed",
  });

  if (!result.available) {
    return { ok: false, degraded: true, error: result.error ?? "The AI provider did not respond." };
  }

  return { ok: true, data: { summary: result.text } };
}

// ── Extract action items → Tasks (proposal only, §8.8) ──────────────────────

export type ProposedTask = {
  title: string;
  priority: "low" | "medium" | "high" | "urgent";
  energy: "deep" | "light" | "admin";
  dueInDays: number | null;
};

export async function extractTasksAction(
  noteId: string,
): Promise<AiResult<{ proposals: ProposedTask[]; aiLogId: string }>> {
  const user = await requireUser();
  const scope = new UserScope(user.id);

  const rows = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), scope.where(notes)))
    .limit(1);
  const note = assertOwnership(rows[0], scope);

  const status = aiStatus();
  if (!status.available) {
    return { ok: false, degraded: true, error: "No AI provider is configured." };
  }

  const body = fenceUntrusted(`note:${note.title}`, note.contentText || "(empty note)");

  const result = await generate({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          "Extract concrete action items from the note below.",
          'Return strict JSON: {"tasks":[{"title":"...","priority":"low|medium|high|urgent","energy":"deep|light|admin","dueInDays":number|null}]}',
          "Rules: only real actionable items, never invent work, maximum 8 items.",
          "Keep each title under 100 characters and write it in the note's language.",
          "",
          body,
        ].join("\n"),
      },
    ],
    temperature: 0.2,
    maxTokens: 900,
    json: true,
  });

  const log = await db
    .insert(aiActionLogs)
    .values({
      userId: user.id,
      capability: "extract_tasks",
      provider: result.provider,
      model: result.model,
      inputRefs: [`note:${noteId}`],
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      latencyMs: result.latencyMs,
      outcome: result.available ? "success" : "failed",
      reversibleUntil: new Date(Date.now() + AI_REVERSIBLE_HOURS * 3600000),
    })
    .returning({ id: aiActionLogs.id });

  if (!result.available) {
    return { ok: false, degraded: true, error: result.error ?? "The AI provider did not respond." };
  }

  const parsed = parseJsonLoose<{ tasks?: ProposedTask[] }>(result.text);
  const proposals = (parsed?.tasks ?? [])
    .filter((t) => t && typeof t.title === "string" && t.title.trim().length > 0)
    .slice(0, 8)
    .map((t) => ({
      title: t.title.trim().slice(0, 380),
      priority: ["low", "medium", "high", "urgent"].includes(t.priority) ? t.priority : "medium",
      energy: ["deep", "light", "admin"].includes(t.energy) ? t.energy : "admin",
      dueInDays: typeof t.dueInDays === "number" && t.dueInDays >= 0 ? Math.min(t.dueInDays, 365) : null,
    }));

  if (proposals.length === 0) {
    return {
      ok: true,
      data: { proposals: [], aiLogId: log[0].id },
    };
  }

  return { ok: true, data: { proposals, aiLogId: log[0].id } };
}

/**
 * Commits proposals the user explicitly approved. Nothing in this function
 * runs automatically — §8.8 requires per-action confirmation for writes.
 */
export async function confirmExtractedTasksAction(
  noteId: string,
  aiLogId: string,
  proposals: ProposedTask[],
  projectId?: string | null,
): Promise<AiResult<{ created: number }>> {
  const user = await requireUser();
  const scope = new UserScope(user.id);

  const noteRows = await db
    .select({ id: notes.id, userId: notes.userId })
    .from(notes)
    .where(and(eq(notes.id, noteId), scope.where(notes)))
    .limit(1);
  assertOwnership(noteRows[0], scope);

  const logRows = await db
    .select({ id: aiActionLogs.id, userId: aiActionLogs.userId, revertedAt: aiActionLogs.revertedAt })
    .from(aiActionLogs)
    .where(and(eq(aiActionLogs.id, aiLogId), eq(aiActionLogs.userId, user.id)))
    .limit(1);
  if (logRows.length === 0) return { ok: false, error: "That suggestion is no longer available." };
  if (logRows[0].revertedAt) return { ok: false, error: "That suggestion was already undone." };

  const valid = proposals.slice(0, 8).filter((p) => p.title?.trim());
  if (valid.length === 0) return { ok: false, error: "Select at least one item to add." };

  const created = await db
    .insert(tasks)
    .values(
      valid.map((p) => ({
        userId: user.id,
        title: p.title.trim().slice(0, 380),
        projectId: projectId ?? null,
        priority: p.priority,
        energy: p.energy,
        dueAt: p.dueInDays === null ? null : new Date(Date.now() + p.dueInDays * 86400000),
        description: `Added by the assistant from note: ${noteId}`,
      })),
    )
    .returning({ id: tasks.id });

  // Keep the log's payload so undo can remove exactly what was created.
  await db
    .update(aiActionLogs)
    .set({ payload: { createdTaskIds: created.map((t) => t.id) } })
    .where(eq(aiActionLogs.id, aiLogId));

  revalidatePath("/tasks");
  revalidatePath("/notes");
  revalidatePath("/assistant");
  return { ok: true, data: { created: created.length } };
}

/** §8.2 every AI write has an undo retained for the reversibility window. */
export async function undoAiActionAction(aiLogId: string): Promise<AiResult> {
  const user = await requireUser();

  const rows = await db
    .select()
    .from(aiActionLogs)
    .where(and(eq(aiActionLogs.id, aiLogId), eq(aiActionLogs.userId, user.id)))
    .limit(1);

  if (rows.length === 0) return { ok: false, error: "Action not found." };
  const log = rows[0];

  if (log.revertedAt) return { ok: false, error: "This action was already undone." };
  if (log.reversibleUntil && log.reversibleUntil.getTime() < Date.now()) {
    return { ok: false, error: "The undo window for this action has closed." };
  }

  const payload = (log.payload ?? {}) as { createdTaskIds?: string[] };

  if (payload.createdTaskIds?.length) {
    await db
      .update(tasks)
      .set({ deletedAt: new Date() })
      .where(and(eq(tasks.userId, user.id), inArray(tasks.id, payload.createdTaskIds)));
  }

  await db.update(aiActionLogs).set({ revertedAt: new Date() }).where(eq(aiActionLogs.id, aiLogId));

  revalidatePath("/tasks");
  revalidatePath("/assistant");
  revalidatePath("/settings/ai");
  return { ok: true };
}

export async function listAiActivityAction(limit = 30) {
  const user = await requireUser();
  return db
    .select()
    .from(aiActionLogs)
    .where(eq(aiActionLogs.userId, user.id))
    .orderBy(desc(aiActionLogs.createdAt))
    .limit(limit);
}

// ── Natural-language quick add (§7.3) ───────────────────────────────────────

export type QuickAddProposal = {
  title: string;
  dueAt: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  energy: "deep" | "light" | "admin";
  projectHint: string | null;
};

export async function parseQuickAddAction(
  text: string,
): Promise<AiResult<{ proposal: QuickAddProposal }>> {
  const user = await requireUser();
  const status = aiStatus();

  if (!status.available) {
    return { ok: false, degraded: true, error: "No AI provider is configured." };
  }

  // Give the model the user's real project names so hints are grounded,
  // and pass them as DATA — never as instructions.
  const projectRows = await db
    .select({ name: projects.name })
    .from(projects)
    .where(and(eq(projects.userId, user.id), eq(projects.status, "active")))
    .limit(30);

  const now = new Date();
  const result = await generate({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          `Current local time: ${now.toISOString()} (timezone ${user.timezone}).`,
          'Parse the user text into one task. Return strict JSON: {"title":"...","dueAt":"ISO8601 or null","priority":"low|medium|high|urgent","energy":"deep|light|admin","projectHint":"name or null"}',
          "Resolve relative dates against the current time above.",
          "Keep the title in the user's own language and strip the date phrase out of it.",
          "",
          fenceUntrusted("user quick-add text", text),
          "",
          `Known projects: ${fenceUntrusted("project list", projectRows.map((p) => p.name).join(", ") || "(none)")}`,
        ].join("\n"),
      },
    ],
    temperature: 0.2,
    maxTokens: 400,
    json: true,
  });

  await logAiAction({
    userId: user.id,
    capability: "quick_add",
    provider: result.provider,
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    latencyMs: result.latencyMs,
    outcome: result.available ? "success" : "failed",
  });

  if (!result.available) {
    return { ok: false, degraded: true, error: result.error ?? "The AI provider did not respond." };
  }

  const parsed = parseJsonLoose<QuickAddProposal>(result.text);
  if (!parsed?.title) {
    return { ok: false, error: "Could not read that as a task. Try phrasing it as an action." };
  }

  return {
    ok: true,
    data: {
      proposal: {
        title: String(parsed.title).slice(0, 380),
        dueAt: parsed.dueAt && !Number.isNaN(Date.parse(parsed.dueAt)) ? parsed.dueAt : null,
        priority: ["low", "medium", "high", "urgent"].includes(parsed.priority) ? parsed.priority : "medium",
        energy: ["deep", "light", "admin"].includes(parsed.energy) ? parsed.energy : "admin",
        projectHint: parsed.projectHint ?? null,
      },
    },
  };
}

// ── Capture triage (§7.1) ───────────────────────────────────────────────────

export async function suggestCaptureDestinationAction(
  captureId: string,
): Promise<AiResult<{ type: "task" | "note" | "event"; title: string; confidence: string; reason: string }>> {
  const user = await requireUser();
  const scope = new UserScope(user.id);

  const rows = await db
    .select()
    .from(captures)
    .where(and(eq(captures.id, captureId), scope.where(captures)))
    .limit(1);
  const capture = assertOwnership(rows[0], scope);

  const status = aiStatus();
  if (!status.available) {
    return { ok: false, degraded: true, error: "No AI provider is configured." };
  }

  const result = await generate({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          'Classify this captured note. Return strict JSON: {"type":"task|note|event","title":"...","confidence":"high|medium|low","reason":"one short sentence"}',
          "",
          fenceUntrusted("captured content", capture.raw),
        ].join("\n"),
      },
    ],
    temperature: 0.2,
    maxTokens: 300,
    json: true,
  });

  if (!result.available) {
    return { ok: false, degraded: true, error: result.error ?? "The AI provider did not respond." };
  }

  const parsed = parseJsonLoose<{ type: string; title: string; confidence: string; reason: string }>(result.text);
  if (!parsed?.type || !["task", "note", "event"].includes(parsed.type)) {
    return { ok: false, error: "Could not classify this item." };
  }

  const type = parsed.type as "task" | "note" | "event";
  const title = (parsed.title || capture.raw.slice(0, 120)).slice(0, 300);
  const confidence = ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "medium";
  const reason = (parsed.reason || "").slice(0, 300);

  await db
    .update(captures)
    .set({
      suggestedType: type,
      suggestedTitle: title,
      suggestionConfidence: confidence,
      suggestionReason: reason,
      updatedAt: new Date(),
    })
    .where(and(eq(captures.id, captureId), scope.where(captures)));

  await logAiAction({
    userId: user.id,
    capability: "capture_triage",
    provider: result.provider,
    model: result.model,
    inputRefs: [`capture:${captureId}`],
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    latencyMs: result.latencyMs,
  });

  revalidatePath("/inbox");
  return { ok: true, data: { type, title, confidence, reason } };
}

// ── Daily brief / weekly review (§7.9) ──────────────────────────────────────

export async function generateBriefAction(
  kind: "daily" | "weekly",
): Promise<AiResult<{ brief: string }>> {
  const user = await requireUser();
  const scope = new UserScope(user.id);

  const status = aiStatus();
  if (!status.available) {
    return { ok: false, degraded: true, error: "No AI provider is configured." };
  }

  const windowDays = kind === "daily" ? 1 : 7;
  const since = new Date(Date.now() - windowDays * 86400000);

  const [openTasks, dueTasks, doneTasks, activeGoals, inboxItems] = await Promise.all([
    db
      .select({ title: tasks.title, priority: tasks.priority, dueAt: tasks.dueAt, energy: tasks.energy })
      .from(tasks)
      .where(and(scope.where(tasks), inArray(tasks.status, ["todo", "in_progress", "blocked"])))
      .limit(40),
    db
      .select({ title: tasks.title, dueAt: tasks.dueAt })
      .from(tasks)
      .where(and(scope.where(tasks), eq(tasks.status, "todo")))
      .limit(40),
    db
      .select({ title: tasks.title, completedAt: tasks.completedAt })
      .from(tasks)
      .where(and(scope.where(tasks), eq(tasks.status, "done")))
      .limit(40),
    db
      .select({ title: goals.title, currentValue: goals.currentValue, targetValue: goals.targetValue, streakCurrent: goals.streakCurrent })
      .from(goals)
      .where(and(scope.where(goals), eq(goals.status, "active")))
      .limit(20),
    db
      .select({ raw: captures.raw })
      .from(captures)
      .where(and(scope.where(captures), eq(captures.processed, false)))
      .limit(20),
  ]);

  const now = new Date();
  const dueSoon = dueTasks
    .filter((t) => t.dueAt !== null)
    .sort((a, b) => (a.dueAt as Date).getTime() - (b.dueAt as Date).getTime());
  const overdue = dueSoon.filter((t) => (t.dueAt as Date) < now);
  const upcoming = dueSoon.filter((t) => (t.dueAt as Date) >= now);

  const digest = [
    `Open tasks (${openTasks.length}):`,
    ...openTasks.map((t) => `- ${t.title} [${t.priority}]${t.dueAt ? ` due ${t.dueAt.toISOString()}` : ""}`),
    "",
    `Overdue (${overdue.length}):`,
    ...overdue.map((t) => `- ${t.title} (was due ${(t.dueAt as Date).toISOString()})`),
    "",
    `Due next (${upcoming.length}):`,
    ...upcoming.slice(0, 10).map((t) => `- ${t.title} (due ${(t.dueAt as Date).toISOString()})`),
    "",
    `Completed in the last ${windowDays} day(s) (${doneTasks.filter((t) => t.completedAt && t.completedAt >= since).length}):`,
    ...doneTasks
      .filter((t) => t.completedAt && t.completedAt >= since)
      .map((t) => `- ${t.title}`),
    "",
    `Active goals (${activeGoals.length}):`,
    ...activeGoals.map((g) => `- ${g.title}: ${g.currentValue}/${g.targetValue}${g.streakCurrent ? ` (streak ${g.streakCurrent})` : ""}`),
    "",
    `Unprocessed inbox items (${inboxItems.length}):`,
    ...inboxItems.map((c) => `- ${c.raw.slice(0, 120)}`),
  ].join("\n");

  const instruction =
    kind === "daily"
      ? "Write a short daily brief: one line on where things stand, then the 3–5 things that matter most today, then one gentle observation if the data supports it. Keep it under 200 words."
      : "Write a weekly review draft: what was completed, what slipped, what is at risk, and 2–3 suggested focus areas for next week. Keep it under 350 words.";

  const result = await generate({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [instruction, "Use the same language as the user's workspace content.", "", fenceUntrusted("workspace digest", digest)].join("\n"),
      },
    ],
    temperature: 0.4,
    maxTokens: 900,
  });

  await logAiAction({
    userId: user.id,
    capability: kind === "daily" ? "daily_brief" : "weekly_review",
    provider: result.provider,
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    latencyMs: result.latencyMs,
    outcome: result.available ? "success" : "failed",
  });

  if (!result.available) {
    return { ok: false, degraded: true, error: result.error ?? "The AI provider did not respond." };
  }

  return { ok: true, data: { brief: result.text } };
}

// ── Grounded Q&A over the workspace (§7.7) ──────────────────────────────────

/**
 * Retrieval is deliberately simple: lexical scoring over the user's own
 * accessible content. It is structured so a pgvector semantic pass can be
 * fused in later (RRF, §8.10) without changing this contract.
 */
async function retrieveContext(userId: string, query: string, limit = 8, granted?: Set<string>) {
  const scope = new UserScope(userId);
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .slice(0, 8);

  if (terms.length === 0) return [];

  // Reading is opt-in per area: a source contributes nothing unless the user
  // has granted `<area>:read`. With no set passed (legacy callers) everything
  // is allowed, matching the pre-permissions behaviour.
  const canRead = (sourceKey: string) => !granted || granted.has(SOURCE_SCOPE[sourceKey]);

  const [noteRows, taskRows, eventRows, captureRows, projectRows, goalRows] = await Promise.all([
    canRead("note")
      ? db
          .select({ id: notes.id, title: notes.title, text: notes.contentText })
          .from(notes)
          .where(and(scope.where(notes), eq(notes.aiAccessible, true)))
          .orderBy(desc(notes.updatedAt))
          .limit(150)
      : Promise.resolve([]),
    canRead("task")
      ? db
          .select({
            id: tasks.id,
            title: tasks.title,
            description: tasks.description,
            status: tasks.status,
            dueAt: tasks.dueAt,
            priority: tasks.priority,
          })
          .from(tasks)
          .where(and(scope.where(tasks), eq(tasks.aiAccessible, true)))
          .orderBy(desc(tasks.updatedAt))
          .limit(150)
      : Promise.resolve([]),
    canRead("event")
      ? db
          .select({
            id: events.id,
            title: events.title,
            description: events.description,
            location: events.location,
            startAt: events.startAt,
            endAt: events.endAt,
          })
          .from(events)
          .where(and(scope.where(events), eq(events.aiAccessible, true)))
          .orderBy(desc(events.startAt))
          .limit(150)
      : Promise.resolve([]),
    // The inbox is included so a freshly captured item is answerable before
    // it has been triaged into a note or task.
    canRead("capture")
      ? db
          .select({
            id: captures.id,
            raw: captures.raw,
            processed: captures.processed,
            createdAt: captures.createdAt,
            suggestedTitle: captures.suggestedTitle,
          })
          .from(captures)
          .where(scope.where(captures))
          .orderBy(desc(captures.createdAt))
          .limit(100)
      : Promise.resolve([]),
    canRead("project")
      ? db
          .select({ id: projects.id, name: projects.name, description: projects.description, status: projects.status })
          .from(projects)
          .where(and(scope.where(projects), eq(projects.aiAccessible, true)))
          .orderBy(desc(projects.updatedAt))
          .limit(60)
      : Promise.resolve([]),
    canRead("goal")
      ? db
          .select({
            id: goals.id,
            title: goals.title,
            description: goals.description,
            status: goals.status,
            dueDate: goals.dueDate,
          })
          .from(goals)
          .where(and(scope.where(goals), eq(goals.aiAccessible, true)))
          .orderBy(desc(goals.updatedAt))
          .limit(60)
      : Promise.resolve([]),
  ]);

  const scored: Array<{ label: string; sourceType: string; sourceId: string; text: string; score: number }> = [];

  const score = (haystack: string) =>
    terms.reduce((acc, term) => acc + (haystack.split(term).length - 1), 0);

  const push = (
    label: string,
    sourceType: string,
    sourceId: string,
    haystack: string,
    text: string,
  ) => {
    const s = score(haystack.toLowerCase());
    if (s > 0) scored.push({ label, sourceType, sourceId, text: text.slice(0, 4000), score: s });
  };

  for (const n of noteRows) {
    push(n.title || "Untitled note", "note", n.id, `${n.title}\n${n.text}`, `${n.title}\n${n.text}`);
  }

  for (const t of taskRows) {
    const when = t.dueAt ? ` · due ${t.dueAt.toISOString()}` : "";
    push(
      t.title,
      "task",
      t.id,
      `${t.title}\n${t.description ?? ""}`,
      `Task: ${t.title} [${t.status}, ${t.priority}${when}]${t.description ? `\n${t.description}` : ""}`,
    );
  }

  for (const e of eventRows) {
    const when = `${e.startAt.toISOString()} → ${e.endAt.toISOString()}`;
    push(
      e.title,
      "event",
      e.id,
      `${e.title}\n${e.description ?? ""}\n${e.location ?? ""}`,
      `Event: ${e.title} [${when}]${e.location ? `\nLocation: ${e.location}` : ""}${e.description ? `\n${e.description}` : ""}`,
    );
  }

  for (const c of captureRows) {
    const label = c.suggestedTitle || c.raw.slice(0, 60);
    push(
      label,
      "capture",
      c.id,
      c.raw,
      `Inbox item (${c.processed ? "triaged" : "not yet triaged"}): ${c.raw}`,
    );
  }

  for (const p of projectRows) {
    push(
      p.name,
      "project",
      p.id,
      `${p.name}\n${p.description ?? ""}`,
      `Project: ${p.name} [${p.status}]${p.description ? `\n${p.description}` : ""}`,
    );
  }

  for (const g of goalRows) {
    const target = g.dueDate ? ` · due ${g.dueDate.toISOString()}` : "";
    push(
      g.title,
      "goal",
      g.id,
      `${g.title}\n${g.description ?? ""}`,
      `Goal: ${g.title} [${g.status}${target}]${g.description ? `\n${g.description}` : ""}`,
    );
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * A precise, date-scoped snapshot injected whenever the question looks
 * time-bound ("what's on today", "my tasks this week"). Lexical scoring cannot
 * answer these reliably because the user rarely types the task's own words.
 */
async function buildAgenda(userId: string, granted?: Set<string>) {
  const scope = new UserScope(userId);
  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const weekAhead = new Date(now.getTime() + 7 * 86_400_000);

  // The agenda respects the same read grants as full retrieval.
  const canTasks = !granted || granted.has("tasks:read");
  const canCalendar = !granted || granted.has("calendar:read");

  const [dueToday, overdue, nextEvents, openNow] = await Promise.all([
    canTasks
      ? db
          .select({ title: tasks.title, status: tasks.status, priority: tasks.priority, dueAt: tasks.dueAt })
          .from(tasks)
          .where(
            and(
              scope.where(tasks),
              ne(tasks.status, "done"),
              ne(tasks.status, "cancelled"),
              isNotNull(tasks.dueAt),
              lte(tasks.dueAt, endOfDay),
              gte(tasks.dueAt, startOfDay),
            ),
          )
          .orderBy(asc(tasks.dueAt))
          .limit(50)
      : Promise.resolve([]),
    canTasks
      ? db
          .select({ title: tasks.title, status: tasks.status, dueAt: tasks.dueAt })
          .from(tasks)
          .where(
            and(
              scope.where(tasks),
              ne(tasks.status, "done"),
              ne(tasks.status, "cancelled"),
              isNotNull(tasks.dueAt),
              lt(tasks.dueAt, startOfDay),
            ),
          )
          .orderBy(asc(tasks.dueAt))
          .limit(50)
      : Promise.resolve([]),
    canCalendar
      ? db
          .select({ title: events.title, startAt: events.startAt, endAt: events.endAt, location: events.location })
          .from(events)
          .where(and(scope.where(events), gte(events.startAt, startOfDay), lte(events.startAt, weekAhead)))
          .orderBy(asc(events.startAt))
          .limit(50)
      : Promise.resolve([]),
    canTasks
      ? db
          .select({ title: tasks.title, status: tasks.status, priority: tasks.priority })
          .from(tasks)
          .where(and(scope.where(tasks), inArray(tasks.status, ["todo", "in_progress", "blocked"])))
          .orderBy(asc(tasks.priority))
          .limit(50)
      : Promise.resolve([]),
  ]);

  const lines: string[] = [
    `Current local time: ${now.toISOString()}`,
    `Today: ${startOfDay.toISOString().slice(0, 10)}`,
    "",
  ];

  lines.push(
    `Tasks due today (${dueToday.length}):`,
    ...(dueToday.length
      ? dueToday.map((t) => `- ${t.title} [${t.priority}, ${t.status}] due ${t.dueAt!.toISOString()}`)
      : ["- (none)"]),
  );
  lines.push(
    "",
    `Overdue tasks (${overdue.length}):`,
    ...(overdue.length ? overdue.map((t) => `- ${t.title} [${t.status}] was due ${t.dueAt!.toISOString()}`) : ["- (none)"]),
  );
  lines.push(
    "",
    `Upcoming events, next 7 days (${nextEvents.length}):`,
    ...(nextEvents.length
      ? nextEvents.map(
          (e) => `- ${e.title} · ${e.startAt.toISOString()} → ${e.endAt.toISOString()}${e.location ? ` @ ${e.location}` : ""}`,
        )
      : ["- (none)"]),
  );
  lines.push(
    "",
    `Other open tasks (${openNow.length}):`,
    ...(openNow.length ? openNow.map((t) => `- ${t.title} [${t.priority}, ${t.status}]`) : ["- (none)"]),
  );

  return lines.join("\n");
}

/** Does the question look like it is asking about a time window? */
function wantsAgenda(text: string): boolean {
  return /today|tonight|tomorrow|this week|next week|agenda|schedule|upcoming|overdue|due|النهاردة|اليوم|بكرة|غدا|غداً|هذا الأسبوع|الأسبوع|القادم|المتأخرة|متأخر|جدولي|مواعيدي|مهامي/i.test(
    text,
  );
}

export async function askAssistantAction(
  input: unknown,
): Promise<AiResult<{ threadId: string; answer: string; citations: Citation[]; grounded: boolean }>> {
  const user = await requireUser();
  const parsed = chatInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const { message, threadId, mode, contextNoteId } = parsed.data;

  // Resolve or create the thread.
  let activeThreadId = threadId ?? null;
  if (activeThreadId) {
    const rows = await db
      .select({ id: chatThreads.id, userId: chatThreads.userId })
      .from(chatThreads)
      .where(and(eq(chatThreads.id, activeThreadId), eq(chatThreads.userId, user.id)))
      .limit(1);
    assertOwnership(rows[0], new UserScope(user.id));
  } else {
    const inserted = await db
      .insert(chatThreads)
      .values({
        userId: user.id,
        title: message.slice(0, 80),
      })
      .returning({ id: chatThreads.id });
    activeThreadId = inserted[0].id;
  }

  await db.insert(chatMessages).values({
    threadId: activeThreadId,
    userId: user.id,
    role: "user",
    content: message,
  });

  const status = aiStatus();
  if (!status.available) {
    const fallback =
      "The assistant is unavailable right now because no AI provider is configured. " +
      "Everything else in TaskNote Plus works normally — capture, tasks, notes, calendar and search all run without AI.";
    await db.insert(chatMessages).values({
      threadId: activeThreadId,
      userId: user.id,
      role: "assistant",
      content: fallback,
      citations: [],
      provider: "none",
      model: "",
    });
    revalidatePath("/assistant");
    return { ok: true, data: { threadId: activeThreadId, answer: fallback, citations: [], grounded: false } };
  }

  // Reading is opt-in: only the areas the user has explicitly granted are
  // searched. With nothing granted the assistant still answers from general
  // knowledge, but it cannot see any personal content.
  const grants = await grantedScopes(user.id);

  const chunks = await retrieveContext(user.id, message, 8, grants);
  const citations: Citation[] = chunks.map((c) => ({
    sourceType: c.sourceType,
    sourceId: c.sourceId,
    label: c.label,
  }));

  const history = await db
    .select({ role: chatMessages.role, content: chatMessages.content })
    .from(chatMessages)
    .where(eq(chatMessages.threadId, activeThreadId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(12);

  const ordered = history.reverse().slice(0, -1).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content.slice(0, 4000),
  }));

  const contextBlock =
    chunks.length > 0
      ? chunks.map((c) => fenceUntrusted(c.label, c.text)).join("\n\n")
      : "(the workspace has no content matching this question)";

  const piiNote =
    detectPiiCategories(message + contextBlock).length > 0
      ? "\nNote: the workspace content may contain personal identifiers. Refer to them only as needed to answer."
      : "";

  const timeBound = wantsAgenda(message);
  const agendaBlock = timeBound ? await buildAgenda(user.id, grants) : "";

  // Only advertise the write tools the user has actually authorised, so the
  // model cannot even propose an action it is not allowed to perform.
  const allowedTools = TOOL_DEFINITIONS.filter((t) => grants.has(TOOL_SCOPE[t.name] ?? ""));

  const toolsEnabled =
    ASSISTANT_TOOLS_ENABLED && allowedTools.length > 0 && anyProviderSupportsTools();

  const toolSpecs = allowedTools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  const taskLine =
    mode === "summarize"
      ? "Summarise the relevant workspace content below."
      : mode === "extract_tasks"
        ? "From the workspace content below, list concrete action items as short imperative bullets."
        : "Answer the user's question.";

  const userTurn = [
    taskLine,
    mode === "chat" ? "Use the workspace content for anything about the user's own notes, tasks, projects, goals, inbox or calendar, and cite the source labels." : "",
    mode === "chat" ? "For anything else, answer from your own knowledge — do not refuse just because the workspace is empty." : "",
    "Never reference sources that are not listed below.",
    piiNote,
    agendaBlock ? `\nLive agenda snapshot (authoritative — prefer this over guessing dates):\n${agendaBlock}` : "",
    "",
    `User: ${message}`,
    contextNoteId ? `(The user pointed at note ${contextNoteId} for context.)` : "",
    "",
    "Workspace content:",
    contextBlock,
  ]
    .filter(Boolean)
    .join("\n");

  const conversation: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...ordered,
    { role: "user", content: userTurn },
  ];

  const toolSummaries: string[] = [];
  let result = await generate({
    messages: conversation,
    temperature: 0.35,
    maxTokens: 1400,
    ...(toolsEnabled
      ? { tools: toolSpecs, toolChoice: "auto" as const }
      : {}),
  });

  // ── Tool-calling loop ─────────────────────────────────────────────────────
  // Bounded to 3 rounds: enough for "book it then tell me what you did",
  // small enough that a confused model cannot spin.
  for (let round = 0; round < 3 && result.available && result.toolCalls.length > 0; round++) {
    conversation.push({
      role: "assistant",
      content: result.text,
      tool_calls: result.toolCalls,
    });

    for (const call of result.toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }

      // Defence in depth: never execute a write the user has not authorised,
      // even if the model names a tool that was not advertised to it.
      const requiredScope = TOOL_SCOPE[call.function.name];
      if (!requiredScope || !grants.has(requiredScope)) {
        conversation.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: `Not permitted: the user has not granted "${requiredScope ?? "that capability"}". Do not retry this tool. Tell the user they can enable it in Settings → Assistant & permissions.`,
        });
        continue;
      }

      const outcome = await runTool(call.function.name, args, {
        userId: user.id,
        timezone: user.timezone || "UTC",
        provider: result.provider,
        model: result.model,
      });

      if (outcome.ok && outcome.summary) toolSummaries.push(outcome.summary);

      conversation.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: outcome.forModel || (outcome.ok ? "done" : "the tool failed"),
      });
    }

    result = await generate({
      messages: conversation,
      temperature: 0.35,
      maxTokens: 1400,
      ...(toolsEnabled
        ? { tools: toolSpecs, toolChoice: "auto" as const }
        : {}),
    });
  }

  await logAiAction({
    userId: user.id,
    capability: "ask_assistant",
    provider: result.provider,
    model: result.model,
    inputRefs: citations.map((c) => `${c.sourceType}:${c.sourceId}`),
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    latencyMs: result.latencyMs,
    outcome: result.available ? "success" : "failed",
    payload: { mode, citationCount: citations.length, toolWrites: toolSummaries },
  });

  let answer = result.available
    ? result.text
    : "The AI provider did not respond. Your data is safe and unchanged — please try again in a moment.";

  // If the model did work but returned no narration, say what happened rather
  // than leaving the user with an empty bubble.
  if (answer.trim().length === 0 && toolSummaries.length > 0) {
    answer = toolSummaries.join("\n");
  }

  // Tool-created rows are new citable sources, so refresh the calendar/notes
  // surfaces the user may be looking at.
  if (toolSummaries.length > 0) {
    revalidatePath("/calendar");
    revalidatePath("/tasks");
    revalidatePath("/notes");
    revalidatePath("/dashboard");
  }

  await db.insert(chatMessages).values({
    threadId: activeThreadId,
    userId: user.id,
    role: "assistant",
    content: answer,
    citations,
    provider: result.provider,
    model: result.model,
  });

  await db
    .update(chatThreads)
    .set({ updatedAt: new Date() })
    .where(and(eq(chatThreads.id, activeThreadId), eq(chatThreads.userId, user.id)));

  revalidatePath("/assistant");
  return {
    ok: true,
    data: {
      threadId: activeThreadId,
      answer,
      citations,
      grounded: result.available && citations.length > 0,
    },
  };
}

export async function listThreadsAction() {
  const user = await requireUser();
  const scope = new UserScope(user.id);
  return db
    .select()
    .from(chatThreads)
    .where(scope.whereWithDeleted(chatThreads))
    .orderBy(desc(chatThreads.updatedAt))
    .limit(50);
}

export async function getThreadAction(threadId: string) {
  const user = await requireUser();
  const scope = new UserScope(user.id);

  const threadRows = await db
    .select()
    .from(chatThreads)
    .where(and(eq(chatThreads.id, threadId), scope.whereWithDeleted(chatThreads)))
    .limit(1);
  assertOwnership(threadRows[0], scope);

  const messages = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.threadId, threadId), eq(chatMessages.userId, user.id)))
    .orderBy(chatMessages.createdAt)
    .limit(200);

  return { thread: threadRows[0], messages };
}

export async function deleteThreadAction(threadId: string): Promise<AiResult> {
  const user = await requireUser();
  const scope = new UserScope(user.id);

  const rows = await db
    .select({ id: chatThreads.id, userId: chatThreads.userId })
    .from(chatThreads)
    .where(and(eq(chatThreads.id, threadId), scope.whereWithDeleted(chatThreads)))
    .limit(1);
  assertOwnership(rows[0], scope);

  await db.delete(chatThreads).where(and(eq(chatThreads.id, threadId), eq(chatThreads.userId, user.id)));
  revalidatePath("/assistant");
  return { ok: true };
}

// ── Permissions & memory (§8.1 / §9.3) ──────────────────────────────────────

const AI_SCOPES = ALL_SCOPES;

/** Every scope with its current grant state, for the settings panel. */
export async function listPermissionsAction() {
  const user = await requireUser();
  const rows = await db
    .select()
    .from(permissionGrants)
    .where(and(eq(permissionGrants.userId, user.id), eq(permissionGrants.granted, true)));

  const granted = new Set(rows.map((r) => r.scope));
  return AI_SCOPES.map((s) => ({ ...s, granted: granted.has(s.scope) }));
}

/** Just the granted scope keys — used to gate retrieval and tool writes. */
export async function grantedScopes(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ scope: permissionGrants.scope })
    .from(permissionGrants)
    .where(and(eq(permissionGrants.userId, userId), eq(permissionGrants.granted, true)));
  return new Set(rows.map((r) => r.scope));
}

export async function setPermissionAction(scope: string, granted: boolean): Promise<AiResult> {
  const user = await requireUser();
  if (!AI_SCOPES.some((s) => s.scope === scope)) {
    return { ok: false, error: "Unknown permission scope." };
  }

  await db
    .insert(permissionGrants)
    .values({
      userId: user.id,
      scope,
      granted,
      grantedAt: granted ? new Date() : null,
      revokedAt: granted ? null : new Date(),
    })
    .onConflictDoUpdate({
      target: [permissionGrants.userId, permissionGrants.scope],
      set: {
        granted,
        grantedAt: granted ? new Date() : null,
        revokedAt: granted ? null : new Date(),
      },
    });

  revalidatePath("/settings");
  revalidatePath("/settings/ai");
  revalidatePath("/assistant");
  return { ok: true };
}

/**
 * Persist the whole permission set at once — the "Save" button in settings.
 * Anything omitted is revoked, so the saved set is exactly what the user saw.
 */
export async function savePermissionsAction(scopes: string[]): Promise<AiResult> {
  const user = await requireUser();

  const wanted = new Set(scopes.filter((s) => AI_SCOPES.some((d) => d.scope === s)));
  const now = new Date();

  // One round trip: write a row per scope with the desired state.
  await db
    .insert(permissionGrants)
    .values(
      AI_SCOPES.map((def) => {
        const granted = wanted.has(def.scope);
        return {
          userId: user.id,
          scope: def.scope,
          granted,
          grantedAt: granted ? now : null,
          revokedAt: granted ? null : now,
        };
      }),
    )
    .onConflictDoUpdate({
      target: [permissionGrants.userId, permissionGrants.scope],
      set: {
        granted: sql`excluded.granted`,
        grantedAt: sql`excluded.granted_at`,
        revokedAt: sql`excluded.revoked_at`,
      },
    });

  revalidatePath("/settings");
  revalidatePath("/settings/ai");
  revalidatePath("/assistant");
  return { ok: true };
}

export async function listMemoryAction() {
  const user = await requireUser();
  return db
    .select()
    .from(aiMemories)
    .where(eq(aiMemories.userId, user.id))
    .orderBy(desc(aiMemories.updatedAt))
    .limit(100);
}

export async function deleteMemoryAction(memoryId: string): Promise<AiResult> {
  const user = await requireUser();
  const rows = await db
    .select({ id: aiMemories.id, userId: aiMemories.userId })
    .from(aiMemories)
    .where(and(eq(aiMemories.id, memoryId), eq(aiMemories.userId, user.id)))
    .limit(1);
  assertOwnership(rows[0], new UserScope(user.id));

  await db.delete(aiMemories).where(and(eq(aiMemories.id, memoryId), eq(aiMemories.userId, user.id)));
  revalidatePath("/settings/ai");
  return { ok: true };
}
