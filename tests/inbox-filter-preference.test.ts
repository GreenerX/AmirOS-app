import { describe, expect, it } from "vitest";
import {
  createInboxFilterPreference,
  INBOX_FILTER_PREFERENCE_TTL_MS,
  readInboxFilterPreference,
} from "../ui/src/inbox-filter-preference";

describe("Inbox filter preference", () => {
  it("keeps a manually selected filter for exactly five minutes", () => {
    const now = 1_700_000_000_000;
    const preference = createInboxFilterPreference("priority", now);

    expect(preference.expiresAt).toBe(now + INBOX_FILTER_PREFERENCE_TTL_MS);
    expect(readInboxFilterPreference(JSON.stringify(preference), preference.expiresAt - 1)).toEqual(preference);
    expect(readInboxFilterPreference(JSON.stringify(preference), preference.expiresAt)).toBeUndefined();
  });

  it("ignores malformed and unsupported stored values", () => {
    expect(readInboxFilterPreference("not-json")).toBeUndefined();
    expect(readInboxFilterPreference(JSON.stringify({ filter: "unread", expiresAt: Date.now() + 1_000 }))).toBeUndefined();
  });
});
