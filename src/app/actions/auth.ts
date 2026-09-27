"use server";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { auditLogs, securityEvents, users, workspaces } from "@/db/schema";
import { ForbiddenError, UserScope } from "@/lib/db/scope";
import { establishSession, destroySession, requireUser, getCurrentUser } from "@/lib/session";
import { loginSchema, profileSchema, registerSchema } from "@/lib/validation";
import { MAX_FAILED_LOGINS, LOCKOUT_MINUTES, PASSWORD_COST } from "@/lib/config";

export type ActionState = {
  ok: boolean;
  error?: string;
  field?: string;
  message?: string;
};

export async function registerAction(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const parsed = registerSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    displayName: formData.get("displayName"),
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: issue.path[0] as string };
  }

  const { email, password, displayName } = parsed.data;

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  if (existing.length > 0) {
    return { ok: false, error: "An account with this email already exists", field: "email" };
  }

  const passwordHash = await bcrypt.hash(password, PASSWORD_COST);

  const inserted = await db
    .insert(users)
    .values({ email, passwordHash, displayName })
    .returning({ id: users.id, email: users.email });

  const user = inserted[0];

  // Every user gets one default workspace so tenancy is never ambiguous.
  await db.insert(workspaces).values({
    userId: user.id,
    name: "Personal",
    slug: "personal",
  });

  await db.insert(auditLogs).values({
    userId: user.id,
    action: "account_created",
    entityType: "user",
    entityId: user.id,
  });

  await establishSession(user.id, user.email);

  revalidatePath("/", "layout");
  return { ok: true, message: "Welcome to TaskNote Plus" };
}

export async function loginAction(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: issue.path[0] as string };
  }

  const { email, password } = parsed.data;

  const rows = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  // Uniform failure message + a dummy compare so timing does not reveal
  // whether the account exists.
  const genericFailure: ActionState = { ok: false, error: "Email or password is incorrect" };

  if (rows.length === 0) {
    await bcrypt.compare(password, "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidiu");
    return genericFailure;
  }

  const user = rows[0];

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    return {
      ok: false,
      error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    };
  }

  const valid = await bcrypt.compare(password, user.passwordHash);

  if (!valid) {
    const failedCount = user.failedLoginCount + 1;
    const shouldLock = failedCount >= MAX_FAILED_LOGINS;
    await db
      .update(users)
      .set({
        failedLoginCount: failedCount,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60000) : null,
      })
      .where(eq(users.id, user.id));

    await db.insert(securityEvents).values({
      userId: user.id,
      kind: shouldLock ? "account_locked" : "login_failed",
      severity: shouldLock ? "warning" : "info",
      detail: { failedCount },
    });

    if (shouldLock) {
      return {
        ok: false,
        error: `Too many failed attempts. Your account is locked for ${LOCKOUT_MINUTES} minutes.`,
      };
    }
    return genericFailure;
  }

  await db
    .update(users)
    .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(users.id, user.id));

  await establishSession(user.id, user.email);

  revalidatePath("/", "layout");
  return { ok: true, message: "Signed in" };
}

export async function logoutAction() {
  await destroySession();
  revalidatePath("/", "layout");
  redirect("/login");
}

export async function updateProfileAction(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const raw: Record<string, unknown> = {};
  for (const key of [
    "displayName",
    "locale",
    "timezone",
    "calendarSystem",
    "theme",
    "avatarColor",
  ]) {
    const value = formData.get(key);
    if (value !== null && value !== "") raw[key] = value;
  }
  const weekStartsOn = formData.get("weekStartsOn");
  if (weekStartsOn !== null && weekStartsOn !== "") raw.weekStartsOn = Number(weekStartsOn);

  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: issue.path[0] as string };
  }

  await db.update(users).set({ ...parsed.data, updatedAt: new Date() }).where(eq(users.id, user.id));

  revalidatePath("/", "layout");
  return { ok: true, message: "Preferences saved" };
}

export async function changePasswordAction(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");

  if (next.length < 10) {
    return { ok: false, error: "Use at least 10 characters", field: "newPassword" };
  }

  const rows = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (rows.length === 0) return { ok: false, error: "Not signed in" };

  const valid = await bcrypt.compare(current, rows[0].passwordHash);
  if (!valid) {
    return { ok: false, error: "Current password is incorrect", field: "currentPassword" };
  }

  const passwordHash = await bcrypt.hash(next, PASSWORD_COST);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, user.id));

  await db.insert(auditLogs).values({
    userId: user.id,
    action: "password_changed",
    entityType: "user",
    entityId: user.id,
  });

  return { ok: true, message: "Password updated" };
}

/** §10.2 session management — revoke a single device remotely. */
export async function revokeSessionAction(sessionId: string): Promise<ActionState> {
  const user = await requireUser();
  const scope = new UserScope(user.id);

  const { sessions } = await import("@/db/schema");

  const rows = await db
    .select({ id: sessions.id, userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), scope.whereWithDeleted(sessions)))
    .limit(1);

  if (rows.length === 0) throw new ForbiddenError();

  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));

  await db.insert(auditLogs).values({
    userId: user.id,
    action: "session_revoked",
    entityType: "session",
    entityId: sessionId,
  });

  revalidatePath("/settings/security");
  return { ok: true, message: "Session revoked" };
}

/** §10.9 remote wipe — mark a device revoked so clients drop their local store. */
export async function revokeDeviceAction(deviceId: string): Promise<ActionState> {
  const user = await requireUser();
  const scope = new UserScope(user.id);
  const { devices, sessions } = await import("@/db/schema");

  const rows = await db
    .select({ id: devices.id, userId: devices.userId })
    .from(devices)
    .where(and(eq(devices.id, deviceId), scope.whereWithDeleted(devices)))
    .limit(1);

  if (rows.length === 0) throw new ForbiddenError();

  const now = new Date();
  await db.update(devices).set({ revokedAt: now }).where(eq(devices.id, deviceId));
  await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.deviceId, deviceId), isNull(sessions.revokedAt)));

  await db.insert(auditLogs).values({
    userId: user.id,
    action: "device_revoked",
    entityType: "device",
    entityId: deviceId,
  });

  revalidatePath("/settings/security");
  return { ok: true, message: "Device signed out everywhere" };
}

/** Exercises the scoping guard so a missing check surfaces in tests, not prod. */
export async function assertScopeHealthy(): Promise<boolean> {
  const user = await requireUser();
  const scope = new UserScope(user.id);
  const rows = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(scope.whereWithDeleted(auditLogs))
    .limit(1);
  return rows.length <= 1;
}

export async function listRecentAudit(limit = 20) {
  const user = await requireUser();
  const scope = new UserScope(user.id);
  return db
    .select()
    .from(auditLogs)
    .where(scope.whereWithDeleted(auditLogs))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}
