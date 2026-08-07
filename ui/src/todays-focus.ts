import { buildProactiveReminders } from "./proactive-reminders.js";
import type { IntelligenceData } from "./types.js";

export type TodaysFocusItem = {
  id: string;
  type: "commitment" | "todo" | "calendar" | "reply";
  priority: number;
  title: string;
  detail: string;
  chatId: string;
  contactName: string;
  messageId?: string;
  action: "chat" | "todo" | "calendar" | "reply";
  timestamp: number;
};

function toMilliseconds(value: number) {
  return value < 10_000_000_000 ? value * 1_000 : value;
}

function startOfLocalDay(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function duePriority(dueAt: number, now: Date) {
  const due = toMilliseconds(dueAt);
  if (due < now.getTime()) return 0;
  if (due < startOfLocalDay(now) + 86_400_000) return 1;
  return undefined;
}

/** Builds the small, local-only list of items that deserve attention today. */
export function buildTodaysFocus(data: IntelligenceData | undefined, now = new Date()): TodaysFocusItem[] {
  if (!data) return [];

  const items: TodaysFocusItem[] = [];
  const seen = new Set<string>();
  const add = (item: TodaysFocusItem) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    items.push(item);
  };

  for (const commitment of data.commitments) {
    if (commitment.owner !== "me" || commitment.status !== "open" || typeof commitment.dueAt !== "number") continue;
    const priority = duePriority(commitment.dueAt, now);
    if (priority === undefined) continue;
    add({
      id: `commitment:${commitment.chatId}:${commitment.id}`,
      type: "commitment",
      priority,
      title: commitment.content,
      detail: priority === 0 ? "Overdue commitment" : "Due today",
      chatId: commitment.chatId,
      contactName: commitment.contactName,
      messageId: commitment.evidence.messageId,
      action: "chat",
      timestamp: toMilliseconds(commitment.dueAt),
    });
  }

  for (const todo of data.todos || []) {
    if (todo.status !== "open" || typeof todo.dueAt !== "number") continue;
    const priority = duePriority(todo.dueAt, now);
    if (priority === undefined) continue;
    add({
      id: `todo:${todo.chatId}:${todo.id}`,
      type: "todo",
      priority,
      title: todo.title,
      detail: priority === 0 ? "Overdue task" : "Due today",
      chatId: todo.chatId,
      contactName: todo.contactName,
      messageId: todo.evidence.messageId,
      action: "todo",
      timestamp: toMilliseconds(todo.dueAt),
    });
  }

  const tomorrow = startOfLocalDay(now) + 86_400_000;
  for (const event of data.events) {
    const startAt = toMilliseconds(event.startAt);
    if (event.status !== "confirmed" || startAt < now.getTime() || startAt >= tomorrow) continue;
    add({
      id: `calendar:${event.chatId}:${event.id}`,
      type: "calendar",
      priority: 2,
      title: event.title,
      detail: "Happening today",
      chatId: event.chatId,
      contactName: event.contactName,
      messageId: event.evidence.messageId,
      action: "calendar",
      timestamp: startAt,
    });
  }

  for (const chat of data.needsReply) {
    if (!chat.needsReply) continue;
    add({
      id: `reply:${chat.chatId}:${chat.lastIncoming?.messageId || "latest"}`,
      type: "reply",
      priority: 3,
      title: `Reply to ${chat.contactName}`,
      detail: "A message is waiting for your reply",
      chatId: chat.chatId,
      contactName: chat.contactName,
      messageId: chat.lastIncoming?.messageId,
      action: "reply",
      timestamp: chat.lastIncoming ? toMilliseconds(chat.lastIncoming.timestamp) : toMilliseconds(chat.updatedAt),
    });
  }

  for (const reminder of buildProactiveReminders(data, now)) {
    if (seen.has(reminder.id)) continue;
    add({
      id: reminder.id,
      type: reminder.type,
      priority: 4,
      title: reminder.title,
      detail: reminder.detail,
      chatId: reminder.chatId,
      contactName: reminder.contactName,
      messageId: reminder.messageId,
      action: reminder.type === "calendar" ? "calendar" : reminder.type === "todo" ? "todo" : "chat",
      timestamp: now.getTime(),
    });
  }

  return items.sort((left, right) => left.priority - right.priority || left.timestamp - right.timestamp || left.title.localeCompare(right.title)).slice(0, 4);
}
