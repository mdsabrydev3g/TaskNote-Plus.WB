import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  ArrowRight,
  CalendarClock,
  CheckSquare,
  Inbox,
  Sparkles,
  Target,
  TriangleAlert,
} from "lucide-react";
import { db } from "@/db";
import { captures, events, goals, notes, tasks } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { UserScope } from "@/lib/db/scope";
import { PageHeader, SectionHeading, StatCard, EmptyState } from "@/components/ui";
import { DailyBriefCard } from "@/components/daily-brief-card";
import { TaskRow } from "@/components/task-row";
import { formatHijri, formatGregorian } from "@/lib/calendar";
import { startOfDay, endOfDay, addDays } from "@/lib/utils";

export const metadata: Metadata = { title: "Today" };

export default async function DashboardPage() {
  const user = await requireUser();
  const scope = new UserScope(user.id);
  const isArabic = user.locale === "ar";
  const t = (ar: string, en: string) => (isArabic ? ar : en);

  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const weekAgo = addDays(now, -7);

  const [openTaskRows, dueTodayRows, overdueRows, doneRows, inboxRows, activeGoals, todayEvents, recentNotes] =
    await Promise.all([
      db
        .select()
        .from(tasks)
        .where(and(scope.where(tasks), inArray(tasks.status, ["todo", "in_progress", "blocked"])))
        .orderBy(asc(tasks.position))
        .limit(200),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(tasks)
        .where(
          and(
            scope.where(tasks),
            sql`${tasks.dueAt} >= ${todayStart}`,
            sql`${tasks.dueAt} <= ${todayEnd}`,
            sql`${tasks.status} <> 'done'`,
          ),
        ),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(tasks)
        .where(and(scope.where(tasks), sql`${tasks.dueAt} < ${todayStart}`, sql`${tasks.status} <> 'done'`)),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(tasks)
        .where(and(scope.where(tasks), eq(tasks.status, "done"), sql`${tasks.completedAt} >= ${weekAgo}`)),
      db
        .select()
        .from(captures)
        .where(and(scope.where(captures), eq(captures.processed, false)))
        .orderBy(desc(captures.createdAt))
        .limit(5),
      db
        .select()
        .from(goals)
        .where(and(scope.where(goals), eq(goals.status, "active")))
        .orderBy(desc(goals.updatedAt))
        .limit(4),
      db
        .select()
        .from(events)
        .where(and(scope.where(events), sql`${events.startAt} >= ${todayStart}`, sql`${events.startAt} <= ${todayEnd}`))
        .orderBy(asc(events.startAt))
        .limit(6),
      db.select().from(notes).where(scope.where(notes)).orderBy(desc(notes.updatedAt)).limit(4),
    ]);

  // Focus list: overdue first, then due today, then the rest by priority.
  const priorityRank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  const focusTasks = [...openTaskRows]
    .sort((a, b) => {
      const aOverdue = a.dueAt && a.dueAt < todayStart ? 0 : 1;
      const bOverdue = b.dueAt && b.dueAt < todayStart ? 0 : 1;
      if (aOverdue !== bOverdue) return aOverdue - bOverdue;

      const aToday = a.dueAt && a.dueAt >= todayStart && a.dueAt <= todayEnd ? 0 : 1;
      const bToday = b.dueAt && b.dueAt >= todayStart && b.dueAt <= todayEnd ? 0 : 1;
      if (aToday !== bToday) return aToday - bToday;

      return (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2);
    })
    .slice(0, 6);

  const dueToday = dueTodayRows[0]?.n ?? 0;
  const overdue = overdueRows[0]?.n ?? 0;
  const done = doneRows[0]?.n ?? 0;

  const greeting =
    now.getHours() < 12
      ? t("صباح الخير", "Good morning")
      : now.getHours() < 17
        ? t("طاب يومك", "Good afternoon")
        : t("مساء الخير", "Good evening");

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-8">
      <PageHeader
        title={`${greeting}، ${user.displayName.split(" ")[0]}`}
        subtitle={`${formatGregorian(now, isArabic ? "ar" : "en", { weekday: "long", day: "numeric", month: "long" })} · ${formatHijri(now, isArabic ? "ar" : "en", { day: "numeric", month: "long", year: "numeric" })}`}
        action={
          <Link href="/capture" className="btn-primary">
            <Sparkles className="h-4 w-4" aria-hidden />
            {t("التقاط سريع", "Quick capture")}
          </Link>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={t("مهام مفتوحة", "Open tasks")}
          value={openTaskRows.length}
          icon={<CheckSquare className="h-4 w-4" aria-hidden />}
        />
        <StatCard
          label={t("مستحقة اليوم", "Due today")}
          value={dueToday}
          tone="brand"
          icon={<CalendarClock className="h-4 w-4" aria-hidden />}
        />
        <StatCard
          label={t("متأخرة", "Overdue")}
          value={overdue}
          tone={overdue > 0 ? "danger" : "default"}
          icon={<TriangleAlert className="h-4 w-4" aria-hidden />}
        />
        <StatCard
          label={t("أُنجزت هذا الأسبوع", "Done this week")}
          value={done}
          tone="success"
          icon={<Target className="h-4 w-4" aria-hidden />}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 lg:col-span-2">
          <DailyBriefCard isArabic={isArabic} />

          <section>
            <SectionHeading
              title={t("أهم ما يستحق انتباهك اليوم", "What deserves your attention today")}
              href="/tasks"
              actionLabel={t("كل المهام", "All tasks")}
            />
            {focusTasks.length === 0 ? (
              <EmptyState
                icon={<CheckSquare className="h-5 w-5" aria-hidden />}
                title={t("لا توجد مهام مفتوحة", "No open tasks")}
                description={t(
                  "ابدأ بالتقاط أي شيء في ذهنك — سنساعدك على ترتيبه لاحقاً.",
                  "Capture anything on your mind — we'll help you organise it later.",
                )}
                action={
                  <Link href="/capture" className="btn-primary">
                    {t("التقاط الآن", "Capture now")}
                  </Link>
                }
              />
            ) : (
              <ul className="space-y-1.5">
                {focusTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={{
                      id: task.id,
                      title: task.title,
                      status: task.status,
                      priority: task.priority,
                      energy: task.energy,
                      dueAt: task.dueAt ? task.dueAt.toISOString() : null,
                      projectId: task.projectId,
                    }}
                    isArabic={isArabic}
                    compact
                  />
                ))}
              </ul>
            )}
          </section>

          <section>
            <SectionHeading
              title={t("آخر الملاحظات", "Recent notes")}
              href="/notes"
              actionLabel={t("كل الملاحظات", "All notes")}
            />
            {recentNotes.length === 0 ? (
              <EmptyState
                icon={<Inbox className="h-5 w-5" aria-hidden />}
                title={t("لا ملاحظات بعد", "No notes yet")}
                description={t("أنشئ ملاحظتك الأولى.", "Create your first note.")}
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {recentNotes.map((note) => (
                  <Link key={note.id} href={`/notes/${note.id}`} className="card-interactive block p-4">
                    <p className="line-clamp-1 text-sm font-medium text-ink">
                      {note.title || t("بدون عنوان", "Untitled")}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-muted">
                      {note.contentText.slice(0, 160) || t("ملاحظة فارغة", "Empty note")}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Side column */}
        <div className="space-y-6">
          <section>
            <SectionHeading
              title={t("وارد بانتظار الفرز", "Inbox to triage")}
              href="/inbox"
              actionLabel={t("افتح الوارد", "Open inbox")}
            />
            {inboxRows.length === 0 ? (
              <div className="card p-4">
                <p className="text-xs text-ink-muted">
                  {t("الوارد فارغ — كل شيء مُرتّب.", "Inbox is clear — everything is filed.")}
                </p>
              </div>
            ) : (
              <ul className="card divide-y divide-slate-100">
                {inboxRows.map((item) => (
                  <li key={item.id} className="p-3.5">
                    <p className="line-clamp-2 text-xs leading-relaxed text-ink-soft">{item.raw}</p>
                    {item.suggestedType ? (
                      <p className="mt-1.5 text-[11px] text-brand-600">
                        {t("اقتراح", "Suggested")}: {item.suggestedType}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <SectionHeading title={t("مواعيد اليوم", "Today's schedule")} href="/calendar" actionLabel={t("التقويم", "Calendar")} />
            {todayEvents.length === 0 ? (
              <div className="card p-4">
                <p className="text-xs text-ink-muted">{t("لا مواعيد اليوم.", "Nothing scheduled today.")}</p>
              </div>
            ) : (
              <ul className="card divide-y divide-slate-100">
                {todayEvents.map((event) => (
                  <li key={event.id} className="flex items-center gap-3 p-3.5">
                    <span className="shrink-0 rounded-lg bg-brand-50 px-2 py-1 text-[11px] font-semibold tabular-nums text-brand-700">
                      {new Intl.DateTimeFormat(isArabic ? "ar" : "en", {
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(event.startAt)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">{event.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <SectionHeading title={t("أهداف نشطة", "Active goals")} href="/goals" actionLabel={t("كل الأهداف", "All goals")} />
            {activeGoals.length === 0 ? (
              <div className="card p-4">
                <p className="text-xs text-ink-muted">{t("لا أهداف نشطة بعد.", "No active goals yet.")}</p>
              </div>
            ) : (
              <ul className="card divide-y divide-slate-100">
                {activeGoals.map((goal) => {
                  const percent =
                    goal.targetValue === 0 ? 0 : Math.min(100, Math.round((goal.currentValue / goal.targetValue) * 100));
                  return (
                    <li key={goal.id} className="p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{goal.title}</span>
                        <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">{percent}%</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${percent}%` }} />
                      </div>
                      {goal.streakCurrent > 0 ? (
                        <p className="mt-1.5 text-[11px] text-ink-faint">
                          {t(`${goal.streakCurrent} يوم متتالٍ`, `${goal.streakCurrent}-day streak`)}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <Link
            href="/assistant"
            className="card-interactive flex items-center gap-3 p-4"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <Sparkles className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-ink">{t("اسأل مساعدك", "Ask your assistant")}</p>
              <p className="text-[11px] text-ink-faint">
                {t("إجابات مبنية على محتواك فقط", "Answers grounded in your content only")}
              </p>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint flip-rtl" aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  );
}
