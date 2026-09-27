/**
 * Read-only database diagnostic.
 *
 * Reports which env var the connection resolved from, whether it is pooled, and
 * which tables currently exist. Used to confirm migrations have been applied.
 * Never prints credentials.
 *
 * Usage: npm run db:check
 */
import { neon } from "@neondatabase/serverless";
import { resolveConnectionString } from "../src/lib/db/connection";

const found = resolveConnectionString();

if (!found.url) {
  console.error(
    "✖ No usable Postgres connection string found in the environment.\n" +
      "  Locally: put your Neon URL in .env.local\n" +
      "  On Vercel: attach the Neon integration, or set DATABASE_URL.",
  );
  process.exit(1);
}

console.log(`Connection source : ${found.source}`);
console.log(`Pooled            : ${found.unpooled ? "NO (direct — migrations only)" : "yes"}`);

const sql = neon(found.url);

try {
  const rows = (await sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
    order by table_name
  `) as Array<{ table_name: string }>;

  console.log(`\nTables found: ${rows.length}`);
  if (rows.length === 0) {
    console.log("(none — migrations have not been applied yet; run `npm run db:migrate`)");
  } else {
    for (const r of rows) console.log(`  • ${r.table_name}`);
  }
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error);
  console.error("\n✖ Query failed:", msg.replace(/:\/\/[^@]*@/g, "://[redacted]@"));
  process.exit(1);
}
