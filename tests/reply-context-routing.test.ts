import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Message } from "whatsapp-web.js";
import type { AiService, ReplyContext } from "../src/ai.js";
import { AmirosState } from "../src/amiros-state.js";
import type { AppConfig } from "../src/config.js";
import { MessageProcessor, naturalFailureMessage } from "../src/processor.js";

const directories: string[] = [];

afterEach(() => {
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
}) {
  return {
    id: { _serialized: input.id, id: input.id, remote: input.chatId },
    from: input.fromMe ? "owner@c.us" : input.chatId,
    to: input.fromMe ? input.chatId : "owner@c.us",
    fromMe: input.fromMe,
    timestamp: Math.floor(Date.now() / 1_000),
    type: "chat",
    body: input.body,
    hasMedia: false,
    hasQuotedMsg: false,
    getChat: async () => ({ id: { _serialized: input.chatId }, name: input.chatName }),
    reply: async () => undefined,
  } as unknown as Message;
}

describe("AI reply context privacy routing", () => {
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
    state.updateContact("dani@c.us", {
      mode: "auto",
      contactTriggerAccess: ["calendar"],
    });
    state.mergeAnalyzedIntelligence("plans@c.us", {
      insights: [],
      commitments: [],
      events: [{
        title: "Theater night",
        startAt: Date.now() + 4 * 86_400_000,
        allDay: false,
        evidence: { excerpt: "We are going to the theater next Friday at 8pm", timestamp: Date.now() },
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

    await processor.process(textMessage({
      id: "dani-calendar-trigger",
      chatId: "dani@c.us",
      chatName: "Dani",
      body: "!bot what is Amir's schedule this week?",
      fromMe: false,
    }), false);

    expect(contexts[0]?.scope).toBe("contact-trigger");
    expect(contexts[0]?.triggerAuthor).toBe("contact");
    expect(contexts[0]?.requesterName).toBe("Dani");
    expect(contexts[0]?.ownerName).toBe("Amir Friedman");
    expect(contexts[0]?.ownerEvents?.some((item) => item.title === "Theater night")).toBe(true);
    expect(contexts[0]?.ownerKnowledge).toBeUndefined();

    await processor.process(textMessage({
      id: "dani-automatic-message",
      chatId: "dani@c.us",
      chatName: "Dani",
      body: "What is Amir's schedule this week?",
      fromMe: false,
    }), false);

    expect(contexts[1]?.scope).toBe("chat");
    expect(contexts[1]?.ownerEvents).toBeUndefined();
    expect(contexts[1]?.ownerKnowledge).toBeUndefined();
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
