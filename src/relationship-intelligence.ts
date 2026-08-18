import type {
  CalendarEvent,
  ContactInsight,
  ConversationMemoryEntry,
  IntelligenceSearchRecord,
  RelationshipCommitment,
  TodoTask,
} from "./amiros-state.js";
import { assessKnowledgeFreshness } from "./memory-maintenance.js";

const DAY_MS = 86_400_000;
const UPCOMING_WINDOW_MS = 90 * DAY_MS;
const RECONNECTION_GAP_MS = 42 * DAY_MS;

export type RelationshipBrief = {
  chatId: string;
  contactName: string;
  /** A compact, evidence-backed projection; it is never persisted as truth. */
  currentContext: string[];
  recentChanges: string[];
  recurringThemes: string[];
  attention: string[];
  upcoming: string[];
  interactionNote?: string;
  /** Governs which calendar context may accompany this relationship answer. */
  temporalFocus: "current" | "historical";
  focus: RelationshipQuestionFocus;
  adviceRequested: boolean;
  confidence: "supported" | "limited" | "insufficient";
  uncertainty?: string;
  /** IDs of the underlying canonical/action records, for answer citations. */
  sourceIds: string[];
};

export type RelationshipIntelligenceResult = {
  requested: boolean;
  briefs: RelationshipBrief[];
  /** A full name or explicit UI choice resolved to one stable direct chat. */
  resolvedChatId?: string;
  temporalFocus?: "current" | "historical";
  /** More than one exact person shares the requested first name. */
  disambiguation?: string[];
  /** Stable identities for a UI clarification step. */
  disambiguationCandidates?: Array<{ chatId: string; contactName: string }>;
};

export type RelationshipQuestionIntent = {
  temporalFocus: "current" | "historical";
  /** Preparation and current-context questions are a briefing, not coaching. */
  briefing: boolean;
  adviceRequested: boolean;
  focus: RelationshipQuestionFocus;
};

export type RelationshipQuestionFocus = "general" | "preparation" | "upcoming" | "unresolved" | "history";

export type RelationshipSource = {
  chatId: string;
  contactName?: string;
  isGroup: boolean;
  insights: ContactInsight[];
  commitments: RelationshipCommitment[];
  todos: TodoTask[];
  events: CalendarEvent[];
  needsReply: boolean;
  lastInteraction?: ConversationMemoryEntry;
};

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function aliases(name: string): string[] {
  const value = normalized(name);
  const first = value.split(" ")[0];
  return [...new Set([value, first].filter((item): item is string => Boolean(item && item.length >= 3)))];
}

function queryMentions(query: string, name: string): boolean {
  const value = ` ${normalized(query)} `;
  return aliases(name).some((alias) => value.includes(` ${alias} `));
}

function isSensitive(value: string): boolean {
  return /\b(?:health\w*|medical\w*|diagnos\w*|depress\w*|anxious\w*|therapy\w*|mental\w*|pregnan\w*|sexual\w*|gay|lesbian|religion\w*|jewish|muslim|christian|politic\w*|election\w*|debt\w*|salary|income|bankrupt\w*|abuse\w*|divorce\w*)\b|(?:בריאות|רפוא|דיכא|חרד|טיפול|הריון|מיני|דת|פוליט|חוב|שכר|גירוש)/iu.test(value);
}

function clean(value: string, max = 180): string {
  return value.replace(/\s+/gu, " ").trim().replace(/[.!?]+$/u, "").slice(0, max);
}

function sourceId(item: { id: string }): string { return item.id; }

function latestEvidenceAt(insight: ContactInsight): number {
  const values = [
    insight.updatedAt,
    insight.lastReinforcedAt || 0,
    insight.evidence.timestamp,
    ...(insight.evidenceHistory || []).map((evidence) => evidence.timestamp),
  ].map((value) => value > 0 && value < 10_000_000_000 ? value * 1_000 : value);
  return Math.max(...values);
}

function insightIsUsable(insight: ContactInsight, now: number): boolean {
  if (insight.status !== "confirmed") return false;
  if (insight.validity === "historical") return false;
  const freshness = assessKnowledgeFreshness(insight, now);
  return freshness.state !== "stale" && !freshness.qualify;
}

function formatDate(value: number): string {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function relationshipQuestionIntent(query: string): RelationshipQuestionIntent | undefined {
  const adviceRequested = /\b(?:what should i do about|how should i handle|should i|how do i approach)\b|(?:מה לעשות|איך להתמודד)/iu.test(query);
  const relationshipQuestion = adviceRequested || /\b(?:how(?:['’]s| is)\b|tell me about|what should i know about|what(?:['’]s| is) (?:been going on|important|changed)|what(?:['’]s| is) coming up|has anything changed|how has|what should i remember|before (?:seeing|meeting|talking)|anything (?:unresolved|to follow up)|what topics|keep coming up|what happened with|relationship|lately|recently|past (?:year|month|months)|not spoken|haven(?:['’])?t spoken|reconnect|follow[- ]?up)\b|(?:מה שלומ|ספר לי על|מה קורה|מה חשוב|מה השתנה|לפני שאני נפגש|לא דיברתי|ליצור קשר|לעקוב)/iu.test(query)
    || /\bwhat(?:['’]s| is) coming up\b/iu.test(query);
  if (!relationshipQuestion) return undefined;
  const historical = /\b(?:what happened|what did we|when did|last (?:time|meeting|saw)|previous(?:ly)?|formerly|history|historical|used to)\b|(?:מה קרה|מתי נפגש|בפעם האחרונה|היסטורי)/iu.test(query);
  const briefing = /\b(?:what should i remember|before (?:seeing|meeting|talking)|what(?:'s| is) (?:been going on|important)|has anything changed|anything (?:unresolved|to follow up)|what topics|keep coming up|lately|recently)\b|(?:מה חשוב|מה השתנה|לפני שאני נפגש|לעקוב)/iu.test(query);
  const focus: RelationshipQuestionFocus = historical
    ? "history"
    : /\b(?:what(?:['’]s| is) coming up|coming up)\b/iu.test(query)
      ? "upcoming"
      : /\b(?:unresolved|follow up)\b|(?:לעקוב)/iu.test(query)
        ? "unresolved"
        : /\b(?:what should i remember|before (?:seeing|meeting|talking))\b|(?:לפני שאני נפגש)/iu.test(query)
          ? "preparation"
          : "general";
  return { temporalFocus: historical ? "historical" : "current", briefing, adviceRequested, focus };
}

/**
 * Prevents general keyword retrieval from reintroducing a past calendar item
 * into a current relationship briefing. Historical questions deliberately keep
 * calendar history available.
 */
export function filterRelationshipRecordsForQuestion(
  records: IntelligenceSearchRecord[],
  relationship: RelationshipIntelligenceResult,
  now = Date.now(),
): IntelligenceSearchRecord[] {
  if (!relationship.requested || relationship.briefs.length === 0) return records;
  const allowedChatIds = new Set(relationship.briefs.map((brief) => brief.chatId));
  const allowedIds = new Set(relationship.briefs.flatMap((brief) => brief.sourceIds));
  // Relationship briefs already select the compact, current evidence that is
  // safe to synthesize. Do not let broad keyword retrieval add raw snippets
  // from the same chat, where an old or sensitive aside can overwhelm the
  // briefing. Historical questions keep only their explicitly selected history.
  return records.filter((record) =>
    allowedChatIds.has(record.chatId) &&
    allowedIds.has(record.id) &&
    (relationship.temporalFocus === "historical" || record.kind !== "calendar_event" || record.timestamp >= now),
  );
}

/**
 * A bounded, deterministic projection over canonical relationship evidence.
 * This is deliberately not stored: canonical memories and action records
 * remain the only durable truth, while Ask AmirOS supplies the prose.
 */
export function buildRelationshipIntelligence(
  query: string,
  sources: RelationshipSource[],
  now = Date.now(),
  selectedChatId?: string,
): RelationshipIntelligenceResult {
  const directSources = sources.filter((source) => !source.isGroup && Boolean(source.contactName));
  const normalizedQuery = ` ${normalized(query)} `;
  const exactNameMatches = directSources.filter((source) => {
    const fullName = normalized(source.contactName!);
    return fullName.includes(" ") && normalizedQuery.includes(` ${fullName} `);
  });
  const selectedSource = selectedChatId
    ? directSources.find((source) => source.chatId === selectedChatId)
    : undefined;
  // A full name is a stronger identity signal than a shared first-name alias.
  // A UI selection is stronger still because it carries the stable chat ID.
  const matched = selectedSource
    ? [selectedSource]
    : exactNameMatches.length
      ? exactNameMatches
      : directSources.filter((source) => queryMentions(query, source.contactName!));
  const intent = relationshipQuestionIntent(query);
  const names = new Map<string, RelationshipSource[]>();
  for (const source of matched) {
    const first = aliases(source.contactName!)[1] || aliases(source.contactName!)[0]!;
    const list = names.get(first) || [];
    list.push(source);
    names.set(first, list);
  }
  const ambiguous = [...names.values()].find((items) => items.length > 1);
  if (ambiguous) return {
    requested: Boolean(intent),
    briefs: [],
    temporalFocus: intent?.temporalFocus,
    disambiguation: ambiguous.map((item) => item.contactName!).sort((left, right) => left.localeCompare(right)),
    disambiguationCandidates: ambiguous
      .map((item) => ({ chatId: item.chatId, contactName: item.contactName! }))
      .sort((left, right) => left.contactName.localeCompare(right.contactName)),
  };

  // Identity resolution is intentionally broader than relationship synthesis.
  // Even an ordinary factual lookup must stop before retrieval when a first
  // name maps to more than one direct contact; otherwise group messages can
  // silently mix different people who share that name.
  if (!intent) return { requested: false, briefs: [], resolvedChatId: matched.length === 1 ? matched[0]?.chatId : undefined };

  const noNamedContact = matched.length === 0;
  const selected = noNamedContact && /(?:not spoken|haven'?t spoken|reconnect|לא דיברתי|ליצור קשר)/iu.test(query)
    ? directSources
      .filter((source) => source.lastInteraction && now - source.lastInteraction.timestamp >= RECONNECTION_GAP_MS)
      .sort((left, right) => (left.lastInteraction?.timestamp || 0) - (right.lastInteraction?.timestamp || 0))
      .slice(0, 3)
    : matched.slice(0, 3);

  const briefs = selected.map((source) => buildBrief(source, now, intent));
  return {
    requested: true,
    temporalFocus: intent.temporalFocus,
    briefs,
    resolvedChatId: selected.length === 1 ? selected[0]?.chatId : undefined,
  };
}

function buildBrief(source: RelationshipSource, now: number, intent: RelationshipQuestionIntent): RelationshipBrief {
  const contactName = source.contactName!;
  const usable = source.insights
    .filter((insight) => insightIsUsable(insight, now))
    .filter((insight) => !isSensitive(insight.content))
    .sort((left, right) => latestEvidenceAt(right) - latestEvidenceAt(left));
  const recentUsable = usable.filter((insight) => latestEvidenceAt(insight) >= now - 180 * DAY_MS);
  const contextualInsights = recentUsable.length ? recentUsable : usable;
  const currentInsights = (intent.focus === "upcoming" || intent.focus === "unresolved"
    ? []
    : intent.focus === "preparation"
      ? contextualInsights.filter((insight) => insight.kind === "relationship_change" || Boolean(insight.topicTitle)).slice(0, 2)
      : contextualInsights.slice(0, 3));
  const currentContext = currentInsights.map((insight) => clean(insight.content));
  const sourceIds = new Set(currentInsights.map(sourceId));
  const recentChanges = (intent.focus === "upcoming" || intent.focus === "unresolved" ? [] : contextualInsights)
    .filter((insight) => insight.evolution === "replace" || source.insights.some((older) => older.supersededById === insight.id))
    .slice(0, 2)
    .map((insight) => {
      sourceIds.add(insight.id);
      const prior = source.insights.find((older) => older.supersededById === insight.id);
      return prior ? `${clean(insight.content)} (previously: ${clean(prior.content, 120)})` : clean(insight.content);
    });

  const themeCounts = new Map<string, { count: number; insight: ContactInsight }>();
  for (const insight of usable) {
    const title = insight.topicTitle && (insight.topicTitleConfidence || 0) >= .8 && !isSensitive(insight.topicTitle)
      ? clean(insight.topicTitle, 90)
      : undefined;
    if (!title) continue;
    const key = normalized(title);
    const existing = themeCounts.get(key);
    themeCounts.set(key, { count: (existing?.count || 0) + Math.max(1, insight.reinforcementCount || 1), insight });
  }
  const recurringThemes = (intent.focus === "upcoming" || intent.focus === "unresolved" ? [] : [...themeCounts.values()])
    .filter((item) => item.count >= 2)
    .sort((left, right) => right.count - left.count)
    .slice(0, 3)
    .map((item) => {
      sourceIds.add(item.insight.id);
      return item.insight.topicTitle!;
    });

  const attention: string[] = [];
  for (const commitment of source.commitments.filter((item) => item.status === "open").slice(0, 2)) {
    sourceIds.add(commitment.id);
    attention.push(commitment.owner === "me"
      ? `You committed to ${clean(commitment.content)}`
      : `${contactName} may be following up on ${clean(commitment.content)}`);
  }
  for (const todo of source.todos.filter((item) => item.status === "open" || item.status === "inferred").slice(0, 2)) {
    sourceIds.add(todo.id);
    attention.push(`Open to-do: ${clean(todo.title)}`);
  }
  if (source.needsReply && source.lastInteraction && now - source.lastInteraction.timestamp < 14 * DAY_MS) {
    attention.push(`${contactName} may still be waiting for your reply`);
  }

  const upcoming = source.events
    .filter((event) => event.status !== "dismissed" && event.status !== "completed")
    .filter((event) => intent.temporalFocus === "historical"
      ? event.startAt <= now && event.startAt >= now - UPCOMING_WINDOW_MS
      : event.startAt >= now && event.startAt <= now + UPCOMING_WINDOW_MS)
    .sort((left, right) => left.startAt - right.startAt)
    .slice(0, 2)
    .map((event) => {
      sourceIds.add(event.id);
      return `${clean(event.title)} (${formatDate(event.startAt)})`;
    });
  const gapDays = source.lastInteraction ? Math.floor((now - source.lastInteraction.timestamp) / DAY_MS) : 0;
  const interactionNote = gapDays >= 1
    ? gapDays >= 42 ? `You have not had a saved interaction with ${contactName} in about ${gapDays} days.` : undefined
    : undefined;

  const confidence: RelationshipBrief["confidence"] = currentContext.length || attention.length || upcoming.length
    ? "supported"
    : source.insights.some((insight) => insight.status === "confirmed") ? "limited" : "insufficient";
  return {
    chatId: source.chatId,
    contactName,
    currentContext,
    recentChanges,
    recurringThemes,
    attention: attention.slice(0, 4),
    upcoming,
    interactionNote,
    temporalFocus: intent.temporalFocus,
    focus: intent.focus,
    adviceRequested: intent.adviceRequested,
    confidence,
    uncertainty: confidence === "limited"
      ? `There is only older, temporary, or limited information about ${contactName}, so no broader conclusion is reliable.`
      : confidence === "insufficient"
        ? `There is not enough dependable relationship context about ${contactName} yet.`
        : undefined,
    sourceIds: [...sourceIds].slice(0, 12),
  };
}
