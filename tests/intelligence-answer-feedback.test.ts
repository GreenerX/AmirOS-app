import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AmirosState } from "../src/amiros-state.js";

const directories: string[] = [];

function createState(): { state: AmirosState; file: string } {
  const directory = mkdtempSync(join(tmpdir(), "amiros-ask-feedback-"));
  directories.push(directory);
  const file = join(directory, "state.json");
  return { state: new AmirosState(file), file };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Ask AmirOS answer feedback", () => {
  it("persists bounded local feedback against a stable answer id", () => {
    const { state, file } = createState();
    const answer = state.rememberIntelligenceAnswer("What should I know about Dan?", "Dan prefers concise updates.", [{
      id: "dan-preference", chatId: "dan@c.us", kind: "insight", content: "Keep it concise", timestamp: Date.now(), score: 10,
    }]);

    const feedback = state.recordIntelligenceAnswerFeedback(answer.id, {
      rating: "needs_work",
      reasons: ["unclear", "too_long"],
      note: "Lead with the useful point.",
      suggestion: { candidateId: "candidate", fingerprint: "a".repeat(24), kind: "meaningful_change", chatId: "dan@c.us" },
    });

    expect(feedback).toMatchObject({ answerId: answer.id, rating: "needs_work", reasons: ["unclear", "too_long"] });
    expect(new AmirosState(file).latestIntelligenceAnswerFeedback(answer.id)).toMatchObject({ note: "Lead with the useful point." });
    expect(new AmirosState(file).getDashboardSettings()).not.toHaveProperty("intelligenceAnswerFeedback");
  });

  it("uses only presentation complaints as future style guidance", () => {
    const { state } = createState();
    const factual = state.rememberIntelligenceAnswer("Where is Dan?", "Dan is in London.", []);
    const presentation = state.rememberIntelligenceAnswer("What matters?", "A long answer.", []);
    state.recordIntelligenceAnswerFeedback(factual.id, {
      rating: "needs_work", reasons: ["outdated_or_incorrect"], note: "Dan is in Paris.",
    });
    state.recordIntelligenceAnswerFeedback(presentation.id, {
      rating: "needs_work", reasons: ["too_long"], note: "Keep it brief.",
    });

    const guidance = state.intelligenceAnswerGuidance();
    expect(guidance).toContain("shorter answer");
    expect(guidance).toContain("Keep it brief");
    expect(guidance).not.toContain("Paris");
  });

  it("uses helpful, relevance, and outdated feedback only to rank exact-question sources", () => {
    const { state } = createState();
    const helpful = state.rememberIntelligenceAnswer("What matters for Dan?", "A useful answer.", [{
      id: "useful", chatId: "dan@c.us", kind: "insight", content: "Useful", timestamp: Date.now(), score: 9,
    }]);
    const irrelevant = state.rememberIntelligenceAnswer("What matters for Dan?", "An irrelevant answer.", [{
      id: "noise", chatId: "dan@c.us", kind: "insight", content: "Noise", timestamp: Date.now(), score: 8,
    }]);
    const outdated = state.rememberIntelligenceAnswer("What matters for Dan?", "An outdated answer.", [{
      id: "old", chatId: "dan@c.us", kind: "insight", content: "Old", timestamp: Date.now(), score: 7,
    }]);
    state.recordIntelligenceAnswerFeedback(helpful.id, { rating: "helpful" });
    state.recordIntelligenceAnswerFeedback(irrelevant.id, { rating: "needs_work", reasons: ["irrelevant"] });
    state.recordIntelligenceAnswerFeedback(outdated.id, { rating: "needs_work", reasons: ["outdated_or_incorrect"] });

    const ranking = state.intelligenceAnswerSourceRanking("What matters for Dan?", "dan@c.us");
    expect([...ranking.boosted]).toEqual(["useful"]);
    expect([...ranking.penalized]).toEqual(["noise", "old"]);
    expect(state.intelligenceAnswerSourceRanking("A different question", "dan@c.us").penalized.size).toBe(0);
  });

  it("never accepts feedback for an answer that is not in local history", () => {
    const { state } = createState();
    expect(state.recordIntelligenceAnswerFeedback("missing", { rating: "helpful" })).toBeUndefined();
  });

  it("links a regenerated answer to the answer that received feedback", () => {
    const { state, file } = createState();
    const original = state.rememberIntelligenceAnswer("What matters?", "Original answer.", []);
    const improved = state.rememberIntelligenceAnswer("What matters?", "Improved answer.", [], original.id);
    expect(improved.parentAnswerId).toBe(original.id);
    expect(new AmirosState(file).intelligenceQuestionById(improved.id)?.parentAnswerId).toBe(original.id);
  });
});
