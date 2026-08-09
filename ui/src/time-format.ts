export type TimeFormat = "12-hour" | "24-hour";

export const TIME_FORMAT_STORAGE_KEY = "amiros-time-format.v1";

type TimeFormatStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): TimeFormatStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function readTimeFormat(storage: TimeFormatStorage | undefined = browserStorage()): TimeFormat {
  try {
    return storage?.getItem(TIME_FORMAT_STORAGE_KEY) === "24-hour" ? "24-hour" : "12-hour";
  } catch {
    return "12-hour";
  }
}

export function saveTimeFormat(value: TimeFormat, storage: TimeFormatStorage | undefined = browserStorage()): TimeFormat {
  try {
    storage?.setItem(TIME_FORMAT_STORAGE_KEY, value);
  } catch {
    // The in-memory preference remains usable if browser storage is unavailable.
  }
  return value;
}

export function hour12For(value: TimeFormat): boolean {
  return value === "12-hour";
}
