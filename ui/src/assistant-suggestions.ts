import type {
  AssistantSuggestionContext, ChatSummary, ContactInsight, IntelligenceChat, IntelligenceData, MemoryEvidence,
  ProactiveIntelligenceItem,
} from "./types";

const DAY_MS = 86_400_000;
const MAX_KNOWLEDGE_AGE_MS = 45 * DAY_MS;
const MAX_CHANGE_SUGGESTION_AGE_MS = 30 * DAY_MS;
const CLOSE_CONTACT_WINDOW_MS = 21 * DAY_MS;

/** The open drawer shows one hero plus three supporting discoveries. */
export const ASSISTANT_DISCOVERY_VISIBLE_COUNT = 4;
/** Rotate only when there are enough independently worthwhile discoveries. */
export const ASSISTANT_DISCOVERY_ROTATION_MS = 3 * 60_000;
const MAX_DISCOVERY_POOL = 8;

export type AssistantSuggestionIcon = "communication" | "connection" | "people" | "work";

export type AssistantSuggestionCard = {
  id: string;
  /** Uses “You” when the selected knowledge belongs to the dashboard owner. */
  contactName: string;
  avatarUrl?: string;
  /** A concise, curiosity-building headline. It is never a task or a next action. */
  title: string;
  /** The direct, attributable fact that makes this card worth opening. */
  preview: string;
  /** One freshness/source cue for the card. */
  detail: string;
  question: string;
  kind: "knowledge";
  icon: AssistantSuggestionIcon;
  suggestionContext: AssistantSuggestionContext;
};

export type AssistantSuggestionOwner = {
  displayName?: string;
  avatarUrl?: string;
};

type RankedSuggestion = AssistantSuggestionCard & {
  sourceAt: number;
  significance: number;
};

function toMilliseconds(value: number): number {
  return value > 0 && value < 10_000_000_000 ? value * 1_000 : value;
}

function sameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function dateLabel(timestamp: number, now: number): string {
  const date = new Date(timestamp);
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay(date, today)) return `Today, ${time}`;
  if (sameDay(date, yesterday)) return "Updated yesterday";
  return `Updated ${date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  })}`;
}

function cleanDisplayText(value: string): string {
  return value
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Keeps owner-facing discovery copy personal even for knowledge written before the current AI projection. */
function ownerFacingCopy(value: string, ownerName: string | undefined, allowFirstName = false): string {
  const normalized = cleanDisplayText(value);
  const fullName = cleanDisplayText(ownerName || "");
  if (!fullName) return normalized;
  const firstName = fullName.split(" ")[0] || fullName;
  // In another person's card, a bare first name could refer to someone else.
  // The full owner name is still unambiguous; the first name is only safe in
  // the owner's own card.
  const aliases = [...new Set([fullName, ...(allowFirstName ? [firstName] : [])].filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  let copy = normalized;
  for (const alias of aliases) {
    const escaped = escapePattern(alias);
    copy = copy.replace(new RegExp(`\\b${escaped}(?:['’]s)`, "giu"), "your");
    copy = copy.replace(new RegExp(`\\b${escaped}\\b`, "giu"), "you");
  }
  // Canonical knowledge predates the owner-facing AI projection in some
  // installs. Repair the common third-person verb forms after replacing the
  // owner's name so that this fallback still reads like a private assistant.
  copy = copy
    .replace(/\byou\s+is\b/giu, "you are")
    .replace(/\byou\s+was\b/giu, "you were")
    .replace(/\byou\s+has\b/giu, "you have")
    .replace(/\byou\s+does\b/giu, "you do")
    .replace(/\byou\s+doesn't\b/giu, "you don't")
    .replace(/\byou\s+isn't\b/giu, "you aren't")
    .replace(/\byou\s+(wants|needs|prefers|likes|loves|misses|says|feels|thinks|believes|knows|works|lives|uses|values|asks|expects|plans)\b/giu, (_match, verb: string) => `you ${verb.toLocaleLowerCase() === "misses" ? "miss" : verb.slice(0, -1)}`);
  return copy.replace(/(^|[.!?]\s+)you\b/gu, "$1You");
}

function insightUnambiguouslyMentionsOwner(insight: ContactInsight, ownerName: string | undefined): boolean {
  const fullName = cleanDisplayText(ownerName || "");
  if (!fullName) return false;
  const source = cleanDisplayText(`${insight.discoverySummary || ""} ${insight.content}`);
  return new RegExp(`\\b${escapePattern(fullName)}\\b`, "iu").test(source);
}

function normalizedName(value: string | undefined): string {
  return (value || "")
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function isOwnerContact(contactName: string, owner?: AssistantSuggestionOwner): boolean {
  const contact = normalizedName(contactName);
  const ownerName = normalizedName(owner?.displayName);
  return Boolean(contact && ownerName && contact === ownerName);
}

/**
 * A card may only promise information that came from the selected person. A
 * full-name match deliberately fails closed rather than guessing from a
 * similarly named participant in another chat.
 */
function evidenceBelongsToContact(evidence: MemoryEvidence, contactName: string): boolean {
  const sender = normalizedName(evidence.senderName);
  const contact = normalizedName(contactName);
  return Boolean(sender && contact && sender === contact);
}

function directEvidenceFor(insight: ContactInsight, contactName: string): MemoryEvidence[] {
  return [insight.evidence, ...(insight.evidenceHistory || [])]
    .filter((evidence) => evidenceBelongsToContact(evidence, contactName))
    .sort((left, right) => toMilliseconds(right.timestamp) - toMilliseconds(left.timestamp));
}

function latestEvidenceAt(evidence: MemoryEvidence[]): number {
  return evidence
    .map((item) => toMilliseconds(item.timestamp))
    .filter((value) => Number.isFinite(value) && value > 0)
    .at(0) || 0;
}

function evidenceCount(evidence: MemoryEvidence[]): number {
  return new Set(evidence.map((item) => item.messageId || `${item.timestamp}:${item.excerpt}`)).size;
}

function sourceCue(count: number, sourceAt: number, now: number): string {
  return `${count} direct ${count === 1 ? "message" : "messages"} · ${dateLabel(sourceAt, now)}`;
}

function usefulKnowledge(insight: ContactInsight, directEvidence: MemoryEvidence[], now: number): boolean {
  const sourceAt = latestEvidenceAt(directEvidence);
  return insight.kind !== "important_date"
    && insight.status === "confirmed"
    && insight.validity !== "historical"
    && insight.validity !== "temporary"
    && insight.confidence >= .9
    && !["stale", "historical", "uncertain"].includes(insight.freshness || "")
    && Boolean(insight.evidence.messageId)
    && directEvidence.length > 0
    && sourceAt <= now + 5 * 60_000
    && sourceAt >= now - MAX_KNOWLEDGE_AGE_MS
    && cleanDisplayText(insight.content).length >= 18;
}

function contactStrength(
  insight: ContactInsight,
  directEvidence: MemoryEvidence[],
  summary: ChatSummary | undefined,
  chat: IntelligenceChat,
  now: number,
  isOwner: boolean,
): number {
  const lastInteractionAt = toMilliseconds(chat.lastInteraction?.timestamp || summary?.timestamp || 0);
  const age = Math.max(0, now - lastInteractionAt);
  let score = isOwner ? 18 : summary?.pinned ? 14 : 0;
  if (age <= 7 * DAY_MS) score += 4;
  else if (age <= CLOSE_CONTACT_WINDOW_MS) score += 2;
  if (insight.kind === "relationship_change") score += 4;
  if (insight.kind === "preference") score += 2;
  score += Math.min(3, evidenceCount(directEvidence) - 1);
  return score;
}

function discoveryTitle(insight: ContactInsight, fallback: string, contactName: string, isOwner: boolean, ownerName?: string): string {
  const allowFirstName = isOwner || insightUnambiguouslyMentionsOwner(insight, ownerName);
  const aiTitle = cleanDisplayText(insight.discoveryTitle || "").replace(/[.!?]+$/u, "");
  if (aiTitle.length >= 4) return ownerFacingCopy(aiTitle, ownerName, allowFirstName);
  const topic = cleanDisplayText(insight.topicTitle || "").replace(/[.!?]+$/u, "");
  if (topic && (insight.topicTitleConfidence || 0) >= .7) {
    const title = isOwner ? `A closer look at ${topic}` : `${contactName} on ${topic}`;
    return ownerFacingCopy(title, ownerName, allowFirstName);
  }
  return ownerFacingCopy(fallback, ownerName, allowFirstName);
}

function discoverySummary(insight: ContactInsight, isOwner: boolean, ownerName?: string): string {
  // Older local knowledge has no generated card copy yet. Show its complete
  // canonical statement rather than hiding the ending behind an ellipsis.
  const summary = cleanDisplayText(insight.discoverySummary || insight.content);
  return ownerFacingCopy(summary, ownerName, isOwner || insightUnambiguouslyMentionsOwner(insight, ownerName));
}

function insightTheme(insight: ContactInsight, kind: ContactInsight["kind"] | "meaningful_change", contactName: string, isOwner: boolean, ownerName?: string): {
  icon: AssistantSuggestionIcon;
  title: string;
  preview: string;
} {
  const content = insight.content;
  const text = content.toLocaleLowerCase();
  const isCommunication = kind === "preference" || /emoji|prefer|communication|update|message|tone|talk|speak|language|interface/u.test(text);
  const isWork = /work|customer|sales|product|project|career|business|team|meeting/u.test(text);
  const isRelationship = kind === "relationship_change" || /family|miss|love|relationship|friend|parent|sibling|brother|sister/u.test(text);
  const subject = isOwner ? "you" : contactName;

  if (isCommunication) {
    return {
      icon: "communication",
      title: discoveryTitle(insight, isOwner ? "A current preference about how people reach you" : `${subject} shared a preference`, contactName, isOwner, ownerName),
      preview: discoverySummary(insight, isOwner, ownerName),
    };
  }
  if (isWork) {
    return {
      icon: "work",
      title: discoveryTitle(insight, isOwner ? "A current detail about work that matters to you" : `${subject} shared work context that could matter`, contactName, isOwner, ownerName),
      preview: discoverySummary(insight, isOwner, ownerName),
    };
  }
  if (isRelationship) {
    return {
      icon: "people",
      title: discoveryTitle(insight, isOwner ? "A current detail about a relationship close to you" : `A recent shift with ${subject}`, contactName, isOwner, ownerName),
      preview: discoverySummary(insight, isOwner, ownerName),
    };
  }
  return {
    icon: "connection",
    title: discoveryTitle(insight, isOwner ? "A current detail about you" : `A current detail from ${subject}`, contactName, isOwner, ownerName),
    preview: discoverySummary(insight, isOwner, ownerName),
  };
}

function insightQuestion(kind: ContactInsight["kind"] | "meaningful_change", contactName: string, isOwner: boolean): string {
  if (isOwner) return "What current, evidence-backed context should I keep in mind about myself?";
  if (kind === "relationship_change") return `What recent relationship context should I keep in mind about ${contactName}?`;
  return `What current context should I keep in mind about ${contactName}?`;
}

function sameIntent(left: AssistantSuggestionCard, right: AssistantSuggestionCard): boolean {
  if (left.suggestionContext.chatId === right.suggestionContext.chatId) return true;
  const leftSources = new Set(left.suggestionContext.sourceIds);
  return right.suggestionContext.sourceIds.some((id) => leftSources.has(id));
}

function proactiveCard(
  item: ProactiveIntelligenceItem,
  sourceInsight: ContactInsight,
  directEvidence: MemoryEvidence[],
  avatarUrl: string | undefined,
  now: number,
  owner?: AssistantSuggestionOwner,
): RankedSuggestion {
  const isOwner = isOwnerContact(item.contactName, owner);
  const theme = insightTheme(sourceInsight, "meaningful_change", item.contactName, isOwner, owner?.displayName);
  const sourceAt = latestEvidenceAt(directEvidence);
  return {
    id: item.id,
    contactName: isOwner ? "You" : item.contactName,
    avatarUrl: isOwner ? owner?.avatarUrl || avatarUrl : avatarUrl,
    title: theme.title,
    preview: theme.preview,
    detail: sourceCue(evidenceCount(directEvidence), sourceAt, now),
    question: insightQuestion("meaningful_change", item.contactName, isOwner),
    kind: "knowledge",
    icon: theme.icon,
    suggestionContext: {
      chatId: item.chatId,
      sourceIds: item.sourceIds,
      candidateId: item.id,
      fingerprint: item.fingerprint,
      kind: item.kind,
    },
    sourceAt,
    significance: 0,
  };
}

/**
 * Builds a small, precision-first relationship discovery pool. Every visible
 * card must be directly attributable to that person, current, confirmed, and
 * capable of answering its own question from exact source records. Closer
 * relationships rank first, but a specific, direct fact can still earn a
 * supporting row rather than being hidden or promoted to the hero by default.
 */
export function buildAssistantSuggestionCards(
  data: IntelligenceData | undefined,
  chats: ChatSummary[],
  now = Date.now(),
  owner?: AssistantSuggestionOwner,
): AssistantSuggestionCard[] {
  if (!data) return [];
  const chatsById = new Map(chats.map((chat) => [chat.id, chat]));
  const intelligenceById = new Map(data.chats.map((chat) => [chat.chatId, chat]));
  const proactiveKnowledge: RankedSuggestion[] = [];
  for (const item of data.proactive || []) {
    if (item.kind !== "meaningful_change" || !item.aiAssessment || item.aiAssessment.confidence < 85 || !item.sourceIds.length) continue;
    const chat = intelligenceById.get(item.chatId);
    if (!chat || chat.isGroup) continue;
    const sourceInsight = chat.insights.find((insight) => item.sourceIds.includes(insight.id));
    if (!sourceInsight) continue;
    const isOwner = isOwnerContact(chat.contactName, owner);
    const directEvidence = directEvidenceFor(sourceInsight, chat.contactName);
    if (
      !usefulKnowledge(sourceInsight, directEvidence, now)
      || latestEvidenceAt(directEvidence) < now - MAX_CHANGE_SUGGESTION_AGE_MS
    ) continue;
    const card = proactiveCard(item, sourceInsight, directEvidence, chatsById.get(item.chatId)?.avatarUrl, now, owner);
    card.significance = contactStrength(sourceInsight, directEvidence, chatsById.get(chat.chatId), chat, now, isOwner) + 5;
    proactiveKnowledge.push(card);
  }
  const proactiveSourceIds = new Set(proactiveKnowledge.flatMap((item) => item.suggestionContext.sourceIds));

  const confirmedKnowledge: RankedSuggestion[] = data.chats.flatMap((chat) => chat.isGroup ? [] : chat.insights
    .flatMap((insight) => {
      if (proactiveSourceIds.has(insight.id)) return [];
      const isOwner = isOwnerContact(chat.contactName, owner);
      const directEvidence = directEvidenceFor(insight, chat.contactName);
      if (
        !usefulKnowledge(insight, directEvidence, now)
      ) return [];
      const sourceAt = latestEvidenceAt(directEvidence);
      const theme = insightTheme(insight, insight.kind, chat.contactName, isOwner, owner?.displayName);
      return [{
        id: `knowledge:${chat.chatId}:${insight.id}`,
        contactName: isOwner ? "You" : chat.contactName,
        avatarUrl: isOwner ? owner?.avatarUrl || chatsById.get(chat.chatId)?.avatarUrl : chatsById.get(chat.chatId)?.avatarUrl,
        title: theme.title,
        preview: theme.preview,
        detail: sourceCue(evidenceCount(directEvidence), sourceAt, now),
        question: insightQuestion(insight.kind, chat.contactName, isOwner),
        kind: "knowledge" as const,
        icon: theme.icon,
        suggestionContext: { chatId: chat.chatId, sourceIds: [insight.id] },
        sourceAt,
        significance: contactStrength(insight, directEvidence, chatsById.get(chat.chatId), chat, now, isOwner),
      }];
    }));

  const accepted: RankedSuggestion[] = [];
  for (const item of [...proactiveKnowledge, ...confirmedKnowledge]
    .sort((left, right) => right.significance - left.significance || right.sourceAt - left.sourceAt)) {
    if (!accepted.some((existing) => sameIntent(existing, item))) accepted.push(item);
  }

  return accepted.slice(0, MAX_DISCOVERY_POOL).map(({ sourceAt: _sourceAt, significance: _significance, ...item }) => item);
}

/** Returns a deterministic, non-repeating window for the drawer’s gentle rotation. */
export function rotateAssistantSuggestions(
  suggestions: AssistantSuggestionCard[],
  cycle: number,
  visibleCount = ASSISTANT_DISCOVERY_VISIBLE_COUNT,
): AssistantSuggestionCard[] {
  if (suggestions.length <= visibleCount) return suggestions;
  const start = ((cycle % suggestions.length) + suggestions.length) % suggestions.length;
  return Array.from({ length: visibleCount }, (_, index) => suggestions[(start + index) % suggestions.length]!);
}
