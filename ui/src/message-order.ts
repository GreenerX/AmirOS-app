import type { ChatMessage, ChatSummary } from "./types";

export function messageTimestamp(timestamp: number): number {
  return timestamp > 0 && timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp;
}

/**
 * WhatsApp timestamps are second-granularity. Preserve the source sequence for
 * messages that share a timestamp instead of using their opaque IDs as a tie-breaker.
 */
export function orderMessagesChronologically(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .map((message, sourceIndex) => ({ message, sourceIndex }))
    .sort((left, right) => messageTimestamp(left.message.timestamp) - messageTimestamp(right.message.timestamp) || left.sourceIndex - right.sourceIndex)
    .map(({ message }) => message);
}

/** Keep the Inbox recency-first, regardless of a conversation's pinned state. */
export function orderChatsByRecency(chats: ChatSummary[]): ChatSummary[] {
  return [...chats].sort((left, right) => messageTimestamp(right.timestamp) - messageTimestamp(left.timestamp));
}
