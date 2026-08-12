import { buildProactiveReminders } from "./proactive-reminders.js";
import type { IntelligenceChat, IntelligenceData, ProactiveIntelligenceItem } from "./types.js";

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
  allDay?: boolean;
  location?: string;
  imageUrl?: string;
  source?: "whatsapp_bot";
  replyAssessment?: IntelligenceChat["replyAssessment"];
  proactive?: ProactiveIntelligenceItem;
  why?: string;
};

export type TodaysFocusPresentation = {
  title: "Today's Focus" | "Up Next";
  subtitle: string;
  period: "today" | "tomorrow";
};

function toMilliseconds(value: number) {
  return value < 10_000_000_000 ? value * 1_000 : value;
}

function startOfLocalDay(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/**
 * Keeps the section recognizable during the day, then transitions to tomorrow
 * only when tonight is genuinely clear and every visible card belongs to the
 * next local calendar day.
 */
export function todaysFocusPresentation(
  items: TodaysFocusItem[],
  now = new Date(),
): TodaysFocusPresentation {
  const isLateEvening = now.getHours() >= 20;
  if (!isLateEvening) {
    return { title: "Today's Focus", subtitle: "What matters most today", period: "today" };
  }
  const tomorrow = startOfLocalDay(now) + 86_400_000;
  const dayAfterTomorrow = tomorrow + 86_400_000;
  const onlyTomorrow = items.length > 0 && items.every((item) => {
    const timestamp = toMilliseconds(item.timestamp);
    return timestamp >= tomorrow && timestamp < dayAfterTomorrow;
  });
  if (onlyTomorrow) {
    return {
      title: "Up Next",
      subtitle: items.length === 1 ? "One thing for tomorrow" : "A head start on tomorrow",
      period: "tomorrow",
    };
  }
  return {
    title: "Today's Focus",
    subtitle: items.length > 0 ? "Before you wrap up" : "You're all clear for tonight",
    period: "today",
  };
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
  const proactiveSourceIds = new Set((data.proactive || []).flatMap((item) => item.sourceIds));
  const add = (item: TodaysFocusItem) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    items.push(item);
  };

  for (const commitment of data.commitments) {
    if (proactiveSourceIds.has(commitment.id)) continue;
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
    if (proactiveSourceIds.has(todo.id)) continue;
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
  const dayAfterTomorrow = tomorrow + 86_400_000;
  for (const event of data.events) {
    if (proactiveSourceIds.has(event.id)) continue;
    const startAt = toMilliseconds(event.startAt);
    if (event.status !== "confirmed" || startAt < now.getTime() || startAt >= dayAfterTomorrow) continue;
    add({
      id: `calendar:${event.chatId}:${event.id}`,
      type: "calendar",
      // The next event is the clearest time-bound item on the Overview, so
      // today's confirmed events lead the focus cards chronologically.
      priority: -1,
      title: event.title,
      detail: startAt < tomorrow ? "Happening today" : "Happening tomorrow",
      chatId: event.chatId,
      contactName: event.contactName,
      messageId: event.evidence.messageId,
      action: "calendar",
      timestamp: startAt,
      allDay: event.allDay,
      location: event.location,
      imageUrl: event.imageUrl,
      source: event.evidence.source,
    });
  }

  for (const chat of data.needsReply) {
    if (chat.lastIncoming?.messageId && proactiveSourceIds.has(chat.lastIncoming.messageId)) continue;
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
      replyAssessment: chat.replyAssessment,
    });
  }

  for (const reminder of buildProactiveReminders(data, now)) {
    if (seen.has(reminder.id) || proactiveSourceIds.has(reminder.recordId)) continue;
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

  for (const proactive of data.proactive || []) {
    if (seen.has(proactive.id)) continue;
    add({
      id: proactive.id,
      type: proactive.kind === "todo" ? "todo" : proactive.kind === "reply" ? "reply" : "commitment",
      priority: proactive.priority,
      title: proactive.title,
      detail: proactive.detail,
      chatId: proactive.chatId,
      contactName: proactive.contactName,
      messageId: proactive.messageId,
      action: proactive.action,
      timestamp: proactive.timestamp,
      proactive,
      why: proactive.why,
    });
  }

  const ranked = items.sort((left, right) => left.priority - right.priority || left.timestamp - right.timestamp || left.title.localeCompare(right.title));
  const visible = ranked.slice(0, 4);
  const bestProactive = ranked.find((item) => item.proactive);
  if (bestProactive && !visible.some((item) => item.id === bestProactive.id)) {
    // Agenda already carries the complete event list. Keep one of the four
    // identity-rich focus cards available for context that AmirOS proactively
    // judged useful, instead of letting calendar duplication consume the row.
    visible[Math.max(0, visible.length - 1)] = bestProactive;
    visible.sort((left, right) => left.priority - right.priority || left.timestamp - right.timestamp || left.title.localeCompare(right.title));
  }
  return visible;
}
