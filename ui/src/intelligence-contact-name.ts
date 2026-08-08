import type { ChatSummary } from "./types";

function phoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

/** WhatsApp can surface a group participant as @<phone number>. Prefer a known direct-chat name. */
export function resolveIntelligenceContactName(value: string, chats: ChatSummary[]) {
  const trimmed = value.replace(/\s+/g, " ").trim();
  const digits = phoneDigits(trimmed);
  if (digits.length < 7) return trimmed;

  const match = chats.find((chat) => {
    const chatDigits = phoneDigits(chat.id);
    return chatDigits === digits || chatDigits.endsWith(digits) || digits.endsWith(chatDigits);
  });
  return match?.name?.trim() || trimmed.replace(/^@/, "");
}

export function replaceIntelligencePhoneReferences(value: string, chats: ChatSummary[]) {
  return value.replace(/@?\+?\d[\d\s()-]{5,}\d/g, (reference) => resolveIntelligenceContactName(reference, chats));
}
