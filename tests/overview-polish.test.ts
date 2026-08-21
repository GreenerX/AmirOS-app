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

  it("uses one quiet unread system for Inbox instead of a floating header number", async () => {
    const [inbox, sidebar, styles] = await Promise.all([
      readFile(new URL("../ui/src/components/InboxView.tsx", import.meta.url), "utf8"),
      readFile(new URL("../ui/src/components/Sidebar.tsx", import.meta.url), "utf8"),
      readFile(new URL("../ui/src/styles.css", import.meta.url), "utf8"),
    ]);
    expect(inbox).toContain('className="inbox-unread-summary"');
    expect(inbox).toContain('unread {unreadCount === 1 ? "message" : "messages"}');
    expect(inbox).toContain('<Mail size={15} aria-hidden="true" />');
    expect(inbox).not.toContain('<span aria-label={`${unreadCount} unread messages`} title={`${unreadCount} unread messages`}>{unreadCount}</span>');
    expect(sidebar).toContain('className="nav-count"');
    expect(styles).toContain('.sidebar .nav-count,\n.sidebar .unread-count');
    expect(styles).toContain('background: #fffaf0');
    expect(styles).toContain('.chat-rail-collapsed .inbox-page-heading');
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
    expect(overview).toContain("agendaEventDetails(event)");
    expect(overview).toContain("data-event-count");
    expect(overview).toContain("overview-todos-panel");
    expect(overview).not.toContain("Quick actions");
    expect(overview).not.toContain('className="panel quick-panel"');
    expect(overview).not.toContain("overview-secondary-grid");
    expect(overview).not.toContain("overview-secondary-activity");
    expect(overview).toContain("next-best-list");
    expect(overview).toContain("Suggested actions");
    expect(overview).toContain("CalendarEventForm");
    expect(overview).toContain("suggestReplyForMessage");
    expect(overview).toContain("Reply to {replyEditor.contactName}");
    expect(overview).toContain('<textarea dir="auto" autoFocus value={replyBody}');
    expect(overview).toContain('className="reply-suggestion-feedback-note" dir="auto"');
    expect(styles).toContain('.reply-suggestion-context[dir="auto"], .reply-suggestion-compose textarea[dir="auto"], .reply-suggestion-feedback-note[dir="auto"]');
    expect(overview).toContain("filteredTrackedTodos.map");
    expect(overview).toContain("View full agenda");
    expect(overview).toContain("No confirmed plans for today.");
    expect(overview).toContain("OverviewReadinessPanel");
    expect(overview).toContain("Nothing confirmed needs your attention");
    expect(overview).toContain("Choose your first conversation");
    expect(overview).toContain("Private briefing");
    expect(overview).toContain('className="next-best-row-icon"');
    expect(overview).not.toContain("nextBestVisuals");
    expect(overview).toContain("relationshipBriefItems");
    expect(overview).toContain("dismissRelationshipBrief");
    expect(overview).toContain('className="overview-private-briefing-dismiss"');
    expect(overview).toContain("hideIntelligenceAction(item.id)");
    expect(overview).toMatch(/intelligenceCandidates|isTrustworthyIntelligenceCard/);
    expect(overview).toMatch(/evidence\.originalText|activeChatIds\.has\(chatId\)/);
    expect(overview).toContain("onOpenNextBestAction(item.chatId, item.messageId)");
    expect(overview).toContain('className="overview-empty-state overview-quiet-summary" role="status"');
    expect(overview).not.toContain('className="overview-empty-state" onClick={() => onNavigate("intelligence")}');
    expect(calendar).toContain("calendar-day-more");
    expect(calendar).toContain("calendar-view-switcher");
    expect(calendar).toContain('selectDisplayMode("day")');
    expect(calendar).toContain('selectDisplayMode("week")');
    expect(calendar).toContain('selectDisplayMode("month")');
    expect(calendar).toContain("readCalendarDisplayMode");
    expect(calendar).toContain("saveCalendarDisplayMode");
    expect(calendar).toContain("openDay(day)");
    expect(calendar).toContain("calendar-day-schedule");
    expect(calendar).toContain("calendar-week-grid");
    expect(calendar).not.toContain("calendar-confirmed");
    expect(styles).toContain(".overview-timeline-event { display: grid;");
    expect(styles).toContain(".todays-focus-item-avatar");
    expect(styles).toContain(".todays-focus-empty");
    expect(styles).toContain(".overview-page .overview-header { margin-bottom: 0; }");
    expect(styles).toContain(".overview-page .todays-focus-panel { margin-top: 0; }");
    expect(styles).toContain("background: var(--todays-focus-theme)");
    expect(styles).toContain("font-size: clamp(29px, 2.1vw, 34px)");
    expect(styles).toContain("font-size: clamp(16px, 1.15vw, 18px)");
    expect(styles).toContain("margin-left: 15px");
    expect(styles).toContain("font-size: clamp(17px, 1.15vw, 19px)");
    expect(styles).toContain("Overview filters share the Inbox control scale");
    expect(styles).toContain(".overview-todo-filter-bar button { min-height: 35px; padding: 0 8px; border-radius: 9px; font-size: 12px;");
    expect(styles).toContain(".overview-todo-filter-bar button span { min-width: 17px; height: 17px; padding: 0 4px; font-size: 9px; }");
    expect(styles).toContain('url("/backgrounds/overview-intelligence-aura-v1.png")');
    expect(styles).toContain("overview-intelligence-aura-drift 45s ease-in-out infinite alternate");
    expect(styles).toContain(".overview-page .todays-focus-title-row h2 {\n  font-family: var(--font-display);");
    expect(styles).toContain(".overview-quote figcaption { margin-top: 7px");
    expect(styles).toContain("height: 105px; max-height: 105px");
    expect(styles).toContain("width: fit-content; min-width: 250px");
    expect(styles).toContain("max-width: min(580px, calc(100vw - 42px))");
    expect(styles).toContain("grid-template-columns: 68px minmax(0, max-content)");
    expect(styles).toContain("padding: 7px 20px 6px 12px");
    expect(styles).toContain("width: 68px; height: 68px");
    expect(styles).not.toContain("-webkit-line-clamp: 1");
    expect(styles).toContain(".overview-private-briefing-item");
    expect(styles).toContain(".overview-private-briefing-dismiss");
    expect(styles).toContain(".overview-private-briefing-kind");
    expect(styles).toContain("Suggested actions are a compact intelligence feed, not a stack of cards.");
    expect(styles).toContain(".overview-suggested-actions-panel .next-best-list { gap: 0;");
    expect(styles).toContain(".overview-suggested-actions-panel .next-best-action-control {\n  width: 30px;\n  height: 30px;\n  border: 0;");
    expect(styles).toContain("The Overview is a desktop workspace, not a document. Panels are content");
    expect(styles).toContain("On shorter desktop windows, preserve the working cards before decorative");
    expect(styles).toContain(".overview-page .overview-private-briefing-list");
    expect(styles).toContain("flex-wrap: nowrap");
    expect(styles).toContain("overflow-x: auto");
    expect(styles).toContain("max-height: min(360px, calc(100dvh - 410px))");
    expect(styles).toContain(".event-detail-bubble.reply-suggestion-editor > header { grid-template-columns: minmax(0, 1fr) auto; }");
    expect(styles).toContain("grid-auto-rows: minmax(56px, auto)");
    expect(styles).toContain('.overview-today-agenda[data-event-count="3"]');
    expect(styles).toContain('.overview-today-agenda[data-event-count="4"]');
    expect(styles).toContain("--agenda-time-size: 15px");
    expect(styles).toContain("scrollbar-gutter: stable both-edges");
    expect(styles).toContain("grid-template-columns: 82px 18px minmax(0, 1fr) 15px");
    expect(styles).toContain("overflow: visible; text-overflow: clip; white-space: normal; overflow-wrap: anywhere;");
    expect(styles).toContain("drop-shadow(0 0 13px rgba(92,239,187,.22))");
    expect(styles).toContain("width .45s cubic-bezier(.4, 0, .2, 1)");
    expect(styles).toContain("width: 20px; height: 20px");
    expect(styles).toContain("padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,.12)");
    expect(styles).toContain("margin: -15px 0 0 67px");
    expect(styles).toContain(".navigation { gap: 4px; margin-top: 40px; }");
    expect(styles).toContain(".app-shell.sidebar-collapsed .navigation { width: 100%; margin-top: 25px; }");
    expect(styles).toContain(".overview-page > .overview-primary-grid > .overview-agenda-pair > .panel {");
    expect(styles).toContain(".overview-page .overview-todos-panel .overview-agenda-list");
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
    expect(header).toContain("overview-timezone-cards-expanded");
    expect(header).toContain("overview-world-clock-trigger");
    expect(header).toContain("overview-world-clock-control");
    expect(header).toContain("overview-world-clock-picker");
    expect(header).not.toContain("worldClockOpen");
    expect(header).not.toContain("overview-timezone-add-card");
    expect(header).toContain("data-art-tone={artTone}");
    expect(header).toContain("useTimeZoneArtTone");
    expect(header).toContain("premium-weather-icon");
    expect(header).toContain('aria-label="Clock format"');
    expect(header).toContain('setTimeFormat("24-hour")');
    expect(header).toContain("formatDeviceClock(now, timeFormat, false)");
    expect(header).toContain("const [pickerOpen, setPickerOpen] = useState(false);");
    expect(header).toContain("overview-current-time-period");
    expect(header).toContain('<span className="overview-current-time-period">{localClockPeriod}</span>');
    expect(header).not.toContain("Andrew Mode");
    expect(header).not.toContain("toggleClockSeconds");
    expect(styles).toContain(".overview-current-time-period { margin-left: .12em; font-size: .5em;");
    expect(header).toContain('className="overview-clock-weather-separator"');
    expect(styles).toContain(".overview-clock-display-row { display: flex; align-items: center; justify-content: flex-end; gap: 24px;");
    expect(styles).toContain(".overview-clock-weather-separator { flex: 0 0 2px; width: 2px; height: 62px; background: var(--text); opacity: .72; transform: translate(5px, -10px);");
    expect(styles).toContain(".overview-clock-weather-separator { margin-inline-end: 16px; }");
    expect(styles).not.toContain(".overview-page:has(.overview-timezone-cards-expanded) .todays-focus-panel");
    expect(styles).toContain(".overview-page .overview-header:has(.overview-timezone-cards-expanded) {\n    row-gap: 0;\n    /* Matches the collapsed header’s unused second-row baseline exactly. */\n    padding-bottom: 30px;");
    expect(styles).toContain("height: 0;\n    min-height: 0;\n    padding-top: 0;\n    overflow: visible;\n    /* Preserve a measured 20px breathing room below the local clock controls. */\n    translate: 0 20px;");
    expect(styles).toContain(".overview-page .overview-timezone-cards-expanded { translate: 0 4px; }");
    expect(styles).not.toContain("andrew-mode-clock-ripple");
    expect(styles).not.toContain("andrew-mode-clock-aura");
    expect(styles).toContain("prefers-reduced-motion: reduce");
    expect(header).toContain("Add world clock");
    expect(header).toContain("MAX_SAVED_TIMEZONE_CITIES");
    expect(header).not.toContain("Add timezone placeholder");
    expect(header).toContain("canAddCity = cities.length < MAX_SAVED_TIMEZONE_CITIES");
    expect(styles).toContain(".overview-timezone-spacer { width: 100%; min-height: 112px; }");
    expect(styles).toContain(".overview-header { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);");
    expect(styles).toContain(".overview-local-strip { display: flex; width: 100%; flex-wrap: wrap; align-items: flex-start; justify-content: flex-end; gap: 40px;");
    expect(styles).toContain(".overview-local-weather { display: grid; grid-template-columns: 54px auto; align-items: center; gap: 12px; min-width: 0;");
    expect(styles).toContain(".overview-clock-block { position: relative; display: grid; justify-items: end; gap: 0; width: max-content; padding-bottom: 31px; }");
    expect(styles).toContain(".overview-clock-block .overview-current-time { width: auto; min-width: 0; }");
    expect(styles).toContain(".overview-clock-controls { position: absolute; right: 0; bottom: 0;");
    expect(styles).toContain(".overview-page .overview-local-weather { transform: translateY(-8px); }");
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
    expect(styles).toContain(".overview-world-clock-picker { position: absolute;");
    expect(styles).not.toContain(".overview-timezone-add-card");
    expect(styles).toContain("display: grid; width: 100%; min-width: 0; height: 112px;");
    expect(styles).toContain("--timezone-overlay-strong");
    expect(styles).toContain('data-art-tone="bright"');
    expect(styles).toContain('data-art-tone="bright"] { --timezone-overlay-strong: rgba(4,14,22,.65); --timezone-overlay-mid: rgba(4,14,22,.35); }');
    expect(styles).toContain('data-art-tone="dark"] { --timezone-overlay-strong: rgba(4,14,22,.38); --timezone-overlay-mid: rgba(4,14,22,.14); }');
    expect(styles).toContain("transparent 84%");
    expect(styles).toContain("overview-timezone-weather-icon");
  });
});
