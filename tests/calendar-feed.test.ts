import { describe, expect, it } from "vitest";
import { buildCalendarSubscriptionFeed } from "../src/calendar-feed.js";

describe("AmirOS calendar subscription feed", () => {
  it("creates a refreshable Unicode calendar with stable confirmed events", () => {
    const timestamp = new Date("2026-08-27T16:00:00.000Z").getTime();
    const feed = buildCalendarSubscriptionFeed([{
      id: "party-1",
      chatId: "laura@c.us",
      contactName: "לאורה 😊",
      title: "מסיבת הבית של לאורה 🎉",
      startAt: timestamp,
      allDay: false,
      status: "confirmed",
      evidence: { excerpt: "House party at 7pm", senderName: "Laura", timestamp },
      createdAt: timestamp,
      updatedAt: timestamp,
    }], timestamp);

    expect(feed).toContain("X-WR-CALNAME:AmirOS");
    expect(feed).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT15M");
    expect(feed).toContain("UID:party-1@amiros.local");
    expect(feed).toContain("מסיבת הבית של לאורה 🎉");
    expect(feed).toContain("DTSTART:20260827T160000Z");
    expect(feed).toContain("DTEND:20260827T170000Z");
    expect(feed).not.toContain("VALUE=DATE");
    expect(feed).toMatch(/\r\nEND:VCALENDAR\r\n$/);
    expect(feed.split("\r\n").every((line) => Buffer.byteLength(line, "utf8") <= 74)).toBe(true);
  });
});
