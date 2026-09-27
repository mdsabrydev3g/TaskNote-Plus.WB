/**
 * Bundle SQL migrations into a TypeScript module.
 *
 * The migration runner normally reads ./drizzle from disk. That is fine in CI
 * and on a developer machine, but not at request time inside a serverless
 * function, where the filesystem may not contain the repository. Inlining the
 * SQL as a module guarantees the migration endpoint always has the statements
 * it needs.
 *
 * Run after `npm run db:generate`. Wired into `db:migrate` so the bundle cannot
 * drift from the generated SQL.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const drizzleDir = resolve(process.cwd(), "drizzle");
const outDir = resolve(process.cwd(), "src/lib/db/migrations");
const outFile = join(outDir, "bundle.ts");

const files = readdirSync(drizzleDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.error("✖ No .sql files found in ./drizzle — run `npm run db:generate` first.");
  process.exit(1);
}

const entries = files
  .map((name) => {
    const sql = readFileSync(join(drizzleDir, name), "utf8");
    return `  {\n    name: ${JSON.stringify(name)},\n    sql: ${JSON.stringify(sql)},\n  },`;
  })
  .join("\n");

const output = `/**
 * Generated migration bundle — DO NOT EDIT BY HAND.
 *
 * Regenerate with: npm run db:bundle
 *
 * The SQL is inlined as a module so it ships inside the serverless bundle
 * without relying on the filesystem, which is not guaranteed to contain the
 * repository at request time on every Vercel runtime.
 */

export type BundledMigration = { name: string; sql: string };

export const MIGRATIONS: BundledMigration[] = [
${entries}
];
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, output, "utf8");

const bytes = Buffer.byteLength(output, "utf8");
console.log(`✔ Bundled ${files.length} migration file(s) → src/lib/db/migrations/bundle.ts (${bytes} bytes)`);
