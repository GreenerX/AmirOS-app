import {
  intelligenceCardDedupeKey,
  isTrustworthyIntelligenceCard,
  type CardEvidence,
} from "../shared/intelligence-card-eligibility.js";
import { assessKnowledgeFreshness } from "./memory-maintenance.js";
import type {
  CalendarEvent,
  ContactInsight,
  ConversationMemoryEntry,
  MemoryEvidence,
  RelationshipCommitment,
  TodoTask,
} from "./amiros-state.js";

const DAY_MS = 86_400_000;
const UPCOMING_WINDOW_MS = 14 * DAY_MS;
const FOLLOW_UP_WINDOW_MS = 7 * DAY_MS;
const RECENT_CHANGE_WINDOW_MS = 14 * DAY_MS;
const RECONNECT_MIN_INACTIVITY_MS = 30 * DAY_MS;
const RECONNECT_MAX_EVIDENCE_AGE_MS = 180 * DAY_MS;
const MAX_CANDIDATES = 30;

/** Stable lanes let every owner-facing surface use the same diverse pool. */
export type IntelligenceCandidateLane =
  | "upcoming_plan"
  | "reply_context"
  | "open_commitment"
  | "due_task"
  | "recent_change"
  | "relationship_memory"
  | "reconnect_memory";

export type CandidateEvidence = {
  messageId: string;
  chatId: string;
  conversationName?: string;
  authorName?: string;
  timestamp: number;
  originalText: string;
  exactMessageAvailable: true;
};

/**
 * A pre-validated Ask prompt. It is intentionally presentation-neutral: UI
 * surfaces can choose card copy later, but cannot change its evidence, scope,
 * or promise without revalidating it.
 */
export type IntelligenceCandidate = {
  id: string;
  lane: IntelligenceCandidateLane;
  chatId: string;
  contactName: string;
  title: string;
  preview: string;
  question: string;
  sourceIds: string[];
  evidence: CandidateEvidence[];
  evidenceIds: string[];
  timestamp: number;
  temporalFrame: "current" | "upcoming" | "open_follow_up" | "worth_remembering";
  dedupeKey: string;
};

export type IntelligenceCandidateSource = {
  chatId: string;
  contactName: string;
  isGroup: boolean;
  isOwner?: boolean;
  retainedMessageIds: readonly string[];
  insights: ContactInsight[];
  commitments: RelationshipCommitment[];
  events: CalendarEvent[];
  todos: TodoTask[];
  needsReply: boolean;
  lastIncoming?: ConversationMemoryEntry;
  lastInteraction?: ConversationMemoryEntry;
  /** Resolves a derived record back to the exact retained original message. */
  exactEvidenceFor: (evidence: MemoryEvidence) => CandidateEvidence | undefined;
};

function toMilliseconds(value: number): number {
  return value > 0 && value < 10_000_000_000 ? value * 1_000 : value;
}

function compact(value: string, max = 120): string {
  const cleaned = value.replace(/\s+/gu, " ").trim().replace(/[.!?]+$/u, "");
  if (cleaned.length <= max) return cleaned;
  const end = cleaned.slice(0, max + 1).lastIndexOf(" ");
  return `${cleaned.slice(0, end > max / 2 ? end : max).trimEnd()}…`;
}

function directEntryEvidence(source: IntelligenceCandidateSource, entry: ConversationMemoryEntry | undefined): CandidateEvidence | undefined {
  if (!entry?.messageId || !source.retainedMessageIds.includes(entry.messageId)) return undefined;
  return source.exactEvidenceFor({
    messageId: entry.messageId,
    excerpt: entry.content,
    senderName: entry.senderName,
    timestamp: entry.timestamp,
  });
}

function latestEvidenceAt(evidence: CandidateEvidence[]): number {
  return Math.max(...evidence.map((item) => toMilliseconds(item.timestamp)));
}

function evidenceFor(source: IntelligenceCandidateSource, record: { evidence: MemoryEvidence }): CandidateEvidence[] {
  const evidence = source.exactEvidenceFor(record.evidence);
  return evidence ? [evidence] : [];
}

function isEligible(
  source: IntelligenceCandidateSource,
  title: string,
  preview: string,
  sourceIds: string[],
  evidence: CandidateEvidence[],
  now: number,
  options: { currentClaim?: boolean; openFollowUp?: boolean; dueAt?: number } = {},
): boolean {
  return isTrustworthyIntelligenceCard({
    chatId: source.chatId,
    isGroup: source.isGroup,
    title,
    detail: preview,
    sourceIds,
    evidence: evidence satisfies CardEvidence[],
    retainedMessageIds: source.retainedMessageIds,
    now,
    ...options,
  });
}

function add(
  candidates: IntelligenceCandidate[],
  source: IntelligenceCandidateSource,
  input: Omit<IntelligenceCandidate, "dedupeKey" | "evidenceIds">,
): void {
  candidates.push({
    ...input,
    evidenceIds: input.evidence.map((item) => item.messageId),
    dedupeKey: intelligenceCardDedupeKey(source.chatId, input.title, input.sourceIds),
  });
}

function usableCurrentInsight(insight: ContactInsight, now: number): boolean {
  const freshness = assessKnowledgeFreshness(insight, now);
  return insight.status === "confirmed" && insight.validity !== "historical" && insight.validity !== "temporary"
    && insight.confidence >= .9 && freshness.state !== "stale" && !freshness.qualify;
}

function sourceAt(insight: ContactInsight): number {
  return Math.max(
    toMilliseconds(insight.evidence.timestamp),
    ...(insight.evidenceHistory || []).map((item) => toMilliseconds(item.timestamp)),
  );
}

function laneOrder(lane: IntelligenceCandidateLane): number {
  return ["upcoming_plan", "reply_context", "open_commitment", "due_task", "recent_change", "relationship_memory", "reconnect_memory"].indexOf(lane);
}

/**
 * Produces a broad, deterministic pool from existing local knowledge. It is
 * deliberately fail-closed: each candidate must carry one or more exact,
 * retained direct-chat messages and a question that can be anchored to its
 * source IDs by Ask.
 */
export function buildIntelligenceCandidatePool(
  sources: IntelligenceCandidateSource[],
  now = Date.now(),
): IntelligenceCandidate[] {
  const candidates: IntelligenceCandidate[] = [];
  for (const source of sources) {
    // Groups do not have a stable selected-person identity. A self chat is
    // useful owner context, but cannot become a selected-person card either.
    if (!source.chatId || !source.contactName || source.isGroup || source.isOwner) continue;

    for (const event of source.events) {
      const startAt = toMilliseconds(event.startAt);
      const evidence = evidenceFor(source, event);
      const title = `Upcoming: ${compact(event.title, 88)}`;
      const preview = `Confirmed plan with ${source.contactName}`;
      if (event.status !== "confirmed" || startAt < now || startAt > now + UPCOMING_WINDOW_MS
        || !isEligible(source, title, preview, [event.id], evidence, now, { dueAt: startAt })) continue;
      add(candidates, source, {
        id: `candidate:plan:${source.chatId}:${event.id}`,
        lane: "upcoming_plan", chatId: source.chatId, contactName: source.contactName,
        title, preview,
        question: `What is the confirmed plan for ${event.title} with ${source.contactName}?`,
        sourceIds: [event.id], evidence, timestamp: startAt, temporalFrame: "upcoming",
      });
    }

    if (source.needsReply && source.lastIncoming) {
      const evidence = directEntryEvidence(source, source.lastIncoming);
      const incomingAt = toMilliseconds(source.lastIncoming.timestamp);
      const title = `${source.contactName} is waiting for your reply`;
      const preview = compact(source.lastIncoming.content, 120);
      if (evidence && incomingAt >= now - FOLLOW_UP_WINDOW_MS && isEligible(
        source, title, preview, [source.lastIncoming.messageId || ""], [evidence], now, { openFollowUp: true },
      )) add(candidates, source, {
        id: `candidate:reply:${source.chatId}:${evidence.messageId}`,
        lane: "reply_context", chatId: source.chatId, contactName: source.contactName,
        title, preview,
        question: `What does ${source.contactName} need a reply about?`,
        sourceIds: [evidence.messageId], evidence: [evidence], timestamp: incomingAt, temporalFrame: "open_follow_up",
      });
    }

    for (const commitment of source.commitments) {
      const dueAt = commitment.dueAt === undefined ? undefined : toMilliseconds(commitment.dueAt);
      const evidence = evidenceFor(source, commitment);
      const evidenceAt = latestEvidenceAt(evidence);
      const timely = dueAt !== undefined ? dueAt <= now + FOLLOW_UP_WINDOW_MS : evidenceAt >= now - FOLLOW_UP_WINDOW_MS;
      const title = compact(commitment.content, 100);
      const preview = dueAt === undefined ? `Your recent commitment to ${source.contactName}` : `Your commitment to ${source.contactName} has a due time`;
      if (commitment.owner !== "me" || commitment.status !== "open" || !timely
        || !isEligible(source, title, preview, [commitment.id], evidence, now, { openFollowUp: true, dueAt })) continue;
      add(candidates, source, {
        id: `candidate:commitment:${source.chatId}:${commitment.id}`,
        lane: "open_commitment", chatId: source.chatId, contactName: source.contactName,
        title, preview,
        question: `What did I commit to ${source.contactName}?`,
        sourceIds: [commitment.id], evidence, timestamp: dueAt || evidenceAt, temporalFrame: "open_follow_up",
      });
    }

    for (const todo of source.todos) {
      const dueAt = todo.dueAt === undefined ? undefined : toMilliseconds(todo.dueAt);
      const evidence = evidenceFor(source, todo);
      const title = compact(todo.title, 100);
      const preview = `Task connected to ${source.contactName}`;
      if (todo.status !== "open" || dueAt === undefined || dueAt > now + FOLLOW_UP_WINDOW_MS
        || !isEligible(source, title, preview, [todo.id], evidence, now, { dueAt })) continue;
      add(candidates, source, {
        id: `candidate:todo:${source.chatId}:${todo.id}`,
        lane: "due_task", chatId: source.chatId, contactName: source.contactName,
        title, preview,
        question: `What is the task I saved in connection with ${source.contactName}?`,
        sourceIds: [todo.id], evidence, timestamp: dueAt, temporalFrame: "open_follow_up",
      });
    }

    for (const insight of source.insights) {
      const evidence = evidenceFor(source, insight);
      const timestamp = sourceAt(insight);
      if (!usableCurrentInsight(insight, now)) continue;
      const title = compact(insight.discoveryTitle || insight.topicTitle || insight.content, 100);
      const preview = compact(insight.discoverySummary || insight.content, 140);
      const recentChange = (insight.kind === "relationship_change" || insight.evolution === "replace")
        && timestamp >= now - RECENT_CHANGE_WINDOW_MS;
      if (recentChange && isEligible(source, title, preview, [insight.id], evidence, now, { currentClaim: true })) {
        add(candidates, source, {
          id: `candidate:change:${source.chatId}:${insight.id}`,
          lane: "recent_change", chatId: source.chatId, contactName: source.contactName,
          title, preview,
          question: `What recently changed with ${source.contactName}?`,
          sourceIds: [insight.id], evidence, timestamp, temporalFrame: "current",
        });
      } else if (isEligible(source, title, preview, [insight.id], evidence, now, { currentClaim: true })) {
        add(candidates, source, {
          id: `candidate:memory:${source.chatId}:${insight.id}`,
          lane: "relationship_memory", chatId: source.chatId, contactName: source.contactName,
          title, preview,
          question: `What is the important current context from ${source.contactName}?`,
          sourceIds: [insight.id], evidence, timestamp, temporalFrame: "current",
        });
      }
    }

    const lastInteractionAt = source.lastInteraction ? toMilliseconds(source.lastInteraction.timestamp) : 0;
    if (lastInteractionAt > 0 && now - lastInteractionAt >= RECONNECT_MIN_INACTIVITY_MS) {
      for (const insight of source.insights) {
        const evidence = evidenceFor(source, insight);
        const timestamp = sourceAt(insight);
        const freshness = assessKnowledgeFreshness(insight, now);
        const title = `Worth remembering before reconnecting with ${source.contactName}`;
        const preview = compact(insight.discoverySummary || insight.content, 140);
        if (insight.status !== "confirmed" || insight.validity === "historical" || insight.validity === "temporary"
          || insight.confidence < .9 || freshness.state === "stale" || freshness.qualify
          || timestamp < now - RECONNECT_MAX_EVIDENCE_AGE_MS
          || !isEligible(source, title, preview, [insight.id], evidence, now)) continue;
        if (candidates.some((candidate) => candidate.chatId === source.chatId && candidate.sourceIds.includes(insight.id))) continue;
        add(candidates, source, {
          id: `candidate:reconnect:${source.chatId}:${insight.id}`,
          lane: "reconnect_memory", chatId: source.chatId, contactName: source.contactName,
          title, preview,
          question: `What should I remember before reconnecting with ${source.contactName}?`,
          sourceIds: [insight.id], evidence, timestamp, temporalFrame: "worth_remembering",
        });
        break;
      }
    }
  }

  const grouped = new Map<IntelligenceCandidateLane, IntelligenceCandidate[]>();
  for (const candidate of candidates) {
    const values = grouped.get(candidate.lane) || [];
    if (!values.some((item) => item.dedupeKey === candidate.dedupeKey)) values.push(candidate);
    grouped.set(candidate.lane, values);
  }
  for (const values of grouped.values()) values.sort((left, right) => right.timestamp - left.timestamp || left.title.localeCompare(right.title));

  const selected: IntelligenceCandidate[] = [];
  const cursors = new Map<IntelligenceCandidateLane, number>();
  const diversityQuota = Math.min(7, new Set(candidates.map((candidate) => candidate.chatId)).size);
  let advanced = true;
  while (selected.length < MAX_CANDIDATES && advanced) {
    advanced = false;
    for (const lane of [...grouped.keys()].sort((left, right) => laneOrder(left) - laneOrder(right))) {
      const values = grouped.get(lane)!;
      const index = cursors.get(lane) || 0;
      const candidate = values[index];
      if (!candidate) continue;
      cursors.set(lane, index + 1);
      advanced = true;
      if (selected.some((item) => item.dedupeKey === candidate.dedupeKey)) continue;
      // First make the pool broad across people; only then allow a second
      // independently grounded card from the same direct conversation.
      if (selected.length < diversityQuota && selected.some((item) => item.chatId === candidate.chatId)) continue;
      selected.push(candidate);
      if (selected.length === MAX_CANDIDATES) break;
    }
  }
  return selected;
}
