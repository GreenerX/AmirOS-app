export const CALENDAR_SUBSCRIPTION_BANNER_KEY = "amiros.calendar.subscription-banner-hidden";
export const CALENDAR_SUBSCRIPTION_VISIBILITY_EVENT = "amiros:calendar-subscription-visibility";
export const CALENDAR_DISPLAY_MODE_KEY = "amiros.calendar.display-mode";

export type CalendarDisplayModePreference = "day" | "week" | "month";

export function calendarSubscriptionBannerHidden(): boolean {
  return window.localStorage.getItem(CALENDAR_SUBSCRIPTION_BANNER_KEY) === "true";
}

export function setCalendarSubscriptionBannerHidden(hidden: boolean): void {
  window.localStorage.setItem(CALENDAR_SUBSCRIPTION_BANNER_KEY, String(hidden));
  window.dispatchEvent(new CustomEvent(CALENDAR_SUBSCRIPTION_VISIBILITY_EVENT, { detail: { hidden } }));
}

export function readCalendarDisplayMode(): CalendarDisplayModePreference {
  const value = window.localStorage.getItem(CALENDAR_DISPLAY_MODE_KEY);
  return value === "day" || value === "week" || value === "month" ? value : "month";
}

export function saveCalendarDisplayMode(mode: CalendarDisplayModePreference): void {
  window.localStorage.setItem(CALENDAR_DISPLAY_MODE_KEY, mode);
}
