"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { createEvent as createEventAction, deleteEvent as deleteEventAction } from "@/app/actions/tasks-bridge";
import { useToast } from "@/components/providers/toast-provider";
import { ConfirmDialog, PageHeader } from "@/components/ui";
import {
  buildMonthGrid,
  buildWeekDays,
  expandRecurrence,
  hijriParts,
  parseNaturalDate,
  weekdayLabels,
} from "@/lib/calendar";
import { cn, formatTime, isSameDay } from "@/lib/utils";

export type CalendarEventItem = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  recurrence: string | null;
  kind: string;
};

type View = "month" | "week";

export function CalendarView({
  events,
  calendarSystem,
  weekStartsOn,
  isArabic,
  openComposer,
}: {
  events: CalendarEventItem[];
  calendarSystem: string;
  weekStartsOn: number;
  isArabic: boolean;
  openComposer: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());
  const [composerOpen, setComposerOpen] = useState(openComposer);
  const [deleteTarget, setDeleteTarget] = useState<CalendarEventItem | null>(null);
  const [, startBusyTransition] = useTransition();

  const t = (ar: string, en: string) => (isArabic ? ar : en);
  const locale = isArabic ? "ar" : "en";
  const showHijri = calendarSystem === "hijri" || calendarSystem === "both";

  const monthGrid = useMemo(
    () => buildMonthGrid(cursor.getFullYear(), cursor.getMonth(), weekStartsOn),
    [cursor, weekStartsOn],
  );
  const weekDays = useMemo(() => buildWeekDays(cursor, weekStartsOn), [cursor, weekStartsOn]);

  const visibleDays = view === "month" ? monthGrid : weekDays;

  /** Expands recurrences into concrete occurrences for the visible window. */
  const occurrences = useMemo(() => {
    const windowStart = visibleDays[0] ?? cursor;
    const windowEnd = new Date(
      (visibleDays[visibleDays.length - 1] ?? cursor).getTime() + 86400000,
    );

    const result: Array<CalendarEventItem & { occurrenceStart: Date; occurrenceEnd: Date }> = [];

    for (const event of events) {
      const start = new Date(event.startAt);
      const end = new Date(event.endAt);
      const duration = end.getTime() - start.getTime();

      const starts = expandRecurrence(start, event.recurrence, windowStart, windowEnd);
      const list = starts.length > 0 ? starts : [start];

      for (const occurrenceStart of list) {
        result.push({
          ...event,
          occurrenceStart,
          occurrenceEnd: new Date(occurrenceStart.getTime() + duration),
        });
      }
    }

    return result.sort((a, b) => a.occurrenceStart.getTime() - b.occurrenceStart.getTime());
  }, [events, visibleDays, cursor]);

  const eventsForDay = (day: Date) =>
    occurrences.filter((o) => isSameDay(o.occurrenceStart, day));

  const selectedEvents = eventsForDay(selectedDay);

  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(cursor);
  const hijriLabel = showHijri ? hijriParts(cursor, locale) : null;

  const shift = (direction: number) => {
    const next = new Date(cursor);
    if (view === "month") next.setMonth(next.getMonth() + direction);
    else next.setDate(next.getDate() + direction * 7);
    setCursor(next);
  };

  const remove = (event: CalendarEventItem) => {
    startBusyTransition(async () => {
      const result = await deleteEventAction(event.id);
      setDeleteTarget(null);
      if (result.ok) {
        toast.success(t("حُذف الموعد", "Event deleted"));
        router.refresh();
      } else {
        toast.error(t("تعذّر الحذف", "Could not delete"), result.error);
      }
    });
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-8">
      <PageHeader
        title={t("التقويم", "Calendar")}
        subtitle={
          hijriLabel
            ? `${monthLabel} · ${hijriLabel.day} ${new Intl.DateTimeFormat(`${locale}-u-ca-islamic-umalqura`, { month: "long", year: "numeric" }).format(cursor)}`
            : monthLabel
        }
        action={
          <>
            <div className="flex rounded-xl border border-slate-200 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setView("month")}
                aria-pressed={view === "month"}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                  view === "month" ? "bg-slate-100 text-ink" : "text-ink-faint hover:text-ink",
                )}
              >
                {t("شهر", "Month")}
              </button>
              <button
                type="button"
                onClick={() => setView("week")}
                aria-pressed={view === "week"}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                  view === "week" ? "bg-slate-100 text-ink" : "text-ink-faint hover:text-ink",
                )}
              >
                {t("أسبوع", "Week")}
              </button>
            </div>
            <button type="button" onClick={() => setComposerOpen((v) => !v)} className="btn-primary">
              {composerOpen ? <X className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
              {t("موعد", "Event")}
            </button>
          </>
        }
      />

      {composerOpen ? (
        <EventComposer
          isArabic={isArabic}
          defaultDate={selectedDay}
          onClose={() => setComposerOpen(false)}
          onCreated={() => {
            setComposerOpen(false);
            router.refresh();
          }}
        />
      ) : null}

      <div className="grid gap-5 lg:grid-cols-4">
        {/* Grid */}
        <div className="card overflow-hidden lg:col-span-3">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => shift(-1)}
                className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-slate-100"
                aria-label={t("السابق", "Previous")}
              >
                <ChevronLeft className="h-4 w-4 flip-rtl" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const today = new Date();
                  setCursor(today);
                  setSelectedDay(today);
                }}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-slate-100 hover:text-ink"
              >
                {t("اليوم", "Today")}
              </button>
              <button
                type="button"
                onClick={() => shift(1)}
                className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-slate-100"
                aria-label={t("التالي", "Next")}
              >
                <ChevronRight className="h-4 w-4 flip-rtl" />
              </button>
            </div>
            <span className="text-xs font-medium text-ink-soft">{monthLabel}</span>
          </div>

          <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/60">
            {weekdayLabels(locale, weekStartsOn).map((label) => (
              <div key={label} className="px-2 py-2 text-center text-[11px] font-medium text-ink-muted">
                {label}
              </div>
            ))}
          </div>

          <div className={cn("grid grid-cols-7", view === "week" && "min-h-[320px]")}>
            {visibleDays.map((day) => {
              const dayEvents = eventsForDay(day);
              const isCurrentMonth = view === "week" || day.getMonth() === cursor.getMonth();
              const isToday = isSameDay(day, new Date());
              const isSelected = isSameDay(day, selectedDay);
              const hijri = showHijri ? hijriParts(day, locale) : null;

              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => setSelectedDay(day)}
                  className={cn(
                    "flex min-h-[68px] flex-col items-start gap-0.5 border-b border-e border-slate-100 p-1.5 text-start transition-colors last:border-e-0",
                    view === "week" && "min-h-[160px]",
                    !isCurrentMonth && "bg-slate-50/40 opacity-50",
                    isSelected ? "bg-brand-50/70" : "hover:bg-slate-50",
                  )}
                >
                  <span className="flex w-full items-center justify-between">
                    <span
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium tabular-nums",
                        isToday ? "bg-brand-600 text-white" : "text-ink-soft",
                      )}
                    >
                      {new Intl.DateTimeFormat(locale, { day: "numeric" }).format(day)}
                    </span>
                    {hijri ? (
                      <span className="text-[9px] tabular-nums text-ink-faint">{hijri.day}</span>
                    ) : null}
                  </span>

                  {dayEvents.slice(0, view === "week" ? 6 : 2).map((event) => (
                    <span
                      key={`${event.id}-${event.occurrenceStart.toISOString()}`}
                      className="w-full truncate rounded-md bg-brand-100/70 px-1.5 py-0.5 text-[10px] font-medium text-brand-800"
                      title={event.title}
                    >
                      {event.allDay
                        ? event.title
                        : `${formatTime(event.occurrenceStart, locale)} ${event.title}`}
                    </span>
                  ))}
                  {dayEvents.length > (view === "week" ? 6 : 2) ? (
                    <span className="text-[9px] text-ink-faint">
                      +{dayEvents.length - (view === "week" ? 6 : 2)}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* Day detail */}
        <aside className="lg:col-span-1">
          <div className="card p-4">
            <h2 className="text-xs font-semibold text-ink">
              {new Intl.DateTimeFormat(locale, {
                weekday: "long",
                day: "numeric",
                month: "long",
              }).format(selectedDay)}
            </h2>
            {showHijri && hijriParts(selectedDay, locale) ? (
              <p className="mt-0.5 text-[11px] text-ink-faint">
                {new Intl.DateTimeFormat(`${locale}-u-ca-islamic-umalqura`, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                }).format(selectedDay)}
              </p>
            ) : null}

            <div className="mt-3.5">
              {selectedEvents.length === 0 ? (
                <p className="py-4 text-center text-[11px] text-ink-faint">
                  {t("لا شيء في هذا اليوم", "Nothing on this day")}
                </p>
              ) : (
                <ul className="space-y-2">
                  {selectedEvents.map((event) => (
                    <li
                      key={`${event.id}-${event.occurrenceStart.toISOString()}`}
                      className="group rounded-xl border border-slate-200 p-2.5"
                    >
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 h-8 w-1 shrink-0 rounded-full bg-brand-500" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium leading-snug text-ink">{event.title}</p>
                          <p className="mt-0.5 flex items-center gap-1 text-[10px] text-ink-faint">
                            <Clock className="h-2.5 w-2.5" aria-hidden />
                            {event.allDay
                              ? t("طوال اليوم", "All day")
                              : `${formatTime(event.occurrenceStart, locale)} – ${formatTime(event.occurrenceEnd, locale)}`}
                          </p>
                          {event.recurrence ? (
                            <p className="mt-0.5 text-[10px] text-ink-faint">
                              {t("متكرر", "Repeats")}
                            </p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(event)}
                          className="rounded-md p-1 text-ink-faint opacity-0 transition-all hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                          aria-label={t("حذف", "Delete")}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <button
              type="button"
              onClick={() => setComposerOpen(true)}
              className="mt-3.5 w-full rounded-xl border border-dashed border-slate-300 py-2 text-[11px] font-medium text-ink-muted transition-colors hover:border-brand-400 hover:text-brand-600"
            >
              <Plus className="me-1 inline h-3 w-3" aria-hidden />
              {t("أضف في هذا اليوم", "Add on this day")}
            </button>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        tone="danger"
        title={t("حذف الموعد؟", "Delete this event?")}
        description={t("سيُحذف من جميع الأيام المتكررة.", "It will be removed from all recurring days.")}
        confirmLabel={t("حذف", "Delete")}
        cancelLabel={t("إلغاء", "Cancel")}
        onConfirm={() => deleteTarget && remove(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function EventComposer({
  isArabic,
  defaultDate,
  onClose,
  onCreated,
}: {
  isArabic: boolean;
  defaultDate: Date;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const t = (ar: string, en: string) => (isArabic ? ar : en);

  const initialStart = new Date(defaultDate);
  initialStart.setHours(9, 0, 0, 0);

  const [title, setTitle] = useState("");
  const [naturalInput, setNaturalInput] = useState("");
  const [startAt, setStartAt] = useState(initialStart.toISOString().slice(0, 16));
  const [endAt, setEndAt] = useState(
    new Date(initialStart.getTime() + 3600000).toISOString().slice(0, 16),
  );
  const [location, setLocation] = useState("");
  const [recurrence, setRecurrence] = useState("");
  const [isSaving, startSaveTransition] = useTransition();

  const applyNatural = () => {
    const parsed = parseNaturalDate(naturalInput);
    if (!parsed) {
      toast.info(
        t("لم أفهم التاريخ", "Couldn't read that date"),
        t('جرّب "بكرة 10 صباحاً" أو "الأحد 3 مساءً".', 'Try "tomorrow 10am" or "Sunday 3pm".'),
      );
      return;
    }
    setStartAt(parsed.toISOString().slice(0, 16));
    setEndAt(new Date(parsed.getTime() + 3600000).toISOString().slice(0, 16));
    if (!title && naturalInput.trim()) setTitle(naturalInput.replace(/\s+\d.*$/, "").trim());
    setNaturalInput("");
    toast.info(t("راجع الوقت ثم احفظ", "Check the time, then save"));
  };

  const save = () => {
    if (!title.trim()) return;
    startSaveTransition(async () => {
      const result = await createEventAction({
        title: title.trim(),
        description: null,
        location: location.trim() || null,
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
        allDay: false,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        recurrence: recurrence || null,
        kind: "event",
      });
      if (result.ok) {
        toast.success(t("أُضيف الموعد", "Event added"));
        onCreated();
      } else {
        toast.error(t("تعذّر الحفظ", "Could not save"), result.error);
      }
    });
  };

  return (
    <div className="card mb-5 space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">{t("موعد جديد", "New event")}</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-ink-faint hover:bg-slate-100"
          aria-label={t("إغلاق", "Close")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <CalendarDays className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-500" aria-hidden />
          <input
            value={naturalInput}
            onChange={(e) => setNaturalInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyNatural();
              }
            }}
            placeholder={t('اكتب: "اجتماع بكرة 10 صباحاً"', 'Type: "meeting tomorrow 10am"')}
            className="input ps-9"
          />
        </div>
        <button type="button" onClick={applyNatural} disabled={!naturalInput.trim()} className="btn-secondary shrink-0">
          {t("طبّق", "Apply")}
        </button>
      </div>

      <div>
        <label htmlFor="event-title" className="label">
          {t("العنوان", "Title")}
        </label>
        <input
          id="event-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="input"
          placeholder={t("اجتماع مع الفريق", "Team meeting")}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="event-start" className="label">
            {t("البداية", "Starts")}
          </label>
          <input
            id="event-start"
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label htmlFor="event-end" className="label">
            {t("النهاية", "Ends")}
          </label>
          <input
            id="event-end"
            type="datetime-local"
            value={endAt}
            onChange={(e) => setEndAt(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label htmlFor="event-repeat" className="label">
            {t("التكرار", "Repeats")}
          </label>
          <select
            id="event-repeat"
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value)}
            className="input"
          >
            <option value="">{t("لا يتكرر", "Does not repeat")}</option>
            <option value="FREQ=DAILY">{t("يومياً", "Daily")}</option>
            <option value="FREQ=WEEKLY">{t("أسبوعياً", "Weekly")}</option>
            <option value="FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH">{t("أيام العمل", "Weekdays")}</option>
            <option value="FREQ=MONTHLY">{t("شهرياً", "Monthly")}</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="event-location" className="label">
          {t("المكان", "Location")}
        </label>
        <input
          id="event-location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="input"
          placeholder={t("اختياري", "Optional")}
        />
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-secondary">
          {t("إلغاء", "Cancel")}
        </button>
        <button type="button" onClick={save} disabled={isSaving || !title.trim()} className="btn-primary">
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {t("حفظ", "Save")}
        </button>
      </div>
    </div>
  );
}
