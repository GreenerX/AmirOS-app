import { describe, expect, it } from "vitest";
import {
  buildFirstRunPeopleDirectory,
  FIRST_RUN_PEOPLE_SCAN_LIMIT,
  FIRST_RUN_PEOPLE_SUGGESTION_LIMIT,
  suggestedFirstRunPeople,
} from "../ui/src/onboarding-people.js";
import type { ChatSummary } from "../ui/src/types.js";

function chat(id: string, timestamp: number, patch: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id,
    name: id.replace(/@.*/u, ""),
    isGroup: false,
    unreadCount: 0,
    timestamp,
    preview: "Private preview that first-run suggestions must not use.",
    mode: "off",
    ...patch,
  };
}

describe("first-run People setup", () => {
  it("suggests up to twelve direct chats, with favorites before newer ordinary chats", () => {
    const chats = [
      chat("owner@c.us", 99, { name: "Amir Friedman (You)" }),
      chat("group@g.us", 98, { isGroup: true }),
      chat("favorite@c.us", 1, { name: "Favorite person", pinned: true }),
      ...Array.from({ length: 13 }, (_, index) => chat(`person-${index}@c.us`, 90 - index)),
    ];

    const suggested = suggestedFirstRunPeople(chats, "Amir Friedman");

    expect(suggested).toHaveLength(FIRST_RUN_PEOPLE_SUGGESTION_LIMIT);
    expect(suggested[0]?.id).toBe("favorite@c.us");
    expect(suggested.map((item) => item.id)).not.toContain("owner@c.us");
    expect(suggested.some((item) => item.isGroup)).toBe(false);
  });

  it("enables, scans, and analyzes selected chats exactly once using the bounded first-run window", async () => {
    const calls: string[] = [];
    const progress: Array<[number, number]> = [];

    await buildFirstRunPeopleDirectory(["dani@c.us", "dani@c.us", "short@c.us"], {
      enableKnowledgeTracking: async (chatId) => { calls.push(`enable:${chatId}`); },
      scanHistory: async (chatId, limit) => {
        calls.push(`scan:${chatId}:${limit}`);
        return { messages: chatId === "short@c.us" ? ["only one"] : ["one", "two"] };
      },
      analyzeRelationship: async (chatId, limit, advanceLearningCursor) => {
        calls.push(`analyze:${chatId}:${limit}:${advanceLearningCursor}`);
      },
      onProgress: (completed, total) => progress.push([completed, total]),
    });

    expect(calls).toEqual([
      `scan:dani@c.us:${FIRST_RUN_PEOPLE_SCAN_LIMIT}`, `analyze:dani@c.us:${FIRST_RUN_PEOPLE_SCAN_LIMIT}:true`, `enable:dani@c.us`,
      `scan:short@c.us:${FIRST_RUN_PEOPLE_SCAN_LIMIT}`, `enable:short@c.us`,
    ]);
    expect(progress).toEqual([[0, 2], [1, 2], [1, 2], [2, 2]]);
  });
});
