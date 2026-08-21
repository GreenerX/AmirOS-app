import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AmirosState, type ContactInsight } from "../src/amiros-state.js";
import { buildNetworkAnswerInstructions } from "../src/ai.js";
import { relationshipQuestionIntent } from "../src/relationship-intelligence.js";

const directories: string[] = [];
const NOW = Date.UTC(2026, 7, 12, 12);

function createState(): AmirosState {
  const directory = mkdtempSync(join(tmpdir(), "amiros-relationship-intelligence-"));
  directories.push(directory);
  return new AmirosState(join(directory, "state.json"));
}

function mergeInsight(
  state: AmirosState,
  chatId: string,
  contactName: string,
  input: Pick<ContactInsight, "content" | "kind" | "confidence"> & Partial<Pick<ContactInsight, "canonicalKey" | "validity" | "evolution" | "topicTitle" | "topicTitleConfidence">> & { id: string; timestamp?: number },
): void {
  const timestamp = input.timestamp || NOW - 2 * 86_400_000;
  state.rememberChatName(chatId, contactName);
  state.rememberMessage(chatId, {
    role: "user", author: "contact", senderName: contactName, messageId: input.id,
    content: input.content, timestamp,
  });
  state.mergeRoutedAnalyzedIntelligence(chatId, {
    insights: [{
      kind: input.kind, content: input.content, confidence: input.confidence,
      canonicalKey: input.canonicalKey, validity: input.validity, evolution: input.evolution,
      topicTitle: input.topicTitle, topicTitleConfidence: input.topicTitleConfidence,
      subjectNames: [contactName],
      evidence: { messageId: input.id, senderName: contactName, excerpt: input.content, timestamp },
    }], commitments: [],
  });
  const insight = state.getInsights(chatId).at(-1)!;
  state.updateInsight(chatId, insight.id, { status: "confirmed" });
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("relationship intelligence", () => {
  it("builds a current, evidence-backed brief with changes, recurring themes, and open relationship context", () => {
    const state = createState();
    const chatId = "david@c.us";
    mergeInsight(state, chatId, "David", {
      id: "apple", kind: "fact", content: "David works at Apple.", confidence: .98,
      canonicalKey: "employer", evolution: "replace", timestamp: NOW - 90 * 86_400_000,
    });
    mergeInsight(state, chatId, "David", {
      id: "anthropic", kind: "fact", content: "David works at Anthropic.", confidence: .98,
      canonicalKey: "employer", evolution: "replace", timestamp: NOW - 2 * 86_400_000,
    });
    mergeInsight(state, chatId, "David", {
      id: "team-1", kind: "fact", content: "David is settling into his new team.", confidence: .96,
      evolution: "reinforce", topicTitle: "Settling into the new team", topicTitleConfidence: .95,
    });
    mergeInsight(state, chatId, "David", {
      id: "team-2", kind: "fact", content: "David is learning how his new team works.", confidence: .96,
      evolution: "reinforce", topicTitle: "Settling into the new team", topicTitleConfidence: .95,
    });
    state.addOwnerCommitment(chatId, {
      content: "send David the onboarding contact", dueAt: NOW + 86_400_000,
      evidence: { excerpt: "I will send it", timestamp: NOW },
    });
    state.addOwnerCalendarEvent(chatId, {
      title: "Dinner with David", startAt: NOW + 3 * 86_400_000, allDay: false,
      evidence: { excerpt: "Dinner next week", timestamp: NOW },
    });

    const result = state.relationshipIntelligence("What has been going on with David lately?", NOW);
    expect(result.requested).toBe(true);
    expect(result.briefs).toHaveLength(1);
    expect(result.briefs[0]).toMatchObject({
      contactName: "David", confidence: "supported",
      currentContext: expect.arrayContaining(["David works at Anthropic"]),
      recurringThemes: ["Settling into the new team"],
      attention: [],
      upcoming: expect.arrayContaining([expect.stringContaining("Dinner with David")]),
    });
    expect(result.briefs[0]?.recentChanges.join(" ")).toContain("previously: David works at Apple");
  });

  it("keeps uncertain and temporary observations out of a broad relationship synthesis", () => {
    const state = createState();
    const chatId = "maya@c.us";
    mergeInsight(state, chatId, "Maya", {
      id: "health", kind: "fact", content: "Maya may be depressed.", confidence: .62,
      validity: "temporary", evolution: "append",
    });
    state.rememberMessage(chatId, { role: "user", author: "owner", content: "Thanks for telling me.", timestamp: NOW - 86_400_000 });

    const result = state.relationshipIntelligence("What is important to Maya right now?", NOW);
    expect(result.briefs[0]).toMatchObject({ contactName: "Maya", confidence: "limited" });
    expect(result.briefs[0]?.currentContext).toEqual([]);
    expect(result.briefs[0]?.recurringThemes).toEqual([]);
    expect(result.briefs[0]?.currentContext.join(" ")).not.toContain("depressed");
  });

  it("does not turn an older transient update into current relationship context", () => {
    const state = createState();
    const chatId = "andrew@c.us";
    mergeInsight(state, chatId, "Andrew", {
      id: "beach-status", kind: "fact",
      content: "Andrew is at the beach and heading home to check email after a temporary syncing problem.", confidence: .97,
      timestamp: NOW - 9 * 86_400_000,
    });

    const result = state.relationshipIntelligence("What recent relationship context should I keep in mind about Andrew?", NOW);
    expect(result.briefs[0]).toMatchObject({ contactName: "Andrew", confidence: "limited", currentContext: [] });
    expect(result.briefs[0]?.sourceIds).toEqual([]);
  });

  it("keeps the original saved message separate from the generated knowledge summary", () => {
    const state = createState();
    const chatId = "maya@c.us";
    state.rememberChatName(chatId, "Maya");
    state.rememberMessage(chatId, {
      role: "user", author: "contact", senderName: "Maya", messageId: "maya-try-app",
      content: "I would love to try AmirOS when it is ready.", timestamp: NOW - 86_400_000,
    });
    state.mergeRoutedAnalyzedIntelligence(chatId, {
      insights: [{
        kind: "fact", content: "Maya wants to try your app.", confidence: .97,
        evidence: { messageId: "maya-try-app", senderName: "Maya", excerpt: "Maya wants to try AmirOS.", timestamp: NOW - 86_400_000 },
      }], commitments: [],
    });
    const insight = state.getInsights(chatId).at(-1)!;
    state.updateInsight(chatId, insight.id, { status: "confirmed" });

    expect(state.intelligenceRecordsByReferences([{ id: insight.id, chatId }], new Set(), NOW)[0]).toMatchObject({
      content: "Maya wants to try your app.",
      sourceContent: "I would love to try AmirOS when it is ready.",
    });
  });

  it("returns a useful reconnection list without inventing a relationship conclusion", () => {
    const state = createState();
    state.rememberChatName("dani@c.us", "Dani");
    state.rememberMessage("dani@c.us", { role: "user", author: "contact", content: "Hi", timestamp: NOW - 55 * 86_400_000 });
    state.rememberChatName("tom@c.us", "Tom");
    state.rememberMessage("tom@c.us", { role: "user", author: "contact", content: "Hi", timestamp: NOW - 7 * 86_400_000 });

    const result = state.relationshipIntelligence("Who have I not spoken with in a while?", NOW);
    expect(result.briefs.map((brief) => brief.contactName)).toEqual(["Dani"]);
    expect(result.briefs[0]?.interactionNote).toContain("55 days");
    expect(result.briefs[0]?.confidence).toBe("insufficient");
  });

  it("asks for a full name instead of mixing two contacts with the same first name", () => {
    const state = createState();
    state.rememberChatName("david-one@c.us", "David Cohen");
    state.rememberChatName("david-two@c.us", "David Levy");
    state.rememberMessage("david-one@c.us", { role: "user", author: "contact", content: "Hi", timestamp: NOW });
    state.rememberMessage("david-two@c.us", { role: "user", author: "contact", content: "Hi", timestamp: NOW });

    const result = state.relationshipIntelligence("What has been going on with David lately?", NOW);
    expect(result).toMatchObject({
      requested: true, briefs: [], disambiguation: ["David Cohen", "David Levy"],
    });
    expect(result.disambiguationCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ chatId: "david-one@c.us", contactName: "David Cohen", identityVerified: true, directChat: true }),
      expect.objectContaining({ chatId: "david-two@c.us", contactName: "David Levy", identityVerified: true, directChat: true }),
    ]));
  });

  it("disambiguates a short status question before a group can become the selected identity", () => {
    const state = createState();
    state.rememberChatName("michelle-soffen@c.us", "Michelle Soffen");
    state.rememberChatName("michelle-chechi@c.us", "Michelle Chechi");
    state.rememberChatName("wonder-crew@g.us", "Wonder Crew");
    state.rememberMessage("michelle-soffen@c.us", { role: "user", author: "contact", content: "Hi", timestamp: NOW });
    state.rememberMessage("michelle-chechi@c.us", { role: "user", author: "contact", content: "Hi", timestamp: NOW });
    state.rememberMessage("wonder-crew@g.us", {
      role: "user", author: "group_member", senderName: "Michelle Soffen",
      content: "I am tired today", timestamp: NOW - 30 * 86_400_000,
    });

    const result = state.relationshipIntelligence("How is Michelle?", NOW);
    expect(result.disambiguationCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ chatId: "michelle-chechi@c.us", contactName: "Michelle Chechi", identityVerified: true, directChat: true }),
      expect.objectContaining({ chatId: "michelle-soffen@c.us", contactName: "Michelle Soffen", identityVerified: true, directChat: true }),
    ]));
    expect(result.disambiguationCandidates?.some((candidate) => candidate.chatId === "wonder-crew@g.us")).toBe(false);
  });

  it("treats an exact full name or a selected stable identity as unambiguous", () => {
    const state = createState();
    state.rememberChatName("david-one@c.us", "David Cohen");
    state.rememberChatName("david-two@c.us", "David Levy");
    state.rememberMessage("david-one@c.us", { role: "user", author: "contact", content: "Hi", timestamp: NOW });
    state.rememberMessage("david-two@c.us", { role: "user", author: "contact", content: "Hi", timestamp: NOW });

    const exactName = state.relationshipIntelligence("What has been going on with David Levy lately?", NOW);
    expect(exactName.disambiguation).toBeUndefined();
    expect(exactName.briefs.map((brief) => brief.chatId)).toEqual(["david-two@c.us"]);

    const selected = state.relationshipIntelligence("What has been going on with David lately?", NOW, "david-one@c.us");
    expect(selected.disambiguation).toBeUndefined();
    expect(selected.briefs.map((brief) => brief.chatId)).toEqual(["david-one@c.us"]);
  });

  it("does not run the relationship projection for an ordinary fact lookup", () => {
    const state = createState();
    expect(state.relationshipIntelligence("Where does David work?", NOW)).toEqual({ requested: false, briefs: [] });
  });

  it("recognizes natural change and preparation questions without changing an ordinary lookup", () => {
    const state = createState();
    state.rememberChatName("dani@c.us", "Dani");
    state.rememberMessage("dani@c.us", { role: "user", author: "contact", content: "See you tomorrow", timestamp: NOW });
    expect(state.relationshipIntelligence("Has anything changed with Dani recently?", NOW).requested).toBe(true);
    expect(state.relationshipIntelligence("What should I remember before seeing Dani tomorrow?", NOW).requested).toBe(true);
    expect(state.relationshipIntelligence("What is new with Dani?", NOW)).toMatchObject({
      requested: true,
      resolvedChatId: "dani@c.us",
    });
  });

  it("brings a named contact's newest direct messages into a current brief while insight extraction catches up", () => {
    const state = createState();
    const chatId = "dan@c.us";
    state.rememberChatName(chatId, "Dan Pundak");
    mergeInsight(state, chatId, "Dan Pundak", {
      id: "dan-work", kind: "fact", content: "Dan has customer insights to share about your work together.", confidence: .96,
      timestamp: NOW - 3 * 86_400_000,
    });
    state.rememberMessage(chatId, {
      role: "user", author: "contact", senderName: "Dan Pundak", messageId: "dan-today",
      content: "I have a new customer update from this morning that I want to share with you.", timestamp: NOW - 90 * 60_000,
    });

    const relationship = state.relationshipIntelligence("What is new with Dan?", NOW);
    const records = state.searchIntelligence("What is new with Dan?", 48, new Set(), NOW);
    const filtered = state.relationshipRecordsForQuestion("What is new with Dan?", records, relationship, NOW);
    expect(relationship.resolvedChatId).toBe(chatId);
    expect(filtered).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "dan-today", kind: "message", sourceAuthor: "contact" }),
      expect.objectContaining({ id: expect.any(String), kind: "insight" }),
    ]));
  });

  it("keeps past calendar plans out of a current preparation brief while retaining a future plan", () => {
    const state = createState();
    const chatId = "morgan@c.us";
    state.rememberChatName(chatId, "Morgan");
    state.addOwnerCalendarEvent(chatId, {
      title: "Dinner with Morgan", startAt: NOW - 5 * 86_400_000, allDay: false,
      evidence: { excerpt: "Dinner", timestamp: NOW - 10 * 86_400_000 },
    });
    state.addOwnerCalendarEvent(chatId, {
      title: "Coffee with Morgan", startAt: NOW + 2 * 86_400_000, allDay: false,
      evidence: { excerpt: "Coffee", timestamp: NOW },
    });

    const result = state.relationshipIntelligence("What should I remember before seeing Morgan?", NOW);
    expect(result).toMatchObject({ requested: true, temporalFocus: "current" });
    expect(result.briefs[0]?.upcoming).toEqual([expect.stringContaining("Coffee with Morgan")]);
    expect(result.briefs[0]?.upcoming.join(" ")).not.toContain("Dinner with Morgan");

    const records = state.searchIntelligence("What should I remember before seeing Morgan?", 20, new Set(), NOW);
    const filtered = state.relationshipRecordsForQuestion("What should I remember before seeing Morgan?", records, result, NOW);
    expect(filtered.some((record) => record.kind === "calendar_event" && record.content.includes("Dinner with Morgan"))).toBe(false);
    expect(filtered.some((record) => record.kind === "calendar_event" && record.content.includes("Coffee with Morgan"))).toBe(true);
  });

  it("resolves proactive suggestion sources only while every referenced plan is still current", () => {
    const state = createState();
    const chatId = "laura@c.us";
    state.rememberChatName(chatId, "Laura");
    const future = state.addOwnerCalendarEvent(chatId, {
      title: "Laura's house party", startAt: NOW + 2 * 86_400_000, allDay: false,
      evidence: { excerpt: "Saturday at 8 at Laura's", timestamp: NOW },
    }).event;
    const past = state.addOwnerCalendarEvent(chatId, {
      title: "Old dinner", startAt: NOW - 3 * 86_400_000, allDay: false,
      evidence: { excerpt: "Dinner last week", timestamp: NOW - 8 * 86_400_000 },
    }).event;

    expect(state.intelligenceRecordsByReferences([{ id: future.id, chatId }], new Set(), NOW))
      .toEqual([expect.objectContaining({ id: future.id, kind: "calendar_event", score: 100 })]);
    expect(state.intelligenceRecordsByReferences([{ id: past.id, chatId }], new Set(), NOW)).toEqual([]);
    expect(state.intelligenceRecordsByReferences([{ id: "missing", chatId }], new Set(), NOW)).toEqual([]);
  });

  it("keeps historical calendar context when the owner asks about the past", () => {
    const state = createState();
    const chatId = "morgan@c.us";
    state.rememberChatName(chatId, "Morgan");
    state.addOwnerCalendarEvent(chatId, {
      title: "Dinner with Morgan", startAt: NOW - 5 * 86_400_000, allDay: false,
      evidence: { excerpt: "Dinner", timestamp: NOW - 10 * 86_400_000 },
    });

    const result = state.relationshipIntelligence("What happened with Morgan last time?", NOW);
    expect(result).toMatchObject({ requested: true, temporalFocus: "historical" });
    expect(result.briefs[0]?.upcoming).toEqual([expect.stringContaining("Dinner with Morgan")]);
    const historicalRecords = state.searchIntelligence("historical events", 20, new Set(), NOW);
    expect(historicalRecords.some((record) => record.kind === "calendar_event" && record.content.includes("Dinner with Morgan"))).toBe(true);
  });

  it("sets a natural briefing boundary for Ask AmirOS", () => {
    const instructions = buildNetworkAnswerInstructions("Amir", NOW);
    expect(instructions).toContain("speak warmly and naturally");
    expect(instructions).toContain("Never say “supplied records,” “retrieved context,” “newer update,” “supporting data,”");
    expect(instructions).toContain("what the owner should know, not what the owner should do");
    expect(instructions).toContain("Never present past events as upcoming");
    expect(instructions).toContain("authoritative current local date and time");
    expect(instructions).toContain("Never repeat “today” as current truth");
    expect(instructions).toContain("current status is unknown unless newer evidence confirms it");
    expect(instructions).toContain("one conversation or one source");
    expect(instructions).toContain("selectedDiscovery is true");
  });

  it("routes upcoming and advice questions through distinct relationship lenses", () => {
    expect(relationshipQuestionIntent("What’s coming up with Andrew?")).toMatchObject({ focus: "upcoming", adviceRequested: false });
    expect(relationshipQuestionIntent("What should I do about Dan?")).toMatchObject({ focus: "general", adviceRequested: true });
  });
});
