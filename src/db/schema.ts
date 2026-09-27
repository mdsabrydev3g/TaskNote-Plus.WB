import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * TaskNote Plus — data model
 * ---------------------------------------------------------------------------
 * Shared-content entities (§6.5) all carry:
 *   id, user_id, workspace_id, created_at, updated_at, ai_accessible,
 *   version (lamport clock), device_origin, deleted_at (soft delete / sync tombstone)
 *
 * Tenancy (§6.6): every content query MUST be scoped by user_id. The `scopeUser`
 * helper in src/lib/db/scope.ts makes that enforced in the query builder rather
 * than left to convention.
 */

const id = () =>
  uuid("id").primaryKey().default(sql`gen_random_uuid()`);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  /** Lamport logical clock — causal ordering across devices (§6.3) */
  version: integer("version").notNull().default(0),
  deviceOrigin: varchar("device_origin", { length: 64 }),
};

// ── Identity ────────────────────────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: id(),
    email: varchar("email", { length: 320 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    avatarColor: varchar("avatar_color", { length: 16 }).notNull().default("#6366f1"),
    locale: varchar("locale", { length: 12 }).notNull().default("ar"),
    timezone: varchar("timezone", { length: 64 }).notNull().default("UTC"),
    calendarSystem: varchar("calendar_system", { length: 12 }).notNull().default("gregorian"),
    weekStartsOn: integer("week_starts_on").notNull().default(6),
    theme: varchar("theme", { length: 12 }).notNull().default("system"),
    emailVerified: boolean("email_verified").notNull().default(false),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    onboardingStep: varchar("onboarding_step", { length: 32 }).notNull().default("capture"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex("users_email_unique").on(sql`lower(${t.email})`),
  }),
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    slug: varchar("slug", { length: 140 }).notNull(),
    dataRegion: varchar("data_region", { length: 16 }).notNull().default("default"),
    aiEnabled: boolean("ai_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("workspaces_user_idx").on(t.userId),
  }),
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the opaque refresh token — the raw token is never stored */
    tokenHash: text("token_hash").notNull(),
    deviceId: varchar("device_id", { length: 64 }),
    userAgent: text("user_agent"),
    ipAddress: varchar("ip_address", { length: 64 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenIdx: uniqueIndex("sessions_token_hash_unique").on(t.tokenHash),
    userIdx: index("sessions_user_idx").on(t.userId),
  }),
);

/** §6.5 DeviceRegistry — every device that has ever authenticated */
export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    platform: varchar("platform", { length: 32 }).notNull(),
    fingerprint: varchar("fingerprint", { length: 128 }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("devices_user_idx").on(t.userId),
  }),
);

/** §6.5 SecurityEvent */
export const securityEvents = pgTable(
  "security_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 48 }).notNull(),
    severity: varchar("severity", { length: 12 }).notNull().default("info"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    ipAddress: varchar("ip_address", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("security_events_user_idx").on(t.userId, t.createdAt),
  }),
);

/** §6.5 AuditLog — non-AI user actions on sensitive resources */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 64 }).notNull(),
    entityType: varchar("entity_type", { length: 32 }),
    entityId: uuid("entity_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("audit_logs_user_idx").on(t.userId, t.createdAt),
  }),
);

/** §6.5 AIActionLog — every AI read/write with scope, model, cost, reversibility */
export const aiActionLogs = pgTable(
  "ai_action_logs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    capability: varchar("capability", { length: 48 }).notNull(),
    provider: varchar("provider", { length: 32 }).notNull(),
    model: varchar("model", { length: 96 }).notNull(),
    promptHash: varchar("prompt_hash", { length: 64 }),
    inputRefs: jsonb("input_refs").$type<string[]>().default(sql`'[]'::jsonb`),
    permissionScope: varchar("permission_scope", { length: 64 }),
    outcome: varchar("outcome", { length: 16 }).notNull().default("success"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    /** side-effecting writes stay undoable until this instant (§8.2) */
    reversibleUntil: timestamp("reversible_until", { withTimezone: true }),
    revertedAt: timestamp("reverted_at", { withTimezone: true }),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("ai_action_logs_user_idx").on(t.userId, t.createdAt),
  }),
);

/** §8.1 PermissionGrant — granular, inspectable, revocable scopes */
export const permissionGrants = pgTable(
  "permission_grants",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: varchar("scope", { length: 64 }).notNull(),
    granted: boolean("granted").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    grantedAt: timestamp("granted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    userScopeIdx: uniqueIndex("permission_user_scope_unique").on(t.userId, t.scope),
  }),
);

/** §6.5 ConsentRecord */
export const consentRecords = pgTable("consent_records", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 32 }).notNull(),
  version: varchar("version", { length: 24 }).notNull(),
  accepted: boolean("accepted").notNull().default(true),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Organising primitives ───────────────────────────────────────────────────

export const projects = pgTable(
  "projects",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    color: varchar("color", { length: 16 }).notNull().default("#6366f1"),
    icon: varchar("icon", { length: 32 }).notNull().default("folder"),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    targetDate: timestamp("target_date", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    aiAccessible: boolean("ai_accessible").notNull().default(true),
    ...timestamps,
  },
  (t) => ({
    userIdx: index("projects_user_idx").on(t.userId, t.status),
  }),
);

export const tags = pgTable(
  "tags",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 64 }).notNull(),
    color: varchar("color", { length: 16 }).notNull().default("#64748b"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userNameIdx: uniqueIndex("tags_user_name_unique").on(t.userId, t.name),
  }),
);

// ── Notes ───────────────────────────────────────────────────────────────────

export const notes = pgTable(
  "notes",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    title: varchar("title", { length: 300 }).notNull().default(""),
    /** block-based body stored as JSON; `contentText` mirrors it for FTS */
    content: jsonb("content").$type<NoteBlock[]>().default(sql`'[]'::jsonb`),
    contentText: text("content_text").notNull().default(""),
    pinned: boolean("pinned").notNull().default(false),
    aiAccessible: boolean("ai_accessible").notNull().default(true),
    ...timestamps,
  },
  (t) => ({
    userIdx: index("notes_user_idx").on(t.userId, t.updatedAt),
    projectIdx: index("notes_project_idx").on(t.projectId),
  }),
);

export type NoteBlock = {
  id: string;
  type: "paragraph" | "heading" | "todo" | "bullet" | "quote" | "code" | "divider";
  text: string;
  checked?: boolean;
  level?: number;
};

// ── Tasks ───────────────────────────────────────────────────────────────────

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    parentId: uuid("parent_id"),
    title: varchar("title", { length: 400 }).notNull(),
    description: text("description"),
    status: varchar("status", { length: 20 }).notNull().default("todo"),
    priority: varchar("priority", { length: 12 }).notNull().default("medium"),
    /** §7.3 energy tagging — feeds focus mode + AI scheduling */
    energy: varchar("energy", { length: 12 }).notNull().default("admin"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    deferUntil: timestamp("defer_until", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    estimateMinutes: integer("estimate_minutes"),
    /** RFC 5545 RRULE string for recurring tasks */
    recurrence: varchar("recurrence", { length: 300 }),
    position: real("position").notNull().default(1000),
    isInbox: boolean("is_inbox").notNull().default(false),
    aiAccessible: boolean("ai_accessible").notNull().default(true),
    ...timestamps,
  },
  (t) => ({
    userIdx: index("tasks_user_idx").on(t.userId, t.status),
    dueIdx: index("tasks_due_idx").on(t.userId, t.dueAt),
    projectIdx: index("tasks_project_idx").on(t.projectId),
    inboxIdx: index("tasks_inbox_idx").on(t.userId, t.isInbox),
  }),
);

export const taskTags = pgTable(
  "task_tags",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.taskId, t.tagId] }),
  }),
);

// ── Goals ───────────────────────────────────────────────────────────────────

export const goals = pgTable(
  "goals",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    title: varchar("title", { length: 300 }).notNull(),
    description: text("description"),
    kind: varchar("kind", { length: 16 }).notNull().default("goal"),
    metricType: varchar("metric_type", { length: 20 }).notNull().default("percent"),
    targetValue: real("target_value").notNull().default(100),
    currentValue: real("current_value").notNull().default(0),
    unit: varchar("unit", { length: 24 }),
    startDate: timestamp("start_date", { withTimezone: true }),
    dueDate: timestamp("due_date", { withTimezone: true }),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    /** habit streak tracking with opt-in grace days (§7.6) */
    streakCurrent: integer("streak_current").notNull().default(0),
    streakBest: integer("streak_best").notNull().default(0),
    graceDaysPerWeek: integer("grace_days_per_week").notNull().default(0),
    lastCheckInAt: timestamp("last_check_in_at", { withTimezone: true }),
    aiAccessible: boolean("ai_accessible").notNull().default(true),
    ...timestamps,
  },
  (t) => ({
    userIdx: index("goals_user_idx").on(t.userId, t.status),
  }),
);

/** §7.6 progress is computed bottom-up — this is the explicit link table */
export const goalTasks = pgTable(
  "goal_tasks",
  {
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.goalId, t.taskId] }),
  }),
);

// ── Calendar ────────────────────────────────────────────────────────────────

export const events = pgTable(
  "events",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    title: varchar("title", { length: 300 }).notNull(),
    description: text("description"),
    location: varchar("location", { length: 300 }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").notNull().default(false),
    /** IANA tz of the *user at input time*, frozen per §6.7 */
    timezone: varchar("timezone", { length: 64 }).notNull().default("UTC"),
    /** RFC 5545 RRULE */
    recurrence: varchar("recurrence", { length: 300 }),
    /** recurrence exceptions stored as overrides, never duplicated rows */
    recurrenceExceptions: jsonb("recurrence_exceptions").$type<string[]>().default(sql`'[]'::jsonb`),
    kind: varchar("kind", { length: 16 }).notNull().default("event"),
    aiAccessible: boolean("ai_accessible").notNull().default(true),
    ...timestamps,
  },
  (t) => ({
    userIdx: index("events_user_idx").on(t.userId, t.startAt),
  }),
);

// ── Capture inbox (§7.1) ────────────────────────────────────────────────────

export const captures = pgTable(
  "captures",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 20 }).notNull().default("text"),
    raw: text("raw").notNull(),
    /** idempotency: re-submitting identical content never duplicates (§7.1) */
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    processed: boolean("processed").notNull().default(false),
    /** AI destination is only a suggestion — capture is never blocked */
    suggestedType: varchar("suggested_type", { length: 20 }),
    suggestedTitle: varchar("suggested_title", { length: 300 }),
    suggestionConfidence: varchar("suggestion_confidence", { length: 12 }),
    suggestionReason: text("suggestion_reason"),
    routedToType: varchar("routed_to_type", { length: 20 }),
    routedToId: uuid("routed_to_id"),
    sourceUrl: text("source_url"),
    ...timestamps,
  },
  (t) => ({
    userIdx: index("captures_user_idx").on(t.userId, t.processed, t.createdAt),
    hashIdx: uniqueIndex("captures_user_hash_unique").on(t.userId, t.contentHash),
  }),
);

// ── Knowledge / AI ──────────────────────────────────────────────────────────

/** §8.10 embeddings — chunked, workspace-partitioned by user_id */
export const chunks = pgTable(
  "chunks",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceType: varchar("source_type", { length: 20 }).notNull(),
    sourceId: uuid("source_id").notNull(),
    ordinal: integer("ordinal").notNull().default(0),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourceIdx: index("chunks_source_idx").on(t.userId, t.sourceType, t.sourceId),
  }),
);

/** §9.3 semantic + episodic memory, user-inspectable and deletable */
export const aiMemories = pgTable(
  "ai_memories",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 16 }).notNull().default("semantic"),
    fact: text("fact").notNull(),
    /** provenance: the AI never asserts a remembered fact without showing its source */
    sourceType: varchar("source_type", { length: 20 }),
    sourceId: uuid("source_id"),
    confirmed: boolean("confirmed").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("ai_memories_user_idx").on(t.userId, t.confirmed),
  }),
);

/** §9.5 conversational threads */
export const chatThreads = pgTable(
  "chat_threads",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }).notNull().default("New conversation"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("chat_threads_user_idx").on(t.userId, t.updatedAt),
  }),
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: id(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 12 }).notNull(),
    content: text("content").notNull(),
    /** inline citations — §7.7 every answer shows its sources */
    citations: jsonb("citations").$type<Citation[]>().default(sql`'[]'::jsonb`),
    provider: varchar("provider", { length: 32 }),
    model: varchar("model", { length: 96 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    threadIdx: index("chat_messages_thread_idx").on(t.threadId, t.createdAt),
  }),
);

export type Citation = {
  sourceType: string;
  sourceId: string;
  label: string;
};

// ── Sync ────────────────────────────────────────────────────────────────────

/** §6.4 every mutation is a typed, ordered Change Event */
export const changeEvents = pgTable(
  "change_events",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityType: varchar("entity_type", { length: 32 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    operation: varchar("operation", { length: 12 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    lamportClock: integer("lamport_clock").notNull().default(0),
    deviceId: varchar("device_id", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("change_events_user_idx").on(t.userId, t.lamportClock),
  }),
);

// ── Relations ───────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  workspaces: many(workspaces),
  notes: many(notes),
  tasks: many(tasks),
  projects: many(projects),
  goals: many(goals),
  events: many(events),
  tags: many(tags),
  captures: many(captures),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, { fields: [projects.userId], references: [users.id] }),
  tasks: many(tasks),
  notes: many(notes),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  user: one(users, { fields: [tasks.userId], references: [users.id] }),
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
}));

export const notesRelations = relations(notes, ({ one }) => ({
  user: one(users, { fields: [notes.userId], references: [users.id] }),
  project: one(projects, { fields: [notes.projectId], references: [projects.id] }),
}));

// ── Inferred types ──────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type CalendarEvent = typeof events.$inferSelect;
export type Capture = typeof captures.$inferSelect;
export type ChatThread = typeof chatThreads.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type AiMemory = typeof aiMemories.$inferSelect;
export type SessionRecord = typeof sessions.$inferSelect;
export type DeviceRecord = typeof devices.$inferSelect;
