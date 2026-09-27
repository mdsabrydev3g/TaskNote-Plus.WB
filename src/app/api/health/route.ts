import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { aiStatus } from "@/lib/ai/gateway";

/**
 * Health check for uptime monitoring and platform probes.
 * Reports database reachability and AI provider configuration — never any
 * user data, and never any secret value.
 */
export async function GET() {
  const started = Date.now();
  let database: "ok" | "unreachable" = "unreachable";

  try {
    await db.execute(sql`select 1`);
    database = "ok";
  } catch {
    database = "unreachable";
  }

  const ai = aiStatus();

  return NextResponse.json(
    {
      status: database === "ok" ? "healthy" : "degraded",
      service: "tasknote-plus",
      version: "1.0.0",
      checks: {
        database,
        aiConfigured: ai.available,
        aiProvider: ai.provider,
      },
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    },
    { status: database === "ok" ? 200 : 503 },
  );
}
