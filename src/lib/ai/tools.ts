/**
 * Assistant tools (§8.6 extension)
 * ---------------------------------------------------------------------------
 * Lets the assistant actually *do* things in the user's workspace instead of
 * only talking about them — "book a meeting tomorrow at 10" creates a real
 * calendar event, not a paragraph of advice.
 *
 * Design constraints that must not be relaxed:
 *
 *  1. Every write goes through the existing Zod-validated server actions in
 *     `@/app/actions/content`, so tool-created rows are indistinguishable from
 *     UI-created rows and inherit exactly the same validation and tenancy.
 *  2. Nothing here trusts the model. Arguments are parsed defensively; a
 *     malformed or unauthorised call returns an error *to the model* so it can
 *     correct itself, and never throws into the request.
 *  3. Writes are logged to `ai_action_logs` with a reversibility window, so the
 *     user can undo anything the assistant did (§8.2).
 *  4. Dates are resolved deterministically in code from the user's timezone —
 *     we never let the model invent an epoch timestamp.
 */

import {
  createEventAction,
  createGoalAction,
  createNoteAction,
  createProjectAction,
  createTaskAction,
} from "@/app/actions/content";
import { db } from "@/db";
import { aiActionLogs } from "@/db/schema";
import { AI_REVERSIBLE_HOURS } from "@/lib/config";

export type ToolName =
  | "create_event"
  | "create_task"
  | "create_note"
  | "create_project"
  | "create_goal";

export type ToolDefinition = {
  name: ToolName;
  description: string;
  parameters: Record<string, unknown>;
};

/**
 * JSON-schema definitions advertised to the model.
 *
 * Each description leads with the user's own vocabulary for that destination
 * and names the `/route` it lands on. The model previously sent "create a
 * project called X" to `create_note` because only notes/tasks/events existed
 * and `create_note` was the nearest thing — so the fix is both more tools and
 * unambiguous descriptions.
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "create_project",
    description:
      "Create a PROJECT (a container that groups tasks, notes and goals) — saved under /projects. Use when the user says project, مشروع, initiative, campaign, client work, 'a project called X'. Do NOT use create_note for a project.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "The project name, e.g. 'Project Phoenix'." },
        description: { type: "string", description: "Optional description of the project's scope." },
        status: { type: "string", enum: ["active", "on_hold", "completed", "archived"] },
        target_date: { type: "string", description: "Optional target date YYYY-MM-DD." },
      },
      required: ["name"],
    },
  },
  {
    name: "create_goal",
    description:
      "Create a GOAL or habit with a measurable target — saved under /goals. Use when the user says goal, هدف, target, habit, عادة, 'I want to reach X', 'track how many X'. Do NOT use create_task for a measurable ongoing goal.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "The goal, e.g. 'Read 24 books'." },
        description: { type: "string", description: "Optional detail or motivation." },
        kind: { type: "string", enum: ["goal", "habit"], description: "habit for recurring routines." },
        metric_type: { type: "string", enum: ["percent", "count", "minutes", "currency"] },
        target_value: { type: "number", description: "The number to reach, e.g. 24." },
        unit: { type: "string", description: "Optional unit, e.g. 'books', 'kg'." },
        due_date: { type: "string", description: "Optional deadline YYYY-MM-DD." },
      },
      required: ["title"],
    },
  },
  {
    name: "create_task",
    description:
      "Create a to-do TASK — a single concrete action, saved under /tasks. Use when the user says task, مهمة, todo, remind me to, 'I need to X', 'add X to my list'. If it is a scheduled meeting use create_event; if it is a multi-step effort use create_project.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short imperative task title." },
        due_date: { type: "string", description: "Optional due date YYYY-MM-DD." },
        due_time: { type: "string", description: "Optional due time HH:MM (only if the user gave one)." },
        priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
        description: { type: "string", description: "Optional detail." },
      },
      required: ["title"],
    },
  },
  {
    name: "create_event",
    description:
      "Create a calendar EVENT or meeting at a specific date and time — saved under /calendar. Use whenever the user asks to schedule, book, plan or block time (e.g. 'book a meeting tomorrow at 10', 'اجتماع بكرة الساعة 10'). Always use this for anything with a clock time.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short event title, e.g. 'Meeting with Sara'." },
        date: {
          type: "string",
          description:
            "Local calendar date for the start, as YYYY-MM-DD. Resolve relative words like today/tomorrow against the current date given to you.",
        },
        start_time: { type: "string", description: "Start time as 24-hour HH:MM, e.g. '10:00'." },
        duration_minutes: {
          type: "integer",
          description: "Length in minutes. Defaults to 60 if the user does not say.",
        },
        end_time: { type: "string", description: "Optional explicit end time HH:MM." },
        location: { type: "string", description: "Optional location." },
        description: { type: "string", description: "Optional notes for the event." },
      },
      required: ["title", "date", "start_time"],
    },
  },
  {
    name: "create_note",
    description:
      "Save a free-form NOTE — reference text with no deadline and no measurable target, saved under /notes. Use for 'write down', 'note that', 'remember this', 'ملاحظة', meeting minutes, ideas, reference material. NOT for tasks, meetings, projects or goals.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short note title." },
        body: { type: "string", description: "The note content as plain text. Use newlines between paragraphs." },
      },
      required: ["title", "body"],
    },
  },
];

export type ToolOutcome = {
  name: ToolName;
  ok: boolean;
  /** Human-readable summary shown to the user under the reply. */
  summary: string;
  /** What the model is told so it can continue the conversation. */
  forModel: string;
  createdId?: string;
  createdLabel?: string;
};

/** `YYYY-MM-DD` + `HH:MM` interpreted in a specific IANA zone, as a real Date. */
export function zonedDateTime(date: string, time: string, timeZone: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const tm = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!dm || !tm) return null;

  const [, y, mo, d] = dm;
  const [, h, mi] = tm;
  const asUtcMillis = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));

  // Determine the zone's offset at that instant, then correct for it.
  const probe = new Date(asUtcMillis);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(probe);

  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asZoneMillis = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  const offset = asZoneMillis - asUtcMillis;
  return new Date(asUtcMillis - offset);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Normalise the loosely-typed arguments the model produced into plain text paragraphs. */
function toNoteBlocks(body: string) {
  return body
    .split(/\r?\n/)
    .map((line, index) => ({ id: `b${index}`, type: "paragraph" as const, text: line }));
}

export type ToolContext = {
  userId: string;
  timezone: string;
  /** Used for the reversibility window and the audit trail. */
  provider: string;
  model: string;
};

/**
 * Execute one tool call. Never throws — errors come back as `ok: false` so the
 * model can recover and the user still gets an answer.
 */
export async function runTool(
  name: string,
  rawArgs: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  if (name === "create_event") return runCreateEvent(rawArgs, ctx);
  if (name === "create_task") return runCreateTask(rawArgs, ctx);
  if (name === "create_note") return runCreateNote(rawArgs, ctx);
  if (name === "create_project") return runCreateProject(rawArgs, ctx);
  if (name === "create_goal") return runCreateGoal(rawArgs, ctx);

  return {
    name: "create_note",
    ok: false,
    summary: "",
    forModel: `Unknown tool "${name}". Available tools: ${TOOL_DEFINITIONS.map((t) => t.name).join(", ")}.`,
  };
}

function fail(name: ToolName, forModel: string): ToolOutcome {
  return { name, ok: false, summary: "", forModel };
}

async function logWrite(ctx: ToolContext, capability: string, entityId: string | undefined) {
  await db.insert(aiActionLogs).values({
    userId: ctx.userId,
    capability,
    provider: ctx.provider,
    model: ctx.model,
    inputRefs: entityId ? [entityId] : [],
    outcome: "success",
    payload: { createdByAssistant: true },
    reversibleUntil: new Date(Date.now() + AI_REVERSIBLE_HOURS * 3600000),
  });
}

async function runCreateEvent(rawArgs: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const name: ToolName = "create_event";
  const title = str(rawArgs.title);
  const date = str(rawArgs.date);
  const startTime = str(rawArgs.start_time);

  if (!title) return fail(name, "create_event failed: `title` is required.");
  if (!date || !startTime) {
    return fail(name, "create_event failed: both `date` (YYYY-MM-DD) and `start_time` (HH:MM) are required.");
  }

  const startAt = zonedDateTime(date, startTime, ctx.timezone) ?? zonedDateTime(date, startTime, "UTC");
  if (!startAt || Number.isNaN(startAt.getTime())) {
    return fail(name, `create_event failed: could not interpret date "${date}" time "${startTime}".`);
  }

  const durationMinutes = Math.min(Math.max(num(rawArgs.duration_minutes) ?? 60, 5), 24 * 60);
  const explicitEnd = str(rawArgs.end_time);
  let endAt: Date;
  if (explicitEnd) {
    const parsed = zonedDateTime(date, explicitEnd, ctx.timezone) ?? zonedDateTime(date, explicitEnd, "UTC");
    endAt = parsed && parsed > startAt ? parsed : new Date(startAt.getTime() + durationMinutes * 60_000);
  } else {
    endAt = new Date(startAt.getTime() + durationMinutes * 60_000);
  }

  const result = await createEventAction({
    title,
    description: str(rawArgs.description) ?? null,
    location: str(rawArgs.location) ?? null,
    startAt,
    endAt,
    allDay: false,
    timezone: ctx.timezone,
    kind: "event",
  });

  if (!result.ok) {
    return fail(name, `create_event was rejected: ${result.error ?? "validation error"}`);
  }

  const id = (result.data as { id: string }).id;
  await logWrite(ctx, "create_event", id);

  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: ctx.timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(startAt);

  return {
    name,
    ok: true,
    createdId: id,
    createdLabel: title,
    summary: `Created event “${title}” — ${when}`,
    forModel: `create_event succeeded. Event "${title}" created for ${when} (id ${id}). Confirm this to the user briefly.`,
  };
}

async function runCreateTask(rawArgs: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const name: ToolName = "create_task";
  const title = str(rawArgs.title);
  if (!title) return fail(name, "create_task failed: `title` is required.");

  const dueDate = str(rawArgs.due_date);
  const dueTime = str(rawArgs.due_time);
  let dueAt: Date | null = null;
  if (dueDate) {
    dueAt = dueTime
      ? (zonedDateTime(dueDate, dueTime, ctx.timezone) ?? null)
      : (zonedDateTime(dueDate, "09:00", ctx.timezone) ?? null);
  }

  const priorityInput = str(rawArgs.priority);
  const priority =
    priorityInput && ["low", "medium", "high", "urgent"].includes(priorityInput) ? priorityInput : "medium";

  const result = await createTaskAction({
    title,
    description: str(rawArgs.description) ?? null,
    status: "todo",
    priority,
    energy: "admin",
    dueAt,
  });

  if (!result.ok) {
    return fail(name, `create_task was rejected: ${result.error ?? "validation error"}`);
  }

  const id = (result.data as { id: string }).id;
  await logWrite(ctx, "create_task", id);

  const when = dueAt
    ? ` — due ${new Intl.DateTimeFormat("en-GB", {
        timeZone: ctx.timezone,
        day: "numeric",
        month: "short",
        hour: dueTime ? "2-digit" : undefined,
        minute: dueTime ? "2-digit" : undefined,
      }).format(dueAt)}`
    : "";

  return {
    name,
    ok: true,
    createdId: id,
    createdLabel: title,
    summary: `Created task “${title}”${when}`,
    forModel: `create_task succeeded. Task "${title}" created${dueAt ? ` with due date ${dueAt.toISOString()}` : ""} (id ${id}). Confirm briefly.`,
  };
}

async function runCreateNote(rawArgs: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const name: ToolName = "create_note";
  const body = str(rawArgs.body);
  if (!body) return fail(name, "create_note failed: `body` is required.");
  const title = str(rawArgs.title) ?? body.slice(0, 60);

  const result = await createNoteAction({
    title,
    content: toNoteBlocks(body),
  });

  if (!result.ok) {
    return fail(name, `create_note was rejected: ${result.error ?? "validation error"}`);
  }

  const id = (result.data as { id: string }).id;
  await logWrite(ctx, "create_note", id);

  return {
    name,
    ok: true,
    createdId: id,
    createdLabel: title,
    summary: `Saved note “${title}”`,
    forModel: `create_note succeeded. Note "${title}" saved (id ${id}). Confirm briefly.`,
  };
}

async function runCreateProject(rawArgs: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const name: ToolName = "create_project";
  const projectName = str(rawArgs.name) ?? str(rawArgs.title);
  if (!projectName) return fail(name, "create_project failed: `name` is required.");

  const statusInput = str(rawArgs.status);
  const status =
    statusInput && ["active", "on_hold", "completed", "archived"].includes(statusInput)
      ? statusInput
      : "active";

  const targetDate = str(rawArgs.target_date);
  const targetAt = targetDate ? zonedDateTime(targetDate, "12:00", ctx.timezone) : null;

  const result = await createProjectAction({
    name: projectName,
    description: str(rawArgs.description) ?? null,
    status,
    targetDate: targetAt,
  });

  if (!result.ok) {
    return fail(name, `create_project was rejected: ${result.error ?? "validation error"}`);
  }

  const id = (result.data as { id: string }).id;
  await logWrite(ctx, "create_project", id);

  return {
    name,
    ok: true,
    createdId: id,
    createdLabel: projectName,
    summary: `Created project “${projectName}” in Projects`,
    forModel: `create_project succeeded. Project "${projectName}" created and is visible under /projects (id ${id}). Confirm briefly and mention it landed in Projects.`,
  };
}

async function runCreateGoal(rawArgs: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const name: ToolName = "create_goal";
  const title = str(rawArgs.title);
  if (!title) return fail(name, "create_goal failed: `title` is required.");

  const kindInput = str(rawArgs.kind);
  const kind = kindInput === "habit" ? "habit" : "goal";

  const metricInput = str(rawArgs.metric_type);
  const metricType =
    metricInput && ["percent", "count", "minutes", "currency"].includes(metricInput)
      ? metricInput
      : "count";

  const target = num(rawArgs.target_value);
  const dueDate = str(rawArgs.due_date);
  const dueAt = dueDate ? zonedDateTime(dueDate, "12:00", ctx.timezone) : null;

  const result = await createGoalAction({
    title,
    description: str(rawArgs.description) ?? null,
    kind,
    metricType,
    targetValue: target !== undefined && target >= 0 ? target : 100,
    currentValue: 0,
    unit: str(rawArgs.unit) ?? null,
    dueDate: dueAt,
    status: "active",
  });

  if (!result.ok) {
    return fail(name, `create_goal was rejected: ${result.error ?? "validation error"}`);
  }

  const id = (result.data as { id: string }).id;
  await logWrite(ctx, "create_goal", id);

  return {
    name,
    ok: true,
    createdId: id,
    createdLabel: title,
    summary: `Created ${kind === "habit" ? "habit" : "goal"} “${title}” in Goals`,
    forModel: `create_goal succeeded. ${kind === "habit" ? "Habit" : "Goal"} "${title}" created and is visible under /goals (id ${id}). Confirm briefly and mention it landed in Goals.`,
  };
}
