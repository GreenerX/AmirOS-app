import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AmirosState } from "../src/amiros-state.js";
import { IntelligenceLearner } from "../src/intelligence-learner.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function createState() {
  const directory = mkdtempSync(join(tmpdir(), "amiros-intelligence-learner-"));
  temporaryDirectories.push(directory);
  return new AmirosState(join(directory, "state.json"));
}

describe("IntelligenceLearner", () => {
  it("automatically turns a newly remembered incoming message into a pending knowledge suggestion", async () => {
    const state = createState();
    const chatId = "dani@c.us";
    state.updateContact(chatId, { knowledgeTracking: "enabled" });
    state.rememberChatName(chatId, "Dani Faitelson");
    state.rememberMessage(chatId, {
      role: "user",
      author: "contact",
      content: "My favorite restaurant is Pronto.",
      senderName: "Dani",
      messageId: "incoming-1",
      timestamp: Date.now(),
    });
    const analyzeRelationship = vi.fn(async () => ({
      insights: [{
        kind: "preference" as const,
        content: "Dani's favorite restaurant is Pronto.",
        confidence: 0.96,
        subjectNames: ["Dani Faitelson"],
        evidence: { messageId: "incoming-1", excerpt: "My favorite restaurant is Pronto.", senderName: "Dani", timestamp: Date.now() },
      }],
      commitments: [],
      events: [],
      todos: [],
    }));
    const learner = new IntelligenceLearner(state, { analyzeRelationship });

    await learner.analyzeIncoming(chatId);

    expect(analyzeRelationship).toHaveBeenCalledTimes(1);
    expect(state.getInsights(chatId)).toEqual([
      expect.objectContaining({
        kind: "preference",
        content: "Dani's favorite restaurant is Pronto.",
        status: "inferred",
      }),
    ]);
  });

  it("turns a newly analyzed owner action into an inferred to-do suggestion", async () => {
    const state = createState();
    const chatId = "dani@c.us";
    const timestamp = Date.now();
    const dueAt = timestamp + 86_400_000;
    state.updateContact(chatId, { knowledgeTracking: "enabled" });
    state.rememberChatName(chatId, "Dani Faitelson");
    state.rememberMessage(chatId, {
      role: "user",
      author: "contact",
      senderName: "Dani",
      content: "Could you please call the dentist about your appointment tomorrow?",
      messageId: "todo-incoming-1",
      timestamp,
    });
    const analyzeRelationship = vi.fn(async () => ({
      insights: [],
      commitments: [],
      events: [],
      todos: [{
        title: "Call the dentist about tomorrow's appointment",
        dueAt,
        evidence: {
          messageId: "todo-incoming-1",
          excerpt: "Could you please call the dentist about your appointment tomorrow?",
          senderName: "Dani",
          timestamp,
        },
      }],
    }));
    const learner = new IntelligenceLearner(state, { analyzeRelationship });

    await learner.analyzeIncoming(chatId);

    expect(state.getTodoTasks(chatId)).toEqual([
      expect.objectContaining({
        title: "Call the dentist about tomorrow's appointment",
        status: "inferred",
        dueAt,
        evidence: expect.objectContaining({ messageId: "todo-incoming-1", senderName: "Dani" }),
      }),
    ]);
  });

  it("routes owner-supplied knowledge to every person the fact describes", async () => {
    const state = createState();
    const ownerChatId = "amir@c.us";
    const daniChatId = "dani@c.us";
    state.updateContact(ownerChatId, { knowledgeTracking: "enabled" });
    state.updateContact(daniChatId, { knowledgeTracking: "enabled" });
    state.rememberMessage(ownerChatId, { role: "user", author: "owner", content: "Dani and I live on King Street.", messageId: "owner-1" });
    state.rememberChatName(ownerChatId, "Amir Friedman");
    state.rememberMessage(daniChatId, { role: "user", author: "contact", content: "Hello", messageId: "dani-1" });
    state.rememberChatName(daniChatId, "Dani Faitelson");
    const analyzeRelationship = vi.fn(async () => ({
      insights: [{
        kind: "fact" as const,
        content: "Amir and Dani live on King Street.",
        confidence: 0.99,
        subjectNames: ["Amir Friedman", "Dani Faitelson"],
        evidence: { messageId: "owner-1", excerpt: "Dani and I live on King Street.", senderName: "Amir Friedman", timestamp: Date.now() },
      }],
      commitments: [],
      events: [],
      todos: [],
    }));
    const learner = new IntelligenceLearner(state, { analyzeRelationship });

    await learner.analyzeIncoming(ownerChatId);

    expect(state.getInsights(ownerChatId)).toEqual([
      expect.objectContaining({ content: "Amir and Dani live on King Street.", status: "inferred" }),
    ]);
    expect(state.getInsights(daniChatId)).toEqual([
      expect.objectContaining({ content: "Amir and Dani live on King Street.", status: "inferred" }),
    ]);
  });

  it("routes a fact about one named person only to that person's knowledge", async () => {
    const state = createState();
    const ownerChatId = "amir@c.us";
    const daniChatId = "dani@c.us";
    state.updateContact(ownerChatId, { knowledgeTracking: "enabled" });
    state.updateContact(daniChatId, { knowledgeTracking: "enabled" });
    state.rememberMessage(ownerChatId, { role: "user", author: "owner", content: "Dani's birthday is July 5th.", messageId: "owner-2" });
    state.rememberChatName(ownerChatId, "Amir Friedman");
    state.rememberMessage(daniChatId, { role: "user", author: "contact", content: "Hello", messageId: "dani-2" });
    state.rememberChatName(daniChatId, "Dani Faitelson");
    const analyzeRelationship = vi.fn(async () => ({
      insights: [{
        kind: "important_date" as const,
        content: "Dani's birthday is July 5th.",
        confidence: 0.99,
        subjectNames: ["Dani Faitelson"],
        evidence: { messageId: "owner-2", excerpt: "Dani's birthday is July 5th.", senderName: "Amir Friedman", timestamp: Date.now() },
      }],
      commitments: [],
      events: [],
      todos: [],
    }));
    const learner = new IntelligenceLearner(state, { analyzeRelationship });

    await learner.analyzeIncoming(ownerChatId);

    expect(state.getInsights(ownerChatId)).toEqual([]);
    expect(state.getInsights(daniChatId)).toEqual([
      expect.objectContaining({ kind: "important_date", content: "Dani's birthday is July 5th." }),
    ]);
  });

  it("coalesces messages that arrive while the same chat is being analyzed", async () => {
    const state = createState();
    const chatId = "group@g.us";
    state.updateContact(chatId, { knowledgeTracking: "enabled" });
    state.rememberMessage(chatId, { role: "user", content: "First", messageId: "1" });
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const analyzeRelationship = vi.fn(async () => {
      if (analyzeRelationship.mock.calls.length === 1) await first;
      return { insights: [], commitments: [], events: [], todos: [] };
    });
    const learner = new IntelligenceLearner(state, { analyzeRelationship });

    const running = learner.analyzeIncoming(chatId);
    void learner.analyzeIncoming(chatId);
    releaseFirst();
    await running;

    // A repeated trigger without a new message is intentionally a no-op.
    expect(analyzeRelationship).toHaveBeenCalledTimes(1);
  });

  it("analyzes each saved message only once and then advances its cursor", async () => {
    const state = createState();
    const chatId = "dani@c.us";
    state.updateContact(chatId, { knowledgeTracking: "enabled" });
    state.rememberMessage(chatId, { role: "user", author: "contact", content: "I prefer tea.", messageId: "first" });
    const analyzeRelationship = vi.fn(async () => ({ insights: [], commitments: [], events: [], todos: [] }));
    const learner = new IntelligenceLearner(state, { analyzeRelationship });

    await learner.analyzeIncoming(chatId);
    await learner.analyzeIncoming(chatId);
    state.rememberMessage(chatId, { role: "user", author: "contact", content: "I also like mint.", messageId: "second" });
    await learner.analyzeIncoming(chatId);

    expect(analyzeRelationship).toHaveBeenCalledTimes(2);
    const calls = analyzeRelationship.mock.calls as unknown as Array<[{ memory: Array<{ messageId?: string }>; candidateMessageIds?: string[] }]>;
    const firstRequest = calls[0]?.[0];
    const secondRequest = calls[1]?.[0];
    expect(firstRequest?.memory.map((entry) => entry.messageId)).toContain("first");
    expect(secondRequest?.memory.map((entry) => entry.messageId)).toContain("second");
    // Earlier messages are supplied as context, but only the just-arrived
    // message is eligible to become a new suggestion on the second scan.
    expect(firstRequest?.candidateMessageIds).toEqual(["first"]);
    expect(secondRequest?.candidateMessageIds).toEqual(["second"]);
  });

  it("drains every unseen message in bounded analysis batches", async () => {
    const state = createState();
    const chatId = "dani@c.us";
    const timestamp = 1_800_000_000_000;
    state.updateContact(chatId, { knowledgeTracking: "enabled" });
    state.rememberMessages(chatId, Array.from({ length: 65 }, (_, index) => ({
      role: "user" as const,
      author: "contact" as const,
      content: `New message ${index + 1}`,
      messageId: `batch-${index + 1}`,
      timestamp: timestamp + index,
    })));
    const analyzeRelationship = vi.fn(async () => ({ insights: [], commitments: [], events: [], todos: [] }));
    const learner = new IntelligenceLearner(state, { analyzeRelationship });

    await learner.analyzeIncoming(chatId);

    expect(analyzeRelationship).toHaveBeenCalledTimes(3);
    const calls = analyzeRelationship.mock.calls as unknown as Array<[{ candidateMessageIds?: string[] }]>;
    expect(calls.map(([request]) => request.candidateMessageIds)).toEqual([
      Array.from({ length: 30 }, (_, index) => `batch-${index + 1}`),
      Array.from({ length: 30 }, (_, index) => `batch-${index + 31}`),
      Array.from({ length: 5 }, (_, index) => `batch-${index + 61}`),
    ]);
    expect(calls.every(([request]) => (request.candidateMessageIds?.length || 0) <= 30)).toBe(true);
    expect(state.getUnanalyzedKnowledgeMessages(chatId)).toEqual([]);
  });

  it("does not create intelligence suggestions for a chat until tracking is approved", async () => {
    const state = createState();
    const chatId = "unknown@g.us";
    state.rememberMessage(chatId, { role: "user", author: "group_member", content: "We should meet Friday.", messageId: "unknown-1" });
    const analyzeRelationship = vi.fn(async () => ({ insights: [], commitments: [], events: [], todos: [] }));
    const learner = new IntelligenceLearner(state, { analyzeRelationship });

    await learner.analyzeIncoming(chatId);

    expect(state.getContact(chatId).knowledgeTracking).toBe("pending");
    expect(analyzeRelationship).not.toHaveBeenCalled();
  });

  it("does not analyze explicit self-chat bot commands as relationship intelligence", async () => {
    const state = createState();
    const chatId = "self@c.us";
    state.updateContact(chatId, { knowledgeTracking: "enabled" });
    state.rememberMessage(chatId, {
      role: "user",
      author: "owner",
      content: "Please remind me to call the dentist tomorrow.",
      messageId: "self-bot-command",
      countAsIncoming: false,
      extractSignals: true,
      excludeFromAutomaticLearning: true,
    });
    const analyzeRelationship = vi.fn(async () => ({
      insights: [],
      commitments: [],
      events: [],
      todos: [],
    }));
    const learner = new IntelligenceLearner(state, { analyzeRelationship });

    await learner.analyzeIncoming(chatId);

    expect(analyzeRelationship).not.toHaveBeenCalled();
  });
});
