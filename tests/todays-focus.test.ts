import { describe, expect, it } from "vitest";
import { buildTodaysFocus, todaysFocusPresentation } from "../ui/src/todays-focus";
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
    value.events.push({
      id: "event", chatId: "dani", contactName: "Dani", title: "Dinner with Dani", startAt: at(0, 19),
      allDay: false, status: "confirmed", imageUrl: "/api/todays-focus/icons/dinner.png",
      evidence: { ...evidence, source: "whatsapp_bot" }, createdAt: at(-1), updatedAt: at(-1),
    });

    expect(buildTodaysFocus(value, now)).toEqual(expect.arrayContaining([expect.objectContaining({
      title: "Dinner with Dani",
      type: "calendar",
      detail: "Happening today",
      imageUrl: "/api/todays-focus/icons/dinner.png",
      source: "whatsapp_bot",
    })]));
  });

  it("keeps tomorrow's events out of Today’s Focus during the day", () => {
    const value = data();
    value.events.push({
      id: "tomorrow",
      chatId: "dani",
      contactName: "Dani",
      title: "Flamenco with Dani",
      startAt: at(1, 19),
      allDay: false,
      location: "Suzanne Dellal Centre",
      status: "confirmed",
      evidence,
      createdAt: at(-1),
      updatedAt: at(-1),
    });

    expect(buildTodaysFocus(value, now)).toHaveLength(0);
  });

  it("shows tomorrow's events as Up Next after 3 PM when today is clear", () => {
    const value = data();
    value.events.push({
      id: "tomorrow", chatId: "dani", contactName: "Dani", title: "Flamenco with Dani",
      startAt: at(1, 19), allDay: false, location: "Suzanne Dellal Centre", status: "confirmed",
      evidence, createdAt: at(-1), updatedAt: at(-1),
    });
    const afternoon = new Date(2026, 7, 6, 15);
    const items = buildTodaysFocus(value, afternoon);

    expect(items).toEqual([expect.objectContaining({
      title: "Flamenco with Dani",
      detail: "Happening tomorrow",
      location: "Suzanne Dellal Centre",
    })]);
    expect(todaysFocusPresentation(items, afternoon).title).toBe("Up Next");
  });

  it("does not mix tomorrow cards into late Today’s Focus while today still needs attention", () => {
    const value = data();
    value.todos!.push({ id: "overdue", chatId: "work", contactName: "Work", title: "Send report", status: "open", priority: "high", dueAt: at(-1), evidence, createdAt: at(-2), updatedAt: at(-1) });
    value.events.push({ id: "tomorrow", chatId: "dani", contactName: "Dani", title: "Dinner tomorrow", startAt: at(1, 19), allDay: false, status: "confirmed", evidence, createdAt: at(-1), updatedAt: at(-1) });
    const afternoon = new Date(2026, 7, 6, 15);
    const items = buildTodaysFocus(value, afternoon);

    expect(items.map((item) => item.title)).toEqual(["Send report"]);
    expect(todaysFocusPresentation(items, afternoon).title).toBe("Today's Focus");
  });

  it("does not pull later events into Today's Focus", () => {
    const value = data();
    value.events.push({ id: "later", chatId: "dani", contactName: "Dani", title: "Next week", startAt: at(2, 10), allDay: false, status: "confirmed", evidence, createdAt: at(-1), updatedAt: at(-1) });

    expect(buildTodaysFocus(value, now)).toHaveLength(0);
  });

  it("places today's next event before other focus items", () => {
    const value = data();
    value.todos!.push({ id: "overdue", chatId: "work", contactName: "Work", title: "Send report", status: "open", priority: "high", dueAt: at(-1), evidence, createdAt: at(-2), updatedAt: at(-1) });
    value.events.push({ id: "event", chatId: "dani", contactName: "Dani", title: "Dinner with Dani", startAt: at(0, 19), allDay: false, status: "confirmed", evidence, createdAt: at(-1), updatedAt: at(-1) });

    expect(buildTodaysFocus(value, now).map((item) => item.title)).toEqual(["Dinner with Dani", "Send report"]);
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

  it("places proactive context in Today’s Focus without duplicating its source action", () => {
    const value = data();
    value.commitments.push({ id: "commitment", chatId: "dani", contactName: "Dani", content: "Send photos", owner: "me", status: "open", dueAt: at(-1), evidence, createdAt: at(-2), updatedAt: at(-1) });
    value.proactive = [{
      id: "proactive:commitment:dani:commitment",
      fingerprint: "a".repeat(24),
      kind: "commitment",
      priority: 0,
      title: "Send photos",
      detail: "Still open with Dani",
      why: "This commitment is still open and past its due time.",
      chatId: "dani",
      contactName: "Dani",
      sourceIds: ["commitment"],
      messageId: "message-1",
      action: "chat",
      timestamp: at(-1),
    }];

    expect(buildTodaysFocus(value, now)).toEqual([expect.objectContaining({
      id: "proactive:commitment:dani:commitment",
      why: "This commitment is still open and past its due time.",
    })]);
  });

  it("keeps one proactive slot when calendar cards would otherwise fill the row", () => {
    const value = data();
    for (let index = 0; index < 4; index += 1) {
      value.events.push({
        id: `event-${index}`, chatId: "work", contactName: "Work", title: `Event ${index}`,
        startAt: at(index > 2 ? 1 : 0, 11 + index), allDay: false, status: "confirmed", evidence,
        createdAt: at(-1), updatedAt: at(-1),
      });
    }
    value.proactive = [{
      id: "proactive:change:dani:move", fingerprint: "b".repeat(24), kind: "meaningful_change", priority: 30,
      title: "Something changed with Dani", detail: "Dani moved to New York", why: "Recent confirmed context.",
      chatId: "dani", contactName: "Dani", sourceIds: ["move"], messageId: "move-message", action: "chat", timestamp: at(-1),
    }];

    const focus = buildTodaysFocus(value, now);
    expect(focus).toHaveLength(4);
    expect(focus.some((item) => item.proactive?.kind === "meaningful_change")).toBe(true);
    expect(focus.filter((item) => item.type === "calendar")).toHaveLength(3);
  });
});

describe("todaysFocusPresentation", () => {
  const card = (timestamp: number, title = "Dinner tomorrow") => ({
    id: title,
    type: "calendar" as const,
    priority: -1,
    title,
    detail: "Happening tomorrow",
    chatId: "dani",
    contactName: "Dani",
    action: "calendar" as const,
    timestamp,
  });

  it("switches to Up Next after 3 PM when every visible card is for tomorrow", () => {
    const afternoon = new Date(2026, 7, 6, 15);
    expect(todaysFocusPresentation([card(at(1, 9)), card(at(1, 18), "Movie tomorrow")], afternoon)).toEqual({
      title: "Up Next",
      subtitle: "A head start on tomorrow",
      period: "tomorrow",
    });
  });

  it("uses singular tomorrow wording for one remaining card", () => {
    const late = new Date(2026, 7, 6, 22);
    expect(todaysFocusPresentation([card(at(1, 9))], late).subtitle).toBe("One thing for tomorrow");
  });

  it("keeps Today’s Focus when an actionable item from today remains", () => {
    const late = new Date(2026, 7, 6, 21);
    const overdue = { ...card(at(-1)), id: "overdue", type: "todo" as const, action: "todo" as const, priority: 0, detail: "Overdue task" };
    expect(todaysFocusPresentation([card(at(1, 9)), overdue], late)).toEqual({
      title: "Today's Focus",
      subtitle: "Before you wrap up",
      period: "today",
    });
  });

  it("does not switch before 3 PM even when only tomorrow cards are visible", () => {
    expect(todaysFocusPresentation([card(at(1, 9))], new Date(2026, 7, 6, 14, 59))).toEqual({
      title: "Today's Focus",
      subtitle: "What matters most today",
      period: "today",
    });
  });

  it("uses a calm nighttime message when no cards remain", () => {
    expect(todaysFocusPresentation([], new Date(2026, 7, 6, 23))).toEqual({
      title: "Today's Focus",
      subtitle: "You're all clear for tonight",
      period: "today",
    });
  });
});
