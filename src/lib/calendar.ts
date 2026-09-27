/**
 * Calendar helpers (§6.7 / §15.3)
 * ---------------------------------------------------------------------------
 * TaskNote Plus ships Gregorian and Hijri side by side. Intl's
 * "islamic-umalqura" calendar is the Umm al-Qura calendar used in Saudi Arabia
 * and the most widely adopted civil Hijri calendar, so it is the default.
 */

export type CalendarSystem = "gregorian" | "hijri" | "both";

export function formatGregorian(date: Date, locale: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(locale, options ?? { dateStyle: "medium" }).format(date);
}

export function formatHijri(date: Date, locale: string, options?: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat(`${locale}-u-ca-islamic-umalqura`, {
      dateStyle: options?.dateStyle ?? "long",
      ...options,
    }).format(date);
  } catch {
    return formatGregorian(date, locale, options);
  }
}

export function formatHijriNumber(date: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(`${locale}-u-ca-islamic-umalqura`, {
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).format(date);
  } catch {
    return "";
  }
}

/**
 * Returns the Hijri year-month-day parts. Used by the calendar grid so Hijri
 * labels can be rendered under each Gregorian day cell.
 */
export function hijriParts(date: Date, locale = "ar"): { year: number; month: number; day: number } | null {
  try {
    const parts = new Intl.DateTimeFormat(`${locale}-u-ca-islamic-umalqura`, {
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(date);
    const get = (type: string) => {
      const part = parts.find((p) => p.type === type);
      if (!part) return NaN;
      return Number(part.value.replace(/[^\d٠-٩]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))));
    };
    const result = { year: get("year"), month: get("month"), day: get("day") };
    if (Number.isNaN(result.year) || Number.isNaN(result.month) || Number.isNaN(result.day)) {
      return null;
    }
    return result;
  } catch {
    return null;
  }
}

const HIJRI_MONTHS_AR = [
  "محرم", "صفر", "ربيع الأول", "ربيع الآخر", "جمادى الأولى", "جمادى الآخرة",
  "رجب", "شعبان", "رمضان", "شوال", "ذو القعدة", "ذو الحجة",
];

export function hijriMonthName(month: number): string {
  return HIJRI_MONTHS_AR[month - 1] ?? "";
}

/** Builds a 6×7 grid of days for a month view, week starting per user pref. */
export function buildMonthGrid(year: number, month: number, weekStartsOn = 6): Date[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() - weekStartsOn + 7) % 7;
  const start = new Date(year, month, 1 - offset);

  const cells: Date[] = [];
  for (let i = 0; i < 42; i += 1) {
    cells.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }
  return cells;
}

export function buildWeekDays(anchor: Date, weekStartsOn = 6): Date[] {
  const offset = (anchor.getDay() - weekStartsOn + 7) % 7;
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - offset);
  return Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

/**
 * Expands an RFC 5545 RRULE into occurrences within a window.
 * Supports the FREQ/INTERVAL/BYDAY/COUNT/UNTIL subset the app writes.
 * Exceptions are layered on by the caller from the event's overrides array —
 * we never duplicate rows for exceptions (§6.7).
 */
export function expandRecurrence(
  start: Date,
  rule: string | null | undefined,
  windowStart: Date,
  windowEnd: Date,
  maxOccurrences = 400,
): Date[] {
  if (!rule) {
    return start >= windowStart && start <= windowEnd ? [start] : [];
  }

  const parts = Object.fromEntries(
    rule
      .replace(/^RRULE:/i, "")
      .split(";")
      .map((pair) => {
        const [k, v] = pair.split("=");
        return [k?.toUpperCase?.() ?? "", v ?? ""];
      }),
  ) as Record<string, string>;

  const freq = parts.FREQ?.toUpperCase();
  const interval = Math.max(1, Number(parts.INTERVAL) || 1);
  const count = parts.COUNT ? Number(parts.COUNT) : undefined;
  const until = parts.UNTIL ? parseIcsDate(parts.UNTIL) : undefined;
  const byDay = parts.BYDAY
    ? parts.BYDAY.split(",").map((d) => d.slice(-2).toUpperCase())
    : null;

  const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const results: Date[] = [];
  let emitted = 0;

  const pushIfInWindow = (date: Date) => {
    if (until && date > until) return false;
    if (count && emitted >= count) return false;
    const inWindow = date >= windowStart && date <= windowEnd;
    emitted += 1;
    if (inWindow && results.length < maxOccurrences) results.push(date);
    return true;
  };

  if (freq === "DAILY") {
    let cursor = new Date(start);
    const step = interval;
    // Fast-forward near the window to avoid iterating decades.
    if (cursor < windowStart) {
      const gapDays = Math.floor((windowStart.getTime() - cursor.getTime()) / 86400000);
      const skips = Math.floor(gapDays / step);
      cursor = new Date(cursor.getTime() + skips * step * 86400000);
    }
    while (cursor <= windowEnd && results.length < maxOccurrences) {
      if (!pushIfInWindow(new Date(cursor))) break;
      cursor = new Date(cursor.getTime() + step * 86400000);
    }
  } else if (freq === "WEEKLY") {
    const days = byDay ?? [DAY_CODES[start.getDay()]];
    let cursor = new Date(start);
    cursor.setDate(cursor.getDate() - 7);
    let guard = 0;
    while (cursor <= windowEnd && results.length < maxOccurrences && guard < 3000) {
      guard += 1;
      for (const code of days) {
        const targetDay = DAY_CODES.indexOf(code);
        if (targetDay === -1) continue;
        const day = new Date(cursor);
        day.setDate(day.getDate() + ((targetDay - cursor.getDay() + 7) % 7));
        if (day >= start && day <= windowEnd) {
          if (!pushIfInWindow(day)) break;
        }
      }
      cursor = new Date(cursor.getTime() + interval * 7 * 86400000);
    }
  } else if (freq === "MONTHLY") {
    const dayOfMonth = start.getDate();
    let cursor = new Date(start.getFullYear(), start.getMonth(), dayOfMonth);
    let guard = 0;
    while (cursor <= windowEnd && results.length < maxOccurrences && guard < 1200) {
      guard += 1;
      if (cursor >= start && !pushIfInWindow(cursor)) break;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + interval, dayOfMonth);
    }
  } else if (freq === "YEARLY") {
    let cursor = new Date(start);
    let guard = 0;
    while (cursor <= windowEnd && results.length < maxOccurrences && guard < 400) {
      guard += 1;
      if (cursor >= start && !pushIfInWindow(cursor)) break;
      cursor = new Date(cursor.getFullYear() + interval, cursor.getMonth(), cursor.getDate());
    }
  } else {
    return start >= windowStart && start <= windowEnd ? [start] : [];
  }

  return results;
}

function parseIcsDate(value: string): Date | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(value);
  if (!match) return undefined;
  const [, y, mo, d, h = "00", mi = "00", s = "00"] = match;
  const isUtc = value.endsWith("Z");
  const date = isUtc
    ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
    : new Date(+y, +mo - 1, +d, +h, +mi, +s);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Builds a simple RRULE from friendly UI options. */
export function buildRecurrence(options: {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval?: number;
  byDay?: string[];
}): string {
  const parts = [`FREQ=${options.frequency.toUpperCase()}`];
  if (options.interval && options.interval > 1) parts.push(`INTERVAL=${options.interval}`);
  if (options.byDay?.length) parts.push(`BYDAY=${options.byDay.join(",")}`);
  return parts.join(";");
}

export const WEEKDAY_LABELS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
export const WEEKDAY_LABELS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function weekdayLabels(locale: string, weekStartsOn = 6): string[] {
  const base = locale.startsWith("ar") ? WEEKDAY_LABELS_AR : WEEKDAY_LABELS_EN;
  return Array.from({ length: 7 }, (_, i) => base[(weekStartsOn + i) % 7]);
}

/**
 * Resolves relative date phrases in Arabic and English at input time, then the
 * caller freezes the result (§6.7). Deliberately small and predictable rather
 * than a general NLP parser.
 */
export function parseNaturalDate(input: string, now = new Date()): Date | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  const timeMatch = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|ص|م)?/.exec(text);
  const resolveTime = (base: Date) => {
    if (!timeMatch) {
      base.setHours(9, 0, 0, 0);
      return base;
    }
    let hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2] ?? "0");
    const meridian = timeMatch[3];
    if (meridian === "pm" || meridian === "م") hours = hours < 12 ? hours + 12 : hours;
    if ((meridian === "am" || meridian === "ص") && hours === 12) hours = 0;
    base.setHours(hours, minutes, 0, 0);
    return base;
  };

  const base = new Date(now);
  base.setSeconds(0, 0);

  if (/^(today|اليوم)\b/.test(text)) return resolveTime(base);

  if (/^(tomorrow|غدا|غداً|بكرة)\b/.test(text)) {
    base.setDate(base.getDate() + 1);
    return resolveTime(base);
  }

  if (/^(yesterday|أمس)\b/.test(text)) {
    base.setDate(base.getDate() - 1);
    return resolveTime(base);
  }

  if (/next week|الأسبوع (الجاي|القادم)/.test(text)) {
    base.setDate(base.getDate() + 7);
    return resolveTime(base);
  }

  if (/next month|الشهر (الجاي|القادم)/.test(text)) {
    base.setMonth(base.getMonth() + 1);
    return resolveTime(base);
  }

  const inDays = /(?:in\s+)?(\d+)\s*(?:days?|يوم|أيام)/.exec(text);
  if (inDays) {
    base.setDate(base.getDate() + Number(inDays[1]));
    return resolveTime(base);
  }

  const weekdayNames: Array<[RegExp, number]> = [
    [/sunday|الأحد/, 0], [/monday|الاثنين|الإثنين/, 1], [/tuesday|الثلاثاء/, 2],
    [/wednesday|الأربعاء/, 3], [/thursday|الخميس/, 4], [/friday|الجمعة/, 5], [/saturday|السبت/, 6],
  ];
  for (const [pattern, targetDay] of weekdayNames) {
    if (pattern.test(text)) {
      const delta = (targetDay - base.getDay() + 7) % 7 || 7;
      base.setDate(base.getDate() + delta);
      return resolveTime(base);
    }
  }

  return null;
}
