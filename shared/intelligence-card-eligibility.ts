/**
 * Shared, deterministic trust gate for owner-facing intelligence cards.
 *
 * This module intentionally contains no message text persistence or network
 * behavior. Each surface supplies local, already-retained evidence IDs and
 * uses the same answerability, freshness, and de-duplication rules.
 */
export const CARD_CURRENT_WINDOW_MS = 14 * 86_400_000;
export const CARD_FOLLOW_UP_WINDOW_MS = 7 * 86_400_000;
const MAX_FUTURE_SKEW_MS = 5 * 60_000;

export type CardEvidence = {
  messageId?: string;
  timestamp?: number;
};

export type CardTrustInput = {
  chatId: string;
  isGroup?: boolean;
  title: string;
  detail?: string;
  sourceIds: string[];
  evidence: CardEvidence[];
  /** IDs of exact local messages that can still be opened. */
  retainedMessageIds?: readonly string[];
  now: number;
  /** Current-context claims need recent evidence; durable memories opt out. */
  currentClaim?: boolean;
  /** An undated promise is useful only while its originating conversation is recent. */
  openFollowUp?: boolean;
  dueAt?: number;
};

function toMilliseconds(value: number): number {
  return value > 0 && value < 10_000_000_000 ? value * 1_000 : value;
}

function normalized(value: string): string {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function endOfSourceDay(sourceAt: number): number {
  const date = new Date(sourceAt);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
}

/** Resolves source-relative language against the message timestamp, never now. */
export function hasExpiredRelativeDate(text: string, sourceAt: number, now: number): boolean {
  const normalizedText = normalized(text);
  if (!normalizedText || !Number.isFinite(sourceAt)) return false;
  const sourceDayEnd = endOfSourceDay(sourceAt);
  if (/\b(today|tonight|this morning|this afternoon|this evening)\b/u.test(normalizedText)) return now >= sourceDayEnd;
  if (/\b(tomorrow|next day)\b/u.test(normalizedText)) return now >= sourceDayEnd + 86_400_000;
  if (/\b(this week)\b/u.test(normalizedText)) {
    const date = new Date(sourceAt);
    const daysUntilMonday = (8 - date.getDay()) % 7 || 7;
    return now >= new Date(date.getFullYear(), date.getMonth(), date.getDate() + daysUntilMonday).getTime();
  }
  return false;
}

/** Stable semantic identity across drawer, proactive delivery, and Focus. */
export function intelligenceCardDedupeKey(chatId: string, title: string, sourceIds: string[]): string {
  const sources = [...new Set(sourceIds.map(normalized).filter(Boolean))].sort();
  return sources.length
    ? `sources:${sources.join("|")}`
    : `theme:${normalized(chatId)}:${normalized(title)}`;
}

export function isTrustworthyIntelligenceCard(input: CardTrustInput): boolean {
  if (!normalized(input.chatId) || input.isGroup || !normalized(input.title) || input.sourceIds.length === 0) return false;
  // Generic labels make a promise without telling the owner what they will learn.
  if (/^(something changed|new context|remember this|follow up|important update)$/iu.test(input.title.trim())) return false;
  const retained = new Set(input.retainedMessageIds || []);
  const exactEvidence = input.evidence
    .filter((evidence) => Boolean(evidence.messageId && retained.has(evidence.messageId)))
    .map((evidence) => ({ id: evidence.messageId!, timestamp: toMilliseconds(evidence.timestamp || 0) }))
    .filter((evidence) => Number.isFinite(evidence.timestamp) && evidence.timestamp > 0 && evidence.timestamp <= input.now + MAX_FUTURE_SKEW_MS);
  if (exactEvidence.length === 0) return false;
  const latestEvidenceAt = Math.max(...exactEvidence.map((evidence) => evidence.timestamp));
  const copy = `${input.title} ${input.detail || ""}`;
  // A resolved calendar/due timestamp is authoritative. Labels such as
  // “Due today” are generated from that timestamp and must not be mistaken
  // for an old message's source-relative word “today”.
  if (input.dueAt === undefined && hasExpiredRelativeDate(copy, latestEvidenceAt, input.now)) return false;
  if (input.currentClaim && latestEvidenceAt < input.now - CARD_CURRENT_WINDOW_MS) return false;
  if (input.openFollowUp && !input.dueAt && latestEvidenceAt < input.now - CARD_FOLLOW_UP_WINDOW_MS) return false;
  return true;
}
