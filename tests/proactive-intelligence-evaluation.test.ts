import { describe, expect, it } from "vitest";
import {
  applyProactiveAiJudgment,
  evaluateProactiveDecisions,
  proactiveJudgmentKey,
  PROACTIVE_AI_POLICY_VERSION,
  type ProactiveAiJudgment,
  type ProactiveCandidate,
} from "../src/proactive-intelligence.js";

const now = new Date(2026, 7, 13, 10).getTime();

function candidate(id: string, patch: Partial<ProactiveCandidate> = {}): ProactiveCandidate {
  return {
    id,
    fingerprint: id.padEnd(24, "0").slice(0, 24).replace(/[^a-f0-9]/gu, "a"),
    kind: "meaningful_change",
    priority: 20,
    title: "Something changed with Dani",
    detail: "Dani started a new role.",
    why: "This is recent confirmed context.",
    chatId: "dani@c.us",
    contactName: "Dani",
    sourceIds: [`source-${id}`],
    action: "chat",
    timestamp: now,
    ...patch,
  };
}

function judgment(item: ProactiveCandidate, patch: Partial<ProactiveAiJudgment> = {}): ProactiveAiJudgment {
  return {
    candidateId: item.id,
    show: true,
    usefulness: 85,
    confidence: 90,
    title: item.title,
    detail: item.detail,
    why: item.why,
    reason: "Useful now",
    mergeWithIds: [],
    ...patch,
  };
}

describe("proactive intelligence precision harness", () => {
  it("measures precision separately from recall so noisy surfacing is visible", () => {
    expect(evaluateProactiveDecisions([
      { expectedToShow: true, actualShow: true },
      { expectedToShow: false, actualShow: true },
      { expectedToShow: true, actualShow: false },
      { expectedToShow: false, actualShow: false },
    ])).toEqual({ precision: .5, recall: .5, falsePositives: 1, falseNegatives: 1 });
  });

  it("covers useful, noisy, duplicate, and already-resolved judgment outcomes", () => {
    const useful = candidate("a-useful", { kind: "commitment", title: "Send Dani the photos" });
    const noise = candidate("b-noise", { title: "Dani mentioned coffee" });
    const duplicate = candidate("c-duplicate", { kind: "todo", title: "Send Dani photos" });
    const resolved = candidate("d-resolved", { kind: "reply", title: "Dani may need your reply" });
    const candidates = [useful, noise, duplicate, resolved];
    const judgments = [
      judgment(useful, { mergeWithIds: [duplicate.id] }),
      judgment(noise, { show: false, usefulness: 5, reason: "Trivial observation" }),
      judgment(duplicate, { usefulness: 75, reason: "Duplicate follow-up" }),
      judgment(resolved, { show: false, usefulness: 0, reason: "Already addressed" }),
    ];
    const visible = applyProactiveAiJudgment(candidates, {
      key: proactiveJudgmentKey(candidates),
      policyVersion: PROACTIVE_AI_POLICY_VERSION,
      judgedAt: now,
      judgments,
    });
    const visibleIds = new Set(visible.map((item) => item.id));
    const score = evaluateProactiveDecisions([
      { expectedToShow: true, actualShow: visibleIds.has(useful.id) },
      { expectedToShow: false, actualShow: visibleIds.has(noise.id) },
      { expectedToShow: false, actualShow: visibleIds.has(duplicate.id) },
      { expectedToShow: false, actualShow: visibleIds.has(resolved.id) },
    ]);
    expect(score).toEqual({ precision: 1, recall: 1, falsePositives: 0, falseNegatives: 0 });
    expect(visible[0]!.sourceIds).toEqual(expect.arrayContaining([useful.sourceIds[0], duplicate.sourceIds[0]]));
  });
});
