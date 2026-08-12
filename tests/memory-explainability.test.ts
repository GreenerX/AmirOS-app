import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AmirosState, type ContactInsight } from "../src/amiros-state.js";
import { explainContactInsight } from "../src/memory-explainability.js";

const directories: string[] = [];

function createState(): AmirosState {
  const directory = mkdtempSync(join(tmpdir(), "amiros-memory-explainability-"));
  directories.push(directory);
  return new AmirosState(join(directory, "state.json"));
}

function mergeDirectContactInsight(
  state: AmirosState,
  chatId: string,
  input: Partial<Pick<ContactInsight, "canonicalKey" | "validity" | "evolution">> &
    Pick<ContactInsight, "kind" | "content" | "confidence"> & {
      messageId: string;
      source: string;
      timestamp: number;
      contactName: string;
    },
): void {
  state.rememberChatName(chatId, input.contactName);
  state.rememberMessage(chatId, {
    role: "user",
    author: "contact",
    content: input.source,
    senderName: input.contactName,
    messageId: input.messageId,
    timestamp: input.timestamp,
  });
  state.mergeRoutedAnalyzedIntelligence(chatId, {
    insights: [{
      kind: input.kind,
      content: input.content,
      confidence: input.confidence,
      canonicalKey: input.canonicalKey,
      validity: input.validity,
      evolution: input.evolution,
      subjectNames: [input.contactName],
      evidence: {
        messageId: input.messageId,
        excerpt: input.source,
        senderName: input.contactName,
        timestamp: input.timestamp,
      },
    }],
    commitments: [],
  });
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("memory explainability", () => {
  it("derives current and historical explanations from canonical replacement links", () => {
    const state = createState();
    const chatId = "david@c.us";

    mergeDirectContactInsight(state, chatId, {
      kind: "fact",
      content: "David works at Apple.",
      confidence: .98,
      canonicalKey: "employer",
      evolution: "replace",
      messageId: "apple",
      source: "I work at Apple.",
      timestamp: 100,
      contactName: "David",
    });
    const apple = state.getInsights(chatId)[0]!;
    state.updateInsight(chatId, apple.id, { status: "confirmed" });

    mergeDirectContactInsight(state, chatId, {
      kind: "fact",
      content: "David works at Anthropic.",
      confidence: .98,
      canonicalKey: "employer",
      evolution: "replace",
      messageId: "anthropic",
      source: "I left Apple and joined Anthropic.",
      timestamp: 200,
      contactName: "David",
    });

    const insights = state.intelligenceSnapshot().find((item) => item.chatId === chatId)!.insights;
    const current = insights.find((item) => item.content.includes("Anthropic"))!;
    const historical = insights.find((item) => item.content.includes("Apple"))!;

    expect(current.explanation).toMatchObject({
      statusLabel: "Current",
      confidenceLabel: "High confidence",
      replaced: ["David works at Apple"],
    });
    expect(current.explanation?.summary).toContain("previous version is preserved as history");
    expect(historical.explanation).toMatchObject({
      statusLabel: "Historical",
      replacedBy: "David works at Anthropic",
    });
  });

  it("includes explanation metadata in Ask AmirOS search records", () => {
    const state = createState();
    const chatId = "dani@c.us";

    mergeDirectContactInsight(state, chatId, {
      kind: "preference",
      content: "Dani is vegetarian.",
      confidence: .97,
      canonicalKey: "diet",
      evolution: "replace",
      messageId: "vegetarian",
      source: "I'm vegetarian now.",
      timestamp: 300,
      contactName: "Dani",
    });

    const record = state.searchIntelligence("Why do you think Dani is vegetarian?", 10)
      .find((item) => item.kind === "insight" && item.content.includes("vegetarian"));

    expect(record?.explanation).toMatchObject({
      statusLabel: "Current",
      confidenceLabel: "High confidence",
      origin: "a direct statement from Dani",
    });
    expect(record?.explanation?.summary).toContain("direct statement");
  });

  it("explains reinforcement without creating a separate fact", () => {
    const insight: ContactInsight = {
      id: "sushi",
      kind: "preference",
      content: "Dani loves sushi.",
      canonicalKey: "food_preferences",
      validity: "current",
      evolution: "reinforce",
      status: "confirmed",
      confidence: .9,
      reinforcementCount: 3,
      lastReinforcedAt: 300,
      evidence: { messageId: "sushi-1", excerpt: "I love sushi.", senderName: "Dani", timestamp: 100 },
      evidenceHistory: [
        { messageId: "sushi-1", excerpt: "I love sushi.", senderName: "Dani", timestamp: 100 },
        { messageId: "sushi-2", excerpt: "I still love sushi.", senderName: "Dani", timestamp: 300 },
      ],
      createdAt: 100,
      updatedAt: 300,
    };

    const explanation = explainContactInsight(insight, [insight], 400);

    expect(explanation).toMatchObject({
      evidenceCount: 2,
      reinforcedCount: 2,
      freshnessLabel: "Current",
    });
    expect(explanation.summary).toContain("supporting messages reinforce");
  });
});
