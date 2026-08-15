import type { ChatSummary } from "./types";

/** A useful relationship window without turning first-run setup into a deep archive scan. */
export const FIRST_RUN_PEOPLE_SCAN_LIMIT = 150;
export const FIRST_RUN_PEOPLE_SUGGESTION_LIMIT = 12;

function normalizedName(value: string) {
  return value
    .replace(/\s*\(you\)\s*$/iu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}

/**
 * First-run discovery is intentionally metadata-only: direct conversations are
 * ranked by recent activity, while existing favorites are always considered
 * before the recency cap. Message text is never used to make these suggestions.
 */
export function suggestedFirstRunPeople(chats: ChatSummary[], ownerName: string): ChatSummary[] {
  const owner = normalizedName(ownerName);
  return chats
    .filter((chat) => !chat.isGroup && chat.timestamp > 0)
    .filter((chat) => !owner || normalizedName(chat.name) !== owner)
    .sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned))
      || right.timestamp - left.timestamp
      || left.name.localeCompare(right.name))
    .slice(0, FIRST_RUN_PEOPLE_SUGGESTION_LIMIT);
}

type FirstRunPeopleBuildDependencies = {
  enableKnowledgeTracking: (chatId: string) => Promise<void>;
  scanHistory: (chatId: string, limit: number) => Promise<{ messages: unknown[] }>;
  analyzeRelationship: (chatId: string, messageLimit: number, advanceLearningCursor: boolean) => Promise<void>;
  onProgress: (completed: number, total: number) => void;
};

/**
 * Performs one intentional, bounded analysis per explicitly selected person.
 * The normal incremental learner handles everything after this first-run pass.
 */
export async function buildFirstRunPeopleDirectory(
  chatIds: string[],
  dependencies: FirstRunPeopleBuildDependencies,
) {
  const selections = [...new Set(chatIds)].slice(0, FIRST_RUN_PEOPLE_SUGGESTION_LIMIT);
  for (const [index, chatId] of selections.entries()) {
    dependencies.onProgress(index, selections.length);
    const result = await dependencies.scanHistory(chatId, FIRST_RUN_PEOPLE_SCAN_LIMIT);
    // Very short conversations are still enabled for future learning, but
    // do not have enough context for a meaningful first profile.
    if (result.messages.length >= 2) {
      await dependencies.analyzeRelationship(chatId, FIRST_RUN_PEOPLE_SCAN_LIMIT, true);
    }
    // Enable the normal incremental learner only after this explicit, bounded
    // first-run pass has recorded its cursor. That prevents a second analysis
    // of the same imported messages while preserving future automatic learning.
    await dependencies.enableKnowledgeTracking(chatId);
    dependencies.onProgress(index + 1, selections.length);
  }
}
