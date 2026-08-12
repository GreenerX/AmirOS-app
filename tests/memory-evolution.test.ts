import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildContactProfilePrompt } from "../src/ai.js";
import { AmirosState, type ContactInsight } from "../src/amiros-state.js";
import { assessKnowledgeFreshness } from "../src/memory-maintenance.js";

const directories: string[] = [];

function createState(): { state: AmirosState; filePath: string } {
  const directory = mkdtempSync(join(tmpdir(), "amiros-memory-evolution-"));
  directories.push(directory);
  const filePath = join(directory, "state.json");
  return { state: new AmirosState(filePath), filePath };
}

function mergeInsight(
  state: AmirosState,
  chatId: string,
  input: Partial<Pick<ContactInsight, "canonicalKey" | "validity" | "evolution">> & Pick<ContactInsight, "kind" | "content" | "confidence"> & { messageId: string; timestamp: number },
): void {
  state.mergeAnalyzedIntelligence(chatId, {
    insights: [{
      kind: input.kind,
      content: input.content,
      confidence: input.confidence,
      canonicalKey: input.canonicalKey,
      validity: input.validity,
      evolution: input.evolution,
      evidence: { messageId: input.messageId, excerpt: input.content, timestamp: input.timestamp },
    }],
    commitments: [],
  });
}

function mergeDirectContactInsight(
  state: AmirosState,
  chatId: string,
  input: Partial<Pick<ContactInsight, "canonicalKey" | "validity" | "evolution" | "topicTitle">> &
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
      topicTitle: input.topicTitle,
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

function recentTimestamp(offset = 0): number {
  return Date.now() - offset;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("canonical memory evolution", () => {
  it("keeps stable dates timeless while aging temporary and weak observations conservatively", () => {
    const now = Date.UTC(2026, 7, 12);
    const base = {
      status: "confirmed" as const,
      confidence: .8,
      evidence: { excerpt: "evidence", timestamp: now - 900 * 86_400_000 },
      updatedAt: now - 900 * 86_400_000,
    };
    expect(assessKnowledgeFreshness({ ...base, kind: "important_date", content: "David's birthday is March 4.", canonicalKey: "birthday" }, now).state).toBe("timeless");
    expect(assessKnowledgeFreshness({ ...base, kind: "fact", content: "David is sick this week.", validity: "temporary" }, now)).toMatchObject({ state: "stale", qualify: true });
    expect(assessKnowledgeFreshness({ ...base, kind: "preference", content: "David likes ramen." }, now)).toMatchObject({ state: "stale", qualify: true });
    expect(assessKnowledgeFreshness({ ...base, kind: "preference", content: "David likes ramen.", reinforcementCount: 3 }, now).state).toBe("aging");
  });

  it("automatically confirms repeated direct evidence and preserves the prior truth as history", () => {
    const { state, filePath } = createState();
    const chatId = "dani@c.us";
    mergeInsight(state, chatId, {
      kind: "fact", content: "Dani lives in Tel Aviv.", confidence: .97,
      canonicalKey: "residence", evolution: "replace", messageId: "tel-aviv", timestamp: 100,
    });
    const oldResidence = state.getInsights(chatId)[0]!;
    state.updateInsight(chatId, oldResidence.id, { status: "confirmed" });

    state.rememberChatName(chatId, "Dani");
    for (const [messageId, source, timestamp] of [
      ["ny-home", "My new home is in New York.", 200],
      ["ny-neighborhood", "My neighborhood in New York is wonderful.", 300],
    ] as const) {
      state.rememberMessage(chatId, { role: "user", author: "contact", senderName: "Dani", content: source, messageId, timestamp });
      state.mergeRoutedAnalyzedIntelligence(chatId, {
        insights: [{
          kind: "fact", content: "Dani lives in New York.", confidence: .9,
          canonicalKey: "residence", evolution: messageId === "ny-home" ? "replace" : "reinforce",
          subjectNames: ["Dani"], evidence: { messageId, excerpt: source, senderName: "Dani", timestamp },
        }],
        commitments: [],
      });
    }

    const reloaded = new AmirosState(filePath);
    const current = reloaded.getInsights(chatId).find((item) => item.content.includes("New York"))!;
    expect(current).toMatchObject({
      status: "confirmed", validity: "current", maintenanceConfirmationReason: "repeated_direct_evidence",
      reinforcementCount: 2,
    });
    expect(reloaded.getInsights(chatId).find((item) => item.id === oldResidence.id)).toMatchObject({
      status: "confirmed", validity: "historical", supersededById: current.id,
    });
  });

  it("invalidates stale profile prose after canonical truth changes and excludes it from retrieval", () => {
    const { state, filePath } = createState();
    const chatId = "david@c.us";
    mergeInsight(state, chatId, {
      kind: "fact", content: "David works at Apple.", confidence: .97,
      canonicalKey: "employer", evolution: "replace", messageId: "apple", timestamp: recentTimestamp(10_000),
    });
    state.updateInsight(chatId, state.getInsights(chatId)[0]!.id, { status: "confirmed" });
    state.setContactProfile(chatId, "David works at Apple and enjoys the team.");

    mergeDirectContactInsight(state, chatId, {
      kind: "fact", content: "David works at Anthropic.", confidence: .98,
      canonicalKey: "employer", evolution: "replace", messageId: "anthropic",
      source: "I left Apple and joined Anthropic.", timestamp: recentTimestamp(), contactName: "David",
    });

    const reloaded = new AmirosState(filePath);
    expect(reloaded.getContactProfile(chatId)).toMatchObject({ staleReason: "canonical_knowledge_changed", staleAt: expect.any(Number) });
    expect(reloaded.searchIntelligence("Where does David work now?", 20).some((item) => item.kind === "profile")).toBe(false);
    expect(reloaded.searchIntelligence("Where does David work now?", 20)[0]).toMatchObject({ content: "David works at Anthropic.", knowledgeFreshness: "fresh" });
  });

  it("persists freshness projections and keeps stale temporary topics out of People", () => {
    const { state, filePath } = createState();
    const chatId = "david@c.us";
    const old = Date.now() - 45 * 86_400_000;
    mergeInsight(state, chatId, {
      kind: "fact", content: "David is sick this week.", confidence: .95,
      validity: "temporary", evolution: "append", messageId: "sick", timestamp: old,
    });
    state.updateInsight(chatId, state.getInsights(chatId)[0]!.id, { status: "confirmed" });

    const reloaded = new AmirosState(filePath);
    expect(reloaded.intelligenceSnapshot()[0]?.insights[0]).toMatchObject({ validity: "temporary", freshness: "stale" });
    expect(reloaded.searchIntelligence("Is David sick?", 10, new Set(), Date.now())[0]).toMatchObject({ knowledgeFreshness: "stale", knowledgeNeedsQualification: true });
  });
  it("reinforces and refines one canonical preference instead of accumulating duplicates", () => {
    const { state } = createState();
    const chatId = "dani@c.us";
    mergeInsight(state, chatId, {
      kind: "preference", content: "Dani likes sushi.", confidence: .82,
      canonicalKey: "food_preferences", evolution: "reinforce", messageId: "sushi", timestamp: 100,
    });
    const original = state.getInsights(chatId)[0]!;
    state.updateInsight(chatId, original.id, { status: "confirmed" });

    mergeInsight(state, chatId, {
      kind: "preference", content: "Dani loves Japanese food, especially sushi.", confidence: .9,
      canonicalKey: "food preferences", evolution: "reinforce", messageId: "japanese", timestamp: 200,
    });

    expect(state.getInsights(chatId)).toEqual([expect.objectContaining({
      id: original.id,
      content: "Dani loves Japanese food, especially sushi.",
      canonicalKey: "food_preferences",
      status: "confirmed",
      validity: "current",
      reinforcementCount: 2,
      lastReinforcedAt: 200,
      evidenceHistory: expect.arrayContaining([
        expect.objectContaining({ messageId: "sushi" }),
        expect.objectContaining({ messageId: "japanese" }),
      ]),
    })]);
    expect(state.getInsights(chatId)[0]!.confidence).toBeGreaterThan(.82);
  });

  it("keeps an approved replacement pending, then makes the old truth historical after approval", () => {
    const { state, filePath } = createState();
    const chatId = "david@c.us";
    state.rememberChatName(chatId, "David");
    mergeInsight(state, chatId, {
      kind: "fact", content: "David works at Apple.", confidence: .96,
      canonicalKey: "employer", evolution: "replace", messageId: "apple", timestamp: 100,
    });
    const apple = state.getInsights(chatId)[0]!;
    state.updateInsight(chatId, apple.id, { status: "confirmed" });

    mergeInsight(state, chatId, {
      kind: "fact", content: "David left Apple and joined Anthropic.", confidence: .98,
      canonicalKey: "employer", evolution: "replace", messageId: "anthropic", timestamp: 200,
    });
    const pending = state.getInsights(chatId).find((item) => item.id !== apple.id)!;
    expect(state.getInsights(chatId).find((item) => item.id === apple.id)?.validity).toBe("current");
    expect(pending.status).toBe("inferred");

    state.updateInsight(chatId, pending.id, { status: "confirmed" });
    const reloaded = new AmirosState(filePath);
    expect(reloaded.getInsights(chatId).find((item) => item.id === apple.id)).toMatchObject({
      status: "confirmed", validity: "historical", supersededById: pending.id, supersededAt: expect.any(Number),
    });
    expect(reloaded.getInsights(chatId).find((item) => item.id === pending.id)).toMatchObject({
      status: "confirmed", validity: "current",
    });

    expect(reloaded.searchIntelligence("Where does David work now?", 10)[0]).toMatchObject({ id: pending.id, knowledgeValidity: "current" });
    expect(reloaded.searchIntelligence("Where did David work previously at Apple?", 10)[0]).toMatchObject({ id: apple.id, knowledgeValidity: "historical" });
  });

  it("autonomously promotes a direct high-confidence employment change and preserves the old employer", () => {
    const { state, filePath } = createState();
    const chatId = "david@c.us";
    mergeInsight(state, chatId, {
      kind: "fact", content: "David works at Apple.", confidence: .96,
      canonicalKey: "employer", evolution: "replace", messageId: "apple", timestamp: 100,
    });
    const apple = state.getInsights(chatId)[0]!;
    state.updateInsight(chatId, apple.id, { status: "confirmed" });

    mergeDirectContactInsight(state, chatId, {
      kind: "fact", content: "David works at Anthropic.", confidence: .98,
      canonicalKey: "employer", evolution: "replace", messageId: "anthropic",
      source: "I left Apple and joined Anthropic.", timestamp: 200, contactName: "David",
    });

    const reloaded = new AmirosState(filePath);
    const current = reloaded.getInsights(chatId).find((item) => item.content.includes("Anthropic"))!;
    const historical = reloaded.getInsights(chatId).find((item) => item.id === apple.id)!;
    expect(current).toMatchObject({
      status: "confirmed",
      validity: "current",
      autonomousConfirmationReason: "direct_contact_statement",
      autonomouslyConfirmedAt: expect.any(Number),
    });
    expect(historical).toMatchObject({ status: "confirmed", validity: "historical", supersededById: current.id });
    expect(reloaded.searchIntelligence("Where does David work now?", 10)[0]).toMatchObject({ id: current.id, knowledgeValidity: "current" });
    expect(reloaded.searchIntelligence("Where did David work before?", 10)[0]).toMatchObject({ id: historical.id, knowledgeValidity: "historical" });
  });

  it("autonomously replaces a direct residence update and gives profiles only the new current home", () => {
    const { state } = createState();
    const chatId = "dani@c.us";
    mergeInsight(state, chatId, {
      kind: "fact", content: "Dani lives in Tel Aviv.", confidence: .97,
      canonicalKey: "residence", evolution: "replace", messageId: "tel-aviv", timestamp: 100,
    });
    const telAviv = state.getInsights(chatId)[0]!;
    state.updateInsight(chatId, telAviv.id, { status: "confirmed" });

    mergeDirectContactInsight(state, chatId, {
      kind: "fact", content: "Dani lives in New York.", confidence: .97,
      canonicalKey: "residence", evolution: "replace", messageId: "new-york",
      source: "I moved to New York.", timestamp: 200, contactName: "Dani",
    });

    const current = state.getInsights(chatId).find((item) => item.content.includes("New York"))!;
    expect(current.status).toBe("confirmed");
    expect(state.getInsights(chatId).find((item) => item.id === telAviv.id)?.validity).toBe("historical");
    const profilePrompt = buildContactProfilePrompt({
      contactName: "Dani", relationship: "Partner", manualMemory: [], memory: [], insights: state.getInsights(chatId),
    });
    expect(profilePrompt).toContain("Confirmed relationship knowledge:\n- fact: Dani lives in New York.");
    expect(profilePrompt).toContain("Historical relationship knowledge (past context only; never present as current truth):\n- fact: Dani lives in Tel Aviv.");
  });

  it("reinforces a confirmed dietary change without creating duplicates", () => {
    const { state } = createState();
    const chatId = "dani@c.us";
    mergeInsight(state, chatId, {
      kind: "fact", content: "Dani eats meat.", confidence: .95,
      canonicalKey: "diet", evolution: "replace", messageId: "meat", timestamp: 100,
    });
    const meat = state.getInsights(chatId)[0]!;
    state.updateInsight(chatId, meat.id, { status: "confirmed" });
    mergeDirectContactInsight(state, chatId, {
      kind: "fact", content: "Dani is vegetarian.", confidence: .98,
      canonicalKey: "diet", evolution: "replace", messageId: "vegetarian",
      source: "I'm vegetarian now.", timestamp: 200, contactName: "Dani",
    });
    mergeDirectContactInsight(state, chatId, {
      kind: "fact", content: "Dani is vegetarian.", confidence: .98,
      canonicalKey: "diet", evolution: "reinforce", messageId: "vegetarian-still",
      source: "I am still vegetarian.", timestamp: 300, contactName: "Dani",
    });

    const diet = state.getInsights(chatId).filter((item) => item.canonicalKey === "diet");
    expect(diet).toHaveLength(2);
    const vegetarian = diet.find((item) => item.validity === "current")!;
    expect(vegetarian).toMatchObject({ status: "confirmed", reinforcementCount: 2 });
    expect(vegetarian.evidenceHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ messageId: "vegetarian" }),
      expect.objectContaining({ messageId: "vegetarian-still" }),
    ]));
    expect(diet.find((item) => item.id === meat.id)?.validity).toBe("historical");
  });

  it("autonomously accepts a direct high-confidence preference once", () => {
    const { state } = createState();
    const chatId = "dani@c.us";
    mergeDirectContactInsight(state, chatId, {
      kind: "preference", content: "Dani prefers window seats when flying.", confidence: .97,
      canonicalKey: "travel_preferences", evolution: "append", messageId: "window-seat",
      source: "I prefer window seats when I fly.", timestamp: 100, contactName: "Dani",
    });
    mergeDirectContactInsight(state, chatId, {
      kind: "preference", content: "Dani prefers window seats when flying.", confidence: .98,
      canonicalKey: "travel_preferences", evolution: "reinforce", messageId: "window-seat-repeat",
      source: "I still prefer the window seat.", timestamp: 200, contactName: "Dani",
    });

    expect(state.getInsights(chatId)).toEqual([
      expect.objectContaining({
        status: "confirmed",
        autonomousConfirmationReason: "direct_contact_statement",
        reinforcementCount: 2,
      }),
    ]);
  });

  it("does not autonomously promote a high-confidence group assertion", () => {
    const { state } = createState();
    const chatId = "friends@g.us";
    state.rememberMessage(chatId, {
      role: "user", author: "group_member", content: "I joined Anthropic.", senderName: "David",
      messageId: "group-employer", timestamp: 100,
    });
    state.mergeRoutedAnalyzedIntelligence(chatId, {
      insights: [{
        kind: "fact", content: "David works at Anthropic.", confidence: .99,
        canonicalKey: "employer", evolution: "replace", subjectNames: ["David"],
        evidence: { messageId: "group-employer", excerpt: "I joined Anthropic.", senderName: "David", timestamp: 100 },
      }],
      commitments: [],
    });

    expect(state.getInsights(chatId)).toEqual([expect.objectContaining({ status: "inferred" })]);
  });

  it("keeps uncertain replacement language pending and leaves confirmed knowledge current", () => {
    const { state } = createState();
    const chatId = "dani@c.us";
    mergeInsight(state, chatId, {
      kind: "fact", content: "Dani lives in Tel Aviv.", confidence: .96,
      canonicalKey: "residence", evolution: "replace", messageId: "tel-aviv", timestamp: 100,
    });
    const telAviv = state.getInsights(chatId)[0]!;
    state.updateInsight(chatId, telAviv.id, { status: "confirmed" });

    mergeDirectContactInsight(state, chatId, {
      kind: "fact", content: "Dani lives in New York.", confidence: .99,
      canonicalKey: "residence", evolution: "replace", messageId: "maybe-new-york",
      source: "I might move to New York.", timestamp: 200, contactName: "Dani",
    });

    expect(state.getInsights(chatId).find((item) => item.id === telAviv.id)).toMatchObject({ status: "confirmed", validity: "current" });
    expect(state.getInsights(chatId).find((item) => item.content.includes("New York"))).toMatchObject({ status: "inferred", validity: "current" });
  });

  it("preserves explicit historical facts and independent current values without unsafe replacement", () => {
    const { state } = createState();
    const chatId = "dani@c.us";
    state.rememberChatName(chatId, "Dani");
    mergeInsight(state, chatId, {
      kind: "fact", content: "Dani currently lives in Tel Aviv.", confidence: .97,
      canonicalKey: "residence", evolution: "replace", messageId: "tel-aviv", timestamp: 300,
    });
    mergeInsight(state, chatId, {
      kind: "fact", content: "Dani lived in Tucson during college.", confidence: .94,
      canonicalKey: "residence", validity: "historical", evolution: "append", messageId: "tucson", timestamp: 100,
    });
    for (const insight of state.getInsights(chatId)) state.updateInsight(chatId, insight.id, { status: "confirmed" });

    mergeInsight(state, chatId, {
      kind: "preference", content: "Dani likes Italian food.", confidence: .8,
      canonicalKey: "food_preferences", evolution: "append", messageId: "italian", timestamp: 400,
    });
    mergeInsight(state, chatId, {
      kind: "preference", content: "Dani likes Thai food.", confidence: .8,
      canonicalKey: "food_preferences", evolution: "append", messageId: "thai", timestamp: 500,
    });

    expect(state.getInsights(chatId).filter((item) => item.canonicalKey === "residence")).toHaveLength(2);
    expect(state.searchIntelligence("Where does Dani live?", 10)[0].content).toContain("Tel Aviv");
    expect(state.searchIntelligence("Where did Dani live previously?", 10).some((record) => record.content.includes("Tucson"))).toBe(true);
    expect(state.getInsights(chatId).filter((item) => item.canonicalKey === "food_preferences")).toHaveLength(2);
  });

  it("gives profile generation current truth while clearly separating historical context", () => {
    const insights: ContactInsight[] = [
      {
        id: "current", kind: "fact", content: "Dani lives in Tel Aviv.", canonicalKey: "residence", validity: "current",
        status: "confirmed", confidence: .98, evidence: { excerpt: "I live in Tel Aviv", timestamp: 200 }, createdAt: 200, updatedAt: 200,
      },
      {
        id: "past", kind: "fact", content: "Dani lived in Tucson.", canonicalKey: "residence", validity: "historical",
        status: "confirmed", confidence: .95, evidence: { excerpt: "I lived in Tucson", timestamp: 100 }, createdAt: 100, updatedAt: 100,
      },
    ];
    const prompt = buildContactProfilePrompt({
      contactName: "Dani", relationship: "Partner", manualMemory: [], memory: [], insights,
    });
    expect(prompt).toContain("Confirmed relationship knowledge:\n- fact: Dani lives in Tel Aviv.");
    expect(prompt).toContain("Historical relationship knowledge (past context only; never present as current truth):\n- fact: Dani lived in Tucson.");
  });
});
