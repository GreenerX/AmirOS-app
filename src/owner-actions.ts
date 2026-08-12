import type { CalendarEvent } from "./amiros-state.js";
import { hasTodoTaskIntent, inferCalendarEventFromMessage } from "./amiros-state.js";
import { classifyTemporalRequest } from "./temporal-classifier.js";
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
  | {
      kind: "todo";
      source: string;
      title: string;
      dueAt?: number;
      needsTimeClarification?: boolean;
      preserveTitle?: boolean;
    }
  | { kind: "knowledge"; source: string; title: string }
  | { kind: "commitment"; source: string; title: string; dueAt?: number };

const EXPLICIT_KNOWLEDGE_TARGET = /\b(?:knowledge|memory|remember that|save that)\b|(?:ידע|זיכרון|תזכור(?:י)? ש|שמור(?:י)? ש)/iu;

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
      .replace(/^\s*(?:a\s+)?(?:to[ -]?do|task)\s+(?:to\s+)?/iu, "")
      .replace(/^\s*(?:i need to|i have to|i should|i must)\s+/iu, "")
      .replace(/\s+(?:to|in|on)\s+(?:(?:the|my|our)\s+)?(?:to[ -]?do|task)(?:\s+list)?\s*$/iu, "");
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
    .replace(/\b(?:today|tonight|tomorrow|(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|at\s+(?:noon|midnight|\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}:\d{2}))\b.*$/iu, "")
    .replace(/[\s,;:–—-]+$/u, "")
    .trim();
  return (title || compact(value)).slice(0, 240);
}

/**
 * Recognizes owner-authored write commands plus clear personal next-action
 * statements such as “I need to buy almonds.” This parser is only invoked for
 * owner messages, so these actions can be saved immediately and truthfully.
 */
export function parseOwnerActionRequest(content: string, timestamp = Date.now()): OwnerActionRequest | undefined {
  const source = compact(content);
  if (!source) return undefined;
  const imperative = /^(?:please\s+)?(?:add|create|put|save|schedule|remember|remind)\b|^(?:תוסיף|תוסיפי|להוסיף|צור|צרי|שמור|שמרי|תזכור|תזכרי|תזכיר|תזכירי)\b/iu.test(source);
  const clearOwnerTodo = hasTodoTaskIntent(source);

  // Knowledge is intentionally outside the temporal classifier. Preserve the
  // existing explicit owner write without allowing ordinary statements to be
  // stored as knowledge.
  if (imperative && EXPLICIT_KNOWLEDGE_TARGET.test(source)) {
    return { kind: "knowledge", source, title: trimCollectionLanguage(source, "knowledge") };
  }

  const classification = classifyTemporalRequest(source, timestamp);
  if (classification?.primaryType === "calendar_event" && classification.temporal?.startAt) {
    // The legacy parser may still contribute a location or a better fallback
    // title, but it cannot alter the shared classifier's type or timestamp.
    const enrichment = inferCalendarEventFromMessage(source, timestamp)
      || inferCalendarEventFromMessage(`${source} to calendar`, timestamp);
    return {
      kind: "calendar",
      source,
      title: enrichment?.title || trimCollectionLanguage(source, "calendar"),
      startAt: classification.temporal.startAt,
      allDay: classification.temporal.precision === "day",
      location: enrichment?.location,
    };
  }
  if (classification?.primaryType === "todo") return {
    kind: "todo",
    source,
    title: trimCollectionLanguage(source, "todo"),
    dueAt: classification.temporal?.dueAt,
    needsTimeClarification: classification.temporal?.precision === "day",
  };
  if (classification?.primaryType === "commitment") return {
    kind: "commitment",
    source,
    title: trimCollectionLanguage(source, "commitment"),
    dueAt: classification.temporal?.dueAt,
  };

  // The temporal service deliberately returns no result for undated requests.
  // Preserve the established owner-only natural to-do behavior in that case.
  if (clearOwnerTodo) return { kind: "todo", source, title: trimCollectionLanguage(source, "todo") };

  return undefined;
}

/**
 * A clarification continuation must be only a clock value. Keeping this
 * deliberately narrow prevents an unrelated owner message from being attached
 * to an earlier action.
 */
export function continueOwnerActionWithTime(
  action: Extract<OwnerActionRequest, { kind: "todo" }>,
  response: string,
): Extract<OwnerActionRequest, { kind: "todo" }> | undefined {
  if (!action.dueAt || !action.needsTimeClarification) return undefined;
  const match = response.match(/^\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[.!]?\s*$/iu);
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const period = match[3]?.toLocaleLowerCase();
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59) return undefined;
  if (period) {
    if (hour < 1 || hour > 12) return undefined;
    if (period === "pm" && hour < 12) hour += 12;
    if (period === "am" && hour === 12) hour = 0;
  } else if (hour > 23) return undefined;
  const due = new Date(action.dueAt);
  due.setHours(hour, minute, 0, 0);
  return { ...action, dueAt: due.getTime(), needsTimeClarification: false, preserveTitle: true };
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
