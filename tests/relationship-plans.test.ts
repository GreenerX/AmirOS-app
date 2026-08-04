import { describe, expect, it } from "vitest";
import { confirmedPlansForRelationship } from "../ui/src/relationship-plans.js";
import type { CalendarEvent, IntelligenceChat } from "../ui/src/types.js";

function plan(id: string, title: string, startAt: number, excerpt = title): CalendarEvent {
  return {
    id,
    title,
    startAt,
    allDay: false,
    status: "confirmed",
    evidence: { messageId: `${id}-message`, excerpt, timestamp: startAt - 1_000 },
    createdAt: startAt - 1_000,
    updatedAt: startAt - 1_000,
  };
}

function chat(chatId: string, contactName: string, events: CalendarEvent[], isGroup = false): IntelligenceChat {
  return {
    chatId,
    contactName,
    isGroup,
    insights: [],
    commitments: [],
    events,
    needsReply: false,
    updatedAt: 1,
  };
}

describe("relationship calendar plans", () => {
  it("shows plans from another chat on every explicitly named person's profile in chronological order", () => {
    const owner = chat("owner@c.us", "Amir Friedman", [
      plan("dinner", "Dinner with Dani", 400),
      plan("shopping", "Shopping", 300),
      plan("swim", "Sunset swim with Dani", 200),
    ]);
    const dani = chat("dani@c.us", "Dani Faitelson", [plan("therapy", "Therapy", 100)]);
    const dan = chat("dan@c.us", "Dan Pundak", []);
    const chats = [owner, dani, dan];

    const plans = confirmedPlansForRelationship(dani, chats);

    expect(plans.map((item) => item.title)).toEqual([
      "Therapy",
      "Sunset swim with Dani",
      "Dinner with Dani",
    ]);
    expect(plans.find((item) => item.id === "swim")).toMatchObject({
      sourceChatId: "owner@c.us",
      sourceContactName: "Amir Friedman",
    });
    expect(confirmedPlansForRelationship(dan, chats)).toEqual([]);
  });

  it("keeps a group's own plans on its profile", () => {
    const group = chat("friends@g.us", "Weekend Friends", [plan("beach", "Beach day", 500)], true);
    expect(confirmedPlansForRelationship(group, [group])).toMatchObject([{ title: "Beach day" }]);
  });
});
