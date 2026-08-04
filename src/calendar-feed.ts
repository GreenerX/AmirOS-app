import type { CalendarEvent } from "./amiros-state.js";

export type CalendarFeedEvent = CalendarEvent & {
  chatId: string;
  contactName: string;
};

function compactUtc(timestamp: number): string {
  return new Date(timestamp).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function foldIcsLine(line: string): string[] {
  const lines: string[] = [];
  let current = "";
  for (const character of line) {
    if (Buffer.byteLength(current + character, "utf8") > 74) {
      lines.push(current);
      current = ` ${character}`;
    } else {
      current += character;
    }
  }
  lines.push(current);
  return lines;
}

export function buildCalendarSubscriptionFeed(
  events: CalendarFeedEvent[],
  generatedAt = Date.now(),
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AmirOS//Relationship Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:AmirOS",
    "X-WR-CALDESC:Confirmed plans gathered from AmirOS conversations",
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
  ];

  for (const event of events) {
    const endAt = event.endAt || event.startAt + 60 * 60 * 1_000;
    const description = `From WhatsApp chat: ${event.contactName}\n\n${event.evidence.excerpt}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcs(event.id)}@amiros.local`,
      `DTSTAMP:${compactUtc(generatedAt)}`,
      `LAST-MODIFIED:${compactUtc(event.updatedAt || generatedAt)}`,
      `DTSTART:${compactUtc(event.startAt)}`,
      `DTEND:${compactUtc(endAt)}`,
      `SUMMARY:${escapeIcs(event.title)}`,
      `DESCRIPTION:${escapeIcs(description)}`,
      ...(event.location ? [`LOCATION:${escapeIcs(event.location)}`] : []),
      "STATUS:CONFIRMED",
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return `${lines.flatMap(foldIcsLine).join("\r\n")}\r\n`;
}
