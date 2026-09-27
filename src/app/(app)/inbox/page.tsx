import type { Metadata } from "next";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { captures } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { UserScope } from "@/lib/db/scope";
import { InboxView } from "@/components/inbox-view";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage() {
  const user = await requireUser();
  const scope = new UserScope(user.id);

  const [rows, processed] = await Promise.all([
    db
      .select()
      .from(captures)
      .where(and(scope.where(captures), eq(captures.processed, false)))
      .orderBy(desc(captures.createdAt))
      .limit(200),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(captures)
      .where(and(scope.where(captures), eq(captures.processed, true))),
  ]);

  return (
    <InboxView
      isArabic={user.locale === "ar"}
      processedCount={processed[0]?.n ?? 0}
      items={rows.map((row) => ({
        id: row.id,
        raw: row.raw,
        kind: row.kind,
        createdAt: row.createdAt.toISOString(),
        suggestedType: row.suggestedType,
        suggestedTitle: row.suggestedTitle,
        suggestionConfidence: row.suggestionConfidence,
        suggestionReason: row.suggestionReason,
      }))}
    />
  );
}
