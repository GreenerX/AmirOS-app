export const DASHBOARD_ACTION_SUMMARIES_KEY = "amiros.next-action-summaries.v1";

type SummaryStorage = Pick<Storage, "getItem" | "setItem">;

function readAll(storage?: Pick<Storage, "getItem">): Record<string, string> {
  try {
    const source = storage || window.localStorage;
    const value = JSON.parse(source.getItem(DASHBOARD_ACTION_SUMMARIES_KEY) || "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

export function readDashboardActionSummaries(storage?: Pick<Storage, "getItem">): Record<string, string> {
  return readAll(storage);
}

export function saveDashboardActionSummary(actionId: string, summary: string, storage?: SummaryStorage): Record<string, string> {
  const source = storage || window.localStorage;
  const saved = readAll(source);
  if (saved[actionId]) return saved;
  const next = { ...saved, [actionId]: summary };
  source.setItem(DASHBOARD_ACTION_SUMMARIES_KEY, JSON.stringify(next));
  return next;
}
