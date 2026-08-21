import { RefreshCw, Save } from "lucide-react";

export type CalendarEventDraft = {
  title: string;
  startAt: string;
  endAt: string;
  location: string;
  timezone?: string;
  timeBasis?: "contact" | "owner";
};

type CalendarEventFormProps = {
  draft: CalendarEventDraft;
  error?: string;
  saving: boolean;
  regeneratingTitle: boolean;
  submitLabel: string;
  onChange: (draft: CalendarEventDraft) => void;
  onCancel: () => void;
  onSubmit: () => void;
  onRegenerateTitle: () => void;
  contactTimezone?: string;
  onTimeBasisChange?: (basis: NonNullable<CalendarEventDraft["timeBasis"]>) => void;
};

export function CalendarEventForm({
  draft,
  error,
  saving,
  regeneratingTitle,
  submitLabel,
  onChange,
  onCancel,
  onSubmit,
  onRegenerateTitle,
  contactTimezone,
  onTimeBasisChange,
}: CalendarEventFormProps) {
  return <form className="event-edit-form" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
    <label className="full"><span>Event title</span><div className="event-title-editor"><input autoFocus value={draft.title} onChange={(event) => onChange({ ...draft, title: event.target.value })} /><button type="button" disabled={saving || regeneratingTitle} onClick={onRegenerateTitle}><RefreshCw size={14} className={regeneratingTitle ? "spin" : ""} />{regeneratingTitle ? "Generating…" : "Generate better title"}</button></div></label>
    {onTimeBasisChange ? <div className="event-timezone-choice full"><span>Time zone</span><div role="group" aria-label="Event time zone"><button type="button" aria-pressed={draft.timeBasis === "contact"} disabled={!contactTimezone} onClick={() => onTimeBasisChange("contact")}>Contact time</button><button type="button" aria-pressed={draft.timeBasis !== "contact"} onClick={() => onTimeBasisChange("owner")}>My time</button></div><small>{draft.timezone}</small></div> : null}
    <label><span>Starts</span><input type="datetime-local" value={draft.startAt} onChange={(event) => onChange({ ...draft, startAt: event.target.value })} /></label>
    <label><span>Ends</span><input type="datetime-local" value={draft.endAt} onChange={(event) => onChange({ ...draft, endAt: event.target.value })} /></label>
    <label className="full"><span>Location</span><input placeholder="Optional location" value={draft.location} onChange={(event) => onChange({ ...draft, location: event.target.value })} /></label>
    {error ? <p className="event-action-error">{error}</p> : null}
    <footer><button type="button" className="button compact" disabled={saving} onClick={onCancel}>Cancel</button><button type="submit" className="button primary compact" disabled={saving || regeneratingTitle}><Save size={15} />{saving ? "Saving…" : submitLabel}</button></footer>
  </form>;
}
