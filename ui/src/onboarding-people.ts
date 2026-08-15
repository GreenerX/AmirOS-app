import type { ChatSummary, KnowledgeTrackingDefault, KnowledgeTrackingStatus } from "./types";

/** A useful relationship window without turning first-run setup into a deep archive scan. */
export const FIRST_RUN_PEOPLE_SCAN_LIMIT = 150;
export const FIRST_RUN_PEOPLE_SUGGESTION_LIMIT = 12;

/**
 * A first-run profile is a one-time, explicitly consented action. This helper
 * controls only whether the owner also allowed future message learning.
 */
export function firstRunFutureTracking(
  defaultTracking: KnowledgeTrackingDefault,
  keepLearningFromSelectedPeople: boolean,
): KnowledgeTrackingStatus {
  if (defaultTracking === "private" || keepLearningFromSelectedPeople) return "enabled";
  return defaultTracking === "ask" ? "pending" : "disabled";
}

/** A selected-chat analysis cannot start until the owner explicitly agrees. */
export function canBuildFirstRunPeopleDirectory(
  selectedPeopleCount: number,
  hasOneTimeAnalysisConsent: boolean,
): boolean {
  return selectedPeopleCount === 0 || hasOneTimeAnalysisConsent;
}

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
  /**
   * Applies the owner's separate choice for learning from future messages only
   * after the explicit one-time first-run analysis is complete.
   */
  setKnowledgeTracking: (chatId: string, status: KnowledgeTrackingStatus) => Promise<void>;
  futureTracking: KnowledgeTrackingStatus;
  scanHistory: (chatId: string, limit: number) => Promise<{ messages: unknown[] }>;
  analyzeRelationship: (chatId: string, messageLimit: number, advanceLearningCursor: boolean) => Promise<void>;
  onProgress: (completed: number, total: number) => void;
};

/**
 * Performs one intentional, bounded analysis per explicitly selected person.
 * The caller must obtain explicit consent before invoking this function. Future
 * learning is a separate preference, represented by `futureTracking`.
 */
export async function buildFirstRunPeopleDirectory(
  chatIds: string[],
  dependencies: FirstRunPeopleBuildDependencies,
) {
  const selections = [...new Set(chatIds)].slice(0, FIRST_RUN_PEOPLE_SUGGESTION_LIMIT);
  for (const [index, chatId] of selections.entries()) {
    dependencies.onProgress(index, selections.length);
    const result = await dependencies.scanHistory(chatId, FIRST_RUN_PEOPLE_SCAN_LIMIT);
    // Very short conversations do not have enough context for a meaningful
    // first profile, but still receive the owner's separate future preference.
    if (result.messages.length >= 2) {
      await dependencies.analyzeRelationship(chatId, FIRST_RUN_PEOPLE_SCAN_LIMIT, true);
    }
    // This is deliberately not always "enabled". A selected first-run profile
    // must never silently opt a person into ongoing knowledge tracking.
    await dependencies.setKnowledgeTracking(chatId, dependencies.futureTracking);
    dependencies.onProgress(index + 1, selections.length);
  }
}
