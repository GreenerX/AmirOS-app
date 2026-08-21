import type { ChatSummary, KnowledgeTrackingStatus } from "./types";

/** A useful relationship window without turning first-run setup into a deep archive scan. */
export const FIRST_RUN_PEOPLE_SCAN_LIMIT = 150;
export const FIRST_RUN_PEOPLE_SUGGESTION_LIMIT = 12;

/**
 * Selecting a person during first-run setup is explicit consent to establish
 * their profile from a bounded history and then learn from new messages in
 * that selected chat. The separate default controls future, unselected chats.
 */
export function firstRunSelectedPeopleTracking(): KnowledgeTrackingStatus {
  return "enabled";
}

/** A selected-chat analysis cannot start until the owner explicitly agrees. */
export function canBuildFirstRunPeopleDirectory(
  selectedPeopleCount: number,
  hasOneTimeAnalysisConsent: boolean,
): boolean {
  return selectedPeopleCount === 0 || hasOneTimeAnalysisConsent;
}

/** Never render an impossible progress count while the final write completes. */
export function firstRunPeopleProgressLabel(completed: number, total: number): string {
  const safeTotal = Math.max(0, Math.floor(total));
  if (safeTotal === 0) return "Preparing People setup";
  const safeCompleted = Math.min(safeTotal, Math.max(0, Math.floor(completed)));
  return safeCompleted < safeTotal
    ? `Preparing ${safeCompleted + 1} of ${safeTotal}`
    : "Finishing People setup";
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
   * Applies the selected person's explicit ongoing-learning choice after their
   * bounded first-run analysis is complete.
   */
  setKnowledgeTracking: (chatId: string, status: KnowledgeTrackingStatus) => Promise<void>;
  futureTracking: KnowledgeTrackingStatus;
  scanHistory: (chatId: string, limit: number) => Promise<{ messages: unknown[] }>;
  analyzeRelationship: (chatId: string, messageLimit: number, advanceLearningCursor: boolean) => Promise<void>;
  onProgress: (completed: number, total: number) => void;
};

export type FirstRunPeopleBuildResult = {
  selectedChatIds: string[];
  profiledChatIds: string[];
  shortConversationChatIds: string[];
};

/** Control Center receives this informational milestone only after a profile exists. */
export function shouldReportFirstPeopleSelected(result: FirstRunPeopleBuildResult): boolean {
  return result.profiledChatIds.length > 0;
}

/** These are informational checklist updates only; neither event grants access. */
export function firstRunPeopleControlCenterEvents(
  connectionStatus: "starting" | "qr" | "authenticated" | "ready" | "disconnected",
  result: FirstRunPeopleBuildResult,
): Array<"whatsapp_connected" | "first_people_selected"> {
  const events: Array<"whatsapp_connected" | "first_people_selected"> = [];
  if (connectionStatus !== "ready") return events;
  events.push("whatsapp_connected");
  if (shouldReportFirstPeopleSelected(result)) events.push("first_people_selected");
  return events;
}

/**
 * Performs one intentional, bounded analysis per explicitly selected person.
 * The caller must obtain explicit consent before invoking this function and
 * passes the selected chats' ongoing-learning status as `futureTracking`.
 */
export async function buildFirstRunPeopleDirectory(
  chatIds: string[],
  dependencies: FirstRunPeopleBuildDependencies,
): Promise<FirstRunPeopleBuildResult> {
  const selections = [...new Set(chatIds)].slice(0, FIRST_RUN_PEOPLE_SUGGESTION_LIMIT);
  const profiledChatIds: string[] = [];
  const shortConversationChatIds: string[] = [];
  for (const [index, chatId] of selections.entries()) {
    dependencies.onProgress(index, selections.length);
    const result = await dependencies.scanHistory(chatId, FIRST_RUN_PEOPLE_SCAN_LIMIT);
    // Very short conversations do not have enough context for a meaningful
    // first profile, but remain selected for ongoing learning.
    if (result.messages.length >= 2) {
      await dependencies.analyzeRelationship(chatId, FIRST_RUN_PEOPLE_SCAN_LIMIT, true);
      profiledChatIds.push(chatId);
    } else {
      shortConversationChatIds.push(chatId);
    }
    await dependencies.setKnowledgeTracking(chatId, dependencies.futureTracking);
    dependencies.onProgress(index + 1, selections.length);
  }
  return { selectedChatIds: selections, profiledChatIds, shortConversationChatIds };
}
