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

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Ask AmirOS memory correction API", () => {
  it("applies a follow-up correction only to the fact cited by the current answer", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-memory-correction-api-"));
    directories.push(directory);
    const state = new AmirosState(join(directory, "state.json"));
    const chatId = "david@c.us";
    const messageId = "google-job";
    state.rememberChatName(chatId, "David");
    state.rememberMessage(chatId, {
      role: "user", author: "contact", senderName: "David", messageId,
      content: "I work at Google.", timestamp: Date.now(),
    });
    state.mergeRoutedAnalyzedIntelligence(chatId, {
      insights: [{
        kind: "fact", content: "David works at Google.", confidence: .98,
        canonicalKey: "employer", validity: "current", evolution: "replace",
        subjectNames: ["David"], evidence: { messageId, excerpt: "I work at Google.", senderName: "David", timestamp: Date.now() },
      }],
      commitments: [],
    });
    const insight = state.getInsights(chatId)[0]!;
    state.updateInsight(chatId, insight.id, { status: "confirmed" });

    const server = startAmirosDashboard({
      client: { pupPage: null, getChats: async () => [] } as unknown as WhatsAppClient,
      ai: {
        interpretMemoryCorrection: async () => { throw new Error("The direct single-fact correction should not call AI"); },
      } as unknown as AiService,
      config: loadConfig({ OPENAI_API_KEY: "", WEB_SEARCH_ENABLED: "false", AMIROS_PORT: "1", WHATSAPP_SESSION_PATH: join(directory, "session") }),
      state,
      calendarFeedTokenPath: join(directory, "calendar-feed-token"),
      port: 0,
    });
    await once(server, "listening");
    const address = server.address();
    expect(address).not.toBeNull();
    const origin = `http://127.0.0.1:${(address as { port: number }).port}`;

    try {
      const response = await fetch(`${origin}/api/intelligence/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "That’s wrong.",
          followUp: {
            question: "Where does David work?",
            answer: "David works at Google.",
            sourceRefs: [{ id: insight.id, chatId, kind: "insight" }],
          },
          scope: { knowledge: true, calendar: false },
        }),
      });
      const result = await response.json() as { answer?: string };

      expect(response.status).toBe(200);
      expect(result.answer).toContain("Thanks for correcting me");
      expect(state.getInsights(chatId).find((item) => item.id === insight.id)).toMatchObject({ status: "outdated" });
      expect(state.memoryCorrectionHistory()).toEqual([
        expect.objectContaining({ targetInsightId: insight.id, operation: "reject" }),
      ]);
    } finally {
      await closeServer(server);
    }
  });
});
