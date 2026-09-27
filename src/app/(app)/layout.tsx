import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { db } from "@/db";
import { captures } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  // Sidebar badge. Wrapped so a database hiccup never blocks the whole app.
  let inboxCount = 0;
  try {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(captures)
      .where(and(eq(captures.userId, user.id), eq(captures.processed, false)));
    inboxCount = rows[0]?.n ?? 0;
  } catch {
    inboxCount = 0;
  }

  return (
    <AppShell user={user} inboxCount={inboxCount}>
      {children}
    </AppShell>
  );
}
