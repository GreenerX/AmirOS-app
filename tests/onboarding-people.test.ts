import { describe, expect, it } from "vitest";
import {
  buildFirstRunPeopleDirectory,
  canBuildFirstRunPeopleDirectory,
  firstRunSelectedPeopleTracking,
  firstRunPeopleProgressLabel,
  FIRST_RUN_PEOPLE_SCAN_LIMIT,
  FIRST_RUN_PEOPLE_SUGGESTION_LIMIT,
  firstRunPeopleControlCenterEvents,
  shouldReportFirstPeopleSelected,
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

  it("keeps learning from chats the owner explicitly selected during setup", () => {
    expect(firstRunSelectedPeopleTracking()).toBe("enabled");
  });

  it("never renders an impossible People setup progress count", () => {
    expect(firstRunPeopleProgressLabel(0, 6)).toBe("Preparing 1 of 6");
    expect(firstRunPeopleProgressLabel(5, 6)).toBe("Preparing 6 of 6");
    expect(firstRunPeopleProgressLabel(6, 6)).toBe("Finishing People setup");
    expect(firstRunPeopleProgressLabel(7, 6)).toBe("Finishing People setup");
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

  it("uses the bounded first-run window once and then preserves selected chats for future learning", async () => {
    const calls: string[] = [];
    const progress: Array<[number, number]> = [];

    const result = await buildFirstRunPeopleDirectory(["dani@c.us", "dani@c.us", "short@c.us"], {
      futureTracking: "enabled",
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
      `scan:dani@c.us:${FIRST_RUN_PEOPLE_SCAN_LIMIT}`, `analyze:dani@c.us:${FIRST_RUN_PEOPLE_SCAN_LIMIT}:true`, `tracking:dani@c.us:enabled`,
      `scan:short@c.us:${FIRST_RUN_PEOPLE_SCAN_LIMIT}`, `tracking:short@c.us:enabled`,
    ]);
    expect(progress).toEqual([[0, 2], [1, 2], [1, 2], [2, 2]]);
    expect(result).toEqual({ selectedChatIds: ["dani@c.us", "short@c.us"], profiledChatIds: ["dani@c.us"], shortConversationChatIds: ["short@c.us"] });
    expect(shouldReportFirstPeopleSelected(result)).toBe(true);
  });

  it("does not report the first-people milestone when an explicit chat has no usable profile", async () => {
    const result = await buildFirstRunPeopleDirectory(["short@c.us"], {
      futureTracking: "enabled",
      setKnowledgeTracking: async () => undefined,
      scanHistory: async () => ({ messages: ["only one"] }),
      analyzeRelationship: async () => undefined,
      onProgress: () => undefined,
    });
    expect(result.profiledChatIds).toEqual([]);
    expect(result.shortConversationChatIds).toEqual(["short@c.us"]);
    expect(shouldReportFirstPeopleSelected(result)).toBe(false);
    expect(firstRunPeopleControlCenterEvents("ready", result)).toEqual(["whatsapp_connected"]);
  });

  it("only sends existing informational Control Center milestones after the matching real local outcome", () => {
    const built = { selectedChatIds: ["dani@c.us"], profiledChatIds: ["dani@c.us"], shortConversationChatIds: [] };
    expect(firstRunPeopleControlCenterEvents("qr", built)).toEqual([]);
    expect(firstRunPeopleControlCenterEvents("ready", built)).toEqual(["whatsapp_connected", "first_people_selected"]);
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
