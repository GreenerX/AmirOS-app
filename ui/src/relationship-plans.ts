import type { CalendarEvent, IntelligenceChat } from "./types.js";

export type RelationshipPlan = CalendarEvent & {
  sourceChatId: string;
  sourceContactName: string;
};

function nameWords(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .normalize("NFKC")
    .match(/[\p{L}\p{N}]+/gu) || [];
}

function containsWords(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || haystack.length < needle.length) return false;
  return haystack.some((_, start) => needle.every((word, offset) => haystack[start + offset] === word));
}

/**
 * Projects canonical calendar events onto the people they explicitly mention.
 * The event remains owned by its source chat so source navigation and editing
 * continue to use the single persisted record.
 */
export function confirmedPlansForRelationship(
  person: IntelligenceChat,
  chats: IntelligenceChat[],
): RelationshipPlan[] {
  const people = chats.filter((item) => !item.isGroup);
  const firstNameFrequency = new Map<string, number>();
  for (const item of people) {
    const firstName = nameWords(item.contactName)[0];
    if (firstName && firstName.length >= 3) {
      firstNameFrequency.set(firstName, (firstNameFrequency.get(firstName) || 0) + 1);
    }
  }

  const personName = nameWords(person.contactName);
  const fullName = personName.length >= 2 ? personName : [];
  const firstName = personName[0];
  const canUseFirstName = !person.isGroup && Boolean(
    firstName && firstName.length >= 3 && firstNameFrequency.get(firstName) === 1,
  );
  const plans = new Map<string, RelationshipPlan>();

  for (const source of chats) {
    for (const event of source.events) {
      if (event.status !== "confirmed") continue;
      const ownConversation = source.chatId === person.chatId;
      const eventWords = nameWords(`${event.title} ${event.evidence.excerpt}`);
      const explicitlyNamed =
        (fullName.length > 0 && containsWords(eventWords, fullName)) ||
        (canUseFirstName && containsWords(eventWords, [firstName!]));
      if (!ownConversation && !explicitlyNamed) continue;
      plans.set(`${source.chatId}:${event.id}`, {
        ...event,
        sourceChatId: source.chatId,
        sourceContactName: source.contactName,
      });
    }
  }

  return [...plans.values()].sort((left, right) =>
    left.startAt - right.startAt || left.updatedAt - right.updatedAt,
  );
}
