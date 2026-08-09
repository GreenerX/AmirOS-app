import {
  CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Cloud, Copy, EyeOff,
  ExternalLink, MapPin, MessageSquareText, PencilLine, RefreshCw,
  Trash2, Undo2, X,
} from "lucide-react";
import { SiApple, SiGooglecalendar } from "react-icons/si";
import { useEffect, useMemo, useState } from "react";
import { getCalendarSubscription, type CalendarSubscriptionInfo } from "../api";
import { calendarSubscriptionBannerHidden, setCalendarSubscriptionBannerHidden } from "../calendar-preferences";
import { downloadIcs, googleCalendarUrl } from "../calendar-export";
import { formatDateTime, formatTime } from "../format";
import type { CalendarEvent, IntelligenceData } from "../types";
import { CalendarEventForm, type CalendarEventDraft } from "./CalendarEventForm";

type EnrichedEvent = CalendarEvent & { chatId: string; contactName: string };
type CalendarPatch = {
  status?: CalendarEvent["status"];
  title?: string;
  startAt?: number;
  endAt?: number;
  allDay?: boolean;
  location?: string;
};

type CalendarViewProps = {
  data?: IntelligenceData;
  onOpenChat: (chatId: string) => void;
  onStatus: (chatId: string, eventId: string, patch: CalendarPatch) => Promise<void>;
  onRegenerateTitle: (chatId: string, eventId: string) => Promise<string>;
};

function longDate(timestamp: number) {
  return formatDateTime(timestamp, {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function shortTime(timestamp: number) {
  return formatTime(timestamp);
}

function localDateTime(timestamp: number) {
  const date = new Date(timestamp);
  return new Date(timestamp - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function sameDay(left: Date, timestamp: number) {
  const right = new Date(timestamp);
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

function eventEnd(event: CalendarEvent) {
  return event.endAt && event.endAt > event.startAt ? event.endAt : event.startAt + 60 * 60 * 1_000;
}

export function CalendarView({ data, onOpenChat, onStatus, onRegenerateTitle }: CalendarViewProps) {
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [dates, setDates] = useState<Record<string, string>>({});
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedEvent, setSelectedEvent] = useState<EnrichedEvent>();
  const [selectedMonthDay, setSelectedMonthDay] = useState<{ date: Date; events: EnrichedEvent[] }>();
  const [editDraft, setEditDraft] = useState<CalendarEventDraft>();
  const [deleteCandidate, setDeleteCandidate] = useState<EnrichedEvent>();
  const [deletedEvent, setDeletedEvent] = useState<EnrichedEvent>();
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const [regeneratingTitle, setRegeneratingTitle] = useState(false);
  const [subscription, setSubscription] = useState<CalendarSubscriptionInfo>();
  const [subscriptionError, setSubscriptionError] = useState("");
  const [copied, setCopied] = useState(false);
  const [subscriptionHidden, setSubscriptionHidden] = useState(calendarSubscriptionBannerHidden);
  const events = data?.events || [];
  const confirmed = events.filter((item) => item.status === "confirmed");
  const suggestions = events.filter((item) => item.status === "inferred");
  const days = useMemo(() => {
    const start = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
    return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  }, [month]);

  useEffect(() => {
    if (subscriptionHidden) return;
    let cancelled = false;
    void getCalendarSubscription().then((result) => {
      if (!cancelled) setSubscription(result);
    }).catch((error) => {
      if (!cancelled) setSubscriptionError(error instanceof Error ? error.message : "Could not create the subscription link");
    });
    return () => { cancelled = true; };
  }, [confirmed.length, subscriptionHidden]);

  useEffect(() => {
    if (!selectedEvent && !deleteCandidate && !selectedMonthDay) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (deleteCandidate) setDeleteCandidate(undefined);
      else if (selectedMonthDay) setSelectedMonthDay(undefined);
      else { setSelectedEvent(undefined); setEditDraft(undefined); }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedEvent?.id, deleteCandidate?.id, selectedMonthDay?.date.getTime()]);

  useEffect(() => {
    if (!deletedEvent) return;
    const timeout = window.setTimeout(() => setDeletedEvent(undefined), 10_000);
    return () => window.clearTimeout(timeout);
  }, [deletedEvent?.id]);

  const copySubscription = async () => {
    if (!subscription) return;
    try {
      await navigator.clipboard.writeText(subscription.httpUrl);
      setSubscriptionError("");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_800);
    } catch {
      setSubscriptionError("The browser could not copy the link. Try opening AmirOS in a regular browser window.");
    }
  };

  const openEvent = (event: EnrichedEvent) => {
    setActionError("");
    setEditDraft(undefined);
    setSelectedEvent(event);
  };

  const beginEdit = (event: EnrichedEvent) => {
    setActionError("");
    setEditDraft({
      title: event.title,
      startAt: localDateTime(event.startAt),
      endAt: localDateTime(eventEnd(event)),
      location: event.location || "",
    });
  };

  const saveEdit = async () => {
    if (!selectedEvent || !editDraft) return;
    const title = editDraft.title.replace(/\s+/g, " ").trim();
    const startAt = new Date(editDraft.startAt).getTime();
    const endAt = new Date(editDraft.endAt).getTime();
    if (!title) { setActionError("Add an event title before saving."); return; }
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
      setActionError("The event end time must be after its start time.");
      return;
    }
    setSaving(true);
    setActionError("");
    try {
      const patch = { title, startAt, endAt, location: editDraft.location.trim(), allDay: false };
      await onStatus(selectedEvent.chatId, selectedEvent.id, patch);
      setSelectedEvent({ ...selectedEvent, ...patch });
      setEditDraft(undefined);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not save this event");
    } finally {
      setSaving(false);
    }
  };

  const regenerateEditTitle = async () => {
    if (!selectedEvent || !editDraft) return;
    setRegeneratingTitle(true);
    setActionError("");
    try {
      const title = await onRegenerateTitle(selectedEvent.chatId, selectedEvent.id);
      setEditDraft((current) => current ? { ...current, title } : current);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not generate a better title");
    } finally {
      setRegeneratingTitle(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteCandidate) return;
    setSaving(true);
    setActionError("");
    try {
      await onStatus(deleteCandidate.chatId, deleteCandidate.id, { status: "dismissed" });
      setDeletedEvent(deleteCandidate);
      if (selectedEvent?.id === deleteCandidate.id) setSelectedEvent(undefined);
      setDeleteCandidate(undefined);
      setEditDraft(undefined);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not delete this event");
    } finally {
      setSaving(false);
    }
  };

  const undoDelete = async () => {
    if (!deletedEvent) return;
    const event = deletedEvent;
    setDeletedEvent(undefined);
    try {
      await onStatus(event.chatId, event.id, { status: "confirmed", allDay: false });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not restore this event");
      setDeletedEvent(event);
    }
  };

  return <main className="main-content secondary-page calendar-page">
    <header className="page-header compact-header"><div><h1>Calendar</h1><p>Plans discovered in conversations, with evidence attached.</p></div></header>

    {suggestions.length > 0 ? <section className="panel calendar-suggestions calendar-suggestions-top"><div className="panel-heading"><h2>Suggested from messages</h2><small>{suggestions.length} awaiting review</small></div>
      <div className="calendar-agenda">{suggestions.map((event) => { const title = titles[event.id] ?? event.title; const dateValue = dates[event.id] ?? localDateTime(event.startAt); const startAt = new Date(dateValue).getTime(); return <article key={event.id}>
        <span className="agenda-date suggestion"><strong>{new Date(event.startAt).getDate()}</strong><small>{new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(event.startAt))}</small><time>{Number.isFinite(startAt) ? shortTime(startAt) : "—"}</time></span>
        <div className="agenda-edit-copy"><label><PencilLine size={13} /><input aria-label={`Edit event title for ${event.contactName}`} value={title} onChange={(change) => setTitles((current) => ({ ...current, [event.id]: change.target.value }))} /><button type="button" aria-label="Regenerate event title" onClick={() => void onRegenerateTitle(event.chatId, event.id).then((next) => setTitles((current) => ({ ...current, [event.id]: next })))}><RefreshCw size={14} /></button></label><input className="event-datetime-input" type="datetime-local" value={dateValue} aria-label={`Date and time for ${title}`} onChange={(change) => setDates((current) => ({ ...current, [event.id]: change.target.value }))} /><button disabled={!Number.isFinite(startAt)} onClick={() => openEvent({ ...event, title, startAt, allDay: false })}><span>{event.evidence.senderName || event.contactName}: {event.evidence.excerpt}</span></button></div>
        <span className="agenda-actions"><button aria-label="Accept calendar suggestion" disabled={!title.trim() || !Number.isFinite(startAt)} onClick={() => void onStatus(event.chatId, event.id, { status: "confirmed", title: title.trim(), startAt, allDay: false })}><Check size={15} /></button><button aria-label="Dismiss calendar suggestion" onClick={() => void onStatus(event.chatId, event.id, { status: "dismissed" })}><X size={15} /></button></span>
      </article>; })}</div>
    </section> : null}

    {!subscriptionHidden ? <section className="panel calendar-subscription-panel">
      <span className="calendar-subscription-icon"><Cloud size={23} /><SiApple size={15} /></span>
      <div className="calendar-subscription-copy"><span className="subscription-heading"><h2>iCloud calendar subscription</h2><small className={subscription?.publicUrlConfigured ? "public" : "local"}>{subscription?.publicUrlConfigured ? "iCloud-ready URL" : "Local Mac feed"}</small></span><p>Subscribe once and confirmed AmirOS events update in a read-only Apple calendar.</p><small>{subscription?.publicUrlConfigured ? "When Apple Calendar opens, choose iCloud as the Location to make it available on your Apple devices." : "Apple Calendar cannot reliably open a local webcal link. Copy this private link, then paste it into Calendar’s New Calendar Subscription screen on this Mac."}</small></div>
      <div className="calendar-subscription-actions">
        {subscription?.webcalUrl ? <a className="button primary compact" href={subscription.webcalUrl}><SiApple className="brand-icon apple" size={16} />Subscribe in Apple Calendar</a> : <button className="button primary compact" disabled={!subscription} onClick={() => void copySubscription()}><SiApple className="brand-icon apple" size={16} />{copied ? "Link copied ✓" : "Copy link for Apple Calendar"}</button>}
        {subscription?.webcalUrl ? <button className="button compact" disabled={!subscription} onClick={() => void copySubscription()}><Copy size={15} />{copied ? "Copied ✓" : "Copy subscription link"}</button> : null}
        <button className="icon-button calendar-subscription-hide" aria-label="Hide iCloud subscription banner" title="Hide from Calendar" onClick={() => { setCalendarSubscriptionBannerHidden(true); setSubscriptionHidden(true); }}><EyeOff size={16} /></button>
      </div>
      {subscriptionError ? <small className="subscription-error">{subscriptionError}</small> : null}
    </section> : null}

    <section className="panel calendar-month-panel">
      <div className="calendar-month-header"><div><h2>{new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(month)}</h2><small>{confirmed.length} confirmed plans</small></div><span><button className="icon-button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={17} /></button><button className="button compact" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Today</button><button className="icon-button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={17} /></button></span></div>
      <div className="calendar-month-grid">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <strong className="calendar-weekday" key={day}>{day}</strong>)}{days.map((day) => { const dayEvents = confirmed.filter((event) => sameDay(day, event.startAt)); const outside = day.getMonth() !== month.getMonth(); const today = sameDay(day, Date.now()); return <div key={day.toISOString()} className={`calendar-day ${outside ? "outside" : ""} ${today ? "today" : ""}`}><span>{day.getDate()}</span>{dayEvents.slice(0, 3).map((event) => <button key={event.id} onClick={() => openEvent(event)} title={`View ${event.title} at ${shortTime(event.startAt)}`}><time>{shortTime(event.startAt)}</time><span>{event.title}</span></button>)}{dayEvents.length > 3 ? <button type="button" className="calendar-day-more" aria-label={`Show all ${dayEvents.length} events on ${new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(day)}`} onClick={() => setSelectedMonthDay({ date: day, events: dayEvents })}>+{dayEvents.length - 3} more</button> : null}</div>; })}</div>
    </section>

    {selectedMonthDay ? <div className="event-detail-backdrop" role="presentation" onClick={() => setSelectedMonthDay(undefined)}>
      <section className="event-detail-bubble calendar-day-events-dialog" role="dialog" aria-modal="true" aria-labelledby="calendar-day-events-title" onClick={(event) => event.stopPropagation()}>
        <header><span className="event-detail-icon"><CalendarDays size={22} /></span><span><small>Day agenda</small><h2 id="calendar-day-events-title">{new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(selectedMonthDay.date)}</h2></span><button className="icon-button" aria-label="Close day agenda" onClick={() => setSelectedMonthDay(undefined)}><X size={17} /></button></header>
        <div className="calendar-day-events-list">{selectedMonthDay.events.map((event) => <button key={event.id} type="button" onClick={() => { setSelectedMonthDay(undefined); openEvent(event); }}><time>{shortTime(event.startAt)}</time><span><strong>{event.title}</strong><small>{event.location || `With ${event.contactName}`}</small></span><ChevronRight size={16} /></button>)}</div>
      </section>
    </div> : null}

    <section className="panel calendar-confirmed"><div className="panel-heading"><h2>Confirmed agenda</h2><small>{confirmed.length} plans</small></div>
        <div className="calendar-agenda">{confirmed.map((event) => <article key={event.id}>
          <span className="agenda-date"><strong>{new Date(event.startAt).getDate()}</strong><small>{new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(event.startAt))}</small><time>{shortTime(event.startAt)}</time></span>
          <button onClick={() => openEvent(event)}><strong>{event.title}</strong><small>{longDate(event.startAt)}</small>{event.location ? <span><MapPin size={13} />{event.location}</span> : null}<span>From {event.contactName}</span></button>
          <span className="agenda-export-actions"><a className="icon-button calendar-platform-button google" aria-label="Add to Google Calendar" title="Google Calendar" href={googleCalendarUrl(event, event.contactName)} target="_blank" rel="noreferrer"><SiGooglecalendar className="brand-icon google" size={17} /></a><button className="icon-button calendar-platform-button apple" aria-label="Download for Apple Calendar" title="Apple Calendar (.ics)" onClick={() => downloadIcs(event, event.contactName)}><SiApple className="brand-icon apple" size={17} /></button><button className="icon-button danger" aria-label={`Delete ${event.title}`} title="Delete event" onClick={() => setDeleteCandidate(event)}><Trash2 size={15} /></button></span>
        </article>)}{confirmed.length === 0 ? <div className="radar-empty"><CalendarDays size={21} /><span><strong>No confirmed plans yet</strong><small>Accept a suggestion to place it here.</small></span></div> : null}</div>
    </section>

    {selectedEvent ? <div className="event-detail-backdrop" role="presentation" onClick={() => { setSelectedEvent(undefined); setEditDraft(undefined); }}>
      <section className={`event-detail-bubble ${editDraft ? "editing" : ""}`} role="dialog" aria-modal="true" aria-labelledby="calendar-event-title" onClick={(event) => event.stopPropagation()}>
        <header><span className="event-detail-icon"><CalendarDays size={22} /></span><span><small>{editDraft ? "Editing event" : selectedEvent.status === "confirmed" ? "Confirmed event" : "Suggested event"}</small><h2 id="calendar-event-title">{selectedEvent.title}</h2></span><button className="icon-button" aria-label="Close event details" onClick={() => { setSelectedEvent(undefined); setEditDraft(undefined); }}><X size={17} /></button></header>
        {editDraft ? <CalendarEventForm draft={editDraft} error={actionError} saving={saving} regeneratingTitle={regeneratingTitle} submitLabel="Save event" onChange={setEditDraft} onCancel={() => { setEditDraft(undefined); setActionError(""); }} onSubmit={() => void saveEdit()} onRegenerateTitle={() => void regenerateEditTitle()} /> : <>
          <dl><div><dt>Date &amp; time</dt><dd>{longDate(selectedEvent.startAt)}</dd></div><div><dt>Duration</dt><dd>{Math.max(1, Math.round((eventEnd(selectedEvent) - selectedEvent.startAt) / 60_000))} minutes</dd></div>{selectedEvent.location ? <div><dt>Location</dt><dd>{selectedEvent.location}</dd></div> : null}<div><dt>Conversation</dt><dd>{selectedEvent.contactName}</dd></div></dl>
          <blockquote><MessageSquareText size={16} /><span><strong>{selectedEvent.evidence.senderName || selectedEvent.contactName}</strong>{selectedEvent.evidence.excerpt}</span></blockquote>
          {actionError ? <p className="event-action-error">{actionError}</p> : null}
          <footer><span><a className="button compact" href={googleCalendarUrl(selectedEvent, selectedEvent.contactName)} target="_blank" rel="noreferrer"><SiGooglecalendar className="brand-icon google" size={16} />Google Calendar</a><button className="button compact" onClick={() => downloadIcs(selectedEvent, selectedEvent.contactName)}><SiApple className="brand-icon apple" size={16} />Apple Calendar</button></span><span className="event-detail-actions"><button className="button compact" onClick={() => beginEdit(selectedEvent)}><PencilLine size={15} />Edit</button>{selectedEvent.status === "confirmed" ? <button className="button compact danger" onClick={() => setDeleteCandidate(selectedEvent)}><Trash2 size={15} />Delete</button> : null}<button className="button primary compact" onClick={() => { setSelectedEvent(undefined); onOpenChat(selectedEvent.chatId); }}><ExternalLink size={15} />Open source chat</button></span></footer>
        </>}
      </section>
    </div> : null}

    {deleteCandidate ? <div className="event-delete-backdrop" role="presentation" onClick={() => setDeleteCandidate(undefined)}>
      <section className="event-delete-confirm" role="alertdialog" aria-modal="true" aria-labelledby="delete-event-title" onClick={(event) => event.stopPropagation()}><span className="delete-event-icon"><Trash2 size={21} /></span><div><small>Delete confirmed event?</small><h2 id="delete-event-title">{deleteCandidate.title}</h2><p>This removes it from AmirOS and the subscription feed. You can undo immediately afterward.</p>{actionError ? <p className="delete-event-error">{actionError}</p> : null}</div><footer><button className="button compact" disabled={saving} onClick={() => setDeleteCandidate(undefined)}>Keep event</button><button className="button compact danger solid" disabled={saving} onClick={() => void confirmDelete()}><Trash2 size={15} />{saving ? "Deleting…" : "Delete event"}</button></footer></section>
    </div> : null}

    {deletedEvent ? <aside className="calendar-undo-toast" role="status"><span><Trash2 size={17} /><span><strong>Event deleted</strong><small>{deletedEvent.title}</small></span></span><button onClick={() => void undoDelete()}><Undo2 size={15} />Undo</button></aside> : null}
  </main>;
}
