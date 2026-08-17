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
    expect(overview).not.toContain("Why this is here:");
    expect(overview).toContain("visibleTodaysFocus.map");
    expect(overview).not.toContain("visibleTodaysFocus.slice(0, 4)");
    expect(overview).toContain("todaysFocusDismissalIds(item)");
    expect(overview).toContain("Overdue · ${eventDateTime(item.timestamp)}");
    expect(overview).toContain("Follow-up from ${eventDateTime(followUpAt)}");
    expect(overview).toContain("setTodoEditor(todo)");
    expect(overview).not.toContain("onOpenTodoReview");
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
    expect(calendar).toContain("calendar-view-switcher");
    expect(calendar).toContain('setDisplayMode("day")');
    expect(calendar).toContain('setDisplayMode("week")');
    expect(calendar).toContain('setDisplayMode("month")');
    expect(calendar).toContain("openDay(day)");
    expect(calendar).toContain("calendar-day-schedule");
    expect(calendar).toContain("calendar-week-grid");
    expect(calendar).not.toContain("calendar-confirmed");
    expect(styles).toContain(".overview-timeline-event { display: grid;");
    expect(styles).toContain(".todays-focus-item-avatar");
    expect(styles).toContain(".todays-focus-empty");
    expect(styles).toContain(".overview-page .overview-header { margin-bottom: 0; }");
    expect(styles).toContain(".overview-page .todays-focus-panel { margin-top: -50px; }");
    expect(styles).toContain("background: var(--todays-focus-theme)");
    expect(styles).toContain("font-size: clamp(29px, 2.1vw, 34px)");
    expect(styles).toContain("font-size: clamp(16px, 1.15vw, 18px)");
    expect(styles).toContain("margin-left: 15px");
    expect(styles).toContain("font-size: clamp(17px, 1.15vw, 19px)");
    expect(styles).toContain(".overview-quote figcaption { margin-top: 7px");
    expect(styles).toContain("height: 105px; max-height: 105px");
    expect(styles).toContain("width: fit-content; min-width: 250px");
    expect(styles).toContain("max-width: min(580px, calc(100vw - 42px))");
    expect(styles).toContain("grid-template-columns: 60px minmax(0, max-content)");
    expect(styles).toContain("padding: 7px 20px 6px 12px");
    expect(styles).toContain("width: 60px; height: 60px");
    expect(styles).not.toContain("-webkit-line-clamp: 1");
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
    expect(header).toContain("formatDeviceClock(now, timeFormat, !secondsHidden)");
    expect(header).toContain("toggleClockSeconds");
    expect(header).toContain("Andrew Mode");
    expect(header).toContain("The seconds can wait.");
    expect(header).toContain("ANDREW_MODE_TOAST_DELAY_MS = 1_750");
    expect(styles).toContain("andrew-mode-clock-ripple");
    expect(styles).toContain("andrew-mode-clock-aura");
    expect(styles).toContain("prefers-reduced-motion: reduce");
    expect(header).toContain("Maximum 4 timezones");
    expect(header).toContain("Up to four cities");
    expect(header).not.toContain("Add timezone placeholder");
    expect(styles).toContain(".overview-timezone-spacer { width: 100%; min-height: 112px; }");
    expect(styles).toContain(".overview-header { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);");
    expect(styles).toContain(".overview-local-strip { display: flex; width: 100%; flex-wrap: wrap; align-items: flex-start; justify-content: flex-end; gap: 40px;");
    expect(styles).toContain(".overview-local-weather { display: grid; grid-template-columns: 54px auto; align-items: center; gap: 12px; min-width: 0;");
    expect(styles).toContain(".overview-clock-block { position: relative; display: grid; justify-items: end; gap: 0; width: max-content; padding-bottom: 31px; }");
    expect(styles).toContain(".overview-clock-block .overview-current-time { width: auto; min-width: 0; }");
    expect(styles).toContain(".overview-clock-controls { position: absolute; right: 0; bottom: 0;");
    expect(styles).toContain(".overview-local-weather { transform: translateY(-15px); }");
    expect(styles).toContain(".local-time-menu-trigger { white-space: nowrap; }");
    expect(styles).toContain(".main-content.overview-page { overflow-x: hidden; }");
    expect(styles).toContain("@media (min-width: 1401px)");
    expect(styles).toContain("column-gap: 28px; row-gap: 20px;");
    expect(styles).toContain('font-size: clamp(44px, 3.4vw, 62px)');
    expect(styles).toContain(".overview-header-copy { grid-column: 1; grid-row: 1 / span 2; align-self: start; transform: translateY(-10px); }");
    expect(styles).toContain(".overview-header-experience { display: contents; }");
    expect(styles).toContain(".overview-local-strip { grid-column: 2; grid-row: 1; width: auto; flex-wrap: nowrap; gap: 40px; }");
    expect(styles).toContain(".overview-clock-block .overview-current-time { transform: scale(1.083, 1.235); transform-origin: right bottom; }");
    expect(styles).toContain(".overview-timezone-cards,\n  .overview-timezone-spacer { grid-column: 1 / -1; grid-row: 2; }");
    expect(styles).toContain(".overview-timezone-cards { grid-template-columns: repeat(auto-fit, minmax(190px, 202px)); }");
    expect(styles).toContain("@media (max-width: 1400px)");
    expect(styles).toContain(".overview-timezone-cards { display: grid; width: 100%; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));");
    expect(styles).toContain(".overview-timezone-card { --timezone-overlay-strong:");
    expect(styles).toContain("andrew-mode-toast-in 4.2s cubic-bezier(.2,.8,.2,1) both");
    expect(styles).toContain("andrew-mode-clock-settle");
    expect(styles).toContain("display: grid; width: 100%; min-width: 0; height: 112px;");
    expect(styles).toContain("--timezone-overlay-strong");
    expect(styles).toContain('data-art-tone="bright"');
    expect(styles).toContain('data-art-tone="bright"] { --timezone-overlay-strong: rgba(4,14,22,.65); --timezone-overlay-mid: rgba(4,14,22,.35); }');
    expect(styles).toContain('data-art-tone="dark"] { --timezone-overlay-strong: rgba(4,14,22,.38); --timezone-overlay-mid: rgba(4,14,22,.14); }');
    expect(styles).toContain("transparent 84%");
    expect(styles).toContain("overview-timezone-weather-icon");
  });
});
