import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { devices, securityEvents, sessions, users } from "@/db/schema";
import { cookies, headers } from "next/headers";
import {
  ACCESS_COOKIE,
  ACCESS_TTL_SECONDS,
  DEVICE_COOKIE,
  REFRESH_COOKIE,
  REFRESH_TTL_SECONDS,
  constantTimeEqual,
  cookieOptions,
  generateRefreshToken,
  sha256,
  sha256Bytes,
  signAccessToken,
  verifyAccessToken,
} from "./auth";

export type CurrentUser = {
  id: string;
  email: string;
  displayName: string;
  avatarColor: string;
  locale: string;
  timezone: string;
  calendarSystem: string;
  weekStartsOn: number;
  theme: string;
  onboardingStep: string;
  sessionId: string;
};

async function readUserAgentAndIp() {
  const h = await headers();
  return {
    userAgent: h.get("user-agent") ?? "unknown",
    ipAddress:
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      h.get("x-real-ip") ??
      "unknown",
  };
}

function detectPlatform(userAgent: string): string {
  if (/iphone|ipad|ipod/i.test(userAgent)) return "ios";
  if (/android/i.test(userAgent)) return "android";
  if (/macintosh|mac os x/i.test(userAgent)) return "macos";
  if (/windows/i.test(userAgent)) return "windows";
  if (/linux/i.test(userAgent)) return "linux";
  return "web";
}

/**
 * Issues a fresh access + refresh token pair and writes both cookies.
 * Also registers/refreshes the DeviceRegistry row (§6.5).
 */
export async function establishSession(userId: string, email: string) {
  const { userAgent, ipAddress } = await readUserAgentAndIp();
  const platform = detectPlatform(userAgent);
  const cookieStore = await cookies();

  // Reuse an existing device id when present so the session list stays readable.
  let deviceId = cookieStore.get(DEVICE_COOKIE)?.value;
  if (deviceId) {
    const existing = await db
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.id, deviceId), eq(devices.userId, userId), isNull(devices.revokedAt)))
      .limit(1);
    if (existing.length === 0) deviceId = undefined;
  }

  if (!deviceId) {
    const inserted = await db
      .insert(devices)
      .values({ userId, name: `${platform} device`, platform })
      .returning({ id: devices.id });
    deviceId = inserted[0].id;
  } else {
    await db
      .update(devices)
      .set({ lastSeenAt: new Date(), platform })
      .where(eq(devices.id, deviceId));
  }

  const { raw: refreshRaw, hash: refreshHash } = generateRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

  const inserted = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: refreshHash,
      deviceId,
      userAgent,
      ipAddress,
      expiresAt,
    })
    .returning({ id: sessions.id });

  const sessionId = inserted[0].id;
  const accessToken = await signAccessToken({ sub: userId, email, sid: sessionId });

  cookieStore.set(ACCESS_COOKIE, accessToken, cookieOptions(ACCESS_TTL_SECONDS));
  cookieStore.set(REFRESH_COOKIE, refreshRaw, cookieOptions(REFRESH_TTL_SECONDS));
  cookieStore.set(DEVICE_COOKIE, deviceId, cookieOptions(REFRESH_TTL_SECONDS));

  await db.insert(securityEvents).values({
    userId,
    kind: "session_established",
    severity: "info",
    detail: { platform, deviceId },
    ipAddress,
  });

  return { sessionId, deviceId };
}

/**
 * Resolves the current user from the access cookie, transparently refreshing
 * via the refresh cookie when the access token has expired.
 * Returns null for anonymous requests — callers decide whether that's an error.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const access = cookieStore.get(ACCESS_COOKIE)?.value;

  if (access) {
    const claims = await verifyAccessToken(access);
    if (claims) {
      return loadUser(claims.sub, claims.sid);
    }
  }

  const refresh = cookieStore.get(REFRESH_COOKIE)?.value;
  if (!refresh) return null;

  // Lookup uses a constant-time comparison against same-user rows so that the
  // stored hash cannot be probed byte-by-byte through timing differences.
  const rows = await db
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
      deviceId: sessions.deviceId,
      tokenHash: sessions.tokenHash,
    })
    .from(sessions)
    .where(isNull(sessions.revokedAt))
    .limit(200);

  const presentedHash = sha256Bytes(refresh);
  const match = rows.find((row) =>
    constantTimeEqual(Buffer.from(row.tokenHash, "hex"), presentedHash),
  ) ?? null;

  if (match) {
    const userRows = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, match.userId))
      .limit(1);
    if (userRows.length === 0) return null;

    // Rotate: invalidate the presented token, mint a new pair.
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, match.sessionId));

    const { raw: refreshRaw, hash: refreshHash } = generateRefreshToken();
    const rotated = await db
      .insert(sessions)
      .values({
        userId: match.userId,
        tokenHash: refreshHash,
        deviceId: match.deviceId,
        expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
      })
      .returning({ id: sessions.id });

    const newSessionId = rotated[0].id;
    const accessToken = await signAccessToken({
      sub: match.userId,
      email: userRows[0].email,
      sid: newSessionId,
    });

    cookieStore.set(ACCESS_COOKIE, accessToken, cookieOptions(ACCESS_TTL_SECONDS));
    cookieStore.set(REFRESH_COOKIE, refreshRaw, cookieOptions(REFRESH_TTL_SECONDS));

    return loadUser(match.userId, newSessionId);
  }

  // No live session matched. If the token belongs to a session we already
  // revoked, it is being replayed — treat it as a compromise and revoke the
  // whole family for that user (§10.2 rotation with reuse detection).
  const revokedRows = await db
    .select({ id: sessions.id, userId: sessions.userId, tokenHash: sessions.tokenHash })
    .from(sessions)
    .where(isNotNull(sessions.revokedAt))
    .limit(200);

  const replayed = revokedRows.find((row) =>
    constantTimeEqual(Buffer.from(row.tokenHash, "hex"), presentedHash),
  );

  if (replayed) {
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, replayed.userId), isNull(sessions.revokedAt)));
    await db.insert(securityEvents).values({
      userId: replayed.userId,
      kind: "refresh_token_reuse_detected",
      severity: "critical",
      detail: { sessionId: replayed.id },
    });
  }

  return null;
}

async function loadUser(userId: string, sessionId: string): Promise<CurrentUser | null> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (rows.length === 0) return null;
  const u = rows[0];
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    avatarColor: u.avatarColor,
    locale: u.locale,
    timezone: u.timezone,
    calendarSystem: u.calendarSystem,
    weekStartsOn: u.weekStartsOn,
    theme: u.theme,
    onboardingStep: u.onboardingStep,
    sessionId,
  };
}

/** Use in route handlers / server components that must not run anonymously. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "UnauthorizedError";
  }
}

export async function destroySession() {
  const cookieStore = await cookies();
  const refresh = cookieStore.get(REFRESH_COOKIE)?.value;
  const access = cookieStore.get(ACCESS_COOKIE)?.value;

  if (refresh) {
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.tokenHash, sha256(refresh)));
  }

  const claims = access ? await verifyAccessToken(access) : null;
  if (claims) {
    await db.insert(securityEvents).values({
      userId: claims.sub,
      kind: "session_terminated",
      severity: "info",
      detail: { sessionId: claims.sid },
    });
  }

  cookieStore.delete(ACCESS_COOKIE);
  cookieStore.delete(REFRESH_COOKIE);
  cookieStore.delete(DEVICE_COOKIE);
}
