export type InboxFilter = "all" | "unread" | "priority" | "auto";

export const DEFAULT_INBOX_FILTER: InboxFilter = "unread";
export const INBOX_FILTER_PREFERENCE_TTL_MS = 5 * 60_000;

type InboxFilterPreference = {
  filter: Exclude<InboxFilter, "unread">;
  expiresAt: number;
};

const isRememberedFilter = (value: unknown): value is InboxFilterPreference => (
  typeof value === "object"
  && value !== null
  && ["all", "priority", "auto"].includes((value as InboxFilterPreference).filter)
  && Number.isFinite((value as InboxFilterPreference).expiresAt)
);

export function readInboxFilterPreference(value: string | null, now = Date.now()): InboxFilterPreference | undefined {
  if (!value) return undefined;
  try {
    const preference = JSON.parse(value) as unknown;
    return isRememberedFilter(preference) && preference.expiresAt > now ? preference : undefined;
  } catch {
    return undefined;
  }
}

export function createInboxFilterPreference(filter: Exclude<InboxFilter, "unread">, now = Date.now()): InboxFilterPreference {
  return { filter, expiresAt: now + INBOX_FILTER_PREFERENCE_TTL_MS };
}
