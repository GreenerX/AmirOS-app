import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { AiService } from "../src/ai.js";
import { AmirosState } from "../src/amiros-state.js";
import { loadConfig } from "../src/config.js";
import { startAmirosDashboard } from "../src/dashboard.js";
import type { Client as WhatsAppClient } from "whatsapp-web.js";

const directories: string[] = [];

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function addConfirmedInsight(
  state: AmirosState,
  chatId: string,
  contactName: string,
  messageId: string,
  originalText: string,
  summary: string,
  timestamp: number,
): void {
  state.rememberChatName(chatId, contactName);
  state.rememberMessage(chatId, {
    role: "user", author: "contact", senderName: contactName, messageId, content: originalText, timestamp,
  });
  state.mergeRoutedAnalyzedIntelligence(chatId, {
    insights: [{
      kind: "fact", content: summary, confidence: .98, validity: "current", evolution: "replace",
      canonicalKey: "employer", subjectNames: [contactName],
      evidence: { messageId, senderName: contactName, excerpt: originalText, timestamp },
    }], commitments: [],
  });
  const insight = state.getInsights(chatId).at(-1)!;
  state.updateInsight(chatId, insight.id, { status: "confirmed" });
}

async function startTestDashboard(state: AmirosState, ai: Pick<AiService, "answerNetworkQuestion">, directory: string): Promise<{ server: Server; origin: string }> {
  const server = startAmirosDashboard({
    client: { pupPage: null, getChats: async () => [] } as unknown as WhatsAppClient,
    ai: ai as AiService,
    config: loadConfig({ OPENAI_API_KEY: "", WEB_SEARCH_ENABLED: "false", AMIROS_PORT: "1", WHATSAPP_SESSION_PATH: join(directory, "session") }),
    state,
    calendarFeedTokenPath: join(directory, "calendar-feed-token"),
    port: 0,
  });
  await once(server, "listening");
  const address = server.address() as { port: number };
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Ask AmirOS P0 trust contract", () => {
  it("keeps a selected person scoped to their direct chat and returns exact original-message evidence", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-ask-p0-"));
    directories.push(directory);
    const state = new AmirosState(join(directory, "state.json"));
    const now = Date.now();
    addConfirmedInsight(state, "david@c.us", "David Cohen", "david-direct-message", "I work at Acme.", "David works at Acme.", now);
    // This looks like the selected person by display name, but belongs to a
    // different direct chat and must never join David's selected answer.
    addConfirmedInsight(state, "other@c.us", "Project updates", "other-message", "David Cohen works at LeakCo.", "David Cohen works at LeakCo.", now);
    let receivedIds: string[] = [];
    const { server, origin } = await startTestDashboard(state, {
      answerNetworkQuestion: async (_query, records) => {
        receivedIds = records.map((record) => record.id);
        const record = records[0]!;
        return {
          // P2 must not expose model prose that falls outside validated points.
          answer: "David also owns an unverified company.",
          evidenceIds: [record.id],
          points: [{ text: "David works at Acme.", evidenceIds: [record.id] }],
          claims: [{ text: "David works at Acme.", evidenceIds: [record.id] }],
          listIcons: [],
        };
      },
    }, directory);

    try {
      const response = await fetch(`${origin}/api/intelligence/search`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "Where does David Cohen work?", selectedContactId: "david@c.us", scope: { knowledge: true, calendar: false } }),
      });
      const result = await response.json() as {
        answer: string;
        points: Array<{ text: string; evidenceIds: string[] }>;
        claims: Array<{ evidenceIds: string[] }>;
        sources: Array<{ chatId: string; evidence: { messageId: string; authorName?: string; originalText: string; exactMessageAvailable: boolean } }>;
      };

      expect(response.status).toBe(200);
      // The direct chat may contribute both its message and its canonical
      // insight, but the display-name match from the other chat must not.
      expect(receivedIds).not.toContain("other-message");
      expect(result.answer).toBe("David works at Acme.");
      expect(result.answer).not.toContain("unverified");
      expect(result.points).toEqual([{ text: "David works at Acme.", evidenceIds: [receivedIds[0]] }]);
      expect(result.claims).toEqual([{ text: "David works at Acme.", evidenceIds: [receivedIds[0]] }]);
      expect(result.sources).toEqual([expect.objectContaining({
        chatId: "david@c.us",
        evidence: expect.objectContaining({
          messageId: "david-direct-message",
          authorName: "David Cohen",
          originalText: "I work at Acme.",
          exactMessageAvailable: true,
        }),
      })]);
      const intelligence = await (await fetch(`${origin}/api/intelligence`)).json() as {
        questionHistory: Array<{ claims: Array<{ evidenceIds: string[] }>; sources: Array<{ evidence: { messageId: string } }> }>;
      };
      expect(intelligence.questionHistory).toEqual([expect.objectContaining({
        claims: [{ text: "David works at Acme.", evidenceIds: [receivedIds[0]] }],
        sources: [expect.objectContaining({ evidence: expect.objectContaining({ messageId: "david-direct-message" }) })],
      })]);
    } finally {
      await closeServer(server);
    }
  });

  it("fails closed when the original supporting message is not retained or a model omits claim linkage", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-ask-p0-"));
    directories.push(directory);
    const state = new AmirosState(join(directory, "state.json"));
    const now = Date.now();
    state.rememberChatName("dana@c.us", "Dana");
    state.mergeRoutedAnalyzedIntelligence("dana@c.us", {
      insights: [{
        kind: "fact", content: "Dana works at Acme.", confidence: .98, validity: "current", evolution: "replace",
        canonicalKey: "employer", subjectNames: ["Dana"],
        // The text excerpt is not a retained original message and therefore
        // cannot prove an Ask claim.
        evidence: { messageId: "missing-message", senderName: "Dana", excerpt: "I work at Acme.", timestamp: now },
      }], commitments: [],
    });
    const insight = state.getInsights("dana@c.us").at(-1)!;
    state.updateInsight("dana@c.us", insight.id, { status: "confirmed" });
    const { server, origin } = await startTestDashboard(state, {
      answerNetworkQuestion: async () => ({
        answer: "Dana works at Acme.", evidenceIds: [], points: [], claims: [], listIcons: [],
      }),
    }, directory);

    try {
      const response = await fetch(`${origin}/api/intelligence/search`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "Where does Dana work?", selectedContactId: "dana@c.us", scope: { knowledge: true, calendar: false } }),
      });
      const result = await response.json() as { answer: string; evidenceIds: string[]; claims: unknown[]; sources: unknown[] };

      expect(response.status).toBe(200);
      expect(result).toMatchObject({
        answer: "I couldn't verify an answer from an original saved message.", evidenceIds: [], claims: [], sources: [],
      });
      const intelligence = await (await fetch(`${origin}/api/intelligence`)).json() as { questionHistory: unknown[] };
      expect(intelligence.questionHistory).toEqual([]);
    } finally {
      await closeServer(server);
    }
  });
});
