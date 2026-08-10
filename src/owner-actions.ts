import type { CalendarEvent } from "./amiros-state.js";
import { inferCalendarEventFromMessage } from "./amiros-state.js";
import { resolveTemporalRange, type TemporalRange } from "./temporal-memory.js";

export type TimeFormatPreference = "12-hour" | "24-hour";

export type OwnerActionRequest =
  | {
      kind: "calendar";
      source: string;
      title: string;
      startAt: number;
      allDay: boolean;
      location?: string;
    }
  | { kind: "todo"; source: string; title: string; dueAt?: number }
  | { kind: "knowledge"; source: string; title: string }
  | { kind: "commitment"; source: string; title: string; dueAt?: number };

const TEMPORAL_CUE = /\b(?:today|tonight|tomorrow|morning|afternoon|evening|night|monday|tuesday|wednesday|thursday|friday|saturday|sunday|at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}:\d{2}|20\d{2}-\d{1,2}-\d{1,2}|\d{1,2}[/.\-]\d{1,2})\b|(?:היום|הערב|מחר|בוקר|צהריים|לילה|יום\s+(?:ראשון|שני|שלישי|רביעי|חמישי|שישי)|שבת|בשעה\s*\d{1,2})/iu;
const EXPLICIT_CALENDAR_TARGET = /\b(?:calendar|agenda|appointment|event)\b|(?:יומן|לוח שנה|אירוע|תור)/iu;
const EXPLICIT_TODO_TARGET = /\b(?:to-?do|task)(?:\s+list)?\b|(?:משימה|מטלה|רשימת משימות)/iu;
const EXPLICIT_KNOWLEDGE_TARGET = /\b(?:knowledge|memory|remember that|save that)\b|(?:ידע|זיכרון|תזכור(?:י)? ש|שמור(?:י)? ש)/iu;
const EXPLICIT_COMMITMENT_TARGET = /\b(?:commitment|promise)\b|(?:התחייבות|הבטחה)/iu;

function compact(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function trimCollectionLanguage(value: string, kind: OwnerActionRequest["kind"]): string {
  let title = compact(value)
    .replace(/^\s*(?:please\s+)?(?:add|create|put|save|schedule)\s+(?:a\s+|an\s+|the\s+)?/iu, "")
    .replace(/^\s*(?:remind me to|remember that|save that)\s+/iu, "")
    .replace(/[.?!]+$/u, "")
    .trim();
  if (kind === "calendar") {
    title = title.replace(/\s+(?:to|in|on)\s+(?:(?:the|my|our)\s+)?(?:calendar|agenda)\s*$/iu, "");
  } else if (kind === "todo") {
    title = title
      .replace(/^\s*(?:a\s+)?(?:to-?do|task)\s+(?:to\s+)?/iu, "")
      .replace(/\s+(?:to|in|on)\s+(?:(?:the|my|our)\s+)?(?:to-?do|task)(?:\s+list)?\s*$/iu, "");
  } else if (kind === "knowledge") {
    title = title
      .replace(/^\s*(?:knowledge|memory)\s+(?:that\s+)?/iu, "")
      .replace(/\s+(?:to|in)\s+(?:(?:the|my|our)\s+)?(?:knowledge|memory)\s*$/iu, "");
  } else {
    title = title
      .replace(/^\s*(?:a\s+)?(?:commitment|promise)\s+(?:to\s+)?/iu, "")
      .replace(/\s+(?:as|to)\s+(?:(?:a|the|my|our)\s+)?(?:commitment|promise)\s*$/iu, "");
  }
  title = compact(title)
    .replace(/\b(?:today|tonight|tomorrow|on\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}:\d{2})\b.*$/iu, "")
    .replace(/[\s,;:–—-]+$/u, "")
    .trim();
  return (title || compact(value)).slice(0, 240);
}

function dueAtFromCommand(content: string, timestamp: number): number | undefined {
  if (!TEMPORAL_CUE.test(content)) return undefined;
  return inferCalendarEventFromMessage(`${content} to calendar`, timestamp)?.startAt;
}

/**
 * Recognizes only owner-authored commands that explicitly ask AmirOS to write
 * something. Ordinary statements continue through the reviewable inference
 * pipeline and are never silently approved.
 */
export function parseOwnerActionRequest(content: string, timestamp = Date.now()): OwnerActionRequest | undefined {
  const source = compact(content);
  if (!source) return undefined;
  const imperative = /^(?:please\s+)?(?:add|create|put|save|schedule|remember|remind)\b|^(?:תוסיף|תוסיפי|להוסיף|צור|צרי|שמור|שמרי|תזכור|תזכרי|תזכיר|תזכירי)\b/iu.test(source);
  if (!imperative) return undefined;

  if (EXPLICIT_CALENDAR_TARGET.test(source)) {
    const event = inferCalendarEventFromMessage(source, timestamp);
    if (!event) return undefined;
    return { kind: "calendar", source, ...event };
  }

  if (EXPLICIT_KNOWLEDGE_TARGET.test(source)) {
    return { kind: "knowledge", source, title: trimCollectionLanguage(source, "knowledge") };
  }

  if (EXPLICIT_COMMITMENT_TARGET.test(source)) {
    return {
      kind: "commitment",
      source,
      title: trimCollectionLanguage(source, "commitment"),
      dueAt: dueAtFromCommand(source, timestamp),
    };
  }

  if (EXPLICIT_TODO_TARGET.test(source) || /^\s*remind me to\b/iu.test(source)) {
    return {
      kind: "todo",
      source,
      title: trimCollectionLanguage(source, "todo"),
      dueAt: dueAtFromCommand(source, timestamp),
    };
  }

  // In the owner's command channel, “Add bedtime at 23:30” is an explicit
  // timed write even when the word calendar is omitted. The temporal cue keeps
  // unrelated requests such as “add emojis” out of the calendar.
  if (TEMPORAL_CUE.test(source)) {
    const event = inferCalendarEventFromMessage(`${source} to calendar`, timestamp);
    if (!event) return undefined;
    return { kind: "calendar", source, ...event };
  }

  return undefined;
}

export function isOwnerClockQuery(content: string): boolean {
  return /^\s*(?:what(?:'s| is) the time|what time is it|current time|time now|מה השעה(?: עכשיו)?)\s*[?.!]*\s*$/iu.test(content);
}

export function ownerScheduleRange(content: string, now = Date.now()): TemporalRange | undefined {
  if (!/\b(?:schedule|calendar|agenda|what do i have|what have i got)\b|(?:לוח זמנים|יומן|מה יש לי)/iu.test(content)) return undefined;
  return resolveTemporalRange(content, now);
}

export function formatLocalTime(timestamp: number, format: TimeFormatPreference): string {
  return new Intl.DateTimeFormat(format === "24-hour" ? "en-GB" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: format === "12-hour",
  }).format(new Date(timestamp));
}

export function authoritativeClockReply(
  now = Date.now(),
  format: TimeFormatPreference = "12-hour",
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local time",
): string {
  return `It’s ${formatLocalTime(now, format)} local time (${timeZone}). 🕒`;
}

export function authoritativeScheduleReply(
  events: CalendarEvent[],
  range: TemporalRange,
  now = Date.now(),
  format: TimeFormatPreference = "12-hour",
): string {
  const scheduled = events
    .filter((event) => event.status === "confirmed" && event.startAt >= range.start && event.startAt < range.end)
    .sort((left, right) => left.startAt - right.startAt || left.title.localeCompare(right.title));
  const date = new Date(range.start);
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
  const prefix = range.phrase === "today" ? "Today" : range.phrase === "tomorrow" ? "Tomorrow" : "Your schedule";
  if (!scheduled.length) return `*${prefix}, ${dateLabel}:*\n\nNothing is scheduled. 🌿`;
  const lines = scheduled.map((event) => {
    const time = event.allDay ? "All day" : formatLocalTime(event.startAt, format);
    return `• ${time} — ${event.title}${event.location ? ` · ${event.location}` : ""}`;
  });
  return `*${prefix}, ${dateLabel}:*\n\n${lines.join("\n")} 📅`;
}
