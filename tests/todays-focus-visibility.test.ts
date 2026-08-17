import { describe, expect, it } from "vitest";
import {
  HIDDEN_TODAYS_FOCUS_STORAGE_KEY,
  readHiddenTodaysFocus,
  saveHiddenTodaysFocus,
} from "../ui/src/todays-focus-visibility.js";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("Today’s Focus visibility", () => {
  it("persists dismissed Focus cards across dashboard restarts", () => {
    const persistent = memoryStorage();
    saveHiddenTodaysFocus(["calendar:one", "todo:two"], persistent);
    expect([...readHiddenTodaysFocus(persistent)]).toEqual(["calendar:one", "todo:two"]);
    expect(persistent.getItem(HIDDEN_TODAYS_FOCUS_STORAGE_KEY)).toContain("calendar:one");
  });

  it("migrates dismissals from the previous session-only storage", () => {
    const persistent = memoryStorage();
    const legacy = memoryStorage({ [HIDDEN_TODAYS_FOCUS_STORAGE_KEY]: JSON.stringify(["reply:three"]) });
    const hidden = readHiddenTodaysFocus(persistent, legacy);
    saveHiddenTodaysFocus(hidden, persistent);
    expect([...readHiddenTodaysFocus(persistent)]).toEqual(["reply:three"]);
  });

  it("ignores corrupted saved dismissal data", () => {
    const persistent = memoryStorage({ [HIDDEN_TODAYS_FOCUS_STORAGE_KEY]: "not json" });
    expect([...readHiddenTodaysFocus(persistent)]).toEqual([]);
  });
});
