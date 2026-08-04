import { describe, expect, it } from "vitest";
import { timeOfDayGreeting } from "../ui/src/format.js";

describe("time-aware overview greeting", () => {
  it.each([
    [5, "Good morning"],
    [11, "Good morning"],
    [12, "Good afternoon"],
    [17, "Good afternoon"],
    [18, "Good evening"],
    [22, "Good evening"],
    [23, "Good night"],
    [4, "Good night"],
  ])("uses the device hour %i", (hour, expected) => {
    expect(timeOfDayGreeting(new Date(2026, 7, 1, hour))).toBe(expected);
  });
});
