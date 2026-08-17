/**
 * Today’s Focus is a personal view. Dismissals must survive a dashboard or
 * service restart, unlike transient UI state such as a scroll position.
 */
export const HIDDEN_TODAYS_FOCUS_STORAGE_KEY = "amiros.hidden-todays-focus.v2";

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

function browserLocalStorage(): StorageReader & StorageWriter | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function browserSessionStorage(): StorageReader | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function readIds(storage: StorageReader | undefined): string[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(HIDDEN_TODAYS_FOCUS_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Includes the old session-only value once so people who update without
 * closing the tab keep their current dismissals as we migrate to persistence.
 */
export function readHiddenTodaysFocus(storage?: StorageReader, legacyStorage?: StorageReader): Set<string> {
  const persistent = storage || browserLocalStorage();
  const legacy = legacyStorage || browserSessionStorage();
  return new Set([...readIds(persistent), ...readIds(legacy)]);
}

export function saveHiddenTodaysFocus(ids: Iterable<string>, storage?: StorageWriter): void {
  const persistent = storage || browserLocalStorage();
  if (!persistent) return;
  try {
    persistent.setItem(HIDDEN_TODAYS_FOCUS_STORAGE_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    // Persistence can be unavailable in a privacy-restricted browser. The
    // caller still hides the card for the current view.
  }
}
