/**
 * Shared connection-string resolution.
 *
 * Used by the app (`src/db/index.ts`) and the maintenance scripts so all of them
 * agree on which database they are talking to.
 *
 * Why this exists: when a database is attached through the Vercel Neon
 * integration, credentials arrive under a project-prefixed name
 * (e.g. `MYAPP_DB_DATABASE_URL`) rather than `DATABASE_URL`. Hard-coding the
 * canonical name means the integration can be attached successfully and the app
 * still reports "database unreachable" — an opaque failure. Resolving through a
 * candidate list makes attaching the integration sufficient.
 *
 * Plain Node module (no path aliases) so `tsx` scripts can import it directly.
 */

const CANONICAL_KEYS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "NEON_DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_PRISMA_URL",
] as const;

const PLACEHOLDER = /^(|\[SENSITIVE\]|replace-me.*|postgres(ql)?:\/\/user:password.*)$/i;

/** A value is usable only if it is a real, non-placeholder Postgres URL. */
function looksUsable(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (PLACEHOLDER.test(trimmed)) return false;
  return /^postgres(ql)?:\/\//i.test(trimmed);
}

/** Strip wrapping quotes and any embedded whitespace/newlines. */
function normalise(raw: string): string {
  return raw
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, "");
}

/** Prefer pooled URLs; `*_UNPOOLED` / `*_NON_POOLING` are migrations-only. */
function isUnpooled(key: string): boolean {
  return /_UNPOOLED|_NON_POOLING|_NO_SSL|_PRISMA_URL$/i.test(key);
}

export type ResolvedConnection = {
  url: string | null;
  source: string | null;
  /** True when the connection came from an unpooled/migration-only variable. */
  unpooled: boolean;
};

export function resolveConnectionString(
  env: Record<string, string | undefined> = process.env,
  options: { allowUnpooled?: boolean } = {},
): ResolvedConnection {
  // 1. Exact matches on the canonical names, in priority order.
  for (const key of CANONICAL_KEYS) {
    if (looksUsable(env[key])) {
      return {
        url: normalise(env[key] as string),
        source: key,
        unpooled: isUnpooled(key),
      };
    }
  }

  // 2. Vercel Neon integration names, e.g. `TASKNOTE_DB_DATABASE_URL`.
  const prefixed = Object.keys(env)
    .filter((k) => /_DB_DATABASE_URL$/i.test(k) || /_DB_POSTGRES_URL$/i.test(k))
    .sort();
  for (const key of prefixed) {
    if (isUnpooled(key) && !options.allowUnpooled) continue;
    if (looksUsable(env[key])) {
      return { url: normalise(env[key] as string), source: key, unpooled: isUnpooled(key) };
    }
  }

  // 3. Last resort: anything Postgres-shaped, pooled-first.
  const anyUrl = Object.keys(env).sort((a, b) => {
    const au = isUnpooled(a) ? 1 : 0;
    const bu = isUnpooled(b) ? 1 : 0;
    return au - bu;
  });
  for (const key of anyUrl) {
    if (!/POSTGRES_URL$|DATABASE_URL$/i.test(key)) continue;
    if (isUnpooled(key) && !options.allowUnpooled) continue;
    if (looksUsable(env[key])) {
      return { url: normalise(env[key] as string), source: key, unpooled: isUnpooled(key) };
    }
  }

  // 4. Allow an unpooled URL as a final fallback (migrations need it).
  if (!options.allowUnpooled) {
    const fallback = resolveConnectionString(env, { allowUnpooled: true });
    if (fallback.url) return fallback;
  }

  return { url: null, source: null, unpooled: false };
}

/**
 * Resolve for a migration/CLI context. Unlike the runtime path, this *requires*
 * the direct (unpooled) connection when one is available, because DDL over the
 * pooler can be routed to different backends mid-migration.
 */
export function resolveMigrationConnection(
  env: Record<string, string | undefined> = process.env,
): ResolvedConnection {
  const direct = Object.keys(env)
    .filter((k) => /_UNPOOLED$|_NON_POOLING$/i.test(k))
    .sort();
  for (const key of direct) {
    if (looksUsable(env[key])) {
      return { url: normalise(env[key] as string), source: key, unpooled: true };
    }
  }
  return resolveConnectionString(env, { allowUnpooled: true });
}
