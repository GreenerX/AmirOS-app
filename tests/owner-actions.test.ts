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
    expect(parseOwnerActionRequest("Add update my LinkedIn to the to do list", now)).toMatchObject({
      kind: "todo", title: "update my LinkedIn",
    });
    expect(parseOwnerActionRequest("I need to buy almonds", now)).toMatchObject({
      kind: "todo", title: "buy almonds",
    });
    expect(parseOwnerActionRequest("Remember that Dani is allergic to shellfish", now)?.kind).toBe("knowledge");
    expect(parseOwnerActionRequest("Add some emoji to your answers", now)).toBeUndefined();
  });

  it("uses the shared temporal decision for owner-created to-dos, events, and commitments", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-owner-temporal-"));
    directories.push(directory);
    const state = new AmirosState(join(directory, "state.json"));
    const replies: string[] = [];
    let generalReplies = 0;
    const ai = {
      generateTodoPresentation: async ({ currentTitle }: { currentTitle: string }) => currentTitle.includes("batteries")
        ? { title: "Buy batteries", priority: "normal" as const, emoji: "🔋" }
        : { title: "Take out the trash", priority: "normal" as const, emoji: "🗑️" },
      generateOwnerActionTitle: async ({ kind }: { kind: string }) => kind === "commitment"
        ? "Send Dani the photos"
        : "Water the plants",
      reply: async () => { generalReplies += 1; return "No action taken."; },
    } as unknown as AiService;
    const processor = new MessageProcessor(config, ai, state);
    const now = new Date(2026, 7, 10, 9, 0).getTime();

    await processor.process(ownerMessage("Add buy batteries tomorrow at 9am to my to-do list.", now, replies), true);
    await processor.process(ownerMessage("Add take out the trash tomorrow at 10am to my to-do list.", now + 1_000, replies), true);
    await processor.process(ownerMessage("Water the plants Wednesday at noon.", now + 2_000, replies), true);
    await processor.process(ownerMessage("Water the plants Wednesday at noon.", now + 2_500, replies), true);
    await processor.process(ownerMessage("I promised Dani I would send the photos tomorrow.", now + 3_000, replies), true);

    const todos = state.getTodoTasks("owner@c.us");
    expect(todos).toHaveLength(2);
    expect(todos.map((item) => item.title)).toEqual(expect.arrayContaining(["Buy batteries 🔋", "Take out the trash 🗑️"]));
    expect(todos.every((item) => new Date(item.dueAt!).getDate() === 11)).toBe(true);

    const events = state.getCalendarEvents("owner@c.us");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ title: "Water the plants", status: "confirmed", allDay: false });
    expect(new Date(events[0]!.startAt).getDay()).toBe(3);
    expect(new Date(events[0]!.startAt).getHours()).toBe(12);

    expect(state.getCommitments("owner@c.us")).toEqual([
      expect.objectContaining({ content: "Send Dani the photos", status: "open" }),
    ]);
    expect(new Date(state.getCommitments("owner@c.us")[0]!.dueAt!).getDate()).toBe(11);
    expect(generalReplies).toBe(0);

    await processor.process(ownerMessage("Tomorrow could be interesting.", now + 4_000, replies), true);
    expect(state.getTodoTasks("owner@c.us")).toHaveLength(2);
    expect(state.getCalendarEvents("owner@c.us")).toHaveLength(1);
    expect(state.getCommitments("owner@c.us")).toHaveLength(1);
    expect(generalReplies).toBe(1);
  });

  it("persists a pending owner action and resumes it from a 24-hour time reply", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-owner-clarification-"));
    directories.push(directory);
    const statePath = join(directory, "state.json");
    const state = new AmirosState(statePath);
    const replies: string[] = [];
    let generalReplies = 0;
    const ai = {
      generateTodoPresentation: async () => ({ title: "Take out the trash", priority: "normal" as const, emoji: "🗑️" }),
      reply: async () => { generalReplies += 1; return "untrusted"; },
    } as unknown as AiService;
    const now = new Date(2026, 7, 10, 9, 0).getTime();

    await new MessageProcessor(config, ai, state).process(
      ownerMessage("Take out the trash tomorrow", now, replies),
      true,
    );

    expect(replies.at(-1)).toContain("What time should I set");
    expect(state.getTodoTasks("owner@c.us")).toEqual([]);
    expect(state.getPendingOwnerActionClarification("owner@c.us", now)).toMatchObject({
      source: "Take out the trash tomorrow",
      title: "Take out the trash",
    });

    // Reloading proves that the pending continuation survives the WhatsApp
    // round trip and a background-service restart.
    const reloaded = new AmirosState(statePath);
    await new MessageProcessor(config, ai, reloaded).process(
      ownerMessage("13:00", now + 60_000, replies),
      true,
    );

    const tasks = reloaded.getTodoTasks("owner@c.us");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: "Take out the trash 🗑️", status: "open" });
    expect(new Date(tasks[0]!.dueAt!).getDate()).toBe(11);
    expect(new Date(tasks[0]!.dueAt!).getHours()).toBe(13);
    expect(reloaded.getPendingOwnerActionClarification("owner@c.us", now + 60_000)).toBeUndefined();
    expect(generalReplies).toBe(0);
  });

  it("resumes a pending owner action from a bare hour", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-owner-bare-hour-"));
    directories.push(directory);
    const state = new AmirosState(join(directory, "state.json"));
    const replies: string[] = [];
    const ai = {
      // A bad enrichment must not turn the owner's TV request into a watch.
      generateTodoPresentation: async () => ({ title: "Buy a watch", priority: "normal" as const, emoji: "📺" }),
      reply: async () => "untrusted",
    } as unknown as AiService;
    const processor = new MessageProcessor(config, ai, state);
    const now = new Date(2026, 7, 10, 9, 0).getTime();

    await processor.process(ownerMessage("Buy a TV tomorrow", now, replies), true);
    await processor.process(ownerMessage("10", now + 60_000, replies), true);

    expect(state.getTodoTasks("owner@c.us")).toHaveLength(1);
    expect(state.getTodoTasks("owner@c.us")[0]).toMatchObject({ title: "Buy a TV 📺", status: "open" });
    expect(new Date(state.getTodoTasks("owner@c.us")[0]!.dueAt!).getHours()).toBe(10);
    expect(state.getPendingOwnerActionClarification("owner@c.us", now + 60_000)).toBeUndefined();
  });

  it("uses one clarification path for simple dated tasks with different action verbs", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-owner-task-verbs-"));
    directories.push(directory);
    const state = new AmirosState(join(directory, "state.json"));
    const replies: string[] = [];
    let generalReplies = 0;
    const ai = {
      generateTodoPresentation: async ({ currentTitle }: { currentTitle: string }) => ({
        title: currentTitle,
        priority: "normal" as const,
        emoji: currentTitle.includes("cat food") ? "🐱" : currentTitle.includes("Vacuum") ? "🧹" : "🔋",
      }),
      reply: async () => { generalReplies += 1; return "untrusted"; },
    } as unknown as AiService;
    const processor = new MessageProcessor(config, ai, state);
    const now = new Date(2026, 7, 11, 9, 0).getTime();

    const clarify = async (request: string, time: string, offset: number, created = true) => {
      await processor.process(ownerMessage(request, now + offset, replies), true);
      expect(replies.at(-1)).toContain("What time should I set");
      await processor.process(ownerMessage(time, now + offset + 1_000, replies), true);
      expect(replies.at(-1)).toContain(`${created ? "Added to" : "Already in"} *AmirOS To-dos*`);
    };

    await clarify("Buy cat food tomorrow", "18:00", 0);
    await clarify("Vacuum the apartment tomorrow", "15:30", 10_000);
    await clarify("Charge the phone tomorrow", "20:15", 20_000);

    const tasks = state.getTodoTasks("owner@c.us");
    expect(tasks).toHaveLength(3);
    expect(tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Buy cat food 🐱" }),
      expect.objectContaining({ title: "Vacuum the apartment 🧹" }),
      expect.objectContaining({ title: "Charge the phone 🔋" }),
    ]));
    expect(new Date(tasks.find((item) => item.title.startsWith("Buy cat food"))!.dueAt!).getHours()).toBe(18);
    expect(new Date(tasks.find((item) => item.title.startsWith("Vacuum"))!.dueAt!).getHours()).toBe(15);
    expect(new Date(tasks.find((item) => item.title.startsWith("Vacuum"))!.dueAt!).getMinutes()).toBe(30);
    expect(new Date(tasks.find((item) => item.title.startsWith("Charge"))!.dueAt!).getHours()).toBe(20);
    expect(generalReplies).toBe(0);

    await clarify("Vacuum the apartment tomorrow", "15:30", 30_000, false);
    expect(state.getTodoTasks("owner@c.us")).toHaveLength(3);
  });

  it("keeps the clarification pending and never confirms when persistence fails", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-owner-clarification-failure-"));
    directories.push(directory);
    const state = new AmirosState(join(directory, "state.json"));
    const replies: string[] = [];
    const ai = {
      generateTodoPresentation: async () => ({ title: "Take out the trash", priority: "normal" as const, emoji: "🗑️" }),
      reply: async () => "untrusted",
      clearConversation: () => undefined,
    } as unknown as AiService;
    const processor = new MessageProcessor(config, ai, state);
    const now = new Date(2026, 7, 10, 9, 0).getTime();

    await processor.process(ownerMessage("Take out the trash tomorrow", now, replies), true);
    state.addOwnerTodo = (() => { throw new Error("simulated disk failure"); }) as typeof state.addOwnerTodo;
    await processor.process(ownerMessage("13:00", now + 60_000, replies), true);

    expect(state.getTodoTasks("owner@c.us")).toEqual([]);
    expect(state.getPendingOwnerActionClarification("owner@c.us", now + 60_000)).toMatchObject({
      source: "Take out the trash tomorrow",
    });
    expect(replies.at(-1)).not.toContain("Added to *AmirOS To-dos*");
  });

  it("does not consume an unrelated message as an owner-action clarification", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-owner-unrelated-clarification-"));
    directories.push(directory);
    const state = new AmirosState(join(directory, "state.json"));
    const replies: string[] = [];
    let generalReplies = 0;
    const ai = {
      generateTodoPresentation: async () => ({ title: "Take out the trash", priority: "normal" as const, emoji: "🗑️" }),
      reply: async () => { generalReplies += 1; return "It looks sunny."; },
    } as unknown as AiService;
    const processor = new MessageProcessor(config, ai, state);
    const now = new Date(2026, 7, 10, 9, 0).getTime();

    await processor.process(ownerMessage("Take out the trash tomorrow", now, replies), true);
    await processor.process(ownerMessage("How is the weather?", now + 60_000, replies), true);

    expect(state.getTodoTasks("owner@c.us")).toEqual([]);
    expect(state.getPendingOwnerActionClarification("owner@c.us", now + 60_000)).toBeUndefined();
    expect(generalReplies).toBe(1);
    expect(replies.at(-1)).toBe("It looks sunny.");
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

  it("preserves explicit morning, afternoon, and evening calendar times end to end", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-owner-calendar-times-"));
    directories.push(directory);
    const statePath = join(directory, "state.json");
    const state = new AmirosState(statePath);
    const replies: string[] = [];
    let generalReplies = 0;
    const ai = {
      generateOwnerActionTitle: async ({ currentTitle }: { currentTitle: string }) => currentTitle,
      reply: async () => { generalReplies += 1; return "untrusted"; },
    } as unknown as AiService;
    const processor = new MessageProcessor(config, ai, state);
    const now = new Date(2026, 7, 11, 9, 0).getTime();

    await processor.process(ownerMessage("Dentist appointment Friday at 9", now, replies), true);
    await processor.process(ownerMessage("Doctor appointment Saturday at 2pm", now + 1_000, replies), true);
    await processor.process(ownerMessage("Dinner Sunday at 19:30", now + 2_000, replies), true);

    const events = state.getCalendarEvents("owner@c.us");
    expect(events).toHaveLength(3);
    expect(new Date(events.find((event) => event.title.startsWith("Dentist"))!.startAt).getHours()).toBe(9);
    expect(new Date(events.find((event) => event.title.startsWith("Doctor"))!.startAt).getHours()).toBe(14);
    expect(new Date(events.find((event) => event.title.startsWith("Dinner"))!.startAt).getHours()).toBe(19);
    expect(new Date(events.find((event) => event.title.startsWith("Dinner"))!.startAt).getMinutes()).toBe(30);
    expect(events.every((event) => !/\bat\s+\d/iu.test(event.title))).toBe(true);
    expect(replies.slice(-3).every((reply) => reply.includes("Added to *AmirOS Calendar*"))).toBe(true);
    expect(generalReplies).toBe(0);

    await processor.process(ownerMessage("Dentist appointment Friday at 9", now + 3_000, replies), true);
    expect(state.getCalendarEvents("owner@c.us")).toHaveLength(3);
    expect(replies.at(-1)).toContain("Already in *AmirOS Calendar*");

    const reloaded = new AmirosState(statePath);
    expect(new Date(reloaded.getCalendarEvents("owner@c.us").find((event) => event.title.startsWith("Dentist"))!.startAt).getHours()).toBe(9);
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

  it("saves natural owner to-do wording through the verified write path", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-owner-natural-todos-"));
    directories.push(directory);
    const state = new AmirosState(join(directory, "state.json"));
    const replies: string[] = [];
    let generalReplies = 0;
    const ai = {
      generateTodoPresentation: async ({ currentTitle }: { currentTitle: string }) => currentTitle.includes("LinkedIn")
        ? { title: "Update LinkedIn", priority: "normal" as const, emoji: "💼" }
        : { title: "Buy almonds", priority: "normal" as const, emoji: "🥜" },
      reply: async () => { generalReplies += 1; return "unverified"; },
    } as unknown as AiService;
    const processor = new MessageProcessor(config, ai, state);
    const now = new Date(2026, 7, 10, 18, 35).getTime();

    await processor.process(ownerMessage("I need to buy almonds", now, replies), true);
    await processor.process(ownerMessage("Add update my LinkedIn to the to do list", now + 1_000, replies), true);

    expect(state.getTodoTasks("owner@c.us")).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Buy almonds 🥜", status: "open", evidence: expect.objectContaining({ source: "whatsapp_bot" }) }),
      expect.objectContaining({ title: "Update LinkedIn 💼", status: "open", evidence: expect.objectContaining({ source: "whatsapp_bot" }) }),
    ]));
    expect(replies).toEqual(expect.arrayContaining([
      expect.stringContaining("Added to *AmirOS To-dos*: *Buy almonds 🥜*"),
      expect.stringContaining("Added to *AmirOS To-dos*: *Update LinkedIn 💼*"),
    ]));
    expect(generalReplies).toBe(0);
  });

  it("reopens a completed owner to-do instead of reporting it as already in the list", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-owner-reopen-todo-"));
    directories.push(directory);
    const state = new AmirosState(join(directory, "state.json"));
    const replies: string[] = [];
    const ai = {
      generateTodoPresentation: async () => ({ title: "Buy almonds", priority: "normal" as const, emoji: "🥜" }),
      reply: async () => "untrusted",
    } as unknown as AiService;
    const processor = new MessageProcessor(config, ai, state);
    const now = new Date(2026, 7, 10, 18, 45).getTime();

    await processor.process(ownerMessage("Add buy almonds to my to do list", now, replies), true);
    const task = state.getTodoTasks("owner@c.us")[0]!;
    state.completeTodoTask("owner@c.us", task.id);
    await processor.process(ownerMessage("Add buy almonds to my to do list", now + 1_000, replies), true);

    expect(state.getTodoTasks("owner@c.us")[0]).toMatchObject({ id: task.id, status: "open" });
    expect(replies.at(-1)).toContain("Moved from completed to open in *AmirOS To-dos*: *Buy almonds 🥜*");
  });

  it("never lets a general owner reply claim an unverified AmirOS write", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-owner-write-claim-"));
    directories.push(directory);
    const state = new AmirosState(join(directory, "state.json"));
    const replies: string[] = [];
    const ai = {
      reply: async () => "Added to your to-do list: Buy almonds. ✨",
    } as unknown as AiService;
    const processor = new MessageProcessor(config, ai, state);
    const now = new Date(2026, 7, 10, 18, 43).getTime();

    await processor.process(ownerMessage("What should I make for dinner?", now, replies), true);

    expect(replies).toEqual([
      "I couldn’t confirm that AmirOS saved that change. Please send a direct request, for example: “Add buy almonds to my to-do list.”",
    ]);
    expect(state.getTodoTasks("owner@c.us")).toEqual([]);
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
