import { describe, expect, it } from "vitest";
import { CLOCK_SECONDS_HIDDEN_KEY, readClockSecondsHidden, saveClockSecondsHidden } from "../ui/src/clock-preferences.js";

function storage(initial = new Map<string, string>()) {
  return {
    getItem(key: string) { return initial.get(key) || null; },
    setItem(key: string, value: string) { initial.set(key, value); },
  };
}

describe("clock preferences", () => {
  it("shows seconds until Andrew Mode is explicitly enabled", () => {
    const value = storage();
    expect(readClockSecondsHidden(value)).toBe(false);

    expect(saveClockSecondsHidden(true, value)).toBe(true);
    expect(value.getItem(CLOCK_SECONDS_HIDDEN_KEY)).toBe("true");
    expect(readClockSecondsHidden(value)).toBe(true);
  });
});
