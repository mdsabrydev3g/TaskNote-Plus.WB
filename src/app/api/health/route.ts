import { NextResponse } from "next/server";
import { probeDatabase } from "@/db";
import { aiStatus } from "@/lib/ai/gateway";

/**
 * Health check for uptime monitoring and platform probes.
 *
 * Reports database reachability and AI provider configuration. When the
 * database is unreachable it includes the underlying driver error and the name
 * of the env var the credentials came from — that is what turns an opaque
 * "unreachable" into an actionable diagnosis. Secrets are never included: only
 * the variable *name*, and any connection string inside the error is redacted.
 */
export async function GET() {
  const started = Date.now();

  const { database, source, error } = await probeDatabase();
  const ai = aiStatus();

  return NextResponse.json(
    {
      status: database === "ok" ? "healthy" : "degraded",
      service: "tasknote-plus",
      version: "1.0.0",
      checks: {
        database,
        databaseSource: source,
        databaseError: error,
        aiConfigured: ai.available,
        aiProvider: ai.provider,
      },
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    },
    { status: database === "ok" ? 200 : 503 },
  );
}
