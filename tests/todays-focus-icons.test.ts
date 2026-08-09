import { describe, expect, it } from "vitest";
import {
  normalizeTodaysFocusIconRequest,
  todaysFocusIconCacheKey,
  todaysFocusIconPrompt,
} from "../src/todays-focus-icons.js";

describe("Today’s Focus generated icons", () => {
  it("validates requests and creates a stable content-addressed cache key", () => {
    const item = { title: "Flamenco Event with Dani", type: "calendar" as const };
    expect(normalizeTodaysFocusIconRequest(item)).toEqual(item);
    expect(normalizeTodaysFocusIconRequest({ ...item, type: "unknown" })).toBeUndefined();
    expect(todaysFocusIconCacheKey(item)).toMatch(/^[a-f0-9]{24}$/u);
    expect(todaysFocusIconCacheKey(item)).toBe(todaysFocusIconCacheKey({ ...item }));
  });

  it("asks for a compact, relevant icon without embedded copy", () => {
    const prompt = todaysFocusIconPrompt({ title: "Walk the Dogs", type: "calendar" });
    expect(prompt).toContain("Walk the Dogs");
    expect(prompt).toContain("recognizable at 64 pixels");
    expect(prompt).toContain("No text");
  });
});
