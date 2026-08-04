import type { CalendarEvent } from "./types.js";

type ExportEvent = CalendarEvent & { contactName?: string };

function compactUtc(timestamp: number) {
  return new Date(timestamp).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcs(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function eventDates(event: ExportEvent) {
  const endAt = event.endAt || event.startAt + 60 * 60 * 1000;
  return { google: `${compactUtc(event.startAt)}/${compactUtc(endAt)}`, start: `DTSTART:${compactUtc(event.startAt)}`, end: `DTEND:${compactUtc(endAt)}` };
}

export function googleCalendarUrl(event: ExportEvent, contactName = event.contactName || "WhatsApp contact") {
  const dates = eventDates(event);
  const params = new URLSearchParams({ action: "TEMPLATE", text: event.title, dates: dates.google, details: `From WhatsApp chat: ${contactName}\n\n${event.evidence.excerpt}`, ...(event.location ? { location: event.location } : {}) });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function buildIcs(event: ExportEvent, contactName = event.contactName || "WhatsApp contact") {
  const dates = eventDates(event);
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AmirOS//Calendar//EN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT", `UID:${event.id}@amiros.local`, `DTSTAMP:${compactUtc(Date.now())}`, dates.start, dates.end, `SUMMARY:${escapeIcs(event.title)}`, `DESCRIPTION:${escapeIcs(`From WhatsApp chat: ${contactName}\n\n${event.evidence.excerpt}`)}`, ...(event.location ? [`LOCATION:${escapeIcs(event.location)}`] : []), "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
}

export function downloadIcs(event: ExportEvent, contactName?: string) {
  const url = URL.createObjectURL(new Blob([buildIcs(event, contactName)], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${event.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "amiros-event"}.ics`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}
