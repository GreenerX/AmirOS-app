import { describe, expect, it } from "vitest";
import { buildProactiveReminders } from "../ui/src/proactive-reminders.js";
import type { IntelligenceData } from "../ui/src/types.js";

const now = new Date(2026, 7, 6, 10, 0, 0);
const timestamp = now.getTime();

function data(): IntelligenceData {
  return {
    generatedAt: timestamp,
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

const evidence = { excerpt: "Please remember", timestamp };

describe("proactive reminders", () => {
  it("includes an owner commitment due tomorrow", () => {
    const state = data();
    state.commitments.push({ id: "commitment", chatId: "dani", contactName: "Dani", content: "Call Dani", owner: "me", status: "open", dueAt: new Date(2026, 7, 7, 9).getTime(), evidence, createdAt: timestamp, updatedAt: timestamp });
    expect(buildProactiveReminders(state, now)).toMatchObject([{ type: "commitment", detail: "Due tomorrow · Dani" }]);
  });

  it("includes due-today and overdue open to-dos, but excludes completed and dismissed ones", () => {
    const state = data();
    state.todos = [
      { id: "today", chatId: "dani", contactName: "Dani", title: "Buy flowers", status: "open", priority: "normal", dueAt: new Date(2026, 7, 6, 17).getTime(), evidence, createdAt: timestamp, updatedAt: timestamp },
      { id: "late", chatId: "dani", contactName: "Dani", title: "Reply", status: "open", priority: "normal", dueAt: new Date(2026, 7, 5, 17).getTime(), evidence, createdAt: timestamp, updatedAt: timestamp },
      { id: "done", chatId: "dani", contactName: "Dani", title: "Done", status: "done", priority: "normal", dueAt: new Date(2026, 7, 6, 12).getTime(), evidence, createdAt: timestamp, updatedAt: timestamp },
      { id: "dismissed", chatId: "dani", contactName: "Dani", title: "Dismissed", status: "dismissed", priority: "normal", dueAt: new Date(2026, 7, 6, 12).getTime(), evidence, createdAt: timestamp, updatedAt: timestamp },
    ];
    expect(buildProactiveReminders(state, now).map((item) => [item.title, item.detail])).toEqual([
      ["Reply", "Overdue · Dani"],
      ["Buy flowers", "Due today · Dani"],
    ]);
  });

  it("includes a confirmed event within 24 hours and excludes future items outside the window", () => {
    const state = data();
    state.events = [
      { id: "soon", chatId: "dani", contactName: "Dani", title: "Dinner", startAt: new Date(2026, 7, 6, 20).getTime(), allDay: false, status: "confirmed", evidence, createdAt: timestamp, updatedAt: timestamp },
      { id: "later", chatId: "dani", contactName: "Dani", title: "Weekend trip", startAt: new Date(2026, 7, 9, 12).getTime(), allDay: false, status: "confirmed", evidence, createdAt: timestamp, updatedAt: timestamp },
    ];
    expect(buildProactiveReminders(state, now).map((item) => item.title)).toEqual(["Dinner"]);
  });
});
