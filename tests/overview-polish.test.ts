import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  DASHBOARD_ACTION_SUMMARIES_KEY,
  readDashboardActionSummaries,
  saveDashboardActionSummary,
} from "../ui/src/dashboard-action-summary-cache.js";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("Overview polish", () => {
  it("persists a dashboard message summary and does not replace it after a refresh", () => {
    const storage = memoryStorage();
    expect(saveDashboardActionSummary("reply:chat:message", "First concise summary.", storage)).toEqual({
      "reply:chat:message": "First concise summary.",
    });
    expect(saveDashboardActionSummary("reply:chat:message", "A different summary.", storage)).toEqual({
      "reply:chat:message": "First concise summary.",
    });
    expect(readDashboardActionSummaries(storage)).toEqual({ "reply:chat:message": "First concise summary." });
    expect(storage.getItem(DASHBOARD_ACTION_SUMMARIES_KEY)).toContain("First concise summary.");
  });

  it("keeps deferred updates reachable from release notes and highlights the version control", async () => {
    const [releaseExperience, sidebar] = await Promise.all([
      readFile(new URL("../ui/src/components/ReleaseExperience.tsx", import.meta.url), "utf8"),
      readFile(new URL("../ui/src/components/Sidebar.tsx", import.meta.url), "utf8"),
    ]);
    expect(releaseExperience).toContain('update?.status === "available"');
    expect(releaseExperience).toContain("Update AmirOS");
    expect(sidebar).toContain("update-available");
    expect(sidebar).toContain("Update ready");
  });

  it("renders a people-first Today’s Focus and a compact timeline for today only", async () => {
    const [overview, styles] = await Promise.all([
      readFile(new URL("../ui/src/components/Overview.tsx", import.meta.url), "utf8"),
      readFile(new URL("../ui/src/styles.css", import.meta.url), "utf8"),
    ]);
    expect(overview).not.toContain("intelligence-overview-stats");
    expect(overview).toContain("isPersonFocus && chat?.avatarUrl");
    expect(overview).toContain("todaysAgenda.map");
    expect(overview).toContain("overview-todos-panel");
    expect(overview).toContain("filteredTrackedTodos.map");
    expect(overview).toContain("View full agenda");
    expect(overview).toContain("Nothing is scheduled for today yet.");
    expect(styles).toContain(".overview-timeline-event { display: grid;");
    expect(styles).toContain(".todays-focus-item-avatar");
    expect(styles).toContain(".overview-agenda-pair > .panel { height: 100%; }");
  });
});
