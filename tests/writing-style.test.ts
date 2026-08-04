import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AmirosState } from "../src/amiros-state.js";
import { WRITING_STYLE_REFRESH_INTERVAL, WritingStyleLearner } from "../src/writing-style.js";

const temporaryDirectories: string[] = [];

function createState(): AmirosState {
  const directory = mkdtempSync(join(tmpdir(), "amiros-writing-style-"));
  temporaryDirectories.push(directory);
  return new AmirosState(join(directory, "state.json"));
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("automatic per-chat writing-style learning", () => {
  it("learns on each fifth owner-written message and ignores AI replies", async () => {
    const state = createState();
    const analyzeWritingStyle = vi.fn(async ({ messages }: { messages: string[] }) => ({
      summary: `Learned from ${messages.length} messages`,
      messageLength: "Short",
      emojiUse: "Occasional",
      formality: "Casual",
      replyGuidance: ["Use short casual sentences."],
      sourceMessageCount: messages.length,
    }));
    const clearConversation = vi.fn();
    const learner = new WritingStyleLearner(state, { analyzeWritingStyle, clearConversation });
    const chatId = "friend@c.us";

    state.rememberMessage(chatId, { role: "assistant", author: "assistant", content: "AI-generated reply" });
    for (let index = 1; index < WRITING_STYLE_REFRESH_INTERVAL; index += 1) {
      state.rememberMessage(chatId, { role: "assistant", author: "owner", content: `Owner message ${index}` });
    }
    expect(await learner.refreshIfDue(chatId)).toBeUndefined();
    expect(analyzeWritingStyle).not.toHaveBeenCalled();

    state.rememberMessage(chatId, { role: "assistant", author: "owner", content: "Owner message 5" });
    const firstProfile = await learner.refreshIfDue(chatId);
    expect(analyzeWritingStyle).toHaveBeenCalledTimes(1);
    expect(firstProfile).toMatchObject({
      sourceMessageCount: 5,
      ownerMessageCountAtUpdate: 5,
    });

    for (let index = 6; index < 10; index += 1) {
      state.rememberMessage(chatId, { role: "assistant", author: "owner", content: `Owner message ${index}` });
    }
    expect(await learner.refreshIfDue(chatId)).toBeUndefined();
    state.rememberMessage(chatId, { role: "assistant", author: "owner", content: "Owner message 10" });
    await learner.refreshIfDue(chatId);

    expect(analyzeWritingStyle).toHaveBeenCalledTimes(2);
    expect(state.getWritingStyleProfile(chatId)).toMatchObject({
      sourceMessageCount: 10,
      ownerMessageCountAtUpdate: 10,
    });
    expect(clearConversation).toHaveBeenCalledTimes(2);
  });

  it("keeps counters and samples isolated by conversation", () => {
    const state = createState();
    state.rememberMessage("dani@c.us", { role: "assistant", author: "owner", content: "Warm and playful 💛" });
    state.rememberMessage("work@g.us", { role: "assistant", author: "owner", content: "Short work update." });
    state.rememberMessage("dani@c.us", { role: "assistant", author: "assistant", content: "Generated answer" });

    expect(state.getOwnerWritingMessageCount("dani@c.us")).toBe(1);
    expect(state.getOwnerWritingMessages("dani@c.us")).toEqual(["Warm and playful 💛"]);
    expect(state.getOwnerWritingMessageCount("work@g.us")).toBe(1);
    expect(state.getOwnerWritingMessages("work@g.us")).toEqual(["Short work update."]);
  });
});
