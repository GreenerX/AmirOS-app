export type TemporalRange = {
  phrase: string;
  start: number;
  end: number;
};

function localDayStart(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

function atHour(day: Date, hour: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour);
}

function mondayOfWeek(day: Date): Date {
  const result = localDayStart(day);
  const daysSinceMonday = (result.getDay() + 6) % 7;
  return addDays(result, -daysSinceMonday);
}

/**
 * Resolves the first supported relative-time phrase into a local, end-exclusive
 * window. This intentionally uses no model calls, locale services, or UTC
 * conversion so Ask AmirOS follows the time on the user's computer.
 */
export function resolveTemporalRange(query: string, now: number | Date = Date.now()): TemporalRange | undefined {
  const current = new Date(now);
  const today = localDayStart(current);
  const normalized = query.toLocaleLowerCase();
  const range = (phrase: string, start: Date, end: Date): TemporalRange => ({
    phrase,
    start: start.getTime(),
    end: end.getTime(),
  });

  // Check longer Hebrew phrases first because several include a shorter word
  // such as "today" or "tomorrow".
  if (normalized.includes("אתמול בלילה") || normalized.includes("אמש")) {
    return range("last night", atHour(addDays(today, -1), 18), atHour(today, 6));
  }
  if (normalized.includes("היום אחר הצהריים") || normalized.includes("אחר הצהריים")) {
    return range("this afternoon", atHour(today, 12), atHour(today, 18));
  }
  if (normalized.includes("בשבוע שעבר") || normalized.includes("שבוע שעבר")) {
    const thisWeek = mondayOfWeek(today);
    return range("last week", addDays(thisWeek, -7), thisWeek);
  }
  if (normalized.includes("בשבוע הבא") || normalized.includes("שבוע הבא")) {
    const thisWeek = mondayOfWeek(today);
    return range("next week", addDays(thisWeek, 7), addDays(thisWeek, 14));
  }
  if (normalized.includes("הבוקר")) return range("this morning", today, atHour(today, 12));
  if (normalized.includes("הערב")) return range("this evening", atHour(today, 18), addDays(today, 1));
  if (normalized.includes("הלילה")) return range("tonight", atHour(today, 18), atHour(addDays(today, 1), 6));
  if (normalized.includes("אתמול")) return range("yesterday", addDays(today, -1), today);
  if (normalized.includes("מחר")) return range("tomorrow", addDays(today, 1), addDays(today, 2));
  if (normalized.includes("היום")) return range("today", today, addDays(today, 1));
  if (normalized.includes("השבוע")) {
    const thisWeek = mondayOfWeek(today);
    return range("this week", thisWeek, addDays(thisWeek, 7));
  }

  if (/\blast\s+night\b/u.test(normalized)) return range("last night", atHour(addDays(today, -1), 18), atHour(today, 6));
  if (/\bthis\s+morning\b/u.test(normalized)) return range("this morning", today, atHour(today, 12));
  if (/\bthis\s+afternoon\b/u.test(normalized)) return range("this afternoon", atHour(today, 12), atHour(today, 18));
  if (/\bthis\s+evening\b/u.test(normalized)) return range("this evening", atHour(today, 18), addDays(today, 1));
  if (/\btonight\b/u.test(normalized)) return range("tonight", atHour(today, 18), atHour(addDays(today, 1), 6));
  if (/\byesterday\b/u.test(normalized)) return range("yesterday", addDays(today, -1), today);
  if (/\btomorrow\b/u.test(normalized)) return range("tomorrow", addDays(today, 1), addDays(today, 2));
  if (/\btoday\b/u.test(normalized)) return range("today", today, addDays(today, 1));

  const thisWeek = mondayOfWeek(today);
  if (/\blast\s+week\b/u.test(normalized)) return range("last week", addDays(thisWeek, -7), thisWeek);
  if (/\bthis\s+week\b/u.test(normalized)) return range("this week", thisWeek, addDays(thisWeek, 7));
  if (/\bnext\s+week\b/u.test(normalized)) return range("next week", addDays(thisWeek, 7), addDays(thisWeek, 14));
  return undefined;
}

export function isDueDateQuery(query: string): boolean {
  return /\b(due|deadline|deadlines|upcoming|schedule|scheduled|calendar|agenda|plan|plans|event|events|task|tasks|to-?do)\b|\bwhat\s+(?:do\s+)?i\s+(?:have|need\s+to\s+do)\b/iu.test(query);
}

export function isWithinTemporalRange(timestamp: number | undefined, range: TemporalRange): boolean {
  return Number.isFinite(timestamp) && timestamp! >= range.start && timestamp! < range.end;
}
