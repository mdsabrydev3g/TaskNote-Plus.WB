import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import { resolveConnectionString } from "@/lib/db/connection";

/**
 * Neon serverless driver — works on Vercel Edge/Node runtimes without a
 * connection pool to manage. Each query is an HTTP round-trip to Neon's
 * pooler, which is the recommended setup for serverless Postgres.
 *
 * Connection resolution lives in `src/lib/db/connection.ts` so the app and the
 * maintenance scripts can never disagree about which database they target. See
 * that file for why a single `DATABASE_URL` lookup is not enough when the Neon
 * integration is attached.
 */

if (typeof globalThis !== "undefined" && !neonConfig.fetchEndpoint) {
  neonConfig.fetchConnectionCache = true;
}

const resolved = resolveConnectionString();

if (!resolved.url) {
  console.warn(
    "[TaskNote Plus] No usable Postgres connection string found. " +
      "Set DATABASE_URL (see .env.example) or attach the Neon integration.",
  );
} else if (resolved.unpooled) {
  // Pooled URLs are required at runtime: serverless functions scale out and a
  // direct connection per instance exhausts Postgres very quickly.
  console.warn(
    `[TaskNote Plus] Using an UNPOOLED connection from ${resolved.source}. ` +
      "This works for a single instance but will exhaust connections under load. " +
      "Set DATABASE_URL to the pooled connection string for production.",
  );
}

/** Name of the env var the connection came from — safe to expose, never a secret. */
export const connectionSource = resolved.source;

const sql = resolved.url ? neon(resolved.url) : (null as never);

export const db = drizzle(sql, { schema });

/** Richer connectivity probe used by /api/health to explain *why* it failed. */
export async function probeDatabase(): Promise<{
  database: "ok" | "unreachable";
  source: string | null;
  error: string | null;
}> {
  if (!resolved.url) {
    return {
      database: "unreachable",
      source: null,
      error:
        "No usable connection string found in the environment. " +
        "Set DATABASE_URL, or attach the Neon integration and redeploy.",
    };
  }

  try {
    await sql`select 1 as ok`;
    return { database: "ok", source: resolved.source, error: null };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    // Redact anything resembling credentials before surfacing the message.
    const safe = raw.replace(/postgres(ql)?:\/\/[^\s"']+/gi, "postgres://[redacted]");
    return { database: "unreachable", source: resolved.source, error: safe.slice(0, 300) };
  }
}

export { schema };
export type Db = typeof db;
