import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Message } from "whatsapp-web.js";
import type { AiService } from "../src/ai.js";
import { AmirosState } from "../src/amiros-state.js";
import type { AppConfig } from "../src/config.js";
import {
  authoritativeClockReply,
  authoritativeScheduleReply,
  ownerScheduleRange,
  parseOwnerActionRequest,
} from "../src/owner-actions.js";
import { MessageProcessor } from "../src/processor.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const config = {
  allowGroups: true,
  allowOutgoingTriggerCommands: true,
  autoReplySelfChat: true,
  botTriggerPrefix: "!bot",
  webTriggerPrefix: "!web",
  imageTriggerPrefix: "!image",
  modelsTriggerPrefix: "!models",
  voiceBotTriggerPrefix: "bot",
  voiceWebTriggerPrefix: "web",
  voiceImageTriggerPrefix: "image",
  conversationTurnLimit: 10,
} as AppConfig;

function ownerMessage(body: string, timestamp: number, replies: string[]): Message {
  return {
    id: { _serialized: `owner-${timestamp}-${body}`, remote: "owner@c.us" },
    from: "owner@c.us",
    to: "owner@c.us",
    fromMe: true,
    timestamp: Math.floor(timestamp / 1_000),
    type: "chat",
    body,
    hasMedia: false,
    hasQuotedMsg: false,
    getChat: async () => ({ id: { _serialized: "owner@c.us" }, name: "Amir Friedman" }),
    reply: async (answer: string) => { replies.push(answer); },
  } as unknown as Message;
}

describe("owner-authorized AmirOS writes", () => {
  it("recognizes explicit collections without treating an unrelated preference as a calendar command", () => {
    const now = new Date(2026, 7, 10, 1, 30).getTime();
    expect(parseOwnerActionRequest("Add walking the dogs at 9:15am to the calendar", now)?.kind).toBe("calendar");
    expect(parseOwnerActionRequest("Add buy milk to my todo list", now)?.kind).toBe("todo");
    expect(parseOwnerActionRequest("Remember that Dani is allergic to shellfish", now)?.kind).toBe("knowledge");
    expect(parseOwnerActionRequest("Add some emoji to your answers", now)).toBeUndefined();
  });

  it("writes a self-chat calendar command as confirmed and replies from the saved record", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-owner-write-"));
    directories.push(directory);
    const statePath = join(directory, "state.json");
    const state = new AmirosState(statePath);
    state.updateOwnerProfile({ displayName: "Amir Friedman" });
    const replies: string[] = [];
    let generalReplies = 0;
    const ai = {
      generateOwnerActionTitle: async () => "Walk the Dogs",
      reply: async () => { generalReplies += 1; return "untrusted"; },
    } as unknown as AiService;
    const processor = new MessageProcessor(
      config,
      ai,
      state,
      undefined,
      undefined,
      async () => "/api/todays-focus/icons/aaaaaaaaaaaaaaaaaaaaaaaa.png",
    );
    const now = new Date(2026, 7, 10, 1, 30).getTime();

    await processor.process(ownerMessage("Add walking the dogs at 9:15am to the calendar", now, replies), true);

    const event = state.getCalendarEvents("owner@c.us")[0];
    expect(event).toMatchObject({ title: "Walk the Dogs", status: "confirmed" });
    expect(new Date(event!.startAt).getHours()).toBe(9);
    expect(new Date(event!.startAt).getMinutes()).toBe(15);
    expect(event?.evidence.source).toBe("whatsapp_bot");
    expect(replies[0]).toContain("Added to *AmirOS Calendar*");
    expect(replies[0]).not.toContain("review");
    expect(generalReplies).toBe(0);
    await Promise.resolve();
    expect(state.getCalendarEvents("owner@c.us")[0]?.imageUrl).toBe("/api/todays-focus/icons/aaaaaaaaaaaaaaaaaaaaaaaa.png");
    expect(JSON.parse(readFileSync(statePath, "utf8")).memories["owner@c.us"].events[0].status).toBe("confirmed");
  });

  it("opens owner-requested to-dos and saves knowledge without review", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-owner-collections-"));
    directories.push(directory);
    const state = new AmirosState(join(directory, "state.json"));
    const replies: string[] = [];
    const ai = {
      generateOwnerActionTitle: async () => "Dani is allergic to shellfish",
      generateTodoPresentation: async () => ({ title: "Buy Milk", priority: "low" as const, emoji: "🥛" }),
      reply: async () => "untrusted",
    } as unknown as AiService;
    const processor = new MessageProcessor(config, ai, state);
    const now = new Date(2026, 7, 10, 2, 0).getTime();

    await processor.process(ownerMessage("Add buy milk to my todo list", now, replies), true);
    await processor.process(ownerMessage("Remember that Dani is allergic to shellfish", now + 1_000, replies), true);

    expect(state.getTodoTasks("owner@c.us")[0]).toMatchObject({ title: "Buy Milk 🥛", priority: "low", status: "open" });
    expect(state.getTodoTasks("owner@c.us")[0]?.evidence.source).toBe("whatsapp_bot");
    expect(state.getManualMemory("owner@c.us")[0]?.content).toBe("Dani is allergic to shellfish");
    expect(replies).toEqual(expect.arrayContaining([
      expect.stringContaining("AmirOS To-dos"),
      expect.stringContaining("AmirOS Knowledge"),
    ]));
  });

  it("answers the clock and schedule deterministically in local time with every confirmed event", () => {
    const now = new Date(2026, 7, 10, 1, 35).getTime();
    expect(authoritativeClockReply(now, "24-hour", "Asia/Jerusalem")).toContain("01:35");
    const range = ownerScheduleRange("What's on my schedule today?", now)!;
    const events = [9, 13, 19, 20, 21].map((hour, index) => ({
      id: String(index), title: `Event ${index + 1}`, startAt: new Date(2026, 7, 10, hour, index ? 30 : 15).getTime(),
      allDay: false, status: "confirmed" as const,
      evidence: { excerpt: "owner command", timestamp: now }, createdAt: now, updatedAt: now,
    }));
    const answer = authoritativeScheduleReply(events, range, now, "24-hour");
    expect(answer).toContain("Monday, August 10, 2026");
    expect(answer.match(/^• /gmu)).toHaveLength(5);
    expect(answer.indexOf("Event 1")).toBeLessThan(answer.indexOf("Event 5"));
  });
});
