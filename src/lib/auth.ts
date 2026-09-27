import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

/**
 * Auth primitives. Design notes (§10.2):
 * - Access token: short-lived JWT (15 min) held in an HttpOnly cookie.
 * - Refresh token: opaque 256-bit random value; only its SHA-256 hash is stored,
 *   so a database leak does not yield usable sessions.
 * - Refresh rotation with reuse detection: presenting a rotated token revokes
 *   the whole family and raises a SecurityEvent.
 */

export const ACCESS_COOKIE = "tnp_access";
export const REFRESH_COOKIE = "tnp_refresh";
export const DEVICE_COOKIE = "tnp_device";

export const ACCESS_TTL_SECONDS = 60 * 15; // 15 minutes
export const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET must be set to a random string of at least 32 characters. Generate one with: openssl rand -base64 48",
    );
  }
  return new TextEncoder().encode(secret);
}

export type AccessTokenClaims = {
  sub: string;
  email: string;
  sid: string;
};

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ email: claims.email, sid: claims.sid })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer("tasknote-plus")
    .setAudience("tasknote-plus-app")
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: "tasknote-plus",
      audience: "tasknote-plus-app",
    });
    if (!payload.sub || typeof payload.email !== "string" || typeof payload.sid !== "string") {
      return null;
    }
    return { sub: payload.sub, email: payload.email, sid: payload.sid };
  } catch {
    return null;
  }
}

/**
 * Refresh tokens are high-entropy (256 bits) random values, so a fast hash is
 * safe here — there is no dictionary to attack. The comparison still needs to
 * be constant-time so hashes cannot be probed byte by byte.
 */
export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: sha256(raw) };
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Bytes(value: string): Buffer {
  return Buffer.from(sha256(value), "hex");
}

/**
 * Constant-time byte comparison. Returns false on length mismatch without
 * leaking where the difference was, so stored hashes cannot be probed.
 */
export function constantTimeEqual(a: Buffer | Uint8Array, b: Buffer | Uint8Array): boolean {
  const bufA = Buffer.isBuffer(a) ? a : Buffer.from(a);
  const bufB = Buffer.isBuffer(b) ? b : Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Cookie options shared by both auth cookies (§10.9 Web security). */
export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
