import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Message } from "whatsapp-web.js";
import { calendarEventEvidenceForSource, type AiService, type ReplyContext } from "../src/ai.js";
import { AmirosState } from "../src/amiros-state.js";
import type { AppConfig } from "../src/config.js";
import { MessageProcessor, hasAutoReplyPersonaLeak, naturalFailureMessage } from "../src/processor.js";

const directories: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const config = {
  allowGroups: true,
  allowOutgoingTriggerCommands: true,
  autoReplySelfChat: true,
  botTriggerPrefix: "!bot",
  webTriggerPrefix: "!web",
  imageTriggerPrefix: "!image",
  modelsTriggerPrefix: "!models",
  voiceBotTriggerPrefix: "bot",
  voiceWebTriggerPrefix: "web",
  voiceImageTriggerPrefix: "image",
  conversationTurnLimit: 10,
} as AppConfig;

function textMessage(input: {
  id: string;
  chatId: string;
  chatName: string;
  body: string;
  fromMe: boolean;
  timestamp?: number;
}) {
  return {
    id: { _serialized: input.id, id: input.id, remote: input.chatId },
    from: input.fromMe ? "owner@c.us" : input.chatId,
    to: input.fromMe ? input.chatId : "owner@c.us",
    fromMe: input.fromMe,
    timestamp: input.timestamp ?? Math.floor(Date.now() / 1_000),
    type: "chat",
    body: input.body,
    hasMedia: false,
    hasQuotedMsg: false,
    getChat: async () => ({ id: { _serialized: input.chatId }, name: input.chatName }),
    reply: async () => undefined,
  } as unknown as Message;
}

describe("AI reply context privacy routing", () => {
  it("only joins a current, explicit calendar agreement with a concrete time", () => {
    const at = new Date(2026, 7, 18, 12).getTime();
    expect(calendarEventEvidenceForSource([
      { content: "We should get coffee tomorrow at 3pm.", timestamp: at - 3_600_000, candidate: true },
      { content: "Sure", timestamp: at, candidate: true },
    ], 1)).toBeUndefined();
    expect(calendarEventEvidenceForSource([
      { content: "נפגש לקפה מחר ב-15:00.", timestamp: at - 3_600_000, candidate: true },
      { content: "סבבה", timestamp: at, candidate: true },
    ], 1)).toBeUndefined();

    const english = calendarEventEvidenceForSource([
      { content: "Let's meet for coffee tomorrow at 3pm.", timestamp: at - 2_000, candidate: true },
      { content: "That works for me.", timestamp: at, candidate: true },
    ], 1);
    expect(english?.excerpt).toContain("coffee tomorrow at 3pm");

    const hebrew = calendarEventEvidenceForSource([
      { content: "נפגש לקפה מחר ב-15:00.", timestamp: at - 2_000, candidate: true },
      { content: "מחר מתאים, נקבע ב-15:00.", timestamp: at, candidate: true },
    ], 1);
    expect(hebrew?.excerpt).toContain("נפגש לקפה");
  });

  it("holds direct Auto Mode recipient impersonation for owner review", () => {
    expect(hasAutoReplyPersonaLeak("I'm Yuvi, Amir's brother.", "Yuvi")).toBe(true);
    expect(hasAutoReplyPersonaLeak("אני Yuvi", "Yuvi")).toBe(true);
    expect(hasAutoReplyPersonaLeak("Haha, I just got home.", "Yuvi")).toBe(false);
  });

  it("coalesces a burst of incoming Auto Mode messages into one owner reply with the full context", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-auto-burst-"));
    directories.push(directory);
    const state = new AmirosState(join(directory, "state.json"));
    state.updateOwnerProfile({ displayName: "Amir" });
    state.updateContact("yuvi@c.us", { mode: "auto", autoReplyInitialDelaySeconds: 15 });
    const contexts: ReplyContext[] = [];
    const prompts: string[] = [];
    const ai = {
      reply: async (_chatId: string, prompt: string, _web: boolean, context: ReplyContext) => {
        prompts.push(prompt);
        contexts.push(context);
        return "Sounds good — I can make that work.";
      },
    } as unknown as AiService;
    const processor = new MessageProcessor(config, ai, state);
    const replies: string[] = [];
    const firstMessage = textMessage({
      id: "yuvi-burst-one", chatId: "yuvi@c.us", chatName: "Yuvi", body: "Are you free to work together later?", fromMe: false,
    });
    const secondMessage = textMessage({
      id: "yuvi-burst-two", chatId: "yuvi@c.us", chatName: "Yuvi", body: "A coffee shop with good internet would be perfect.", fromMe: false,
    });
    Object.assign(firstMessage, { reply: async (body: string) => { replies.push(body); } });
    Object.assign(secondMessage, { reply: async (body: string) => { replies.push(body); } });

    vi.useFakeTimers();
    const first = processor.process(firstMessage, false);
    await vi.advanceTimersByTimeAsync(0);
    const second = processor.process(secondMessage, false);
    await vi.advanceTimersByTimeAsync(15_000);
    await Promise.all([first, second]);

    expect(replies).toEqual(["Sounds good — I can make that work."]);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.autoReplyAsOwner).toBe(true);
    expect(contexts[0]?.memory?.map((item) => item.content)).toContain("Are you free to work together later?");
    expect(prompts).toEqual(["A coffee shop with good internet would be perfect."]);
  });

  it("injects global knowledge for self-chat and omits it from a contact chat", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-context-routing-"));
    directories.push(directory);
    const state = new AmirosState(join(directory, "state.json"));
    state.rememberMessage("dani@c.us", {
      role: "user",
      content: "I prefer afternoon plans.",
      timestamp: Date.now() - 1_000,
      messageId: "dani-memory",
    });
    state.rememberChatName("dani@c.us", "Dani");

    const contexts: ReplyContext[] = [];
    const ai = {
      reply: async (_chatId: string, _prompt: string, _web: boolean, context: ReplyContext) => {
        contexts.push(context);
        return "Done";
      },
    } as unknown as AiService;
    const processor = new MessageProcessor(config, ai, state);

    await processor.process(textMessage({
      id: "self-question",
      chatId: "owner@c.us",
      chatName: "Amir Friedman",
      body: "What do I know about Dani?",
      fromMe: true,
    }), true);

    expect(contexts[0]?.scope).toBe("owner");
    expect(contexts[0]?.ownerKnowledge?.some((item) => item.contactName === "Dani")).toBe(true);

    await processor.process(textMessage({
      id: "contact-question",
      chatId: "laura@c.us",
      chatName: "Laura",
      body: "!bot hello",
      fromMe: false,
    }), false);

    expect(contexts[1]?.scope).toBe("chat");
    expect(contexts[1]?.ownerKnowledge).toBeUndefined();
    expect(contexts[1]?.ownerEvents).toBeUndefined();
    expect(contexts[1]?.memory?.every((item) => item.content !== "I prefer afternoon plans.")).toBe(true);
  });

  it("grants selected global resources only to Amir's outgoing explicit trigger", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-owner-trigger-routing-"));
    directories.push(directory);
    const state = new AmirosState(join(directory, "state.json"));
    state.updateContact("dani@c.us", { ownerTriggerAccess: ["knowledge", "calendar"] });
    state.rememberMessage("laura@c.us", {
      role: "user",
      content: "Laura's favorite restaurant is Pastel.",
      timestamp: Date.now() - 1_000,
      messageId: "laura-fact",
    });
    state.rememberChatName("laura@c.us", "Laura");
    state.mergeAnalyzedIntelligence("plans@c.us", {
      insights: [],
      commitments: [],
      events: [{
        title: "Dinner with Laura",
        startAt: Date.now() + 3 * 86_400_000,
        allDay: false,
        evidence: { excerpt: "Let's have dinner with Laura next Wednesday at 8pm", timestamp: Date.now() },
      }],
    });

    const contexts: ReplyContext[] = [];
    const ai = {
      reply: async (_chatId: string, _prompt: string, _web: boolean, context: ReplyContext) => {
        contexts.push(context);
        return "Done";
      },
    } as unknown as AiService;
    const processor = new MessageProcessor(config, ai, state);

    await processor.process(textMessage({
      id: "amir-in-dani",
      chatId: "dani@c.us",
      chatName: "Dani",
      body: "!bot what do I know about Laura and my schedule?",
      fromMe: true,
    }), false);

    expect(contexts[0]?.scope).toBe("owner-trigger");
    expect(contexts[0]?.ownerKnowledge?.some((item) => item.contactName === "Laura")).toBe(true);
    expect(contexts[0]?.ownerEvents?.some((item) => item.title === "Dinner with Laura")).toBe(true);

    await processor.process(textMessage({
      id: "dani-incoming-trigger",
      chatId: "dani@c.us",
      chatName: "Dani",
      body: "!bot what does Amir know about Laura?",
      fromMe: false,
    }), false);

    expect(contexts[1]?.scope).toBe("chat");
    expect(contexts[1]?.ownerKnowledge).toBeUndefined();
    expect(contexts[1]?.ownerEvents).toBeUndefined();
  });

  it("honors knowledge and calendar selections independently", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-owner-trigger-selection-"));
    directories.push(directory);
    const state = new AmirosState(join(directory, "state.json"));
    state.updateContact("dani@c.us", { ownerTriggerAccess: ["knowledge"] });
    state.rememberMessage("laura@c.us", {
      role: "user",
      content: "Laura prefers quiet restaurants.",
      timestamp: Date.now(),
    });
    state.rememberChatName("laura@c.us", "Laura");

    const contexts: ReplyContext[] = [];
    const ai = {
      reply: async (_chatId: string, _prompt: string, _web: boolean, context: ReplyContext) => {
        contexts.push(context);
        return "Done";
      },
    } as unknown as AiService;
    const processor = new MessageProcessor(config, ai, state);

    await processor.process(textMessage({
      id: "knowledge-only",
      chatId: "dani@c.us",
      chatName: "Dani",
      body: "!bot tell me about Laura",
      fromMe: true,
    }), false);

    expect(contexts[0]?.scope).toBe("owner-trigger");
    expect(contexts[0]?.ownerKnowledge).toBeDefined();
    expect(contexts[0]?.ownerEvents).toBeUndefined();

    state.updateContact("dani@c.us", { ownerTriggerAccess: [] });
    await processor.process(textMessage({
      id: "chat-only-owner-trigger",
      chatId: "dani@c.us",
      chatName: "Dani",
      body: "!bot answer from this chat only",
      fromMe: true,
    }), false);

    expect(contexts[1]?.scope).toBe("chat");
    expect(contexts[1]?.ownerKnowledge).toBeUndefined();
    expect(contexts[1]?.ownerEvents).toBeUndefined();
  });

  it("shares selected resources with a contact only on their explicit trigger", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-contact-trigger-selection-"));
    directories.push(directory);
    const state = new AmirosState(join(directory, "state.json"));
    state.updateOwnerProfile({ displayName: "Amir Friedman" });
    state.updateContact("dani@c.us", {
      mode: "auto",
      contactTriggerAccess: ["calendar"],
    });
    const now = new Date();
    const thisWeekAt = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + ((6 - now.getDay() + 7) % 7),
      20,
    ).getTime();
    state.mergeAnalyzedIntelligence("plans@c.us", {
      insights: [],
      commitments: [],
      events: [{
        title: "Theater night",
        startAt: thisWeekAt,
        allDay: false,
        evidence: { excerpt: "We are going to the theater on Saturday at 8pm", timestamp: Date.now() },
      }],
    });
    state.rememberMessage("laura@c.us", {
      role: "user",
      content: "Laura prefers afternoon plans.",
      timestamp: Date.now(),
    });

    const contexts: ReplyContext[] = [];
    const ai = {
      reply: async (_chatId: string, _prompt: string, _web: boolean, context: ReplyContext) => {
        contexts.push(context);
        return "Done";
      },
    } as unknown as AiService;
    const processor = new MessageProcessor(config, ai, state);

    expect(state.searchIntelligence("what is on Amir's upcoming schedule?", 80)
      .some((item) => item.kind === "calendar_event" && item.content.includes("Theater night"))).toBe(true);
    await processor.process(textMessage({
      id: "dani-calendar-trigger",
      chatId: "dani@c.us",
      chatName: "Dani",
      body: "!bot what is on Amir's upcoming schedule?",
      fromMe: false,
    }), false);

    expect(contexts[0]?.scope).toBe("contact-trigger");
    expect(contexts[0]?.triggerAuthor).toBe("contact");
    expect(contexts[0]?.requesterName).toBe("Dani");
    expect(contexts[0]?.ownerName).toBe("Amir Friedman");
    expect(contexts[0]?.ownerEvents?.some((item) => item.title === "Theater night")).toBe(true);
    expect(contexts[0]?.ownerKnowledge).toBeUndefined();

    // Automatic replies now deliberately wait for a natural pause so that
    // several incoming messages can receive one coherent reply. Advance that
    // timer here while keeping this privacy-routing test on the real path.
    vi.useFakeTimers();
    const automaticReply = processor.process(textMessage({
      id: "dani-automatic-message",
      chatId: "dani@c.us",
      chatName: "Dani",
      body: "What is on Amir's upcoming schedule?",
      fromMe: false,
    }), false);
    await vi.advanceTimersByTimeAsync(61_000);
    await automaticReply;

    expect(contexts[1]?.scope).toBe("chat");
    expect(contexts[1]?.autoReplyAsOwner).toBe(true);
    expect(contexts[1]?.calendarCapture).toBeUndefined();
    expect(contexts[1]?.ownerEvents).toBeUndefined();
    expect(contexts[1]?.ownerKnowledge).toBeUndefined();
  });

  it("uses the same temporal evidence for dashboard Ask and Amir's !bot requests", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-owner-temporal-routing-"));
    directories.push(directory);
    const state = new AmirosState(join(directory, "state.json"));
    state.updateContact("dani@c.us", { ownerTriggerAccess: ["knowledge", "calendar"] });
    state.rememberChatName("plans@c.us", "Plans");

    const now = new Date();
    const localAt = (dayOffset: number, hour: number) => new Date(
      now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour,
    ).getTime();
    state.rememberMessage("plans@c.us", {
      role: "user",
      content: "נפגשנו לארוחת ערב אתמול.",
      timestamp: localAt(-1, 18),
      messageId: "yesterday-message",
    });
    state.rememberMessage("plans@c.us", {
      role: "user",
      content: "נפגשנו לארוחת ערב לפני יומיים.",
      timestamp: localAt(-2, 18),
      messageId: "two-days-ago-message",
    });
    state.mergeAnalyzedIntelligence("plans@c.us", {
      insights: [],
      commitments: [],
      events: [
        {
          title: "Lunch tomorrow",
          startAt: localAt(1, 12),
          allDay: false,
          evidence: { excerpt: "Lunch tomorrow at noon", timestamp: Date.now() },
        },
        {
          title: "Lunch in two days",
          startAt: localAt(2, 12),
          allDay: false,
          evidence: { excerpt: "Lunch in two days at noon", timestamp: Date.now() },
        },
      ],
    });

    const contexts: ReplyContext[] = [];
    const ai = {
      reply: async (_chatId: string, _prompt: string, _web: boolean, context: ReplyContext) => {
        contexts.push(context);
        return "Done";
      },
    } as unknown as AiService;
    const processor = new MessageProcessor(config, ai, state);

    await processor.process(textMessage({
      id: "owner-tomorrow",
      chatId: "dani@c.us",
      chatName: "Dani",
      body: "!bot What do I have tomorrow?",
      fromMe: true,
    }), false);
    // Exact schedule requests now use the deterministic calendar path instead
    // of letting a model omit or shift events.
    expect(contexts).toHaveLength(0);

    const dashboardYesterday = state.searchIntelligence("מה עשיתי אתמול", 80)
      .filter((record) => record.kind === "message")
      .map((record) => record.id);
    await processor.process(textMessage({
      id: "owner-yesterday",
      chatId: "dani@c.us",
      chatName: "Dani",
      body: "!bot מה עשיתי אתמול",
      fromMe: true,
    }), false);
    expect(contexts[0]?.ownerKnowledge?.filter((record) => record.kind === "message").map((record) => record.id))
      .toEqual(dashboardYesterday);
  });

  it("turns processing failures into natural, reason-specific replies", () => {
    expect(naturalFailureMessage({ status: 400, message: "Invalid body: failed to parse JSON value" }))
      .toContain("temporary formatting problem");
    expect(naturalFailureMessage({ status: 429, code: "rate_limit_exceeded" }))
      .toContain("too many requests");
    expect(naturalFailureMessage({ status: 401, code: "invalid_api_key" }))
      .toContain("connection needs attention");
    expect(naturalFailureMessage(new Error("fetch failed: socket timeout")))
      .toContain("trouble reaching the AI service");
  });
});
