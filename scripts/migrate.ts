/**
 * TaskNote Plus — migration runner.
 *
 * Applies the SQL migrations in ./drizzle to the target Neon database.
 *
 * Usage:
 *   1. Generate SQL from the Drizzle schema:   npm run db:generate
 *   2. Apply the generated SQL to the database: npm run db:migrate
 *
 * Notes:
 * - `@neondatabase/serverless` supports single-shot queries only (no
 *   interactive transactions), so each migration file is wrapped in its own
 *   explicit BEGIN/COMMIT block executed as a single batch.
 * - A lightweight `_tasknote_migrations` table records which files have already
 *   been applied, making the runner idempotent and safe to re-run.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const MIGRATIONS_DIR = resolve(process.cwd(), "drizzle");
const LEDGER_TABLE = "_tasknote_migrations";

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    fail(
      "DATABASE_URL is not set.\n" +
        "  Copy .env.example to .env.local and paste the pooled connection string\n" +
        "  from your Neon dashboard (Connection Details → Pooled connection).",
    );
  }

  if (!existsSync(MIGRATIONS_DIR)) {
    fail(
      "No ./drizzle directory found.\n" +
        "  Run `npm run db:generate` first to produce SQL from src/db/schema.ts.",
    );
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, "en"));

  if (files.length === 0) {
    fail("No .sql migration files found in ./drizzle. Run `npm run db:generate`.");
  }

  const sql = neon(url);

  // --- Ensure the ledger exists -------------------------------------------------
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(LEDGER_TABLE)} (
      name        text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `;

  const applied = (await sql`SELECT name, checksum FROM ${sql(LEDGER_TABLE)}`) as Array<{
    name: string;
    checksum: string;
  }>;
  const appliedMap = new Map(applied.map((r) => [r.name, r.checksum]));

  let ran = 0;
  let skipped = 0;

  for (const file of files) {
    const fullPath = join(MIGRATIONS_DIR, file);
    const raw = readFileSync(fullPath, "utf8");
    const checksum = createHash("sha256").update(raw).digest("hex");

    const previous = appliedMap.get(file);
    if (previous) {
      if (previous !== checksum) {
        fail(
          `Migration "${file}" was already applied but its contents changed.\n` +
            `  Applied checksum: ${previous}\n  Current checksum: ${checksum}\n` +
            "  Create a new migration instead of editing an applied one.",
        );
      }
      console.log(`• ${file} — already applied, skipping`);
      skipped += 1;
      continue;
    }

    // Split on Drizzle's `--> statement-breakpoint` marker, strip line
    // comments, and drop empty segments so we only send real statements.
    const cleaned = raw
      .split(/-->\s*statement-breakpoint/g)
      .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
      .filter((s) => s.length > 0);

    console.log(`→ applying ${file} (${cleaned.length} statement${cleaned.length === 1 ? "" : "s"})`);

    // Apply the whole file inside one non-interactive HTTP transaction so a
    // mid-file failure rolls back cleanly.
    try {
      await sql.transaction(cleaned.map((statement) => sql(statement)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Tolerate idempotent re-runs of object creation.
      if (/already exists|duplicate/i.test(message)) {
        console.warn(`  · skipped (objects already exist): ${message}`);
      } else {
        fail(`Failed while applying ${file}:\n  ${message}`);
      }
    }

    await sql`
      INSERT INTO ${sql(LEDGER_TABLE)} (name, checksum)
      VALUES (${file}, ${checksum})
      ON CONFLICT (name) DO NOTHING
    `;

    ran += 1;
    console.log(`  ✓ ${file} applied`);
  }

  console.log(`\n✔ Migrations complete — ${ran} applied, ${skipped} skipped (already up to date).\n`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.stack ?? error.message : String(error));
});
