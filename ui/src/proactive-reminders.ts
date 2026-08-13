import type { IntelligenceData } from "./types.js";

export type ProactiveReminder = {
  id: string;
  type: "commitment" | "todo" | "calendar";
  priority: number;
  recordId: string;
  title: string;
  detail: string;
  chatId: string;
  contactName: string;
  messageId?: string;
  timestamp: number;
};

function toMilliseconds(value: number) {
  return value < 10_000_000_000 ? value * 1_000 : value;
}

function startOfLocalDay(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function timingFor(timestamp: number, now: Date, kind: "due" | "event" = "due") {
  const value = toMilliseconds(timestamp);
  const todayStart = startOfLocalDay(now);
  const tomorrowStart = todayStart + 86_400_000;
  const dayAfterTomorrowStart = tomorrowStart + 86_400_000;
  const next24Hours = now.getTime() + 86_400_000;

  if (value < now.getTime()) return { label: "Overdue", priority: 0 };
  if (value < tomorrowStart) return { label: kind === "event" ? "Event today" : "Due today", priority: 1 };
  if (value < dayAfterTomorrowStart) return { label: kind === "event" ? "Event tomorrow" : "Due tomorrow", priority: 2 };
  if (value <= next24Hours) return { label: "Within 24 hours", priority: 3 };
  return undefined;
}

/** Creates local, deterministic reminders without making any AI requests. */
export function buildProactiveReminders(data: IntelligenceData | undefined, now = new Date()): ProactiveReminder[] {
  if (!data) return [];

  const reminders: ProactiveReminder[] = [];
  for (const commitment of data.commitments) {
    if (commitment.owner !== "me" || commitment.status !== "open" || typeof commitment.dueAt !== "number") continue;
    const timing = timingFor(commitment.dueAt, now);
    if (!timing) continue;
    reminders.push({
      id: `commitment:${commitment.chatId}:${commitment.id}`,
      type: "commitment",
      priority: timing.priority,
      recordId: commitment.id,
      title: commitment.content,
      detail: `${timing.label} · ${commitment.contactName}`,
      chatId: commitment.chatId,
      contactName: commitment.contactName,
      messageId: commitment.evidence.messageId,
      timestamp: toMilliseconds(commitment.dueAt),
    });
  }

  for (const todo of data.todos || []) {
    if (todo.status !== "open" || typeof todo.dueAt !== "number") continue;
    const timing = timingFor(todo.dueAt, now);
    if (!timing) continue;
    reminders.push({
      id: `todo:${todo.chatId}:${todo.id}`,
      type: "todo",
      priority: timing.priority,
      recordId: todo.id,
      title: todo.title,
      detail: `${timing.label} · ${todo.contactName}`,
      chatId: todo.chatId,
      contactName: todo.contactName,
      messageId: todo.evidence.messageId,
      timestamp: toMilliseconds(todo.dueAt),
    });
  }

  for (const event of data.events) {
    if (event.status !== "confirmed" || toMilliseconds(event.startAt) < now.getTime()) continue;
    const timing = timingFor(event.startAt, now, "event");
    if (!timing) continue;
    reminders.push({
      id: `calendar:${event.chatId}:${event.id}`,
      type: "calendar",
      priority: timing.priority,
      recordId: event.id,
      title: event.title,
      detail: `${timing.label} · ${event.contactName}`,
      chatId: event.chatId,
      contactName: event.contactName,
      messageId: event.evidence.messageId,
      timestamp: toMilliseconds(event.startAt),
    });
  }

  return reminders.sort((left, right) => left.priority - right.priority || left.title.localeCompare(right.title));
}
