import { describe, expect, it } from "vitest";
import { formatDeviceClock } from "../ui/src/format.js";

describe("device clock", () => {
  it("shows seconds by default in both time formats", () => {
    const value = new Date(2026, 7, 16, 21, 7, 54);

    expect(formatDeviceClock(value, "12-hour")).toMatch(/:\d{2}:\d{2}/u);
    expect(formatDeviceClock(value, "24-hour")).toMatch(/:\d{2}:\d{2}/u);
  });

  it("can hide seconds for Andrew Mode", () => {
    const value = new Date(2026, 7, 16, 21, 7, 54);

    expect(formatDeviceClock(value, "12-hour", false)).not.toMatch(/:\d{2}:\d{2}/u);
    expect(formatDeviceClock(value, "24-hour", false)).not.toMatch(/:\d{2}:\d{2}/u);
  });
});
