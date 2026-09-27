import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Neon serverless driver — works on Vercel Edge/Node runtimes without a
 * connection pool to manage. Each query is an HTTP round-trip to Neon's
 * pooler, which is the recommended setup for serverless Postgres.
 */

if (typeof globalThis !== "undefined" && !neonConfig.fetchEndpoint) {
  // Default is fine in production; this keeps local dev on the same path.
  neonConfig.fetchConnectionCache = true;
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  // Fail loudly at call time with a message a human can action, rather than
  // a confusing driver error deep in a stack trace.
  console.warn(
    "[TaskNote Plus] DATABASE_URL is not set. Copy .env.example to .env.local and add your Neon connection string.",
  );
}

const sql = connectionString ? neon(connectionString) : (null as never);

export const db = drizzle(sql, { schema });

export { schema };
export type Db = typeof db;
