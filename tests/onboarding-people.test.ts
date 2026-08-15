import { describe, expect, it } from "vitest";
import {
  buildFirstRunPeopleDirectory,
  canBuildFirstRunPeopleDirectory,
  firstRunFutureTracking,
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
  it("requires explicit consent before a selected first-run analysis can start", () => {
    expect(canBuildFirstRunPeopleDirectory(0, false)).toBe(true);
    expect(canBuildFirstRunPeopleDirectory(1, false)).toBe(false);
    expect(canBuildFirstRunPeopleDirectory(1, true)).toBe(true);
  });

  it("does not silently opt selected people into future learning", () => {
    expect(firstRunFutureTracking("ask", false)).toBe("pending");
    expect(firstRunFutureTracking("off", false)).toBe("disabled");
    expect(firstRunFutureTracking("private", false)).toBe("enabled");
    expect(firstRunFutureTracking("off", true)).toBe("enabled");
  });

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

  it("keeps one-time setup separate from future learning and uses the bounded first-run window once", async () => {
    const calls: string[] = [];
    const progress: Array<[number, number]> = [];

    await buildFirstRunPeopleDirectory(["dani@c.us", "dani@c.us", "short@c.us"], {
      futureTracking: "pending",
      setKnowledgeTracking: async (chatId, status) => { calls.push(`tracking:${chatId}:${status}`); },
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
      `scan:dani@c.us:${FIRST_RUN_PEOPLE_SCAN_LIMIT}`, `analyze:dani@c.us:${FIRST_RUN_PEOPLE_SCAN_LIMIT}:true`, `tracking:dani@c.us:pending`,
      `scan:short@c.us:${FIRST_RUN_PEOPLE_SCAN_LIMIT}`, `tracking:short@c.us:pending`,
    ]);
    expect(progress).toEqual([[0, 2], [1, 2], [1, 2], [2, 2]]);
  });

  it("only enables ongoing learning when that separate preference is selected", async () => {
    const calls: string[] = [];
    await buildFirstRunPeopleDirectory(["dani@c.us"], {
      futureTracking: "enabled",
      setKnowledgeTracking: async (_chatId, status) => { calls.push(status); },
      scanHistory: async () => ({ messages: ["one", "two"] }),
      analyzeRelationship: async () => undefined,
      onProgress: () => undefined,
    });
    expect(calls).toEqual(["enabled"]);
  });
});
