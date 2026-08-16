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

describe("calendar history API", () => {
  it("keeps confirmed past events available to the Calendar without adding them to the current dashboard feed", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-calendar-history-api-"));
    directories.push(directory);
    const state = new AmirosState(join(directory, "state.json"));
    const chatId = "history-contact@c.us";
    const pastStartAt = Date.now() - 7 * 86_400_000;
    state.addOwnerCalendarEvent(chatId, {
      title: "Past family dinner",
      startAt: pastStartAt,
      allDay: false,
      evidence: { excerpt: "Past family dinner", timestamp: pastStartAt },
    });

    const server = startAmirosDashboard({
      client: {
        pupPage: null,
        getChats: async () => [{
          id: { _serialized: chatId, user: "History Contact" },
          name: "History Contact",
          archived: false,
        }],
      } as unknown as WhatsAppClient,
      ai: { isConfigured: () => false } as unknown as AiService,
      config: loadConfig({ OPENAI_API_KEY: "", WEB_SEARCH_ENABLED: "false", AMIROS_PORT: "1", WHATSAPP_SESSION_PATH: join(directory, "session") }),
      state,
      calendarFeedTokenPath: join(directory, "calendar-feed-token"),
      port: 0,
    });
    await once(server, "listening");
    const address = server.address() as { port: number };

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/intelligence`);
      const result = await response.json() as {
        events: Array<{ title: string }>;
        calendarEvents: Array<{ title: string; status: string }>;
      };

      expect(response.status).toBe(200);
      expect(result.calendarEvents).toContainEqual(expect.objectContaining({
        title: "Past family dinner",
        status: "confirmed",
      }));
      expect(result.events).not.toContainEqual(expect.objectContaining({ title: "Past family dinner" }));
    } finally {
      await closeServer(server);
    }
  });
});
