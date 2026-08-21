import type {
  AssistantSuggestionContext, ChatSummary, ContactInsight, IntelligenceChat, IntelligenceData, MemoryEvidence,
  ProactiveIntelligenceItem, IntelligenceCandidate,
} from "./types";
import { intelligenceCardDedupeKey, isTrustworthyIntelligenceCard } from "../../shared/intelligence-card-eligibility";

const DAY_MS = 86_400_000;
/** Discovery is intentionally stricter than on-demand memory retrieval. */
const MAX_KNOWLEDGE_AGE_MS = 14 * DAY_MS;
const MAX_CHANGE_SUGGESTION_AGE_MS = 14 * DAY_MS;
const CLOSE_CONTACT_WINDOW_MS = 21 * DAY_MS;
/** A reconnect card is useful only when its remembered context is still credible. */
const RECONNECT_MIN_INACTIVITY_MS = 30 * DAY_MS;
const RECONNECT_MAX_EVIDENCE_AGE_MS = 180 * DAY_MS;

/** The open drawer shows one hero plus three supporting discoveries. */
export const ASSISTANT_DISCOVERY_VISIBLE_COUNT = 4;
/** Keep an open Ask drawer fresh without making its hero feel restless. */
export const ASSISTANT_DISCOVERY_OPEN_ROTATION_MS = 60_000;
/** Advance the next reveal quietly while Ask is tucked away. */
export const ASSISTANT_DISCOVERY_CLOSED_ROTATION_MS = 5 * 60_000;
const MAX_DISCOVERY_POOL = 12;

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
  /** Stable candidate identity used to prevent a rotating window from repeating a theme. */
  dedupeKey?: string;
};

export type AssistantSuggestionOwner = {
  displayName?: string;
  avatarUrl?: string;
};

type RankedSuggestion = AssistantSuggestionCard & {
  sourceAt: number;
  significance: number;
  lane: "fresh" | "reconnect";
  candidateLane?: IntelligenceCandidate["lane"];
  /** Internal identity that prevents one relationship fact claiming two slots. */
  dedupeKey: string;
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

function insightTextMentionsOwner(value: string, ownerName: string | undefined): boolean {
  const fullName = cleanDisplayText(ownerName || "");
  return Boolean(fullName && new RegExp(`\\b${escapePattern(fullName)}\\b`, "iu").test(cleanDisplayText(value)));
}

function firstName(value: string): string {
  return cleanDisplayText(value).split(/\s+/u)[0] || cleanDisplayText(value);
}

/** The drawer is personal: use first names for the people explicitly named by the insight. */
function personalCardCopy(value: string, contactName: string, isOwner: boolean, ownerName?: string, subjectNames: string[] = []): string {
  let copy = ownerFacingCopy(value, ownerName, isOwner || insightTextMentionsOwner(value, ownerName));
  const owner = normalizedName(ownerName);
  const names = [...new Set([contactName, ...subjectNames].map(cleanDisplayText).filter(Boolean))]
    .filter((name) => normalizedName(name) !== owner)
    .sort((left, right) => right.length - left.length);
  for (const fullName of names) {
    const shortName = firstName(fullName);
    if (fullName === shortName) continue;
    const escaped = escapePattern(fullName);
    copy = copy.replace(new RegExp(`\\b${escaped}(?:['’]s)`, "giu"), `${shortName}'s`);
    copy = copy.replace(new RegExp(`\\b${escaped}\\b`, "giu"), shortName);
  }
  return copy;
}

function insightUnambiguouslyMentionsOwner(insight: ContactInsight, ownerName: string | undefined): boolean {
  const fullName = cleanDisplayText(ownerName || "");
  if (!fullName) return false;
  const source = cleanDisplayText(`${insight.discoverySummary || ""} ${insight.content}`);
  return insightTextMentionsOwner(source, ownerName);
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

function directEvidenceFor(insight: ContactInsight, contactName: string, retainedMessageIds: readonly string[] | undefined): MemoryEvidence[] {
  const retained = new Set(retainedMessageIds || []);
  return [insight.evidence, ...(insight.evidenceHistory || [])]
    .filter((evidence) => evidenceBelongsToContact(evidence, contactName) && Boolean(evidence.messageId && retained.has(evidence.messageId)))
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
  const text = cleanDisplayText(`${insight.content} ${insight.discoverySummary || ""}`).toLocaleLowerCase();
  const transientOrAmbiguous = /\b(?:at the beach|heading home|on (?:my|the) way|waiting for people to wake|sync(?:ing)? (?:issue|error|problem)|contacts? (?:disappeared|disappearing|returned|returning)|technical (?:issue|problem)|microdose|maybe|might|could|possibly)\b/iu.test(text);
  const clearPreference = insight.kind === "preference" && /\b(?:prefer(?:s|red)?|would rather|please|don't|do not|avoid|want(?:s|ed)?|like(?:s|d)?)\b/iu.test(text);
  const clearHighSalienceUpdate = /\b(?:asked|invited|confirmed|scheduled|meeting|dinner|birthday|considering|will\s+(?:be|need|meet|call)|wants?\s+to|needs?\s+to)\b/iu.test(text);
  const independentlyReinforced = evidenceCount(directEvidence) >= 2;
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
    && cleanDisplayText(insight.content).length >= 18
    // A one-message technical status or ambiguous aside is not a discovery.
    // One direct preference can be useful; other facts need reinforcement.
    && !transientOrAmbiguous
    && (independentlyReinforced || clearPreference || clearHighSalienceUpdate);
}

function usefulReconnectKnowledge(insight: ContactInsight, directEvidence: MemoryEvidence[], lastInteractionAt: number, now: number): boolean {
  const sourceAt = latestEvidenceAt(directEvidence);
  const text = cleanDisplayText(`${insight.content} ${insight.discoverySummary || ""}`).toLocaleLowerCase();
  const transientOrAmbiguous = /\b(?:at the beach|heading home|on (?:my|the) way|waiting for people to wake|sync(?:ing)? (?:issue|error|problem)|contacts? (?:disappeared|disappearing|returned|returning)|technical (?:issue|problem)|microdose|maybe|might|could|possibly)\b/iu.test(text);
  const clearPreference = insight.kind === "preference" && /\b(?:prefer(?:s|red)?|would rather|please|don't|do not|avoid|want(?:s|ed)?|like(?:s|d)?)\b/iu.test(text);
  const independentlyReinforced = evidenceCount(directEvidence) >= 2;
  const inactiveFor = now - lastInteractionAt;
  return insight.kind !== "important_date"
    && insight.status === "confirmed"
    && insight.validity !== "historical"
    && insight.validity !== "temporary"
    && insight.confidence >= .9
    && !["stale", "historical", "uncertain"].includes(insight.freshness || "")
    && Boolean(insight.evidence.messageId)
    && directEvidence.length > 0
    && Number.isFinite(lastInteractionAt)
    && inactiveFor >= RECONNECT_MIN_INACTIVITY_MS
    && sourceAt >= now - RECONNECT_MAX_EVIDENCE_AGE_MS
    && sourceAt <= now + 5 * 60_000
    && cleanDisplayText(insight.content).length >= 18
    && !transientOrAmbiguous
    && (independentlyReinforced || clearPreference);
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
  // A discovery must ask only for the fact it promises. Broad “current
  // context” questions encouraged the answer model to assemble unrelated
  // history into a misleading briefing.
  if (isOwner) return "What did I recently share that AmirOS should remember?";
  if (kind === "preference") return `What preference did ${contactName} share recently?`;
  if (kind === "relationship_change") return `What changed in my relationship context with ${contactName}?`;
  return `What is the important recent update from ${contactName}?`;
}

function sameIntent(left: AssistantSuggestionCard, right: AssistantSuggestionCard): boolean {
  const leftRanked = left as RankedSuggestion;
  const rightRanked = right as RankedSuggestion;
  if (leftRanked.dedupeKey && leftRanked.dedupeKey === rightRanked.dedupeKey) return true;
  if (left.suggestionContext.chatId === right.suggestionContext.chatId) return true;
  const leftSources = new Set(left.suggestionContext.sourceIds);
  return right.suggestionContext.sourceIds.some((id) => leftSources.has(id));
}

function relationshipFactKey(insight: ContactInsight, chatId: string): string {
  if (insight.clusterId) return `cluster:${insight.clusterId}`;
  if (insight.canonicalKey) return `canonical:${insight.kind}:${insight.canonicalKey}`;
  if (insight.evidence.messageId) return `evidence:${insight.evidence.messageId}`;
  return intelligenceCardDedupeKey(chatId, insight.topicTitle || insight.content, [insight.id]);
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
    contactName: isOwner ? "You" : firstName(item.contactName),
    avatarUrl: isOwner ? owner?.avatarUrl || avatarUrl : avatarUrl,
    title: personalCardCopy(theme.title, item.contactName, isOwner, owner?.displayName, sourceInsight.subjectNames),
    preview: personalCardCopy(theme.preview, item.contactName, isOwner, owner?.displayName, sourceInsight.subjectNames),
    detail: sourceCue(evidenceCount(directEvidence), sourceAt, now),
    question: insightQuestion(sourceInsight.kind, item.contactName, isOwner),
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
    lane: "fresh",
    dedupeKey: relationshipFactKey(sourceInsight, item.chatId),
  };
}

function reconnectDetail(lastInteractionAt: number, directEvidenceCount: number, now: number): string {
  const days = Math.max(1, Math.floor((now - lastInteractionAt) / DAY_MS));
  const lastSpoke = days < 45 ? `${days} days ago` : new Date(lastInteractionAt).toLocaleDateString([], { month: "short", day: "numeric" });
  return `Last spoke ${lastSpoke} · ${directEvidenceCount} saved direct ${directEvidenceCount === 1 ? "message" : "messages"}`;
}

function reconnectCard(
  insight: ContactInsight,
  chat: IntelligenceChat,
  summary: ChatSummary | undefined,
  directEvidence: MemoryEvidence[],
  now: number,
  owner?: AssistantSuggestionOwner,
): RankedSuggestion {
  const isOwner = isOwnerContact(chat.contactName, owner);
  const theme = insightTheme(insight, insight.kind, chat.contactName, isOwner, owner?.displayName);
  const lastInteractionAt = toMilliseconds(chat.lastInteraction?.timestamp || summary?.timestamp || 0);
  const person = isOwner ? "yourself" : firstName(chat.contactName);
  return {
    id: `reconnect:${chat.chatId}:${insight.id}`,
    contactName: isOwner ? "You" : firstName(chat.contactName),
    avatarUrl: isOwner ? owner?.avatarUrl || summary?.avatarUrl : summary?.avatarUrl,
    title: isOwner ? "A useful thing to remember about yourself" : `Before you reconnect with ${person}`,
    preview: personalCardCopy(theme.preview, chat.contactName, isOwner, owner?.displayName, insight.subjectNames),
    detail: reconnectDetail(lastInteractionAt, evidenceCount(directEvidence), now),
    question: isOwner
      ? "What should I remember about myself from our earlier conversations?"
      : `What should I remember before reconnecting with ${person}?`,
    kind: "knowledge",
    icon: theme.icon,
    suggestionContext: { chatId: chat.chatId, sourceIds: [insight.id] },
    sourceAt: latestEvidenceAt(directEvidence),
    significance: contactStrength(insight, directEvidence, summary, chat, now, isOwner),
    lane: "reconnect",
    dedupeKey: relationshipFactKey(insight, chat.chatId),
  };
}

function interleaveDiscoveryLanes(fresh: RankedSuggestion[], reconnect: RankedSuggestion[]): RankedSuggestion[] {
  const accepted: RankedSuggestion[] = [];
  const add = (candidate: RankedSuggestion | undefined) => {
    if (candidate && !accepted.some((existing) => sameIntent(existing, candidate))) accepted.push(candidate);
  };
  let freshIndex = 0;
  let reconnectIndex = 0;
  // Lead with the strongest recent discoveries. Then reserve every third slot
  // for a durable memory about someone the owner has not spoken with lately.
  while (accepted.length < MAX_DISCOVERY_POOL && (freshIndex < fresh.length || reconnectIndex < reconnect.length)) {
    add(fresh[freshIndex++]);
    add(fresh[freshIndex++]);
    add(reconnect[reconnectIndex++]);
  }
  return accepted;
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
    const directEvidence = directEvidenceFor(sourceInsight, chat.contactName, chat.retainedMessageIds);
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
      const directEvidence = directEvidenceFor(insight, chat.contactName, chat.retainedMessageIds);
      if (
        !usefulKnowledge(insight, directEvidence, now)
        || !isTrustworthyIntelligenceCard({
          chatId: chat.chatId,
          isGroup: chat.isGroup,
          title: insight.discoveryTitle || insight.topicTitle || insight.content,
          detail: insight.discoverySummary || insight.content,
          sourceIds: [insight.id],
          evidence: directEvidence,
          retainedMessageIds: chat.retainedMessageIds,
          currentClaim: true,
          now,
        })
      ) return [];
      const sourceAt = latestEvidenceAt(directEvidence);
      const theme = insightTheme(insight, insight.kind, chat.contactName, isOwner, owner?.displayName);
      return [{
        id: `knowledge:${chat.chatId}:${insight.id}`,
        contactName: isOwner ? "You" : firstName(chat.contactName),
        avatarUrl: isOwner ? owner?.avatarUrl || chatsById.get(chat.chatId)?.avatarUrl : chatsById.get(chat.chatId)?.avatarUrl,
        title: personalCardCopy(theme.title, chat.contactName, isOwner, owner?.displayName, insight.subjectNames),
        preview: personalCardCopy(theme.preview, chat.contactName, isOwner, owner?.displayName, insight.subjectNames),
        detail: sourceCue(evidenceCount(directEvidence), sourceAt, now),
        question: insightQuestion(insight.kind, chat.contactName, isOwner),
        kind: "knowledge" as const,
        icon: theme.icon,
        suggestionContext: { chatId: chat.chatId, sourceIds: [insight.id] },
        sourceAt,
        significance: contactStrength(insight, directEvidence, chatsById.get(chat.chatId), chat, now, isOwner),
        lane: "fresh" as const,
        dedupeKey: relationshipFactKey(insight, chat.chatId),
      }];
    }));

  const fresh = [...proactiveKnowledge, ...confirmedKnowledge]
    .sort((left, right) => right.significance - left.significance || right.sourceAt - left.sourceAt);
  const freshChatIds = new Set(fresh.map((item) => item.suggestionContext.chatId));
  const reconnect = data.chats.flatMap((chat) => chat.isGroup || freshChatIds.has(chat.chatId) ? [] : chat.insights.flatMap((insight) => {
    const summary = chatsById.get(chat.chatId);
    const lastInteractionAt = toMilliseconds(chat.lastInteraction?.timestamp || summary?.timestamp || 0);
    const directEvidence = directEvidenceFor(insight, chat.contactName, chat.retainedMessageIds);
    return usefulReconnectKnowledge(insight, directEvidence, lastInteractionAt, now)
      ? [reconnectCard(insight, chat, summary, directEvidence, now, owner)]
      : [];
  })).sort((left, right) => right.significance - left.significance || right.sourceAt - left.sourceAt);

  return interleaveDiscoveryLanes(fresh, reconnect)
    .map(({ sourceAt: _sourceAt, significance: _significance, lane: _lane, dedupeKey: _dedupeKey, ...item }) => item);
}

const CANDIDATE_LANE_ORDER: IntelligenceCandidate["lane"][] = [
  "upcoming_plan", "reply_context", "open_commitment", "due_task", "recent_change", "relationship_memory", "reconnect_memory",
];

function candidateIcon(lane: IntelligenceCandidate["lane"]): AssistantSuggestionIcon {
  if (lane === "reply_context") return "communication";
  if (lane === "upcoming_plan") return "work";
  if (lane === "recent_change" || lane === "reconnect_memory") return "people";
  return "connection";
}

function candidateSignificance(lane: IntelligenceCandidate["lane"]): number {
  return CANDIDATE_LANE_ORDER.indexOf(lane);
}

function exactCandidateEvidence(candidate: IntelligenceCandidate): IntelligenceCandidate["evidence"] {
  const expectedIds = new Set(candidate.evidenceIds);
  if (!candidate.chatId || !candidate.sourceIds.length || !expectedIds.size) return [];
  const evidence = candidate.evidence.filter((item) =>
    item.exactMessageAvailable === true && item.chatId === candidate.chatId && Boolean(item.messageId && item.originalText.trim()) && expectedIds.has(item.messageId),
  );
  return evidence.length === expectedIds.size ? evidence : [];
}

function diversifyCandidateSuggestions(candidates: RankedSuggestion[]): RankedSuggestion[] {
  const lanes = new Map(CANDIDATE_LANE_ORDER.map((lane) => [lane, [] as RankedSuggestion[]]));
  for (const candidate of candidates) {
    if (candidate.candidateLane) lanes.get(candidate.candidateLane)?.push(candidate);
  }
  for (const values of lanes.values()) values.sort((left, right) => left.sourceAt - right.sourceAt || left.title.localeCompare(right.title));
  const result: RankedSuggestion[] = [];
  const seenKeys = new Set<string>();
  const distinctChats = new Set(candidates.map((candidate) => candidate.suggestionContext.chatId));
  const diversityQuota = Math.min(6, distinctChats.size);
  let advanced = true;
  while (result.length < MAX_DISCOVERY_POOL && advanced) {
    advanced = false;
    for (const lane of CANDIDATE_LANE_ORDER) {
      const candidate = lanes.get(lane)?.shift();
      if (!candidate) continue;
      advanced = true;
      const chatId = candidate.suggestionContext.chatId;
      if (seenKeys.has(candidate.dedupeKey)) continue;
      if (result.length < diversityQuota && result.some((item) => item.suggestionContext.chatId === chatId)) continue;
      seenKeys.add(candidate.dedupeKey);
      result.push(candidate);
      if (result.length === MAX_DISCOVERY_POOL) break;
    }
  }
  return result;
}

/**
 * Converts only API-verified candidate-pool records into Ask cards. The old
 * relationship projection remains below as a compatibility reference, but is
 * deliberately not a rendering source: this prevents unlinked summaries or
 * display-name matching from becoming a rotating Ask card.
 */
function buildCandidateAssistantSuggestionCards(
  data: IntelligenceData | undefined,
  chats: ChatSummary[],
  now = Date.now(),
  _owner?: AssistantSuggestionOwner,
): AssistantSuggestionCard[] {
  if (!data?.intelligenceCandidates?.length) return [];
  const chatsById = new Map(chats.filter((chat) => !chat.isGroup).map((chat) => [chat.id, chat]));
  const candidates = data.intelligenceCandidates.flatMap((candidate) => {
    const evidence = exactCandidateEvidence(candidate);
    const chat = chatsById.get(candidate.chatId);
    if (!evidence.length || !chat) return [];
    const sourceAt = Math.max(...evidence.map((item) => toMilliseconds(item.timestamp)));
    const contactName = firstName(candidate.contactName);
    return [{
      id: candidate.id,
      contactName,
      avatarUrl: chat.avatarUrl,
      title: cleanDisplayText(candidate.title),
      preview: cleanDisplayText(candidate.preview),
      detail: sourceCue(evidence.length, sourceAt, now),
      question: candidate.question,
      kind: "knowledge" as const,
      icon: candidateIcon(candidate.lane),
      suggestionContext: { chatId: candidate.chatId, sourceIds: [...candidate.sourceIds] },
      dedupeKey: candidate.dedupeKey,
      sourceAt,
      significance: candidateSignificance(candidate.lane),
      lane: candidate.lane === "reconnect_memory" ? "reconnect" as const : "fresh" as const,
      candidateLane: candidate.lane,
    } satisfies RankedSuggestion];
  });
  return diversifyCandidateSuggestions(candidates)
    .map(({ sourceAt: _sourceAt, significance: _significance, lane: _lane, candidateLane: _candidateLane, ...card }) => card);
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
