import { describe, expect, it } from "vitest";
import { formatDateTime } from "../ui/src/format.js";
import {
  TIME_FORMAT_STORAGE_KEY,
  hour12For,
  readTimeFormat,
  saveTimeFormat,
} from "../ui/src/time-format.js";
import { cityTimeLabel } from "../ui/src/timezone-weather.js";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("shared time format", () => {
  it("defaults to 12-hour time and persists a 24-hour preference", () => {
    const storage = memoryStorage();
    expect(readTimeFormat(storage)).toBe("12-hour");
    expect(saveTimeFormat("24-hour", storage)).toBe("24-hour");
    expect(storage.getItem(TIME_FORMAT_STORAGE_KEY)).toBe("24-hour");
    expect(readTimeFormat(storage)).toBe("24-hour");
    expect(hour12For("12-hour")).toBe(true);
    expect(hour12For("24-hour")).toBe(false);
  });

  it("applies the selected format to shared and timezone clocks", () => {
    const instant = new Date("2026-08-09T17:05:00Z");
    const twelveHour = formatDateTime(instant, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }, "12-hour");
    const twentyFourHour = formatDateTime(instant, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }, "24-hour");

    expect(twelveHour).toMatch(/5:05\s*PM/i);
    expect(twentyFourHour).toMatch(/17:05/);
    expect(cityTimeLabel(instant, "UTC", "12-hour")).toMatch(/5:05\s*PM/i);
    expect(cityTimeLabel(instant, "UTC", "24-hour")).toMatch(/17:05/);
  });
});
