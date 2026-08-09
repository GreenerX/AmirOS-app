import { hour12For, readTimeFormat, type TimeFormat } from "./time-format";

function milliseconds(timestampSecondsOrMs: number): number {
  return timestampSecondsOrMs < 10_000_000_000
    ? timestampSecondsOrMs * 1_000
    : timestampSecondsOrMs;
}

function includesTime(options: Intl.DateTimeFormatOptions): boolean {
  return Boolean(options.hour || options.minute || options.second || options.timeStyle);
}

export function formatDateTime(
  value: number | Date,
  options: Intl.DateTimeFormatOptions,
  timeFormat: TimeFormat = readTimeFormat(),
): string {
  return new Intl.DateTimeFormat(undefined, {
    ...options,
    ...(includesTime(options) ? { hour12: hour12For(timeFormat) } : {}),
  }).format(value instanceof Date ? value : new Date(milliseconds(value)));
}

export function formatTime(timestampSecondsOrMs: number, timeFormat: TimeFormat = readTimeFormat()): string {
  return formatDateTime(milliseconds(timestampSecondsOrMs), {
    hour: "2-digit",
    minute: "2-digit",
  }, timeFormat);
}

export function timeOfDayGreeting(date: Date): "Good morning" | "Good afternoon" | "Good evening" | "Good night" {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  if (hour >= 18 && hour < 23) return "Good evening";
  return "Good night";
}

export function formatDeviceClock(date: Date, timeFormat: TimeFormat = readTimeFormat()): string {
  return formatDateTime(date, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }, timeFormat);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

export function compactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact" }).format(value);
}
