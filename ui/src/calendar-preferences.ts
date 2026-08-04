export const CALENDAR_SUBSCRIPTION_BANNER_KEY = "amiros.calendar.subscription-banner-hidden";
export const CALENDAR_SUBSCRIPTION_VISIBILITY_EVENT = "amiros:calendar-subscription-visibility";

export function calendarSubscriptionBannerHidden(): boolean {
  return window.localStorage.getItem(CALENDAR_SUBSCRIPTION_BANNER_KEY) === "true";
}

export function setCalendarSubscriptionBannerHidden(hidden: boolean): void {
  window.localStorage.setItem(CALENDAR_SUBSCRIPTION_BANNER_KEY, String(hidden));
  window.dispatchEvent(new CustomEvent(CALENDAR_SUBSCRIPTION_VISIBILITY_EVENT, { detail: { hidden } }));
}
