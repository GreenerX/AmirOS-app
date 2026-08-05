import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AmirosState } from "../src/amiros-state.js";
import { IntelligenceLearner, RELATIONSHIP_LEARNING_DEBOUNCE_MS } from "../src/intelligence-learner.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.useRealTimers();
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

    await learner.analyzeNow(chatId);

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

    await learner.analyzeNow(chatId);

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

    await learner.analyzeNow(ownerChatId);

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

    await learner.analyzeNow(ownerChatId);

    expect(state.getInsights(ownerChatId)).toEqual([]);
    expect(state.getInsights(daniChatId)).toEqual([
      expect.objectContaining({ kind: "important_date", content: "Dani's birthday is July 5th." }),
    ]);
  });

  it("batches several quick messages in one chat into one automatic analysis", async () => {
    const state = createState();
    const chatId = "group@g.us";
    state.updateContact(chatId, { knowledgeTracking: "enabled" });
    state.rememberMessages(chatId, [
      { role: "user", content: "First", messageId: "1" },
      { role: "user", content: "Second", messageId: "2" },
      { role: "user", content: "Third", messageId: "3" },
    ]);
    const analyzeRelationship = vi.fn(async () => ({ insights: [], commitments: [], events: [], todos: [] }));
    const learner = new IntelligenceLearner(state, { analyzeRelationship });
    vi.useFakeTimers();

    const first = learner.analyzeIncoming(chatId);
    const second = learner.analyzeIncoming(chatId);
    const third = learner.analyzeIncoming(chatId);
    await vi.advanceTimersByTimeAsync(RELATIONSHIP_LEARNING_DEBOUNCE_MS - 1);
    expect(analyzeRelationship).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([first, second, third]);

    expect(analyzeRelationship).toHaveBeenCalledTimes(1);
    const calls = analyzeRelationship.mock.calls as unknown as Array<[{ candidateMessageIds?: string[] }]>;
    expect(calls[0]?.[0]?.candidateMessageIds).toEqual(["1", "2", "3"]);
  });

  it("keeps automatic learning timers separate for different chats", async () => {
    const state = createState();
    const firstChat = "dani@c.us";
    const secondChat = "andrew@c.us";
    state.updateContact(firstChat, { knowledgeTracking: "enabled" });
    state.updateContact(secondChat, { knowledgeTracking: "enabled" });
    state.rememberMessage(firstChat, { role: "user", content: "First chat", messageId: "first" });
    state.rememberMessage(secondChat, { role: "user", content: "Second chat", messageId: "second" });
    const analyzeRelationship = vi.fn(async () => ({ insights: [], commitments: [], events: [], todos: [] }));
    const learner = new IntelligenceLearner(state, { analyzeRelationship });
    vi.useFakeTimers();

    const first = learner.analyzeIncoming(firstChat);
    await vi.advanceTimersByTimeAsync(15_000);
    const second = learner.analyzeIncoming(secondChat);
    await vi.advanceTimersByTimeAsync(30_000);
    await first;
    expect(analyzeRelationship).toHaveBeenCalledTimes(1);
    const calls = analyzeRelationship.mock.calls as unknown as Array<[{ chatId: string }]>;
    expect(calls[0]?.[0]?.chatId).toBe(firstChat);

    await vi.advanceTimersByTimeAsync(15_000);
    await second;
    expect(analyzeRelationship).toHaveBeenCalledTimes(2);
    expect(calls[1]?.[0]?.chatId).toBe(secondChat);
  });

  it("restarts a chat's 45-second wait when another message arrives", async () => {
    const state = createState();
    const chatId = "dani@c.us";
    state.updateContact(chatId, { knowledgeTracking: "enabled" });
    state.rememberMessage(chatId, { role: "user", content: "First", messageId: "first" });
    const analyzeRelationship = vi.fn(async () => ({ insights: [], commitments: [], events: [], todos: [] }));
    const learner = new IntelligenceLearner(state, { analyzeRelationship });
    vi.useFakeTimers();

    const first = learner.analyzeIncoming(chatId);
    await vi.advanceTimersByTimeAsync(30_000);
    state.rememberMessage(chatId, { role: "user", content: "Second", messageId: "second" });
    const second = learner.analyzeIncoming(chatId);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(analyzeRelationship).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(15_000);
    await Promise.all([first, second]);
    expect(analyzeRelationship).toHaveBeenCalledTimes(1);
    const calls = analyzeRelationship.mock.calls as unknown as Array<[{ candidateMessageIds?: string[] }]>;
    expect(calls[0]?.[0]?.candidateMessageIds).toEqual(["first", "second"]);
  });

  it("runs manual analysis immediately and cancels the pending automatic wait", async () => {
    const state = createState();
    const chatId = "dani@c.us";
    state.updateContact(chatId, { knowledgeTracking: "enabled" });
    state.rememberMessage(chatId, { role: "user", content: "Analyze me now", messageId: "manual" });
    const analyzeRelationship = vi.fn(async () => ({ insights: [], commitments: [], events: [], todos: [] }));
    const learner = new IntelligenceLearner(state, { analyzeRelationship });
    vi.useFakeTimers();

    const scheduled = learner.analyzeIncoming(chatId);
    await learner.analyzeNow(chatId);
    expect(analyzeRelationship).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RELATIONSHIP_LEARNING_DEBOUNCE_MS);
    await scheduled;
    expect(analyzeRelationship).toHaveBeenCalledTimes(1);
  });

  it("analyzes each saved message only once and then advances its cursor", async () => {
    const state = createState();
    const chatId = "dani@c.us";
    state.updateContact(chatId, { knowledgeTracking: "enabled" });
    state.rememberMessage(chatId, { role: "user", author: "contact", content: "I prefer tea.", messageId: "first" });
    const analyzeRelationship = vi.fn(async () => ({ insights: [], commitments: [], events: [], todos: [] }));
    const learner = new IntelligenceLearner(state, { analyzeRelationship });

    await learner.analyzeNow(chatId);
    await learner.analyzeNow(chatId);
    state.rememberMessage(chatId, { role: "user", author: "contact", content: "I also like mint.", messageId: "second" });
    await learner.analyzeNow(chatId);

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

  it("does not skip queued tracked messages when a large burst needs multiple analysis batches", async () => {
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

    vi.useFakeTimers();
    const scheduled = learner.analyzeIncoming(chatId);
    await vi.advanceTimersByTimeAsync(RELATIONSHIP_LEARNING_DEBOUNCE_MS);
    await scheduled;

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

    await learner.analyzeNow(chatId);

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

    await learner.analyzeNow(chatId);

    expect(analyzeRelationship).not.toHaveBeenCalled();
  });
});
