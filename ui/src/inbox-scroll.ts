import type { ChatMessage } from "./types.js";

export const CHAT_BOTTOM_THRESHOLD = 96;

export type ChatScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

/** A small buffer keeps ordinary reading at the bottom from feeling jumpy. */
export function isNearChatBottom(
  { scrollTop, scrollHeight, clientHeight }: ChatScrollMetrics,
  threshold = CHAT_BOTTOM_THRESHOLD,
): boolean {
  return scrollHeight - clientHeight - scrollTop <= threshold;
}

/** Owner-sent messages intentionally return to the newest bubble after sending. */
export function shouldFollowNewMessages(
  wasNearBottom: boolean,
  messages: ReadonlyArray<Pick<ChatMessage, "fromMe">>,
): boolean {
  return wasNearBottom || messages.some((message) => message.fromMe);
}

export function shouldShowNewMessageJump(newMessageCount: number, nearBottom: boolean): boolean {
  return newMessageCount > 0 && !nearBottom;
}
