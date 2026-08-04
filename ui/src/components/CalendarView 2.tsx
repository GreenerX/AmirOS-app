import { CalendarDays, Check, MapPin, PencilLine, X } from "lucide-react";
import { useState } from "react";
import type { CalendarEvent, IntelligenceData } from "../types";

type CalendarViewProps = {
  data?: IntelligenceData;
  onOpenChat: (chatId: string) => void;
  onStatus: (chatId: string, eventId: string, patch: { status?: CalendarEvent["status"]; title?: string }) => Promise<void>;
};

function longDate(timestamp: number, allDay: boolean) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long", month: "long", day: "numeric",
    ...(allDay ? {} : { hour: "numeric", minute: "2-digit" }),
  }).format(new Date(timestamp));
}

export function CalendarView({ data, onOpenChat, onStatus }: CalendarViewProps) {
  const [titles, setTitles] = useState<Record<string, string>>({});
  const events = data?.events || [];
  const confirmed = events.filter((item) => item.status === "confirmed");
  const suggestions = events.filter((item) => item.status === "inferred");
  return <main className="main-content secondary-page calendar-page">
    <header className="page-header compact-header"><div><h1>Calendar</h1><p>Plans discovered in conversations, with evidence attached.</p></div></header>
    <div className="calendar-sections">
      <section className="panel calendar-confirmed"><div className="panel-heading"><h2>On your calendar</h2><small>{confirmed.length} confirmed</small></div>
        <div className="calendar-agenda">{confirmed.map((event) => <article key={event.id}>
          <span className="agenda-date"><strong>{new Date(event.startAt).getDate()}</strong><small>{new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(event.startAt))}</small></span>
          <button onClick={() => onOpenChat(event.chatId)}><strong>{event.title}</strong><small>{longDate(event.startAt, event.allDay)}</small>{event.location ? <span><MapPin size={13} />{event.location}</span> : null}<span>From {event.contactName}</span></button>
          <button className="icon-button" aria-label="Remove from calendar" onClick={() => void onStatus(event.chatId, event.id, { status: "dismissed" })}><X size={16} /></button>
        </article>)}{confirmed.length === 0 ? <div className="radar-empty"><CalendarDays size={21} /><span><strong>No confirmed plans yet</strong><small>Accept a suggestion to place it here.</small></span></div> : null}</div>
      </section>
      <section className="panel calendar-suggestions"><div className="panel-heading"><h2>Suggested from messages</h2><small>{suggestions.length} awaiting review</small></div>
        <div className="calendar-agenda">{suggestions.map((event) => { const title = titles[event.id] ?? event.title; return <article key={event.id}>
          <span className="agenda-date suggestion"><strong>{new Date(event.startAt).getDate()}</strong><small>{new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(event.startAt))}</small></span>
          <div className="agenda-edit-copy"><label><PencilLine size={13} /><input aria-label={`Edit event title for ${event.contactName}`} value={title} onChange={(change) => setTitles((current) => ({ ...current, [event.id]: change.target.value }))} /></label><button onClick={() => onOpenChat(event.chatId)}><small>{longDate(event.startAt, event.allDay)}</small><span>{event.evidence.senderName || event.contactName}: {event.evidence.excerpt}</span></button></div>
          <span className="agenda-actions"><button aria-label="Accept calendar suggestion" disabled={!title.trim()} onClick={() => void onStatus(event.chatId, event.id, { status: "confirmed", title: title.trim() })}><Check size={15} /></button><button aria-label="Dismiss calendar suggestion" onClick={() => void onStatus(event.chatId, event.id, { status: "dismissed" })}><X size={15} /></button></span>
        </article>; })}{suggestions.length === 0 ? <div className="radar-empty"><Check size={21} /><span><strong>Suggestions reviewed</strong><small>New plans found in messages will appear here.</small></span></div> : null}</div>
      </section>
    </div>
  </main>;
}
