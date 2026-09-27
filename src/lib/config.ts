/**
 * Central configuration constants. Keeping them in one place means the
 * documented limits in the spec and the code that enforces them cannot drift.
 */

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "TaskNote Plus";
export const APP_TAGLINE_AR = "مساحة واحدة لكل ما تفكر فيه وتعمل عليه";
export const APP_TAGLINE_EN = "One place for everything you think and do";

/** bcrypt cost. 12 is ~250ms on typical serverless hardware — good tradeoff. */
export const PASSWORD_COST = 12;

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

/** §8.6 token budget per user per day for cloud AI providers. */
export const DAILY_AI_TOKEN_BUDGET = 150_000;

/** §7.10 search performance targets. */
export const SEARCH_LOCAL_TARGET_MS = 150;
export const SEARCH_SEMANTIC_TARGET_MS = 800;

/** §8.2 AI writes stay undoable for at least 24h. */
export const AI_REVERSIBLE_HOURS = 48;

/**
 * Assistant behaviour:
 *  - "general"  (default) — a full personal assistant. Answers from its own
 *                knowledge AND from the workspace, and can create events,
 *                tasks and notes on request.
 *  - "grounded" (opt-in)  — the original strict mode: answers only from the
 *                user's own workspace content and never uses general knowledge.
 * Set ASSISTANT_MODE=grounded to restore the strict behaviour.
 */
export const ASSISTANT_MODE: "general" | "grounded" =
  process.env.ASSISTANT_MODE === "grounded" ? "grounded" : "general";

/** Tool use (creating events/tasks/notes from chat) is enabled in general mode. */
export const ASSISTANT_TOOLS_ENABLED = ASSISTANT_MODE === "general";

/** §12 notifications are batched by default. */
export const QUIET_HOURS_DEFAULT = { start: 22, end: 7 };

export const DEFAULT_CAPTURE_KINDS = ["text", "voice", "image", "email", "web", "file"] as const;

export const TASK_STATUSES = ["todo", "in_progress", "blocked", "done", "cancelled"] as const;
export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const TASK_ENERGIES = ["deep", "light", "admin"] as const;

export const KANBAN_COLUMNS = [
  { id: "todo", titleAr: "قائمة الانتظار", titleEn: "To do" },
  { id: "in_progress", titleAr: "قيد التنفيذ", titleEn: "In progress" },
  { id: "blocked", titleAr: "متوقف", titleEn: "Blocked" },
  { id: "done", titleAr: "مكتمل", titleEn: "Done" },
] as const;

export const PRIORITY_META = {
  urgent: { color: "#ef4444", labelAr: "عاجل", labelEn: "Urgent" },
  high: { color: "#f59e0b", labelAr: "مرتفع", labelEn: "High" },
  medium: { color: "#3b82f6", labelAr: "متوسط", labelEn: "Medium" },
  low: { color: "#64748b", labelAr: "منخفض", labelEn: "Low" },
} as const;

export const ENERGY_META = {
  deep: { icon: "brain", labelAr: "تركيز عميق", labelEn: "Deep work" },
  light: { icon: "coffee", labelAr: "عمل خفيف", labelEn: "Light work" },
  admin: { icon: "inbox", labelAr: "إداري", labelEn: "Admin" },
} as const;

export const STATUS_META = {
  todo: { color: "#64748b", labelAr: "قائمة الانتظار", labelEn: "To do" },
  in_progress: { color: "#3b82f6", labelAr: "قيد التنفيذ", labelEn: "In progress" },
  blocked: { color: "#ef4444", labelAr: "متوقف", labelEn: "Blocked" },
  done: { color: "#10b981", labelAr: "مكتمل", labelEn: "Done" },
  cancelled: { color: "#94a3b8", labelAr: "ملغي", labelEn: "Cancelled" },
} as const;

/** §7.12 onboarding — user reaches first capture within 30 seconds. */
export const ONBOARDING_STEPS = ["capture", "organize", "ai", "done"] as const;

export const NAV_ITEMS = [
  { href: "/dashboard", key: "dashboard", labelAr: "لوحة اليوم", labelEn: "Today", icon: "home" },
  { href: "/inbox", key: "inbox", labelAr: "الوارد", labelEn: "Inbox", icon: "inbox" },
  { href: "/tasks", key: "tasks", labelAr: "المهام", labelEn: "Tasks", icon: "check" },
  { href: "/notes", key: "notes", labelAr: "الملاحظات", labelEn: "Notes", icon: "note" },
  { href: "/projects", key: "projects", labelAr: "المشاريع", labelEn: "Projects", icon: "folder" },
  { href: "/calendar", key: "calendar", labelAr: "التقويم", labelEn: "Calendar", icon: "calendar" },
  { href: "/goals", key: "goals", labelAr: "الأهداف", labelEn: "Goals", icon: "target" },
  { href: "/assistant", key: "assistant", labelAr: "المساعد", labelEn: "Assistant", icon: "sparkles" },
] as const;
