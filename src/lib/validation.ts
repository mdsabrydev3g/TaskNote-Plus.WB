import { z } from "zod";

/** All user input crosses the API boundary through these schemas (§10.7). */

const trimmed = (max: number) => z.string().trim().max(max);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5)
  .max(320)
  .email("Enter a valid email address");

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200)
  .refine((v) => /[a-z]/.test(v), "Include a lowercase letter")
  .refine((v) => /[A-Z]/.test(v), "Include an uppercase letter")
  .refine((v) => /\d/.test(v), "Include a number");

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: trimmed(120).min(1, "Tell us what to call you"),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password").max(200),
});

export const profileSchema = z.object({
  displayName: trimmed(120).min(1).optional(),
  locale: z.enum(["ar", "en"]).optional(),
  timezone: trimmed(64).optional(),
  calendarSystem: z.enum(["gregorian", "hijri", "both"]).optional(),
  weekStartsOn: z.number().int().min(0).max(6).optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
  avatarColor: trimmed(16).optional(),
});

// ── Notes ───────────────────────────────────────────────────────────────────

export const noteBlockSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["paragraph", "heading", "todo", "bullet", "quote", "code", "divider"]),
  text: z.string().max(20000),
  checked: z.boolean().optional(),
  level: z.number().int().min(1).max(3).optional(),
});

export const noteInputSchema = z.object({
  title: trimmed(300).default(""),
  content: z.array(noteBlockSchema).max(500).default([]),
  projectId: z.string().uuid().nullable().optional(),
  pinned: z.boolean().optional(),
  aiAccessible: z.boolean().optional(),
});

export const noteUpdateSchema = noteInputSchema.partial();

// ── Tasks ───────────────────────────────────────────────────────────────────

export const taskStatusSchema = z.enum(["todo", "in_progress", "blocked", "done", "cancelled"]);
export const taskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export const taskEnergySchema = z.enum(["deep", "light", "admin"]);

export const taskInputSchema = z.object({
  title: trimmed(400).min(1, "A task needs a title"),
  description: z.string().max(20000).nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  status: taskStatusSchema.default("todo"),
  priority: taskPrioritySchema.default("medium"),
  energy: taskEnergySchema.default("admin"),
  dueAt: z.coerce.date().nullable().optional(),
  deferUntil: z.coerce.date().nullable().optional(),
  estimateMinutes: z.number().int().min(0).max(100000).nullable().optional(),
  recurrence: trimmed(300).nullable().optional(),
  isInbox: z.boolean().optional(),
  aiAccessible: z.boolean().optional(),
  position: z.number().optional(),
});

export const taskUpdateSchema = taskInputSchema.partial();

// ── Projects ────────────────────────────────────────────────────────────────

export const projectInputSchema = z.object({
  name: trimmed(160).min(1, "A project needs a name"),
  description: z.string().max(20000).nullable().optional(),
  color: trimmed(16).optional(),
  icon: trimmed(32).optional(),
  status: z.enum(["active", "on_hold", "completed", "archived"]).default("active"),
  targetDate: z.coerce.date().nullable().optional(),
  aiAccessible: z.boolean().optional(),
});

export const projectUpdateSchema = projectInputSchema.partial();

// ── Goals ───────────────────────────────────────────────────────────────────

export const goalInputSchema = z.object({
  title: trimmed(300).min(1, "A goal needs a title"),
  description: z.string().max(20000).nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  kind: z.enum(["goal", "habit"]).default("goal"),
  metricType: z.enum(["percent", "count", "minutes", "currency"]).default("percent"),
  targetValue: z.number().min(0).default(100),
  currentValue: z.number().min(0).default(0),
  unit: trimmed(24).nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  status: z.enum(["active", "paused", "achieved", "dropped"]).default("active"),
  graceDaysPerWeek: z.number().int().min(0).max(7).default(0),
});

export const goalUpdateSchema = goalInputSchema.partial();

// ── Events ──────────────────────────────────────────────────────────────────

export const eventInputSchema = z
  .object({
    title: trimmed(300).min(1, "An event needs a title"),
    description: z.string().max(20000).nullable().optional(),
    location: trimmed(300).nullable().optional(),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    allDay: z.boolean().default(false),
    timezone: trimmed(64).default("UTC"),
    recurrence: trimmed(300).nullable().optional(),
    kind: z.enum(["event", "block", "reminder", "travel"]).default("event"),
    projectId: z.string().uuid().nullable().optional(),
    taskId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.endAt >= v.startAt, {
    message: "End time must be after the start time",
    path: ["endAt"],
  });

export const eventUpdateSchema = z.object({
  title: trimmed(300).optional(),
  description: z.string().max(20000).nullable().optional(),
  location: trimmed(300).nullable().optional(),
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().optional(),
  allDay: z.boolean().optional(),
  timezone: trimmed(64).optional(),
  recurrence: trimmed(300).nullable().optional(),
  kind: z.enum(["event", "block", "reminder", "travel"]).optional(),
  projectId: z.string().uuid().nullable().optional(),
  recurrenceExceptions: z.array(z.string()).optional(),
});

// ── Capture ─────────────────────────────────────────────────────────────────

export const captureInputSchema = z.object({
  raw: z.string().trim().min(1, "Nothing to capture").max(200000),
  kind: z.enum(["text", "voice", "image", "email", "web", "file"]).default("text"),
  sourceUrl: z.string().url().max(2000).nullable().optional(),
});

// ── Tags ────────────────────────────────────────────────────────────────────

export const tagInputSchema = z.object({
  name: trimmed(64).min(1),
  color: trimmed(16).optional(),
});

// ── Chat ────────────────────────────────────────────────────────────────────

export const chatInputSchema = z.object({
  threadId: z.string().uuid().nullable().optional(),
  message: z.string().trim().min(1, "Type a message").max(8000),
  mode: z.enum(["chat", "summarize", "extract_tasks"]).default("chat"),
  contextNoteId: z.string().uuid().nullable().optional(),
});

// ── Search ──────────────────────────────────────────────────────────────────

export const searchQuerySchema = z.object({
  q: z.string().trim().max(300).default(""),
  types: z.array(z.enum(["note", "task", "project", "goal", "event", "capture"])).optional(),
  projectId: z.string().uuid().nullable().optional(),
  tag: trimmed(64).nullable().optional(),
  limit: z.number().int().min(1).max(100).default(30),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type NoteInput = z.infer<typeof noteInputSchema>;
export type TaskInput = z.infer<typeof taskInputSchema>;
export type ProjectInput = z.infer<typeof projectInputSchema>;
export type GoalInput = z.infer<typeof goalInputSchema>;
export type EventInput = z.infer<typeof eventInputSchema>;
export type CaptureInput = z.infer<typeof captureInputSchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
