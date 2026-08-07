import type { IntelligenceChat } from "./types.js";

export const HIDDEN_INTELLIGENCE_ACTIONS_KEY = "amiros-hidden-radar";

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "getItem" | "setItem">;

export function replyActionId(chat: IntelligenceChat): string {
  const messageIdentity = chat.lastIncoming?.messageId
    || chat.lastIncoming?.timestamp
    || chat.updatedAt;
  return `reply:${chat.chatId}:${messageIdentity}`;
}

export function readHiddenIntelligenceActions(storage?: StorageReader): Set<string> {
  try {
    const source = storage || window.localStorage;
    const parsed = JSON.parse(source.getItem(HIDDEN_INTELLIGENCE_ACTIONS_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

/** Keep an action out of AmirOS's local review queue without touching WhatsApp. */
export function hideIntelligenceAction(actionId: string, storage?: StorageWriter): void {
  const source = storage || window.localStorage;
  const hidden = readHiddenIntelligenceActions(source);
  hidden.add(actionId);
  source.setItem(HIDDEN_INTELLIGENCE_ACTIONS_KEY, JSON.stringify([...hidden]));
}

export function visibleReplyChats(chats: IntelligenceChat[], hidden: Set<string>): IntelligenceChat[] {
  return chats.filter((chat) => !hidden.has(replyActionId(chat)));
}
