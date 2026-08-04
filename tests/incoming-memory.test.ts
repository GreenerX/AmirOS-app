import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Message } from "whatsapp-web.js";
import type { AiService } from "../src/ai.js";
import { AmirosState } from "../src/amiros-state.js";
import type { AppConfig } from "../src/config.js";
import { MessageProcessor } from "../src/processor.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("incoming contact memory capture", () => {
  it("tracks an incoming group message even when group automation is disabled", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-incoming-memory-"));
    directories.push(directory);
    const state = new AmirosState(join(directory, "state.json"));
    const processor = new MessageProcessor(
      {
        allowGroups: false,
        allowOutgoingTriggerCommands: true,
        autoReplySelfChat: true,
      } as AppConfig,
      {} as AiService,
      state,
    );
    const message = {
      id: { _serialized: "incoming-group-message-1" },
      from: "group@g.us",
      to: "owner@c.us",
      fromMe: false,
      timestamp: 100,
      type: "chat",
      body: "I prefer afternoon meetings.",
      hasMedia: false,
      getChat: async () => ({ name: "Project Group" }),
      getContact: async () => ({ name: "Sana" }),
    } as unknown as Message;

    await processor.process(message, false);

    expect(state.getConversationMemory("group@g.us")).toMatchObject([
      {
        role: "user",
        senderName: "Sana",
        content: "I prefer afternoon meetings.",
        messageId: "incoming-group-message-1",
      },
    ]);
  });
});
