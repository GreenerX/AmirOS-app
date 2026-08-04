import { describe, expect, it } from "vitest";
import { buildIntelligenceSnapshot } from "../ui/src/intelligence-snapshot.js";
import type { IntelligenceChat, IntelligenceData } from "../ui/src/types.js";

function chat(chatId: string, contactName: string, timestamp: number): IntelligenceChat {
  return {
    chatId,
    contactName,
    isGroup: false,
    insights: [{
      id: `${chatId}-fact`,
      kind: "fact",
      content: `${contactName} likes coffee`,
      status: "confirmed",
      confidence: 1,
      evidence: { excerpt: "Coffee, please", timestamp },
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    commitments: [],
    events: [],
    needsReply: true,
    lastIncoming: { role: "user", content: "Are you free?", timestamp, messageId: `${chatId}-message` },
    updatedAt: timestamp,
  };
}

describe("Intelligence snapshot", () => {
  it("uses inspectable known-contact records for every snapshot total", () => {
    const now = 1_800_000_000_000;
    const known = chat("dani@c.us", "Dani", now);
    const placeholder = chat("unknown@c.us", "WhatsApp contact", now + 1);
    const data: IntelligenceData = {
      generatedAt: now,
      needsReply: [known, placeholder],
      commitments: [],
      changes: [],
      events: [
        { id: "future", chatId: known.chatId, contactName: known.contactName, title: "Coffee", startAt: now + 60_000, allDay: false, status: "confirmed", evidence: { excerpt: "Tomorrow", timestamp: now }, createdAt: now, updatedAt: now },
        { id: "unknown", chatId: placeholder.chatId, contactName: placeholder.contactName, title: "Unknown", startAt: now + 60_000, allDay: false, status: "confirmed", evidence: { excerpt: "Tomorrow", timestamp: now }, createdAt: now, updatedAt: now },
      ],
      chats: [known, placeholder],
      questionHistory: [],
      suggestedQuestions: [],
    };

    const snapshot = buildIntelligenceSnapshot(data, new Set(), now);

    expect(snapshot.relationships).toBe(1);
    expect(snapshot.details).toBe(1);
    expect(snapshot.confirmedKnowledge.map((item) => item.contactName)).toEqual(["Dani"]);
    expect(snapshot.upcomingEvents.map((item) => item.title)).toEqual(["Coffee"]);
    expect(snapshot.replies.map((item) => item.contactName)).toEqual(["Dani"]);
  });
});
