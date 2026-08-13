import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AmirosState } from "../src/amiros-state.js";
import {
  correctionClarification,
  looksLikeMemoryCorrection,
  resolveMemoryCorrection,
} from "../src/memory-correction.js";

const directories: string[] = [];

function createState(): { state: AmirosState; filePath: string } {
  const directory = mkdtempSync(join(tmpdir(), "amiros-memory-correction-"));
  directories.push(directory);
  const filePath = join(directory, "state.json");
  return { state: new AmirosState(filePath), filePath };
}

function addFact(state: AmirosState, content: string, messageId: string, canonicalKey = "employer") {
  const chatId = "david@c.us";
  state.rememberChatName(chatId, "David");
  state.rememberMessage(chatId, {
    role: "user", author: "contact", senderName: "David", messageId,
    content: content.replace(/^David /u, "I "), timestamp: 100,
  });
  state.mergeRoutedAnalyzedIntelligence(chatId, {
    insights: [{
      kind: "fact", content, confidence: .98, canonicalKey, validity: "current", evolution: "replace",
      subjectNames: ["David"], evidence: { messageId, excerpt: content, senderName: "David", timestamp: 100 },
    }], commitments: [],
  });
  const insight = state.getInsights(chatId)[0]!;
  state.updateInsight(chatId, insight.id, { status: "confirmed" });
  return { chatId, insight: state.getInsights(chatId)[0]! };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("memory correction and control", () => {
  it.each([
    "That’s wrong.",
    "Forget that.",
    "That was temporary.",
    "Don’t use that anymore.",
    "Why are you still saying this?",
  ])("recognizes natural owner correction language: %s", (request) => {
    expect(looksLikeMemoryCorrection(request)).toBe(true);
  });

  it("rejects an incorrect fact without deleting its evidence and excludes it from current retrieval", () => {
    const { state } = createState();
    const { chatId, insight } = addFact(state, "David works at Google.", "google");

    const applied = state.applyMemoryCorrection({
      chatId, insightId: insight.id, operation: "reject", sourceText: "That’s wrong.",
    });

    expect(applied?.previous.content).toBe("David works at Google.");
    expect(state.getInsights(chatId)[0]).toMatchObject({ status: "outdated" });
    expect(state.searchIntelligence("Where does David work?", 10).some((record) => record.id === insight.id)).toBe(false);
    expect(state.getConversationMemory(chatId).some((entry) => entry.messageId === "google")).toBe(true);
  });

  it("marks a fact historical so it remains available for history but not current truth", () => {
    const { state } = createState();
    const { chatId, insight } = addFact(state, "David works at Apple.", "apple");

    state.applyMemoryCorrection({ chatId, insightId: insight.id, operation: "historical", sourceText: "That used to be true." });

    expect(state.getInsights(chatId)[0]).toMatchObject({ status: "confirmed", validity: "historical" });
    expect(state.searchIntelligence("Where does David work now?", 10).some((record) => record.id === insight.id)).toBe(false);
    expect(state.searchIntelligence("Where did David work previously?", 10).some((record) => record.id === insight.id)).toBe(true);
  });

  it("replaces a canonical fact, preserves the prior truth as history, and invalidates profile prose", () => {
    const { state, filePath } = createState();
    const { chatId, insight } = addFact(state, "David works at Apple.", "apple");
    state.setContactProfile(chatId, "David works at Apple.");

    const applied = state.applyMemoryCorrection({
      chatId, insightId: insight.id, operation: "replace", replacementContent: "David works at Anthropic.",
      sourceText: "David doesn’t work at Apple anymore. He works at Anthropic.",
    });
    const reloaded = new AmirosState(filePath);

    expect(applied?.current).toMatchObject({ content: "David works at Anthropic.", status: "confirmed", validity: "current" });
    expect(reloaded.getInsights(chatId).find((item) => item.id === insight.id)).toMatchObject({ validity: "historical" });
    expect(reloaded.searchIntelligence("Where does David work now?", 10)[0]).toMatchObject({ content: "David works at Anthropic." });
    expect(reloaded.getContactProfile(chatId)).toMatchObject({ staleReason: "canonical_knowledge_changed" });
  });

  it("keeps linked copies and every original evidence message in a correction audit", () => {
    const { state } = createState();
    const { chatId, insight } = addFact(state, "David works at Apple.", "apple-private");
    const groupChatId = "friends@g.us";
    state.rememberChatName(groupChatId, "Friends");
    state.mergeAnalyzedIntelligence(groupChatId, {
      insights: [{
        clusterId: insight.clusterId, subjectChatIds: [chatId, groupChatId],
        kind: "fact", content: "David works at Apple.", confidence: .98, canonicalKey: "employer", validity: "current", evolution: "replace",
        subjectNames: ["David"], evidence: { messageId: "apple-group", excerpt: "David works at Apple.", senderName: "Dani", timestamp: 101 },
      }], commitments: [],
    });

    const applied = state.applyMemoryCorrection({
      chatId, insightId: insight.id, operation: "forget", sourceText: "Forget that David works at Apple.",
    });

    expect(applied?.affectedChatIds).toEqual(expect.arrayContaining([chatId, groupChatId]));
    expect(applied?.correction.evidenceMessageIds).toEqual(expect.arrayContaining(["apple-private", "apple-group"]));
  });

  it("keeps a forgotten claim suppressed when the same old evidence is analyzed again", () => {
    const { state } = createState();
    const { chatId, insight } = addFact(state, "David likes golf.", "golf", "hobby");
    state.applyMemoryCorrection({ chatId, insightId: insight.id, operation: "forget", sourceText: "Forget that David likes golf." });

    state.mergeRoutedAnalyzedIntelligence(chatId, {
      insights: [{
        kind: "fact", content: "David likes golf.", confidence: .98, canonicalKey: "hobby", validity: "current", evolution: "append",
        subjectNames: ["David"], evidence: { messageId: "golf", excerpt: "I like golf.", senderName: "David", timestamp: 100 },
      }], commitments: [],
    });

    expect(state.getInsights(chatId).filter((item) => item.content === "David likes golf.")).toHaveLength(1);
    expect(state.getInsights(chatId)[0]).toMatchObject({ status: "outdated" });
  });

  it("uses one supported previous answer deterministically and does not guess among several memories", async () => {
    const candidates = [{ id: "apple", chatId: "david", content: "David works at Apple.", status: "confirmed" as const, knowledgeValidity: "current" as const, kind: "fact" as const }];
    const resolved = await resolveMemoryCorrection({
      request: "That’s wrong.", candidates,
      interpret: async () => { throw new Error("AI should not run for a single explicit correction"); },
    });
    expect(resolved.interpretation).toMatchObject({ operation: "reject", targetIds: ["apple"] });

    const severalCandidates = [...candidates, { ...candidates[0]!, id: "anthropic", content: "David works at Anthropic." }];
    const ambiguous = await resolveMemoryCorrection({
      request: "That’s wrong.",
      candidates: severalCandidates,
      interpret: async () => ({ operation: "reject", targetIds: [], confidence: 10, reason: "Several facts could be meant." }),
    });
    expect(ambiguous.needsClarification).toBe(true);
    expect(ambiguous.interpretation).toBeUndefined();
    expect(correctionClarification(severalCandidates)).toContain("more than one memory");
  });

  it("treats a supported temporary observation as historical rather than deleting it", async () => {
    const candidates = [{ id: "health", chatId: "david", content: "David is sick this week.", status: "confirmed" as const, knowledgeValidity: "temporary" as const, kind: "fact" as const }];
    const resolved = await resolveMemoryCorrection({
      request: "That was temporary.", candidates,
      interpret: async () => { throw new Error("AI should not run for an explicit temporary correction"); },
    });
    expect(resolved.interpretation).toMatchObject({ operation: "historical", targetIds: ["health"] });
  });

  it("keeps canonical memory unchanged when an ambiguous AI interpretation is unavailable", async () => {
    const candidates = [{ id: "apple", chatId: "david", content: "David works at Apple.", status: "confirmed" as const, knowledgeValidity: "current" as const, kind: "fact" as const }];
    const resolved = await resolveMemoryCorrection({
      request: "David doesn't work there anymore. He works at Anthropic.", candidates,
      interpret: async () => ({
        operation: "replace",
        targetIds: ["apple"],
        replacementContent: "David works at Anthropic.",
        confidence: 98,
        reason: "The owner supplied a replacement job.",
      }),
    });
    expect(resolved).toMatchObject({ needsClarification: false, interpretation: { operation: "replace", targetIds: ["apple"] } });

    const unavailable = await resolveMemoryCorrection({
      request: "Actually, update it.", candidates,
      interpret: async () => { throw new Error("AI unavailable"); },
    });
    expect(unavailable.needsClarification).toBe(true);
    expect(unavailable.interpretation).toBeUndefined();
  });
});
