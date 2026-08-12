import type { ContactInsight, MemoryEvidence } from "./amiros-state.js";
import { assessKnowledgeFreshness, type KnowledgeFreshness } from "./memory-maintenance.js";

export type MemoryExplanation = {
  summary: string;
  statusLabel: "Current" | "Historical" | "Temporary" | "Pending review" | "Outdated";
  confidenceLabel: "High confidence" | "Medium confidence" | "Low confidence";
  confidencePercent: number;
  freshnessLabel: string;
  evidenceCount: number;
  reinforcedCount: number;
  origin: string;
  replaced?: string[];
  replacedBy?: string;
  bullets: string[];
};

function normalizeKey(value: string | undefined): string {
  return (value || "").replace(/[\s-]+/gu, "_").toLocaleLowerCase();
}

function confidencePercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

function confidenceLabel(value: number): MemoryExplanation["confidenceLabel"] {
  const percent = confidencePercent(value);
  if (percent >= 86) return "High confidence";
  if (percent >= 65) return "Medium confidence";
  return "Low confidence";
}

function statusLabel(insight: ContactInsight): MemoryExplanation["statusLabel"] {
  if (insight.status === "outdated") return "Outdated";
  if (insight.status === "inferred") return "Pending review";
  if (insight.validity === "historical") return "Historical";
  if (insight.validity === "temporary") return "Temporary";
  return "Current";
}

function freshnessLabel(value: KnowledgeFreshness): string {
  switch (value) {
    case "timeless": return "Stable";
    case "fresh": return "Current";
    case "aging": return "Older evidence";
    case "stale": return "Possibly stale";
    case "historical": return "Historical";
    case "uncertain": return "Unconfirmed";
  }
}

function evidenceCount(insight: ContactInsight): number {
  const ids = new Set<string>();
  const add = (item: MemoryEvidence | undefined) => {
    if (!item) return;
    ids.add(item.messageId || `${item.timestamp}:${item.excerpt}`);
  };
  add(insight.evidence);
  (insight.evidenceHistory || []).forEach(add);
  return ids.size || 1;
}

function originLabel(insight: ContactInsight): string {
  if (insight.autonomousConfirmationReason === "direct_contact_statement") {
    return insight.evidence.senderName
      ? `a direct statement from ${insight.evidence.senderName}`
      : "a direct statement from the contact";
  }
  if (insight.autonomousConfirmationReason === "direct_owner_statement") return "an owner statement";
  if (insight.maintenanceConfirmationReason === "repeated_direct_evidence") return "repeated supporting evidence";
  if (insight.evidence.source === "whatsapp_bot") return "an owner action through the WhatsApp bot";
  if (insight.evidence.senderName) return `a message from ${insight.evidence.senderName}`;
  return "saved conversation evidence";
}

function shortFact(value: string): string {
  return value.replace(/\s+/gu, " ").trim().replace(/[.!?]+$/u, "").slice(0, 140);
}

function sameCanonicalFact(left: ContactInsight, right: ContactInsight): boolean {
  const leftKey = normalizeKey(left.canonicalKey);
  const rightKey = normalizeKey(right.canonicalKey);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function replacedFacts(insight: ContactInsight, allInsights: ContactInsight[]): ContactInsight[] {
  return allInsights
    .filter((candidate) => candidate.id !== insight.id)
    .filter((candidate) =>
      candidate.supersededById === insight.id ||
      (sameCanonicalFact(candidate, insight) && candidate.validity === "historical" && (candidate.supersededAt || candidate.updatedAt) <= insight.updatedAt),
    )
    .sort((left, right) => (right.supersededAt || right.updatedAt) - (left.supersededAt || left.updatedAt));
}

function replacementFor(insight: ContactInsight, allInsights: ContactInsight[]): ContactInsight | undefined {
  if (!insight.supersededById) return undefined;
  return allInsights.find((candidate) => candidate.id === insight.supersededById);
}

function summaryFor(
  insight: ContactInsight,
  freshness: ReturnType<typeof assessKnowledgeFreshness>,
  replaced: ContactInsight[],
  replacedBy: ContactInsight | undefined,
): string {
  const confidence = confidenceLabel(insight.confidence).toLocaleLowerCase();
  const origin = originLabel(insight);
  const count = evidenceCount(insight);
  const reinforced = insight.reinforcementCount || count;
  if ((insight.validity || "current") === "historical") {
    return replacedBy
      ? `AmirOS treats this as historical because newer evidence now supports “${shortFact(replacedBy.content)}.”`
      : `AmirOS keeps this as historical context, not as the current truth.`;
  }
  if (insight.validity === "temporary") {
    return freshness.qualify
      ? `AmirOS learned this from ${origin}, but it looks time-sensitive and should be treated as possibly outdated.`
      : `AmirOS treats this as a temporary current note from ${origin}.`;
  }
  if (replaced.length) {
    return `AmirOS treats this as current because ${origin} updated older knowledge. The previous version is preserved as history.`;
  }
  if (reinforced > 1) {
    return `AmirOS treats this as current with ${confidence} because ${count} supporting messages reinforce the same memory.`;
  }
  if (freshness.qualify) {
    return `AmirOS has evidence for this from ${origin}, but the evidence is older or weaker, so it should be read with context.`;
  }
  return `AmirOS believes this from ${origin} with ${confidence}.`;
}

export function explainContactInsight(
  insight: ContactInsight,
  allInsights: ContactInsight[] = [],
  now = Date.now(),
): MemoryExplanation {
  const freshness = assessKnowledgeFreshness(insight, now);
  const replaced = replacedFacts(insight, allInsights);
  const replacedBy = replacementFor(insight, allInsights);
  const confidence = confidencePercent(insight.confidence);
  const status = statusLabel(insight);
  const count = evidenceCount(insight);
  const reinforced = Math.max(0, (insight.reinforcementCount || count) - 1);
  const origin = originLabel(insight);
  const replacedSummaries = replaced.slice(0, 3).map((item) => shortFact(item.content));
  const bullets = [
    `${status} memory`,
    `${confidence}% confidence`,
    `${count} supporting ${count === 1 ? "message" : "messages"}`,
  ];
  if (reinforced > 0) bullets.push(`Reinforced ${reinforced} ${reinforced === 1 ? "time" : "times"}`);
  if (freshness.qualify) bullets.push(`Needs context: ${freshnessLabel(freshness.state).toLocaleLowerCase()}`);
  if (replacedSummaries.length) bullets.push(`Replaced older knowledge`);
  if (replacedBy) bullets.push(`Replaced by newer knowledge`);

  return {
    summary: summaryFor(insight, freshness, replaced, replacedBy),
    statusLabel: status,
    confidenceLabel: confidenceLabel(insight.confidence),
    confidencePercent: confidence,
    freshnessLabel: freshnessLabel(freshness.state),
    evidenceCount: count,
    reinforcedCount: reinforced,
    origin,
    replaced: replacedSummaries,
    replacedBy: replacedBy ? shortFact(replacedBy.content) : undefined,
    bullets,
  };
}
