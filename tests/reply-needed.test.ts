import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AmirosState } from "../src/amiros-state.js";
import {
  assessDeterministicReplyNeed,
  REPLY_AI_FALLBACK_CONFIDENCE_THRESHOLD,
  resolveReplyAssessment,
  type CachedReplyAssessment,
  type ReplyAssessmentCache,
  type ReplyAssessmentContextEntry,
} from "../src/reply-needed.js";

const temporaryDirectories: string[] = [];
const now = Date.UTC(2026, 7, 9, 12, 0, 0);

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function context(content: string): ReplyAssessmentContextEntry[] {
  return [{
    role: "user",
    author: "group_member",
    content,
    senderName: "Dani",
    timestamp: now - 60_000,
    messageId: "message-1",
  }];
}

function memoryCache(): ReplyAssessmentCache {
  const values = new Map<string, CachedReplyAssessment>();
  return {
    getReplyAssessment: (chatId, contextKey) => {
      const value = values.get(chatId);
      return value?.contextKey === contextKey ? value : undefined;
    },
    setReplyAssessment: (chatId, assessment) => values.set(chatId, assessment),
  };
}

describe("deterministic reply-needed assessment", () => {
  it("uses AI only below the configured 90% confidence cutoff", () => {
    expect(REPLY_AI_FALLBACK_CONFIDENCE_THRESHOLD).toBe(90);
    expect(assessDeterministicReplyNeed({
      chatId: "dani@c.us", content: "When are you free", latestMessageIsIncoming: true, lastIncomingAt: now - 60_000, now,
    })).toMatchObject({ confidence: 92, requiresAi: false });
  });

  it("keeps direct private questions and requests deterministic", () => {
    expect(assessDeterministicReplyNeed({
      chatId: "dani@c.us", content: "Can you send me the address?", latestMessageIsIncoming: true, lastIncomingAt: now - 60_000, now,
    })).toMatchObject({ needsReply: true, confidence: 97, reason: "direct_request", requiresAi: false });
    expect(assessDeterministicReplyNeed({
      chatId: "dani@c.us", content: "When are you free?", latestMessageIsIncoming: true, lastIncomingAt: now - 60_000, now,
    })).toMatchObject({ needsReply: true, reason: "direct_question", requiresAi: false });
  });

  it("closes clear acknowledgements, owner replies, and stale messages without AI", () => {
    expect(assessDeterministicReplyNeed({
      chatId: "dani@c.us", content: "Thanks!", latestMessageIsIncoming: true, lastIncomingAt: now - 60_000, now,
    })).toMatchObject({ needsReply: false, reason: "acknowledgement", confidence: 97 });
    expect(assessDeterministicReplyNeed({
      chatId: "dani@c.us", content: "Can you help?", latestMessageIsIncoming: false, now,
    })).toMatchObject({ needsReply: false, reason: "owner_replied", confidence: 100 });
    expect(assessDeterministicReplyNeed({
      chatId: "dani@c.us", content: "Can you help?", latestMessageIsIncoming: true, lastIncomingAt: now - 8 * 24 * 60 * 60 * 1_000, now,
    })).toMatchObject({ needsReply: false, reason: "stale", requiresAi: false });
  });

  it("requires a clear owner address for a deterministic group reply", () => {
    expect(assessDeterministicReplyNeed({
      chatId: "family@g.us", content: "Amir, can you bring the tickets?", ownerName: "Amir Friedman", latestMessageIsIncoming: true, lastIncomingAt: now - 60_000, now,
    })).toMatchObject({ needsReply: true, reason: "mentioned_in_group", confidence: 98, requiresAi: false });
    expect(assessDeterministicReplyNeed({
      chatId: "family@g.us", content: "Could you bring the tickets?", ownerName: "Amir Friedman", latestMessageIsIncoming: true, lastIncomingAt: now - 60_000, now,
    })).toMatchObject({ needsReply: false, mayNeedReply: true, reason: "ambiguous", requiresAi: true });
  });
});

describe("ambiguous reply-needed AI fallback", () => {
  it("uses AI once per unchanged context and exposes its cached decision", async () => {
    const ai = {
      isConfigured: () => true,
      assessReplyNeed: vi.fn(async () => ({ needsReply: false, confidence: 87, reason: "Request is for the group, not the owner" })),
    };
    const cache = memoryCache();
    const input = {
      chatId: "family@g.us",
      contactName: "Family",
      content: "Could you bring the tickets?",
      latestMessageIsIncoming: true,
      lastIncomingAt: now - 60_000,
      ownerName: "Amir Friedman",
      now,
      context: context("Could you bring the tickets?"),
      cache,
      ai,
    };

    await expect(resolveReplyAssessment(input)).resolves.toMatchObject({
      needsReply: false, mayNeedReply: false, confidence: 87, source: "ai",
    });
    await expect(resolveReplyAssessment(input)).resolves.toMatchObject({ source: "ai", confidence: 87 });
    expect(ai.assessReplyNeed).toHaveBeenCalledTimes(1);

    await resolveReplyAssessment({ ...input, context: [...input.context, {
      role: "user", author: "group_member", content: "Anyone available?", senderName: "Noa", timestamp: now, messageId: "message-2",
    }] });
    expect(ai.assessReplyNeed).toHaveBeenCalledTimes(2);
  });

  it("keeps an ambiguous deterministic result when AI is unavailable", async () => {
    const ai = { isConfigured: () => false, assessReplyNeed: vi.fn() };
    await expect(resolveReplyAssessment({
      chatId: "family@g.us", contactName: "Family", content: "Could you bring the tickets?", latestMessageIsIncoming: true,
      lastIncomingAt: now - 60_000, ownerName: "Amir Friedman", now, context: context("Could you bring the tickets?"), ai,
    })).resolves.toMatchObject({ needsReply: false, mayNeedReply: true, confidence: 54, source: "deterministic", reason: "ambiguous" });
    expect(ai.assessReplyNeed).not.toHaveBeenCalled();
  });
});

describe("reply-needed cache persistence", () => {
  it("invalidates an AI decision as soon as a relevant chat message is saved", () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-reply-needed-"));
    temporaryDirectories.push(directory);
    const state = new AmirosState(join(directory, "state.json"));
    const chatId = "family@g.us";
    const contextKey = "a".repeat(64);
    state.setReplyAssessment(chatId, {
      contextKey, needsReply: true, mayNeedReply: true, confidence: 76, source: "ai", reason: "owner was addressed", createdAt: now,
    });
    expect(state.getReplyAssessment(chatId, contextKey)).toBeDefined();

    state.rememberMessage(chatId, {
      role: "user", author: "group_member", content: "Actually, never mind.", messageId: "new-message", timestamp: now,
    });
    expect(state.getReplyAssessment(chatId, contextKey)).toBeUndefined();
  });
});
