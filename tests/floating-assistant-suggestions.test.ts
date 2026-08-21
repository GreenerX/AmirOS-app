import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ASSISTANT_DISCOVERY_VISIBLE_COUNT,
  buildAssistantSuggestionCards,
  rotateAssistantSuggestions,
  type AssistantSuggestionCard,
} from "../ui/src/assistant-suggestions.js";
import type { ChatSummary, IntelligenceCandidate, IntelligenceData } from "../ui/src/types.js";

const now = new Date(2026, 7, 21, 10).getTime();

const chats: ChatSummary[] = [
  { id: "dani@c.us", name: "Dani Cohen", isGroup: false, unreadCount: 0, timestamp: now, preview: "Can you send the address?", mode: "off", avatarUrl: "/dani.jpg" },
  { id: "maya@c.us", name: "Maya Levi", isGroup: false, unreadCount: 0, timestamp: now, preview: "Dinner next week", mode: "off", avatarUrl: "/maya.jpg" },
  { id: "yuvi@c.us", name: "Yuvi Shalev", isGroup: false, unreadCount: 0, timestamp: now, preview: "I started a new role", mode: "off", avatarUrl: "/yuvi.jpg" },
  { id: "group@g.us", name: "Family group", isGroup: true, unreadCount: 0, timestamp: now, preview: "Hello", mode: "off", avatarUrl: "/group.jpg" },
];

function candidate(
  id: string,
  lane: IntelligenceCandidate["lane"],
  chatId = "dani@c.us",
  overrides: Partial<IntelligenceCandidate> = {},
): IntelligenceCandidate {
  const contactName = chats.find((chat) => chat.id === chatId)?.name || "Dani Cohen";
  const messageId = `${id}-message`;
  return {
    id,
    lane,
    chatId,
    contactName,
    title: `${lane} title`,
    preview: `${contactName} shared an exact detail worth opening.`,
    question: `What does ${contactName} want me to know?`,
    sourceIds: [`${id}-record`],
    evidence: [{
      messageId,
      chatId,
      conversationName: contactName,
      authorName: contactName,
      timestamp: now - 60_000,
      originalText: `Original message for ${id}.`,
      exactMessageAvailable: true,
    }],
    evidenceIds: [messageId],
    timestamp: now,
    temporalFrame: lane === "reconnect_memory" ? "worth_remembering" : "current",
    dedupeKey: `dedupe:${id}`,
    ...overrides,
  };
}

function data(candidates: IntelligenceCandidate[] = []): IntelligenceData {
  return {
    generatedAt: now,
    needsReply: [],
    commitments: [],
    changes: [],
    events: [],
    chats: [],
    questionHistory: [],
    suggestedQuestions: [],
    intelligenceCandidates: candidates,
  };
}

function legacyData(): IntelligenceData {
  const value = data([candidate("available-but-not-required", "reply_context")]);
  value.chats = [
    {
      chatId: "dani@c.us", contactName: "Dani Cohen", isGroup: false, retainedMessageIds: ["dani-message"], commitments: [], events: [], needsReply: false, updatedAt: now,
      insights: [{
        id: "dani-preference", kind: "preference", content: "Dani prefers concise decisions and clear outcomes.", status: "confirmed", confidence: .96,
        validity: "current", freshness: "fresh", evidence: { messageId: "dani-message", excerpt: "Please keep it concise", senderName: "Dani Cohen", timestamp: now - 60_000 },
        createdAt: now - 60_000, updatedAt: now,
      }],
    },
    {
      chatId: "maya@c.us", contactName: "Maya Levi", isGroup: false, retainedMessageIds: ["maya-message"], commitments: [], events: [], needsReply: false, updatedAt: now,
      insights: [{
        id: "maya-update", kind: "fact", content: "Maya shared a confirmed launch update.", status: "confirmed", confidence: .96,
        validity: "current", freshness: "fresh", evidence: { messageId: "maya-message", excerpt: "The launch plan is confirmed.", senderName: "Maya Levi", timestamp: now - 60_000 },
        createdAt: now - 60_000, updatedAt: now,
      }],
    },
  ];
  return value;
}

describe("Ask AmirOS suggestion fallback", () => {
  it("keeps existing grounded discovery visible while candidate rollout is incomplete", () => {
    const cards = buildAssistantSuggestionCards(legacyData(), chats, now);

    expect(cards).toHaveLength(2);
    expect(cards.find((card) => card.contactName === "Dani")?.suggestionContext).toEqual({
      chatId: "dani@c.us",
      sourceIds: ["dani-preference"],
    });
    expect(cards.find((card) => card.contactName === "Dani")?.avatarUrl).toBe("/dani.jpg");
    expect(cards.find((card) => card.contactName === "Maya")?.avatarUrl).toBe("/maya.jpg");
  });

  it("still fails closed for group and source-free legacy knowledge", () => {
    const value = legacyData();
    value.chats.push({
      chatId: "group@g.us", contactName: "Family group", isGroup: true, retainedMessageIds: ["group-message"], commitments: [], events: [], needsReply: false, updatedAt: now,
      insights: [{ ...value.chats[0]!.insights[0]!, id: "group", evidence: { ...value.chats[0]!.insights[0]!.evidence, messageId: "group-message" } }],
    });
    value.chats[0]!.insights[0] = { ...value.chats[0]!.insights[0]!, evidence: { ...value.chats[0]!.insights[0]!.evidence, messageId: undefined } };
    const cards = buildAssistantSuggestionCards(value, chats, now);
    expect(cards.map((card) => card.contactName)).toEqual(["Maya"]);
  });

  it("does not duplicate one grounded relationship fact", () => {
    const value = legacyData();
    value.chats.push({ ...value.chats[0]!, chatId: "yuvi@c.us", contactName: "Yuvi Shalev" });
    const cards = buildAssistantSuggestionCards(value, chats, now);
    expect(cards.filter((card) => card.title.includes("Dani"))).toHaveLength(1);
  });

  it("rotates a larger discovery pool", () => {
    const cards = Array.from({ length: 6 }, (_, index) => ({
      id: `card-${index}`,
      contactName: `Person ${index}`,
      title: `Useful detail ${index}`,
      preview: `Evidence ${index}`,
      detail: "1 direct message · Today",
      question: `What happened with Person ${index}?`,
      kind: "knowledge" as const,
      icon: "connection" as const,
      suggestionContext: { chatId: `person-${index}`, sourceIds: [`source-${index}`] },
      dedupeKey: `theme:${index}`,
    })) satisfies AssistantSuggestionCard[];
    const rotated = rotateAssistantSuggestions(cards, 0);
    expect(rotated).toHaveLength(ASSISTANT_DISCOVERY_VISIBLE_COUNT);
    expect(rotateAssistantSuggestions(cards, 1).map((card) => card.id)).toEqual(["card-1", "card-2", "card-3", "card-4"]);
  });

  it("expands only original-message evidence and opens the exact message target", () => {
    const component = readFileSync(new URL("../ui/src/components/FloatingAssistant.tsx", import.meta.url), "utf8");
    expect(component).toContain("evidence.originalText");
    expect(component).toContain("evidence.authorName");
    expect(component).toContain("evidence.conversationName");
    expect(component).toContain("onOpenChat(source.chatId, evidence.messageId)");
    expect(component).not.toContain("source.sourceContent || source.content");
  });
});
