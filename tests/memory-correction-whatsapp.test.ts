import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "whatsapp-web.js";
import { afterEach, describe, expect, it } from "vitest";
import type { AiService, ReplyContext } from "../src/ai.js";
import { AmirosState } from "../src/amiros-state.js";
import type { AppConfig } from "../src/config.js";
import { MessageProcessor } from "../src/processor.js";

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

function ownerMessage(body: string, replies: string[], id: string): Message {
  return {
    id: { _serialized: id, id, remote: "owner@c.us" },
    from: "owner@c.us",
    to: "owner@c.us",
    fromMe: true,
    timestamp: Math.floor(Date.now() / 1_000),
    type: "chat",
    body,
    hasMedia: false,
    hasQuotedMsg: false,
    getChat: async () => ({ id: { _serialized: "owner@c.us" }, name: "Amir Friedman" }),
    reply: async (answer: unknown) => { replies.push(String(answer)); return undefined; },
  } as unknown as Message;
}

function confirmedInsight(state: AmirosState, chatId: string, name: string, content: string, messageId: string) {
  state.rememberChatName(chatId, name);
  state.rememberMessage(chatId, {
    role: "user", author: "contact", senderName: name, messageId, content,
    timestamp: Date.now() - 1_000,
  });
  state.mergeRoutedAnalyzedIntelligence(chatId, {
    insights: [{
      kind: "fact", content, confidence: .98, canonicalKey: "employer",
      validity: "current", evolution: "replace", subjectNames: [name],
      evidence: { messageId, excerpt: content, senderName: name, timestamp: Date.now() - 1_000 },
    }],
    commitments: [],
  });
  const insight = state.getInsights(chatId)[0]!;
  state.updateInsight(chatId, insight.id, { status: "confirmed" });
  return insight;
}

describe("WhatsApp owner memory correction", () => {
  it("uses the prior bot answer to safely reject one canonical fact", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-whatsapp-memory-correction-"));
    directories.push(directory);
    const state = new AmirosState(join(directory, "state.json"));
    state.updateOwnerProfile({ displayName: "Amir Friedman" });
    const google = confirmedInsight(state, "david@c.us", "David", "David works at Google.", "google-job");
    const replies: string[] = [];
    const ai = {
      reply: async (_chatId: string, _prompt: string, _web: boolean, context: ReplyContext) => {
        expect(context.ownerKnowledge?.some((record) => record.id === google.id)).toBe(true);
        return "David works at Google.";
      },
      interpretMemoryCorrection: async () => { throw new Error("A direct one-fact rejection must not call AI"); },
      clearConversation: () => undefined,
    } as unknown as AiService;
    const processor = new MessageProcessor(config, ai, state);

    await processor.process(ownerMessage("Where does David work?", replies, "question"), true);
    expect(replies.at(-1)).toBe("David works at Google.");
    expect(state.getOwnerAssistantMemoryContext("owner@c.us")?.sourceRefs).toEqual([
      { id: google.id, chatId: "david@c.us" },
    ]);

    await processor.process(ownerMessage("That’s wrong.", replies, "correction"), true);

    expect(replies.at(-1)).toContain("Thanks for correcting me");
    expect(state.getInsights("david@c.us").find((item) => item.id === google.id)?.status).toBe("outdated");
    expect(state.memoryCorrectionHistory()[0]).toMatchObject({ targetInsightId: google.id, operation: "reject" });
    expect(state.getOwnerAssistantMemoryContext("owner@c.us")).toBeUndefined();
  });

  it("preserves correction context across restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-whatsapp-memory-restart-"));
    directories.push(directory);
    const statePath = join(directory, "state.json");
    const state = new AmirosState(statePath);
    const fact = confirmedInsight(state, "dani@c.us", "Dani", "Dani lives in Tel Aviv.", "dani-city");
    state.rememberOwnerAssistantMemoryContext("owner@c.us", {
      question: "Where does Dani live?",
      answer: "Dani lives in Tel Aviv.",
      sourceRefs: [{ id: fact.id, chatId: "dani@c.us" }],
    });
    const restarted = new AmirosState(statePath);
    const replies: string[] = [];
    const processor = new MessageProcessor(config, {
      interpretMemoryCorrection: async () => { throw new Error("A direct one-fact historical correction must not call AI"); },
      clearConversation: () => undefined,
    } as unknown as AiService, restarted);

    await processor.process(ownerMessage("That used to be true.", replies, "historical"), true);

    expect(replies.at(-1)).toContain("historical context");
    expect(restarted.getInsights("dani@c.us").find((item) => item.id === fact.id)).toMatchObject({
      status: "confirmed",
      validity: "historical",
    });
  });

  it("continues an ambiguous correction clarification without treating it as a new request", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-whatsapp-memory-clarification-"));
    directories.push(directory);
    const state = new AmirosState(join(directory, "state.json"));
    const employer = confirmedInsight(state, "david@c.us", "David", "David works at Google.", "david-employer");
    state.mergeRoutedAnalyzedIntelligence("david@c.us", {
      insights: [{
        kind: "fact", content: "David lives in Boston.", confidence: .97, canonicalKey: "residence",
        validity: "current", evolution: "replace", subjectNames: ["David"],
        evidence: { messageId: "david-city", excerpt: "David lives in Boston.", senderName: "David", timestamp: Date.now() },
      }],
      commitments: [],
    });
    const residence = state.getInsights("david@c.us").find((item) => item.id !== employer.id)!;
    state.updateInsight("david@c.us", residence.id, { status: "confirmed" });
    state.rememberOwnerAssistantMemoryContext("owner@c.us", {
      question: "What do I know about David?",
      answer: "David works at Google and lives in Boston.",
      sourceRefs: [
        { id: employer.id, chatId: "david@c.us" },
        { id: residence.id, chatId: "david@c.us" },
      ],
    });
    const replies: string[] = [];
    const interpretations: string[] = [];
    const processor = new MessageProcessor(config, {
      interpretMemoryCorrection: async (input: { request: string }) => {
        interpretations.push(input.request);
        if (!input.request.includes("Clarification:")) {
          return { operation: "reject", targetIds: [], confidence: 40, reason: "Ambiguous" };
        }
        return { operation: "reject", targetIds: [employer.id], confidence: 98, reason: "The owner selected the employer fact" };
      },
      clearConversation: () => undefined,
    } as unknown as AiService, state);

    await processor.process(ownerMessage("That’s wrong.", replies, "ambiguous-correction"), true);
    expect(replies.at(-1)).toContain("more than one memory");
    await processor.process(ownerMessage("The Google job.", replies, "correction-choice"), true);

    expect(interpretations.at(-1)).toContain("Clarification: The Google job.");
    expect(state.getInsights("david@c.us").find((item) => item.id === employer.id)?.status).toBe("outdated");
    expect(state.getInsights("david@c.us").find((item) => item.id === residence.id)?.status).toBe("confirmed");
  });

  it("does not let a contact mutate AmirOS memory", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-contact-memory-correction-"));
    directories.push(directory);
    const state = new AmirosState(join(directory, "state.json"));
    const fact = confirmedInsight(state, "david@c.us", "David", "David works at Google.", "google-job-contact");
    const replies: string[] = [];
    const ai = {
      reply: async () => "I understand.",
      interpretMemoryCorrection: async () => { throw new Error("Contacts must not reach correction interpretation"); },
      clearConversation: () => undefined,
    } as unknown as AiService;
    const processor = new MessageProcessor(config, ai, state);
    const incoming = ownerMessage("!bot That’s wrong.", replies, "contact-correction") as Message & { fromMe: boolean; from: string; to: string };
    incoming.fromMe = false;
    incoming.from = "david@c.us";
    incoming.to = "owner@c.us";

    await processor.process(incoming, false);

    expect(state.getInsights("david@c.us").find((item) => item.id === fact.id)?.status).toBe("confirmed");
    expect(state.memoryCorrectionHistory()).toHaveLength(0);
  });
});
