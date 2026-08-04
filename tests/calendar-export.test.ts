import { describe, expect, it } from "vitest";
import { buildIcs, googleCalendarUrl } from "../ui/src/calendar-export.js";

const event = {
  id: "timed-event",
  title: "Dinner with Laura",
  startAt: new Date("2026-08-27T16:00:00.000Z").getTime(),
  endAt: new Date("2026-08-27T17:30:00.000Z").getTime(),
  allDay: true,
  status: "confirmed" as const,
  evidence: { excerpt: "Dinner at 7pm", timestamp: Date.now() },
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

describe("calendar exports", () => {
  it("always includes a start and end time in Google Calendar", () => {
    const url = new URL(googleCalendarUrl(event, "Laura"));
    expect(url.searchParams.get("dates")).toBe("20260827T160000Z/20260827T173000Z");
  });

  it("always includes timed DTSTART and DTEND values in Apple Calendar files", () => {
    const calendar = buildIcs(event, "Laura");
    expect(calendar).toContain("DTSTART:20260827T160000Z");
    expect(calendar).toContain("DTEND:20260827T173000Z");
    expect(calendar).not.toContain("VALUE=DATE");
  });
});
