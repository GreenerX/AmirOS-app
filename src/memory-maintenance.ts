import type { ContactInsight } from "./amiros-state.js";

const DAY_MS = 86_400_000;

export type KnowledgeFreshness = "timeless" | "fresh" | "aging" | "stale" | "historical" | "uncertain";

export type KnowledgeFreshnessAssessment = {
  state: KnowledgeFreshness;
  reason:
    | "stable_fact"
    | "recent_evidence"
    | "reinforced_evidence"
    | "temporary_aging"
    | "temporary_expired"
    | "weak_observation_aging"
    | "weak_observation_stale"
    | "historical"
    | "unconfirmed";
  scoreMultiplier: number;
  qualify: boolean;
};

function toMilliseconds(value: number): number {
  return value > 0 && value < 10_000_000_000 ? value * 1_000 : value;
}

function normalizedCanonicalKey(insight: Pick<ContactInsight, "canonicalKey">): string {
  return (insight.canonicalKey || "").replace(/[\s-]+/gu, "_").toLocaleLowerCase();
}

function latestEvidenceAt(insight: Pick<ContactInsight, "evidence" | "evidenceHistory" | "lastReinforcedAt" | "updatedAt">): number {
  const evidenceTimestamps = [
    insight.lastReinforcedAt || 0,
    insight.evidence.timestamp,
    ...(insight.evidenceHistory || []).map((item) => item.timestamp),
  ].filter((value) => value > 0);
  return (evidenceTimestamps.length ? evidenceTimestamps : [insight.updatedAt])
    .reduce((latest, value) => Math.max(latest, toMilliseconds(value)), 0);
}

function isTimelessFact(insight: Pick<ContactInsight, "kind" | "canonicalKey" | "content">): boolean {
  const key = normalizedCanonicalKey(insight);
  return insight.kind === "important_date" || /(?:^|_)(?:birthday|birth_date)(?:_|$)/u.test(key) ||
    /\b(?:birthday|date of birth|born on)\b/iu.test(insight.content);
}

/**
 * Computes prominence without changing canonical truth. Age can make a weak
 * or temporary observation less useful, but it never deletes evidence or
 * silently turns a durable confirmed fact into history.
 */
export function assessKnowledgeFreshness(
  insight: Pick<ContactInsight,
    "kind" | "content" | "canonicalKey" | "validity" | "status" | "confidence" |
    "reinforcementCount" | "lastReinforcedAt" | "evidence" | "evidenceHistory" | "updatedAt"
  >,
  now = Date.now(),
): KnowledgeFreshnessAssessment {
  if ((insight.validity || "current") === "historical") {
    return { state: "historical", reason: "historical", scoreMultiplier: 1, qualify: false };
  }
  if (insight.status !== "confirmed") {
    return { state: "uncertain", reason: "unconfirmed", scoreMultiplier: .35, qualify: true };
  }
  if (isTimelessFact(insight)) {
    return { state: "timeless", reason: "stable_fact", scoreMultiplier: 1, qualify: false };
  }

  const ageDays = Math.max(0, now - latestEvidenceAt(insight)) / DAY_MS;
  const reinforced = (insight.reinforcementCount || 1) >= 2 || (insight.evidenceHistory?.length || 0) >= 2;
  if (insight.validity === "temporary") {
    if (ageDays > 30) return { state: "stale", reason: "temporary_expired", scoreMultiplier: .08, qualify: true };
    if (ageDays > 7) return { state: "aging", reason: "temporary_aging", scoreMultiplier: .45, qualify: true };
    return { state: "fresh", reason: "recent_evidence", scoreMultiplier: 1, qualify: false };
  }

  if (reinforced || insight.confidence >= .9) {
    return {
      state: ageDays > 730 ? "aging" : "fresh",
      reason: reinforced ? "reinforced_evidence" : "recent_evidence",
      scoreMultiplier: ageDays > 730 ? .78 : 1,
      qualify: ageDays > 730,
    };
  }

  const isPreferenceOrObservation = insight.kind === "preference" || !normalizedCanonicalKey(insight);
  if (isPreferenceOrObservation && ageDays > 730) {
    return { state: "stale", reason: "weak_observation_stale", scoreMultiplier: .2, qualify: true };
  }
  if (isPreferenceOrObservation && ageDays > 180) {
    return { state: "aging", reason: "weak_observation_aging", scoreMultiplier: .6, qualify: true };
  }
  return { state: "fresh", reason: "recent_evidence", scoreMultiplier: 1, qualify: false };
}

export function knowledgeNeedsQualification(
  insight: Parameters<typeof assessKnowledgeFreshness>[0],
  now = Date.now(),
): boolean {
  return assessKnowledgeFreshness(insight, now).qualify;
}
