import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AmirosState } from "../src/amiros-state.js";
import {
  buildIntelligenceCandidatePool,
  type IntelligenceCandidateSource,
} from "../src/intelligence-candidate-pool.js";

const DAY = 86_400_000;
const now = new Date(2026, 7, 21, 10).getTime();
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function source(patch: Partial<IntelligenceCandidateSource> = {}): IntelligenceCandidateSource {
  const messages = new Map([
    ["plan-message", { text: "Let's have dinner next week.", timestamp: now - DAY }],
    ["reply-message", { text: "Can you send the address?", timestamp: now - 60_000 }],
    ["commitment-message", { text: "I will send you the photos by Friday.", timestamp: now - DAY }],
    ["todo-message", { text: "Please book the restaurant.", timestamp: now - DAY }],
    ["change-message", { text: "I started a new role this week.", timestamp: now - DAY }],
    ["memory-message", { text: "I prefer short messages.", timestamp: now - 3 * DAY }],
    ["reconnect-message", { text: "I enjoy hiking in Greece.", timestamp: now - 60 * DAY }],
  ]);
  return {
    chatId: "dani@c.us",
    contactName: "Dani",
    isGroup: false,
    retainedMessageIds: [...messages.keys()],
    insights: [
      {
        id: "new-role", kind: "relationship_change", content: "Dani started a new role.",
        status: "confirmed", confidence: .97, validity: "current", evolution: "replace",
        evidence: { messageId: "change-message", excerpt: "I started a new role this week.", timestamp: now - DAY },
        createdAt: now - DAY, updatedAt: now - DAY,
      },
      {
        id: "short-messages", kind: "preference", content: "Dani prefers short messages.",
        status: "confirmed", confidence: .97, validity: "current",
        evidence: { messageId: "memory-message", excerpt: "I prefer short messages.", timestamp: now - 3 * DAY },
        createdAt: now - 3 * DAY, updatedAt: now - 3 * DAY,
      },
      {
        id: "hiking", kind: "fact", content: "Dani enjoys hiking in Greece.",
        status: "confirmed", confidence: .97, validity: "current",
        evidence: { messageId: "reconnect-message", excerpt: "I enjoy hiking in Greece.", timestamp: now - 60 * DAY },
        createdAt: now - 60 * DAY, updatedAt: now - 60 * DAY,
      },
    ],
    commitments: [{
      id: "photos", content: "Send Dani the photos", owner: "me", status: "open", dueAt: now + DAY,
      evidence: { messageId: "commitment-message", excerpt: "I will send you the photos by Friday.", timestamp: now - DAY },
      createdAt: now - DAY, updatedAt: now - DAY,
    }],
    events: [{
      id: "dinner", title: "Dinner", startAt: now + 2 * DAY, allDay: false, status: "confirmed",
      evidence: { messageId: "plan-message", excerpt: "Let's have dinner next week.", timestamp: now - DAY },
      createdAt: now - DAY, updatedAt: now - DAY,
    }],
    todos: [{
      id: "restaurant", title: "Book the restaurant", status: "open", priority: "normal", dueAt: now + DAY,
      evidence: { messageId: "todo-message", excerpt: "Please book the restaurant.", timestamp: now - DAY },
      createdAt: now - DAY, updatedAt: now - DAY,
    }],
    needsReply: true,
    lastIncoming: { role: "user", author: "contact", content: "Can you send the address?", messageId: "reply-message", timestamp: now - 60_000 },
    lastInteraction: { role: "user", author: "contact", content: "I prefer short messages.", messageId: "memory-message", timestamp: now - 45 * DAY },
    exactEvidenceFor: (evidence) => {
      const message = evidence.messageId ? messages.get(evidence.messageId) : undefined;
      return message && evidence.messageId ? {
        messageId: evidence.messageId,
        chatId: "dani@c.us",
        conversationName: "Dani",
        authorName: "Dani",
        timestamp: message.timestamp,
        originalText: message.text,
        exactMessageAvailable: true,
      } : undefined;
    },
    ...patch,
  };
}

describe("intelligence candidate pool", () => {
  it("broadens across local lanes while retaining an exact-message contract", () => {
    const candidates = buildIntelligenceCandidatePool([source()], now);
    expect(candidates.map((candidate) => candidate.lane)).toEqual(expect.arrayContaining([
      "upcoming_plan", "reply_context", "open_commitment", "due_task", "recent_change", "relationship_memory", "reconnect_memory",
    ]));
    for (const candidate of candidates) {
      expect(candidate.evidence).toHaveLength(1);
      expect(candidate.evidence[0]).toMatchObject({ exactMessageAvailable: true, chatId: candidate.chatId });
      expect(candidate.evidenceIds).toEqual([candidate.evidence[0]!.messageId]);
      expect(candidate.sourceIds).not.toEqual([]);
    }
    const reconnect = candidates.find((candidate) => candidate.lane === "reconnect_memory")!;
    expect(reconnect.temporalFrame).toBe("worth_remembering");
    expect(reconnect.title).toMatch(/^Worth remembering/u);
  });

  it("fails closed for group context and a missing original message", () => {
    expect(buildIntelligenceCandidatePool([source({ isGroup: true })], now)).toEqual([]);
    expect(buildIntelligenceCandidatePool([source({
      exactEvidenceFor: () => undefined,
    })], now)).toEqual([]);
  });

  it("does not portray an old, unresolved reply as current work", () => {
    const staleReply = source({
      lastIncoming: { role: "user", author: "contact", content: "Can you send the address?", messageId: "reply-message", timestamp: now - 8 * DAY },
    });
    expect(buildIntelligenceCandidatePool([staleReply], now).some((candidate) => candidate.lane === "reply_context")).toBe(false);
  });

  it("resolves a reply candidate and its Ask anchor to the exact retained message", () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-candidate-pool-"));
    directories.push(directory);
    const state = new AmirosState(join(directory, "state.json"));
    state.rememberChatNames([{ id: "dani@c.us", name: "Dani" }]);
    state.rememberMessage("dani@c.us", {
      role: "user", author: "contact", content: "Can you send the address?", messageId: "reply-message", timestamp: now - 60_000,
    });

    const candidate = state.intelligenceCandidatePool(now).find((item) => item.lane === "reply_context")!;
    expect(candidate).toMatchObject({
      chatId: "dani@c.us",
      sourceIds: ["reply-message"],
      evidence: [expect.objectContaining({
        messageId: "reply-message",
        originalText: "Can you send the address?",
        authorName: "Dani",
        exactMessageAvailable: true,
      })],
    });
    expect(state.intelligenceRecordsByReferences([{ id: "reply-message", chatId: "dani@c.us" }], new Set(), now))
      .toEqual([expect.objectContaining({
        kind: "message",
        evidence: expect.objectContaining({ originalText: "Can you send the address?", exactMessageAvailable: true }),
      })]);
  });
});
