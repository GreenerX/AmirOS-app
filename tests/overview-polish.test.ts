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
    const [overview, calendar, styles] = await Promise.all([
      readFile(new URL("../ui/src/components/Overview.tsx", import.meta.url), "utf8"),
      readFile(new URL("../ui/src/components/CalendarView.tsx", import.meta.url), "utf8"),
      readFile(new URL("../ui/src/styles.css", import.meta.url), "utf8"),
    ]);
    expect(overview).not.toContain("intelligence-overview-stats");
    expect(overview).not.toContain('className="todays-focus-title-icon"');
    expect(overview).toContain("isPersonFocus && chat?.avatarUrl");
    expect(overview).toContain("ensureTodaysFocusIcon");
    expect(overview).toContain("item.type === \"calendar\"");
    expect(overview).toContain("formatTime(item.timestamp)");
    expect(overview).not.toContain("todays-focus-action");
    expect(overview).not.toContain("overview-action-strip");
    expect(overview).toContain("todaysAgenda.map");
    expect(overview).toContain("data-event-count");
    expect(overview).toContain("overview-todos-panel");
    expect(overview).not.toContain("Quick actions");
    expect(overview).not.toContain('className="panel quick-panel"');
    expect(overview.indexOf("overview-secondary-grid")).toBeLessThan(overview.indexOf("overview-secondary-activity"));
    expect(overview).toContain("filteredTrackedTodos.map");
    expect(overview).toContain("View full agenda");
    expect(overview).toContain("Nothing is scheduled for today yet.");
    expect(overview).toContain("You’re all caught up for today.");
    expect(overview).toContain('className="intelligence-focus caught-up" role="status"');
    expect(overview).not.toContain('className="intelligence-focus caught-up" onClick={() => onNavigate("intelligence")}');
    expect(calendar).toContain("calendar-day-more");
    expect(calendar).toContain("Show all ${dayEvents.length} events");
    expect(calendar).toContain("calendar-day-events-dialog");
    expect(styles).toContain(".overview-timeline-event { display: grid;");
    expect(styles).toContain(".todays-focus-item-avatar");
    expect(styles).toContain(".todays-focus-empty");
    expect(styles).toContain(".overview-page .overview-header { margin-bottom: 0; }");
    expect(styles).toContain(".overview-page .todays-focus-panel { margin-top: -45px; }");
    expect(styles).toContain("background: var(--todays-focus-theme)");
    expect(styles).toContain("font-size: clamp(29px, 2.1vw, 34px)");
    expect(styles).toContain("font-size: clamp(16px, 1.15vw, 18px)");
    expect(styles).toContain("font-size: clamp(17px, 1.15vw, 19px)");
    expect(styles).toContain(".overview-quote figcaption { margin-top: 7px");
    expect(styles).toContain("min-height: 88px");
    expect(styles).toContain("grid-template-columns: 54px fit-content(330px)");
    expect(styles).toContain("flex-wrap: nowrap");
    expect(styles).toContain("overflow-x: auto");
    expect(styles).toContain("height: 360px");
    expect(styles).toContain("grid-auto-rows: 48px");
    expect(styles).toContain('.overview-today-agenda[data-event-count="3"]');
    expect(styles).toContain('.overview-today-agenda[data-event-count="4"]');
    expect(styles).toContain("--agenda-time-size: 15px");
    expect(styles).toContain("scrollbar-gutter: stable both-edges");
    expect(styles).toContain("grid-template-columns: 62px 18px minmax(0, 1fr) 15px");
    expect(styles).toContain("drop-shadow(0 0 13px rgba(92,239,187,.22))");
    expect(styles).toContain("width .28s cubic-bezier(.22,.85,.3,1)");
    expect(styles).toContain("width: 20px; height: 20px");
    expect(styles).toContain("padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,.12)");
    expect(styles).toContain("margin: -15px 0 0 67px");
    expect(styles).toContain(".navigation { gap: 4px; margin-top: 40px; }");
    expect(styles).toContain(".app-shell.sidebar-collapsed .navigation { width: 100%; margin-top: 25px; }");
    expect(styles).toContain(".overview-agenda-pair > .panel { height: 100%; }");
    expect(styles).toContain(".overview-secondary-activity { min-height: 250px;");
  });

  it("keeps the connection in the sidebar and scopes weather/timezones to the Overview header", async () => {
    const [overview, header, sidebar, styles] = await Promise.all([
      readFile(new URL("../ui/src/components/Overview.tsx", import.meta.url), "utf8"),
      readFile(new URL("../ui/src/components/OverviewHeaderExperience.tsx", import.meta.url), "utf8"),
      readFile(new URL("../ui/src/components/Sidebar.tsx", import.meta.url), "utf8"),
      readFile(new URL("../ui/src/styles.css", import.meta.url), "utf8"),
    ]);
    expect(overview).toContain("<OverviewHeaderExperience now={deviceTime} />");
    expect(overview).not.toContain("WhatsApp connected");
    expect(sidebar).toContain("sidebar-whatsapp-status");
    expect(sidebar).toContain("sidebar-brand-area");
    expect(sidebar).toContain("sidebar-collapse-icon");
    expect(sidebar).not.toContain("<span>{collapsed ? \"Expand\" : \"Collapse\"}</span>");
    expect(header).toContain("overview-timezone-cards");
    expect(header).toContain("overview-timezone-spacer");
    expect(header).toContain("data-art-tone={artTone}");
    expect(header).toContain("useTimeZoneArtTone");
    expect(header).toContain("premium-weather-icon");
    expect(header).toContain('aria-label="Clock format"');
    expect(header).toContain('setTimeFormat("24-hour")');
    expect(header).toContain("Maximum 3 timezones");
    expect(header).not.toContain("Add timezone placeholder");
    expect(styles).toContain(".overview-timezone-spacer { width: 100%; min-height: 112px; }");
    expect(styles).toContain("--timezone-overlay-strong");
    expect(styles).toContain('data-art-tone="bright"');
    expect(styles).toContain("transparent 84%");
    expect(styles).toContain("overview-timezone-weather-icon");
  });
});
