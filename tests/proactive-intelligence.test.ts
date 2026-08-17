import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AmirosState, type ContactInsight } from "../src/amiros-state.js";
import {
  applyProactiveAiJudgment,
  applyProactiveDeliveryState,
  applyProactiveFeedbackRanking,
  buildProactiveCandidates,
  proactiveJudgmentKey,
  PROACTIVE_AI_POLICY_VERSION,
  type ProactiveAiJudgmentBatch,
  type ProactiveSource,
} from "../src/proactive-intelligence.js";

const now = new Date(2026, 7, 13, 10).getTime();
const DAY = 86_400_000;
const directories: string[] = [];
const evidence = { messageId: "message-1", excerpt: "I moved to New York", timestamp: now - DAY };

function source(patch: Partial<ProactiveSource> = {}): ProactiveSource {
  return {
    chatId: "dani@c.us",
    contactName: "Dani",
    isGroup: false,
    insights: [],
    commitments: [],
    events: [],
    todos: [],
    needsReply: false,
    ...patch,
  };
}

function insight(patch: Partial<ContactInsight> = {}): ContactInsight {
  return {
    id: "move",
    kind: "relationship_change",
    content: "Dani recently moved to New York.",
    canonicalKey: "residence",
    validity: "current",
    evolution: "replace",
    status: "confirmed",
    confidence: .97,
    evidence,
    createdAt: now - DAY,
    updatedAt: now - DAY,
    ...patch,
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("proactive intelligence", () => {
  it("surfaces recent context before a nearby confirmed plan", () => {
    const candidates = buildProactiveCandidates([source({
      insights: [insight()],
      events: [{
        id: "dinner", title: "Dinner with Dani", startAt: now + DAY, allDay: false, status: "confirmed",
        evidence: { excerpt: "Dinner tomorrow", timestamp: now }, createdAt: now, updatedAt: now,
      }],
    })], now);
    expect(candidates).toEqual(expect.arrayContaining([expect.objectContaining({
      kind: "upcoming_context",
      title: "Before Dinner with Dani",
      detail: "Dani recently moved to New York",
      sourceIds: ["dinner", "move"],
    })]));
  });

  it("never presents a past event as upcoming context", () => {
    const candidates = buildProactiveCandidates([source({
      insights: [insight()],
      events: [{
        id: "old", title: "Old dinner", startAt: now - 1, allDay: false, status: "confirmed",
        evidence, createdAt: now - DAY, updatedAt: now - DAY,
      }],
    })], now);
    expect(candidates.some((item) => item.kind === "upcoming_context")).toBe(false);
  });

  it("surfaces unresolved owner commitments and removes them when resolved", () => {
    const active = source({ commitments: [{
      id: "photos", content: "Send Dani the photos", owner: "me", status: "open", dueAt: now - 1,
      evidence, createdAt: now - DAY, updatedAt: now - DAY,
    }] });
    expect(buildProactiveCandidates([active], now)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "commitment", title: "Send Dani the photos", sourceTimestamp: now - DAY, hasExplicitDueAt: true }),
    ]));
    active.commitments[0]!.status = "done";
    expect(buildProactiveCandidates([active], now).some((item) => item.kind === "commitment")).toBe(false);
  });

  it("keeps an undated commitment as a follow-up rather than an overdue item", () => {
    const candidates = buildProactiveCandidates([source({ commitments: [{
      id: "check-in", content: "Check in with Dani", owner: "me", status: "open",
      evidence, createdAt: now - DAY, updatedAt: now - DAY,
    }] })], now);

    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "commitment", timestamp: now - DAY, sourceTimestamp: now - DAY, hasExplicitDueAt: false }),
    ]));
  });

  it("keeps deterministic fallback copy compact while AI is still judging", () => {
    const candidates = buildProactiveCandidates([source({ commitments: [{
      id: "long", content: "Send Yuvi a message after the flamenco event and confirm every remaining detail about the plan", owner: "me", status: "open", dueAt: now + 60_000,
      evidence, createdAt: now - DAY, updatedAt: now - DAY,
    }] })], now);
    expect(candidates[0]!.title.length).toBeLessThanOrEqual(64);
    expect(candidates[0]!.detail.length).toBeLessThanOrEqual(72);
    expect(candidates[0]!.title.endsWith("…")).toBe(false);
  });

  it("requires high-confidence direct reply evidence", () => {
    const base = source({
      needsReply: true,
      lastIncoming: { role: "user", author: "contact", content: "Can you send the address?", timestamp: now - 60_000, messageId: "request" },
      replyAssessment: { needsReply: true, mayNeedReply: true, confidence: 94, source: "deterministic", reason: "direct_request" },
    });
    expect(buildProactiveCandidates([base], now).some((item) => item.kind === "reply")).toBe(false);
    base.replyAssessment = { ...base.replyAssessment!, confidence: 97 };
    expect(buildProactiveCandidates([base], now)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "reply", sourceIds: ["request"] }),
    ]));
  });

  it("excludes stale, weak, sensitive, and group-derived changes", () => {
    const weak = insight({ confidence: .6 });
    const stale = insight({ id: "stale", updatedAt: now - 400 * DAY, evidence: { ...evidence, timestamp: now - 400 * DAY } });
    const sensitive = insight({ id: "health", content: "Dani received a medical diagnosis." });
    expect(buildProactiveCandidates([source({ insights: [weak, stale, sensitive] })], now)).toHaveLength(0);
    expect(buildProactiveCandidates([source({ isGroup: true, insights: [insight()] })], now)).toHaveLength(0);
    expect(buildProactiveCandidates([source({ isOwner: true, insights: [insight()] })], now)).toHaveLength(0);
  });

  it("does not manufacture interaction-gap urgency or repeat a change the owner already addressed", () => {
    expect(buildProactiveCandidates([source({
      lastInteraction: { role: "user", author: "contact", content: "Hello", timestamp: now - 100 * DAY },
    })], now)).toHaveLength(0);
    expect(buildProactiveCandidates([source({
      insights: [insight()],
      lastInteraction: { role: "user", author: "owner", content: "Congratulations on the move!", timestamp: now },
    })], now)).toHaveLength(0);
  });

  it("keeps dismissal durable for the same evidence and resurfaces a meaningful update", () => {
    const first = buildProactiveCandidates([source({ insights: [insight()] })], now)[0]!;
    const decision = { candidateId: first.id, fingerprint: first.fingerprint, status: "dismissed" as const, updatedAt: now };
    expect(applyProactiveDeliveryState([first], [decision])).toEqual([]);

    const changed = buildProactiveCandidates([source({ insights: [insight({ updatedAt: now, content: "Dani now lives in Brooklyn." })] })], now)[0]!;
    expect(changed.id).toBe(first.id);
    expect(changed.fingerprint).not.toBe(first.fingerprint);
    expect(applyProactiveDeliveryState([changed], [decision])).toEqual([changed]);
  });

  it("persists proactive delivery state without changing canonical memory", () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-proactive-"));
    directories.push(directory);
    const file = join(directory, "state.json");
    const state = new AmirosState(file);
    const before = state.intelligenceSnapshot();
    expect(state.setProactiveDeliveryDecision("proactive:change:dani:move", "a".repeat(24), "dismissed", now)).toMatchObject({ status: "dismissed" });
    expect(state.intelligenceSnapshot()).toEqual(before);
    expect(new AmirosState(file).proactiveDeliveryDecisions()).toEqual([expect.objectContaining({ candidateId: "proactive:change:dani:move" })]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toHaveProperty("proactiveDelivery");
  });

  it("lets AI suppress noise and merge only same-contact grounded candidates", () => {
    const candidates = buildProactiveCandidates([source({
      commitments: [{
        id: "photos", content: "Send Dani the photos", owner: "me", status: "open", dueAt: now + 60_000,
        evidence, createdAt: now - DAY, updatedAt: now - DAY,
      }],
      todos: [{
        id: "send-photos", title: "Send Dani photos 📷", status: "open", priority: "normal", dueAt: now + 60_000,
        evidence, createdAt: now - DAY, updatedAt: now - DAY,
      }],
    }), source({
      chatId: "andrew@c.us", contactName: "Andrew",
      commitments: [{
        id: "coffee", content: "Maybe remember coffee", owner: "me", status: "open", dueAt: now + 60_000,
        evidence, createdAt: now - DAY, updatedAt: now - DAY,
      }],
    })], now);
    const commitment = candidates.find((item) => item.id.includes(":photos"))!;
    const todo = candidates.find((item) => item.id.includes(":send-photos"))!;
    const noise = candidates.find((item) => item.chatId === "andrew@c.us")!;
    const batch: ProactiveAiJudgmentBatch = {
      key: proactiveJudgmentKey(candidates), policyVersion: PROACTIVE_AI_POLICY_VERSION, judgedAt: now,
      judgments: [
        { candidateId: commitment.id, show: true, usefulness: 95, confidence: 92, title: "Send Dani the photos", detail: "One follow-up before today ends", why: "This combines the same open promise and to-do.", reason: "Same actionable follow-up", mergeWithIds: [todo.id, noise.id] },
        { candidateId: todo.id, show: true, usefulness: 90, confidence: 90, title: todo.title, detail: todo.detail, why: todo.why, reason: "Duplicate task", mergeWithIds: [] },
        { candidateId: noise.id, show: false, usefulness: 10, confidence: 85, title: noise.title, detail: noise.detail, why: noise.why, reason: "Not useful enough", mergeWithIds: [] },
      ],
    };
    const judged = applyProactiveAiJudgment(candidates, batch);
    expect(judged).toHaveLength(1);
    expect(judged[0]).toMatchObject({ title: "Send Dani the photos", aiAssessment: { confidence: 92 } });
    expect(judged[0]!.sourceIds).toEqual(expect.arrayContaining(["photos", "send-photos"]));
    expect(judged[0]!.sourceIds).not.toContain("coffee");
  });

  it("keeps AI-written Focus copy short and complete", () => {
    const candidates = buildProactiveCandidates([source({ commitments: [{
      id: "appointment", content: "Arrange a hospital phone appointment with Firouzion and confirm all the scheduling details", owner: "me", status: "open", dueAt: now + 60_000,
      evidence, createdAt: now - DAY, updatedAt: now - DAY,
    }] })], now);
    const candidate = candidates[0]!;
    const judged = applyProactiveAiJudgment(candidates, {
      key: proactiveJudgmentKey(candidates), policyVersion: PROACTIVE_AI_POLICY_VERSION, judgedAt: now,
      judgments: [{ candidateId: candidate.id, show: true, usefulness: 90, confidence: 92, title: "Arrange a hospital phone appointment with Firouzion and confirm every last scheduling detail", detail: "A long repeated explanation about the same hospital phone appointment that consumes too much card space", why: "This explanation remains available internally but is not rendered on the Focus card.", reason: "Useful follow-up", mergeWithIds: [] }],
    });
    expect(judged[0]!.title.length).toBeLessThanOrEqual(64);
    expect(judged[0]!.detail.length).toBeLessThanOrEqual(72);
    expect(judged[0]!.title.endsWith("…")).toBe(false);
  });

  it("ignores stale AI output and preserves deterministic fallback", () => {
    const candidates = buildProactiveCandidates([source({ insights: [insight()] })], now);
    const stale = {
      key: "f".repeat(24), policyVersion: PROACTIVE_AI_POLICY_VERSION, judgedAt: now,
      judgments: [],
    };
    expect(applyProactiveAiJudgment(candidates, stale)).toEqual(candidates);
  });

  it("uses interaction feedback only for attention ranking", () => {
    const candidates = buildProactiveCandidates([
      source({ insights: [insight()] }),
      source({
        chatId: "andrew@c.us", contactName: "Andrew",
        insights: [insight({ id: "andrew-change", content: "Andrew started a new role." })],
      }),
    ], now);
    const dani = candidates.find((item) => item.chatId === "dani@c.us")!;
    const ranked = applyProactiveFeedbackRanking(candidates, [{
      candidateId: "older-dani-item", fingerprint: "a".repeat(24), status: "dismissed", updatedAt: now,
      kind: dani.kind, chatId: dani.chatId,
    }], now);
    expect(ranked.find((item) => item.id === dani.id)!.priority).toBeGreaterThan(dani.priority);
    expect(ranked.find((item) => item.id === dani.id)!.fingerprint).toBe(dani.fingerprint);
  });

  it("caches AI judgments and automatically resolves opened items when evidence disappears", () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-proactive-ai-"));
    directories.push(directory);
    const file = join(directory, "state.json");
    const state = new AmirosState(file);
    const candidate = buildProactiveCandidates([source({ insights: [insight()] })], now)[0]!;
    const batch: ProactiveAiJudgmentBatch = {
      key: proactiveJudgmentKey([candidate]), policyVersion: PROACTIVE_AI_POLICY_VERSION, judgedAt: now,
      judgments: [{ candidateId: candidate.id, show: true, usefulness: 80, confidence: 90, title: candidate.title, detail: candidate.detail, why: candidate.why, reason: "Useful change", mergeWithIds: [] }],
    };
    state.setProactiveJudgment(batch);
    state.setProactiveDeliveryDecision(candidate.id, candidate.fingerprint, "opened", now, { kind: candidate.kind, chatId: candidate.chatId });
    expect(new AmirosState(file).proactiveJudgment(batch.key)).toEqual(batch);
    state.resolveInactiveProactiveDelivery(new Set(), now + 1);
    expect(state.proactiveDeliveryDecisions()).toEqual([expect.objectContaining({ status: "resolved" })]);
  });
});
