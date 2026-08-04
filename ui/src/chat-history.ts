import type { ChatMessage, ContactPreferences } from "./types.js";

export function historyForSelectedChat(
  selectedChatId: string | undefined,
  loadedChatId: string | undefined,
  messages: ChatMessage[],
): ChatMessage[] {
  return selectedChatId && selectedChatId === loadedChatId ? messages : [];
}

export function contactForSelectedChat(
  selectedChatId: string | undefined,
  loadedChatId: string | undefined,
  contact: ContactPreferences | undefined,
): ContactPreferences | undefined {
  return selectedChatId && selectedChatId === loadedChatId ? contact : undefined;
}
