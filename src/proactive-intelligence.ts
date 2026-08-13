import { createHash } from "node:crypto";
import type {
  CalendarEvent,
  ContactInsight,
  ConversationMemoryEntry,
  RelationshipCommitment,
  TodoTask,
} from "./amiros-state.js";
import { assessKnowledgeFreshness } from "./memory-maintenance.js";
import type { ReplyAssessment } from "./reply-needed.js";

const DAY_MS = 86_400_000;
const UPCOMING_CONTEXT_WINDOW_MS = 36 * 60 * 60_000;
const CHANGE_WINDOW_MS = 14 * DAY_MS;
const FOLLOW_UP_WINDOW_MS = 7 * DAY_MS;

export type ProactiveCandidateKind = "upcoming_context" | "commitment" | "todo" | "reply" | "meaningful_change";
export type ProactiveCandidateAction = "chat" | "calendar" | "todo";

export type ProactiveCandidate = {
  id: string;
  fingerprint: string;
  kind: ProactiveCandidateKind;
  priority: number;
  title: string;
  detail: string;
  why: string;
  chatId: string;
  contactName: string;
  sourceIds: string[];
  messageId?: string;
  action: ProactiveCandidateAction;
  timestamp: number;
  aiAssessment?: {
    confidence: number;
    reason: string;
  };
};

export type ProactiveSource = {
  chatId: string;
  contactName: string;
  isGroup: boolean;
  isOwner?: boolean;
  insights: ContactInsight[];
  commitments: RelationshipCommitment[];
  events: CalendarEvent[];
  todos: TodoTask[];
  needsReply: boolean;
  replyAssessment?: ReplyAssessment;
  lastIncoming?: ConversationMemoryEntry;
  lastInteraction?: ConversationMemoryEntry;
};

export type ProactiveDeliveryDecision = {
  candidateId: string;
  fingerprint: string;
  status: "opened" | "dismissed" | "resolved";
  updatedAt: number;
  kind?: ProactiveCandidateKind;
  chatId?: string;
};

export type ProactiveAiJudgment = {
  candidateId: string;
  show: boolean;
  usefulness: number;
  confidence: number;
  title: string;
  detail: string;
  why: string;
  reason: string;
  mergeWithIds: string[];
};

export type ProactiveAiJudgmentBatch = {
  key: string;
  policyVersion: string;
  judgedAt: number;
  judgments: ProactiveAiJudgment[];
};

export const PROACTIVE_AI_POLICY_VERSION = "proactive-judgment-v2";

export type ProactiveCandidateOptions = {
  /** Defaults to off: normal dashboard refreshes should not create relationship anxiety. */
  interactionGap?: {
    enabled: boolean;
    baselineIntervalMs: number;
    sampleSize: number;
  };
};

function toMilliseconds(value: number): number {
  return value > 0 && value < 10_000_000_000 ? value * 1_000 : value;
}

function compact(value: string, max = 170): string {
  const normalized = value.replace(/\s+/gu, " ").trim().replace(/[.!?]+$/u, "");
  if (normalized.length <= max) return normalized;
  const cut = normalized.slice(0, max + 1);
  const boundary = cut.lastIndexOf(" ");
  return `${cut.slice(0, boundary > max / 2 ? boundary : max).trimEnd()}…`;
}

/** Proactive surfacing has a deliberately higher privacy bar than on-demand retrieval. */
export function isSensitiveProactiveContent(value: string): boolean {
  return /\b(?:health\w*|medical\w*|diagnos\w*|depress\w*|anxious\w*|therapy\w*|mental\w*|pregnan\w*|sexual\w*|gay|lesbian|religion\w*|jewish|muslim|christian|politic\w*|election\w*|debt\w*|salary|income|bankrupt\w*|abuse\w*|divorce\w*|conflict\w*|fight\w*)\b|(?:בריאות|רפוא|דיכא|חרד|טיפול|הריון|מיני|דת|פוליט|חוב|שכר|גירוש|ריב)/iu.test(value);
}

function evidenceTimestamp(insight: ContactInsight): number {
  return Math.max(
    toMilliseconds(insight.updatedAt),
    toMilliseconds(insight.lastReinforcedAt || 0),
    toMilliseconds(insight.evidence.timestamp),
    ...(insight.evidenceHistory || []).map((item) => toMilliseconds(item.timestamp)),
  );
}

function usableInsight(insight: ContactInsight, now: number): boolean {
  if (insight.status !== "confirmed" || insight.validity === "historical" || insight.confidence < .9) return false;
  if (isSensitiveProactiveContent(`${insight.topicTitle || ""} ${insight.content}`)) return false;
  const freshness = assessKnowledgeFreshness(insight, now);
  return freshness.state !== "stale" && !freshness.qualify;
}

function stableFingerprint(kind: ProactiveCandidateKind, sourceIds: string[], values: Array<string | number | undefined>): string {
  return createHash("sha256")
    .update(JSON.stringify([kind, [...sourceIds].sort(), ...values]))
    .digest("hex")
    .slice(0, 24);
}

function addCandidate(
  values: ProactiveCandidate[],
  input: Omit<ProactiveCandidate, "fingerprint"> & { fingerprintValues: Array<string | number | undefined> },
): void {
  const { fingerprintValues, ...candidate } = input;
  values.push({
    ...candidate,
    title: cleanFocusCardCopy(candidate.title, candidate.title, 64),
    detail: cleanFocusCardCopy(candidate.detail, candidate.detail, 72),
    fingerprint: stableFingerprint(candidate.kind, candidate.sourceIds, fingerprintValues),
  });
}

function nextRelevantInsight(source: ProactiveSource, now: number): ContactInsight | undefined {
  return source.insights
    .filter((item) => usableInsight(item, now))
    .filter((item) => item.kind === "relationship_change" || item.kind === "important_date" || Boolean(item.topicTitle))
    .filter((item) => evidenceTimestamp(item) >= now - 90 * DAY_MS)
    .sort((left, right) => evidenceTimestamp(right) - evidenceTimestamp(left))[0];
}

/**
 * Deterministic, bounded projection from canonical knowledge and action state.
 * It never stores prose as truth and never calls AI while the dashboard loads.
 */
export function buildProactiveCandidates(
  sources: ProactiveSource[],
  now = Date.now(),
  _options: ProactiveCandidateOptions = {},
): ProactiveCandidate[] {
  const candidates: ProactiveCandidate[] = [];
  for (const source of sources) {
    if (!source.contactName || source.isGroup || source.isOwner) continue;

    const upcomingEvent = source.events
      .filter((event) => event.status === "confirmed")
      .filter((event) => toMilliseconds(event.startAt) >= now && toMilliseconds(event.startAt) <= now + UPCOMING_CONTEXT_WINDOW_MS)
      .sort((left, right) => toMilliseconds(left.startAt) - toMilliseconds(right.startAt))[0];
    let upcomingContextAdded = false;
    if (upcomingEvent) {
      const insight = nextRelevantInsight(source, now);
      if (insight) {
        const startAt = toMilliseconds(upcomingEvent.startAt);
        addCandidate(candidates, {
          id: `proactive:upcoming:${source.chatId}:${upcomingEvent.id}:${insight.id}`,
          kind: "upcoming_context",
          priority: 10,
          title: `Before ${upcomingEvent.title}`,
          detail: compact(insight.content),
          why: `${upcomingEvent.title} is coming up soon, and this is recent, confirmed context about ${source.contactName}.`,
          chatId: source.chatId,
          contactName: source.contactName,
          sourceIds: [upcomingEvent.id, insight.id],
          messageId: insight.evidence.messageId || upcomingEvent.evidence.messageId,
          action: "chat",
          timestamp: startAt,
          fingerprintValues: [startAt, insight.updatedAt, insight.lastReinforcedAt],
        });
        upcomingContextAdded = true;
      }
    }

    for (const commitment of source.commitments) {
      if (commitment.owner !== "me" || commitment.status !== "open") continue;
      const dueAt = typeof commitment.dueAt === "number" ? toMilliseconds(commitment.dueAt) : undefined;
      const evidenceAt = toMilliseconds(commitment.evidence.timestamp);
      const timely = dueAt ? dueAt <= now + DAY_MS : now - evidenceAt <= FOLLOW_UP_WINDOW_MS;
      if (!timely || isSensitiveProactiveContent(commitment.content)) continue;
      addCandidate(candidates, {
        id: `proactive:commitment:${source.chatId}:${commitment.id}`,
        kind: "commitment",
        priority: dueAt && dueAt < now ? 0 : dueAt ? 12 : 24,
        title: compact(commitment.content, 100),
        detail: dueAt && dueAt < now ? `Still open with ${source.contactName}` : `Your commitment to ${source.contactName}`,
        why: dueAt
          ? `This commitment is still open and ${dueAt < now ? "past its due time" : "due within a day"}.`
          : `You made this commitment recently and it still appears open.`,
        chatId: source.chatId,
        contactName: source.contactName,
        sourceIds: [commitment.id],
        messageId: commitment.evidence.messageId,
        action: "chat",
        timestamp: dueAt || evidenceAt,
        fingerprintValues: [commitment.updatedAt, dueAt],
      });
    }

    for (const todo of source.todos) {
      if (todo.status !== "open" || typeof todo.dueAt !== "number") continue;
      const dueAt = toMilliseconds(todo.dueAt);
      if (dueAt > now + DAY_MS || isSensitiveProactiveContent(`${todo.title} ${todo.note || ""}`)) continue;
      addCandidate(candidates, {
        id: `proactive:todo:${source.chatId}:${todo.id}`,
        kind: "todo",
        priority: dueAt < now ? 1 : 14,
        title: compact(todo.title, 100),
        detail: dueAt < now ? "This to-do is overdue" : "This to-do is due within a day",
        why: `This is an open to-do with a ${dueAt < now ? "past" : "nearby"} due time.`,
        chatId: source.chatId,
        contactName: source.contactName,
        sourceIds: [todo.id],
        messageId: todo.evidence.messageId,
        action: "todo",
        timestamp: dueAt,
        fingerprintValues: [todo.updatedAt, dueAt, todo.priority],
      });
    }

    const assessment = source.replyAssessment;
    const incomingAt = source.lastIncoming ? toMilliseconds(source.lastIncoming.timestamp) : 0;
    if (
      source.needsReply && assessment?.needsReply && assessment.confidence >= 95 && incomingAt >= now - 7 * DAY_MS &&
      source.lastIncoming && !isSensitiveProactiveContent(source.lastIncoming.content)
    ) {
      addCandidate(candidates, {
        id: `proactive:reply:${source.chatId}:${source.lastIncoming.messageId || incomingAt}`,
        kind: "reply",
        priority: 18,
        title: `${source.contactName} may need your reply`,
        detail: compact(source.lastIncoming.content, 130),
        why: assessment.reason === "direct_question"
          ? `${source.contactName} asked you a direct question and no later reply from you is saved.`
          : `${source.contactName} made a direct request and no later reply from you is saved.`,
        chatId: source.chatId,
        contactName: source.contactName,
        sourceIds: [source.lastIncoming.messageId || `message-${incomingAt}`],
        messageId: source.lastIncoming.messageId,
        action: "chat",
        timestamp: incomingAt,
        fingerprintValues: [assessment.reason, assessment.confidence, incomingAt],
      });
    }

    const meaningfulChange = source.insights
      .filter((insight) => usableInsight(insight, now))
      .filter((insight) => insight.kind === "relationship_change" || insight.evolution === "replace")
      .filter((insight) => evidenceTimestamp(insight) >= now - CHANGE_WINDOW_MS)
      .sort((left, right) => evidenceTimestamp(right) - evidenceTimestamp(left))[0];
    if (meaningfulChange && !upcomingContextAdded) {
      const changedAt = evidenceTimestamp(meaningfulChange);
      const lastInteractionAt = source.lastInteraction ? toMilliseconds(source.lastInteraction.timestamp) : 0;
      if (source.lastInteraction?.author === "owner" && lastInteractionAt > changedAt) continue;
      addCandidate(candidates, {
        id: `proactive:change:${source.chatId}:${meaningfulChange.id}`,
        kind: "meaningful_change",
        priority: 30,
        title: `Something changed with ${source.contactName}`,
        detail: compact(meaningfulChange.content),
        why: `This is recent, confirmed relationship knowledge backed by saved evidence about ${source.contactName}.`,
        chatId: source.chatId,
        contactName: source.contactName,
        sourceIds: [meaningfulChange.id],
        messageId: meaningfulChange.evidence.messageId,
        action: "chat",
        timestamp: changedAt,
        fingerprintValues: [meaningfulChange.updatedAt, meaningfulChange.lastReinforcedAt, meaningfulChange.supersededAt],
      });
    }
  }
  return candidates
    .sort((left, right) => left.priority - right.priority || left.timestamp - right.timestamp || left.title.localeCompare(right.title))
    .slice(0, 12);
}

export function applyProactiveDeliveryState(
  candidates: ProactiveCandidate[],
  decisions: ProactiveDeliveryDecision[],
): ProactiveCandidate[] {
  const current = new Map(decisions.map((decision) => [decision.candidateId, decision]));
  return candidates.filter((candidate) => {
    const decision = current.get(candidate.id);
    return !decision || decision.fingerprint !== candidate.fingerprint || decision.status === "opened";
  });
}

/** Feedback changes attention ranking only; it never changes canonical truth. */
export function applyProactiveFeedbackRanking(
  candidates: ProactiveCandidate[],
  decisions: ProactiveDeliveryDecision[],
  now = Date.now(),
): ProactiveCandidate[] {
  const recent = decisions.filter((item) => item.updatedAt >= now - 90 * DAY_MS);
  return candidates.map((candidate) => {
    let adjustment = 0;
    for (const decision of recent) {
      if (decision.candidateId === candidate.id && decision.fingerprint === candidate.fingerprint) {
        if (decision.status === "opened") adjustment -= 3;
        continue;
      }
      if (decision.chatId === candidate.chatId) {
        adjustment += decision.status === "dismissed" ? 3 : decision.status === "opened" ? -1 : 0;
      }
      if (decision.kind === candidate.kind) {
        adjustment += decision.status === "dismissed" ? 2 : decision.status === "opened" ? -1 : 0;
      }
    }
    return { ...candidate, priority: Math.max(0, Math.min(50, candidate.priority + adjustment)) };
  }).sort((left, right) => left.priority - right.priority || left.timestamp - right.timestamp || left.title.localeCompare(right.title));
}

export function proactiveJudgmentKey(candidates: ProactiveCandidate[]): string {
  return createHash("sha256")
    .update(JSON.stringify([
      PROACTIVE_AI_POLICY_VERSION,
      candidates.map((item) => [item.id, item.fingerprint, item.priority]),
    ]))
    .digest("hex")
    .slice(0, 24);
}

export type ProactiveEvaluationCase = {
  expectedToShow: boolean;
  actualShow: boolean;
};

/** Lightweight precision-first score for a reusable proactive QA corpus. */
export function evaluateProactiveDecisions(cases: ProactiveEvaluationCase[]): {
  precision: number;
  recall: number;
  falsePositives: number;
  falseNegatives: number;
} {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  for (const item of cases) {
    if (item.actualShow && item.expectedToShow) truePositives += 1;
    if (item.actualShow && !item.expectedToShow) falsePositives += 1;
    if (!item.actualShow && item.expectedToShow) falseNegatives += 1;
  }
  return {
    precision: truePositives + falsePositives ? truePositives / (truePositives + falsePositives) : 1,
    recall: truePositives + falseNegatives ? truePositives / (truePositives + falseNegatives) : 1,
    falsePositives,
    falseNegatives,
  };
}

function cleanJudgmentCopy(value: string, fallback: string, max: number): string {
  return compact(value || fallback, max) || fallback;
}

function cleanFocusCardCopy(value: string, fallback: string, max: number): string {
  const normalized = (value || fallback).replace(/\s+/gu, " ").trim().replace(/[…]+$/u, "");
  if (normalized.length <= max) return normalized;
  const boundary = normalized.slice(0, max + 1).lastIndexOf(" ");
  return normalized.slice(0, boundary > max / 2 ? boundary : max).trimEnd().replace(/[,;:—-]+$/u, "");
}

/**
 * Applies a cached, bounded AI judgment to already-safe deterministic candidates.
 * Unknown IDs and cross-contact merge requests are ignored; AI cannot introduce
 * facts, actions, contacts, or source evidence.
 */
export function applyProactiveAiJudgment(
  candidates: ProactiveCandidate[],
  batch: ProactiveAiJudgmentBatch | undefined,
): ProactiveCandidate[] {
  if (!batch || batch.policyVersion !== PROACTIVE_AI_POLICY_VERSION || batch.key !== proactiveJudgmentKey(candidates)) {
    return candidates;
  }
  const candidatesById = new Map(candidates.map((item) => [item.id, item]));
  const judgmentsById = new Map(batch.judgments
    .filter((item) => candidatesById.has(item.candidateId))
    .map((item) => [item.candidateId, item]));
  const used = new Set<string>();
  const output: ProactiveCandidate[] = [];
  const ranked = candidates
    .filter((item) => judgmentsById.get(item.id)?.show !== false)
    .sort((left, right) => {
      const leftScore = judgmentsById.get(left.id)?.usefulness ?? 50;
      const rightScore = judgmentsById.get(right.id)?.usefulness ?? 50;
      return rightScore - leftScore || left.priority - right.priority;
    });
  for (const candidate of ranked) {
    if (used.has(candidate.id)) continue;
    const judgment = judgmentsById.get(candidate.id);
    if (!judgment) {
      output.push(candidate);
      used.add(candidate.id);
      continue;
    }
    const merge = judgment.mergeWithIds
      .map((id) => candidatesById.get(id))
      .filter((item): item is ProactiveCandidate => Boolean(item))
      .filter((item) => item.chatId === candidate.chatId && judgmentsById.get(item.id)?.show !== false && !used.has(item.id));
    const members = [candidate, ...merge.filter((item) => item.id !== candidate.id)];
    for (const member of members) used.add(member.id);
    const fingerprint = members.length === 1
      ? candidate.fingerprint
      : createHash("sha256").update(JSON.stringify(members.map((item) => item.fingerprint).sort())).digest("hex").slice(0, 24);
    output.push({
      ...candidate,
      fingerprint,
      priority: Math.max(0, Math.min(40, Math.round((100 - judgment.usefulness) * .4))),
      title: cleanFocusCardCopy(judgment.title, candidate.title, 64),
      detail: cleanFocusCardCopy(judgment.detail, candidate.detail, 72),
      why: cleanJudgmentCopy(judgment.why, candidate.why, 140),
      sourceIds: [...new Set(members.flatMap((item) => item.sourceIds))],
      aiAssessment: judgment.confidence > 0 ? {
        confidence: Math.max(1, Math.min(100, Math.round(judgment.confidence))),
        reason: cleanJudgmentCopy(judgment.reason, "AI checked this suggestion", 120),
      } : undefined,
    });
  }
  return output.sort((left, right) => left.priority - right.priority || left.timestamp - right.timestamp || left.title.localeCompare(right.title));
}
