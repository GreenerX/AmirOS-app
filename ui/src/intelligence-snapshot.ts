import type { ContactInsight, IntelligenceData } from "./types.js";
import { visibleReplyChats } from "./intelligence-visibility.js";

export type ConfirmedKnowledgeItem = ContactInsight & {
  chatId: string;
  contactName: string;
};

function toMilliseconds(value: number) {
  return value < 10_000_000_000 ? value * 1_000 : value;
}

export function isKnownIntelligenceContactName(name: string) {
  const normalized = name.replace(/\s+/g, " ").trim();
  return Boolean(normalized)
    && !/^(?:whatsapp contact|group participant|unknown contact)$/iu.test(normalized)
    && !/^\+?[\d\s().-]{7,}$/u.test(normalized);
}

export function buildIntelligenceSnapshot(
  data: IntelligenceData | undefined,
  hiddenReplyActions: Set<string>,
  now = Date.now(),
) {
  const confirmedKnowledge: ConfirmedKnowledgeItem[] = (data?.chats || [])
    .filter((chat) => isKnownIntelligenceContactName(chat.contactName))
    .flatMap((chat) => chat.insights
      .filter((item) => item.status === "confirmed")
      .map((item) => ({ ...item, chatId: chat.chatId, contactName: chat.contactName })))
    .sort((left, right) => toMilliseconds(right.updatedAt) - toMilliseconds(left.updatedAt));

  const upcomingEvents = (data?.events || [])
    .filter((event) => isKnownIntelligenceContactName(event.contactName)
      && event.status === "confirmed"
      && toMilliseconds(event.startAt) >= now)
    .sort((left, right) => toMilliseconds(left.startAt) - toMilliseconds(right.startAt));

  const replies = visibleReplyChats(
    (data?.needsReply || []).filter((chat) => isKnownIntelligenceContactName(chat.contactName)),
    hiddenReplyActions,
  );

  return {
    confirmedKnowledge,
    upcomingEvents,
    replies,
    relationships: new Set(confirmedKnowledge.map((item) => item.chatId)).size,
    details: confirmedKnowledge.length,
  };
}
