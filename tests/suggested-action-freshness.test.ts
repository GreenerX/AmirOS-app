import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AmirosState } from "../src/amiros-state.js";
import {
  SUGGESTED_ACTION_MESSAGE_WINDOW_MS,
  hasFreshSuggestedActionEvidence,
  rememberDashboardMessages,
} from "../src/dashboard.js";

describe("suggested-action freshness", () => {
  it("keeps only recent message evidence in the active review window", () => {
    const now = Date.UTC(2026, 7, 16, 18, 0, 0);
    const item = (timestamp: number) => ({
      evidence: { excerpt: "Please follow up", timestamp },
    });

    expect(hasFreshSuggestedActionEvidence(item(now - SUGGESTED_ACTION_MESSAGE_WINDOW_MS + 1), now)).toBe(true);
    expect(hasFreshSuggestedActionEvidence(item(now - SUGGESTED_ACTION_MESSAGE_WINDOW_MS - 1), now)).toBe(false);
    expect(hasFreshSuggestedActionEvidence(item(now + 10 * 60_000), now)).toBe(false);
  });

  it("uses dashboard history as relationship context without creating action suggestions", () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-suggestion-history-"));
    try {
      const state = new AmirosState(join(directory, "state.json"));
      const chatId = "dani@c.us";
      const now = Date.now();
      state.updateContact(chatId, { knowledgeTracking: "enabled" });

      expect(rememberDashboardMessages(state, chatId, [{
        id: "imported-request",
        body: "Can you send me the photos tomorrow?",
        fromMe: false,
        timestamp: now,
        type: "chat",
        hasMedia: false,
      }])).toBe(1);
      expect(state.getConversationMemory(chatId)).toEqual([
        expect.objectContaining({ messageId: "imported-request", eligibleForActionSuggestions: false }),
      ]);
      expect(state.getCommitments(chatId)).toEqual([]);
      expect(state.getTodoTasks(chatId)).toEqual([]);
      expect(state.getCalendarEvents(chatId)).toEqual([]);

      state.mergeAnalyzedIntelligence(chatId, {
        insights: [{
          kind: "relationship_change",
          content: "Dani asked Amir to send photos.",
          confidence: 0.8,
          evidence: { messageId: "imported-request", excerpt: "Can you send me the photos tomorrow?", timestamp: now },
          clusterId: "photos",
          subjectChatIds: [chatId],
          subjectNames: ["Dani"],
        }],
        commitments: [{
          content: "Send Dani the photos",
          owner: "me",
          evidence: { messageId: "imported-request", excerpt: "Can you send me the photos tomorrow?", timestamp: now },
        }],
        todos: [{
          title: "Send Dani the photos",
          evidence: { messageId: "imported-request", excerpt: "Can you send me the photos tomorrow?", timestamp: now },
        }],
        events: [{
          title: "Dinner with Dani",
          startAt: now + 86_400_000,
          allDay: false,
          evidence: { messageId: "imported-request", excerpt: "Dinner tomorrow at 7", timestamp: now },
        }],
      });

      expect(state.getInsights(chatId)).toHaveLength(1);
      expect(state.getCommitments(chatId)).toEqual([]);
      expect(state.getTodoTasks(chatId)).toEqual([]);
      expect(state.getCalendarEvents(chatId)).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("still creates a suggestion from a live tracked message", () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-suggestion-live-"));
    try {
      const state = new AmirosState(join(directory, "state.json"));
      const chatId = "dani@c.us";
      state.updateContact(chatId, { knowledgeTracking: "enabled" });
      state.rememberMessage(chatId, {
        role: "user",
        author: "contact",
        content: "Can you buy batteries?",
        senderName: "Dani",
        timestamp: Date.now(),
        messageId: "live-request",
        eligibleForActionSuggestions: true,
      });

      expect(state.getTodoTasks(chatId)).toEqual([
        expect.objectContaining({
          status: "inferred",
          title: expect.stringMatching(/buy batteries/i),
        }),
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
