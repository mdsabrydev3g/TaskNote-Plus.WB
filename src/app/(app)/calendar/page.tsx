import type { Metadata } from "next";
import { and, asc, gte, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { UserScope } from "@/lib/db/scope";
import { CalendarView } from "@/components/calendar-view";
import { addDays, startOfDay } from "@/lib/utils";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const user = await requireUser();
  const scope = new UserScope(user.id);
  const params = await searchParams;

  // Fetch a generous window so month navigation and recurrences have data
  // available without another round trip on every arrow press.
  const rangeStart = addDays(startOfDay(new Date()), -90);
  const rangeEnd = addDays(startOfDay(new Date()), 180);

  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        scope.where(events),
        lte(events.startAt, rangeEnd),
        or(gte(events.endAt, rangeStart), sql`${events.recurrence} is not null`),
      ),
    )
    .orderBy(asc(events.startAt))
    .limit(1000);

  return (
    <CalendarView
      isArabic={user.locale === "ar"}
      calendarSystem={user.calendarSystem}
      weekStartsOn={user.weekStartsOn}
      openComposer={params.new === "1"}
      events={rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        location: row.location,
        startAt: row.startAt.toISOString(),
        endAt: row.endAt.toISOString(),
        allDay: row.allDay,
        recurrence: row.recurrence,
        kind: row.kind,
      }))}
    />
  );
}
