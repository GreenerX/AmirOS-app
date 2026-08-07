import { describe, expect, it } from "vitest";
import { buildTodaysFocus } from "../ui/src/todays-focus";
import type { IntelligenceData } from "../ui/src/types";

const now = new Date(2026, 7, 6, 10, 0, 0);
const at = (dayOffset: number, hour = 10) => new Date(2026, 7, 6 + dayOffset, hour).getTime();
const evidence = { excerpt: "Message evidence", timestamp: at(-1), messageId: "message-1" };

function data(): IntelligenceData {
  return {
    generatedAt: now.getTime(),
    needsReply: [],
    commitments: [],
    changes: [],
    events: [],
    todos: [],
    chats: [],
    questionHistory: [],
    suggestedQuestions: [],
  };
}

describe("buildTodaysFocus", () => {
  it("ranks overdue items before items due today", () => {
    const value = data();
    value.commitments.push({ id: "commitment", chatId: "dani", contactName: "Dani", content: "Call Dani", owner: "me", status: "open", dueAt: at(-1), evidence, createdAt: at(-2), updatedAt: at(-1) });
    value.todos!.push({ id: "today", chatId: "work", contactName: "Work", title: "Send report", status: "open", priority: "normal", dueAt: at(0, 17), evidence, createdAt: at(-1), updatedAt: at(-1) });

    expect(buildTodaysFocus(value, now).map((item) => item.title)).toEqual(["Call Dani", "Send report"]);
  });

  it("includes open to-dos due today and excludes completed ones", () => {
    const value = data();
    value.todos!.push(
      { id: "open", chatId: "work", contactName: "Work", title: "Prepare webinar", status: "open", priority: "high", dueAt: at(0, 16), evidence, createdAt: at(-1), updatedAt: at(-1) },
      { id: "done", chatId: "work", contactName: "Work", title: "Already finished", status: "done", priority: "normal", dueAt: at(0, 15), evidence, createdAt: at(-1), updatedAt: at(-1) },
    );

    const items = buildTodaysFocus(value, now);
    expect(items.map((item) => item.title)).toContain("Prepare webinar");
    expect(items.map((item) => item.title)).not.toContain("Already finished");
  });

  it("does not include completed commitments", () => {
    const value = data();
    value.commitments.push({ id: "done-commitment", chatId: "dani", contactName: "Dani", content: "Already called Dani", owner: "me", status: "done", dueAt: at(-1), evidence, createdAt: at(-2), updatedAt: at(-1) });

    expect(buildTodaysFocus(value, now)).toHaveLength(0);
  });

  it("includes confirmed calendar events happening today", () => {
    const value = data();
    value.events.push({ id: "event", chatId: "dani", contactName: "Dani", title: "Dinner with Dani", startAt: at(0, 19), allDay: false, status: "confirmed", evidence, createdAt: at(-1), updatedAt: at(-1) });

    expect(buildTodaysFocus(value, now)).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Dinner with Dani", type: "calendar" })]));
  });

  it("includes people waiting for a reply", () => {
    const value = data();
    value.needsReply.push({ chatId: "mike", contactName: "Mike", isGroup: false, insights: [], commitments: [], events: [], needsReply: true, lastIncoming: { role: "user", content: "Are you free?", timestamp: at(-2), messageId: "mike-message" }, updatedAt: at(-2) });

    expect(buildTodaysFocus(value, now)).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Reply to Mike", type: "reply" })]));
  });

  it("returns at most four items", () => {
    const value = data();
    for (let index = 0; index < 5; index += 1) {
      value.todos!.push({ id: `todo-${index}`, chatId: "work", contactName: "Work", title: `Task ${index}`, status: "open", priority: "normal", dueAt: at(-1), evidence, createdAt: at(-2), updatedAt: at(-1) });
    }

    expect(buildTodaysFocus(value, now)).toHaveLength(4);
  });
});
