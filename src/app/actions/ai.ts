"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  aiActionLogs,
  aiMemories,
  captures,
  chatMessages,
  chatThreads,
  goals,
  notes,
  permissionGrants,
  projects,
  tasks,
  type Citation,
} from "@/db/schema";
import { UserScope, assertOwnership } from "@/lib/db/scope";
import { requireUser } from "@/lib/session";
import { generate, aiStatus, parseJsonLoose } from "@/lib/ai/gateway";
import {
  DATA_BOUNDARY_INSTRUCTION,
  detectPiiCategories,
  fenceUntrusted,
} from "@/lib/ai/safety";
import { chatInputSchema } from "@/lib/validation";
import { AI_REVERSIBLE_HOURS } from "@/lib/config";

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
  DATA_BOUNDARY_INSTRUCTION,
  "",
  "Style: concise, specific, no filler. Match the user's language (Arabic or English).",
  "Arabic responses should read as natural Modern Standard Arabic unless the user writes in a dialect, in which case mirror their tone.",
  "When you list action items, prefer short imperative sentences.",
  "If you do not have enough context to answer, say so plainly — do not invent details about the user's data.",
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
async function retrieveContext(userId: string, query: string, limit = 8) {
  const scope = new UserScope(userId);
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .slice(0, 8);

  if (terms.length === 0) return [];

  const noteRows = await db
    .select({ id: notes.id, title: notes.title, text: notes.contentText })
    .from(notes)
    .where(and(scope.where(notes), eq(notes.aiAccessible, true)))
    .orderBy(desc(notes.updatedAt))
    .limit(120);

  const taskRows = await db
    .select({ id: tasks.id, title: tasks.title, description: tasks.description, status: tasks.status })
    .from(tasks)
    .where(and(scope.where(tasks), eq(tasks.aiAccessible, true)))
    .orderBy(desc(tasks.updatedAt))
    .limit(120);

  const scored: Array<{ label: string; sourceType: string; sourceId: string; text: string; score: number }> = [];

  for (const n of noteRows) {
    const haystack = `${n.title}\n${n.text}`.toLowerCase();
    const score = terms.reduce((acc, term) => acc + (haystack.split(term).length - 1), 0);
    if (score > 0) {
      scored.push({
        label: n.title || "Untitled note",
        sourceType: "note",
        sourceId: n.id,
        text: `${n.title}\n${n.text}`.slice(0, 4000),
        score,
      });
    }
  }

  for (const t of taskRows) {
    const haystack = `${t.title}\n${t.description ?? ""}`.toLowerCase();
    const score = terms.reduce((acc, term) => acc + (haystack.split(term).length - 1), 0);
    if (score > 0) {
      scored.push({
        label: t.title,
        sourceType: "task",
        sourceId: t.id,
        text: `Task: ${t.title} [${t.status}]${t.description ? `\n${t.description}` : ""}`,
        score,
      });
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
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

  const chunks = await retrieveContext(user.id, message);
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
      : "(no matching workspace content was found)";

  const piiNote =
    detectPiiCategories(message + contextBlock).length > 0
      ? "\nNote: the workspace content may contain personal identifiers. Refer to them only as needed to answer."
      : "";

  const result = await generate({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...ordered,
      {
        role: "user",
        content: [
          mode === "summarize"
            ? "Summarise the relevant workspace content below."
            : mode === "extract_tasks"
              ? "From the workspace content below, list concrete action items as short imperative bullets."
              : "Answer the question using only the workspace content below.",
          "If the content does not contain the answer, say plainly that you could not find it in the workspace.",
          "Do not reference sources that are not listed below.",
          piiNote,
          "",
          `Question: ${message}`,
          contextNoteId ? `(The user pointed at note ${contextNoteId} for context.)` : "",
          "",
          "Workspace content:",
          contextBlock,
        ].join("\n"),
      },
    ],
    temperature: 0.35,
    maxTokens: 1400,
  });

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
    payload: { mode, citationCount: citations.length },
  });

  const answer = result.available
    ? result.text
    : "The AI provider did not respond. Your data is safe and unchanged — please try again in a moment.";

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

// Module-private by design: a "use server" file may only export async
// functions, so this table must not be exported (it would break the whole
// route at runtime with "can only export async functions, found object").
const AI_SCOPES = [
  { scope: "notes:read", labelAr: "قراءة الملاحظات", labelEn: "Read notes" },
  { scope: "tasks:read", labelAr: "قراءة المهام", labelEn: "Read tasks" },
  { scope: "calendar:read", labelAr: "قراءة التقويم", labelEn: "Read calendar" },
  { scope: "projects:read", labelAr: "قراءة المشاريع", labelEn: "Read projects" },
  { scope: "goals:read", labelAr: "قراءة الأهداف", labelEn: "Read goals" },
  { scope: "tasks:write", labelAr: "إنشاء المهام", labelEn: "Create tasks" },
  { scope: "memory:write", labelAr: "حفظ حقائق عني", labelEn: "Remember facts" },
] as const;

export async function listPermissionsAction() {
  const user = await requireUser();
  const rows = await db
    .select()
    .from(permissionGrants)
    .where(and(eq(permissionGrants.userId, user.id), eq(permissionGrants.granted, true)));

  const granted = new Set(rows.map((r) => r.scope));
  return AI_SCOPES.map((s) => ({ ...s, granted: granted.has(s.scope) }));
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

  revalidatePath("/settings/ai");
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
