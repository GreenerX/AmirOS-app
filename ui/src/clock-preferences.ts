export const CLOCK_SECONDS_HIDDEN_KEY = "amiros.clock.seconds-hidden.v1";

type ClockPreferenceStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): ClockPreferenceStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** Seconds are shown unless the person has explicitly enabled Andrew Mode. */
export function readClockSecondsHidden(storage: ClockPreferenceStorage | undefined = browserStorage()): boolean {
  try {
    return storage?.getItem(CLOCK_SECONDS_HIDDEN_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveClockSecondsHidden(hidden: boolean, storage: ClockPreferenceStorage | undefined = browserStorage()): boolean {
  try {
    storage?.setItem(CLOCK_SECONDS_HIDDEN_KEY, String(hidden));
  } catch {
    // The in-memory preference remains usable if browser storage is unavailable.
  }
  return hidden;
}
