export function relationshipLearningInstructions(ownerName: string): string {
  return [
    "Extract only useful relationship intelligence explicitly supported by the supplied messages.",
    "Messages marked candidate=false are context only. Never return an insight, commitment, event, or to-do whose sourceIndex points to a context-only message.",
    "Facts and preferences must describe the contact or relationship, not generic conversation topics.",
    `The owner is ${ownerName}. Treat first-person statements by ${ownerName} as facts supplied by the owner, not as information from another contact.`,
    "For every insight, return subjectNames containing every person or group that the knowledge directly describes. Use exact names from knownSubjectNames whenever a match is available.",
    `Example: if ${ownerName} says \"Dani and I live on King Street\", write one useful fact and include both ${ownerName} and Dani in subjectNames. If ${ownerName} says \"Dani's birthday is July 5\", include only Dani.`,
    "When a contact speaks in first person, assign the insight to that speaker. When an insight describes the conversation or group as a whole, assign it to contactName.",
    "Never extract knowledge from assistant-generated replies. Only human-authored messages are supplied as evidence.",
    "A commitment is a concrete promise, request, task, or follow-up that may still need action.",
    "Use owner=me when Amir was asked to act, contact when the other person promised, and group_member for a named group participant.",
    "Do not infer sensitive traits, diagnoses, politics, religion, ethnicity, sexuality, or health. Do not invent dates.",
    "Extract calendar events only for a genuine personal plan, appointment, invitation, meetup, trip, or scheduled activity involving Amir or the conversation participants, supported by a concrete date or relative weekday. Convert relative dates using the supplied message timestamp. Use Unix milliseconds.",
    "Do not turn ordinary date mentions into events. Exclude news and article headlines, historical events, availability notices, deadlines or requests to send something, and vague statements that do not represent an activity Amir may attend or remember. A named birthday with a concrete date or relative weekday is an event Amir wants to remember even when the message states it as a fact; exclude birthdays only when no usable day or date is supplied.",
    "Never create an all-day event. Always set allDay=false and include a concrete local time. Honor broad time phrases with these defaults: morning 09:00, afternoon 15:00, evening or dinner 19:00, night 20:00. When no time is stated, use 12:00 local time so Amir can review it.",
    "Write each calendar title as a concise, natural 2-7 word label that names the actual occasion or activity. Include the person's name when useful (for example, 'Laura's house party'). Remove dates, times, invitation boilerplate, and vague titles such as 'Calendar event' or 'Meeting'.",
    "A to-do is a concrete next action for the owner. Extract one only when the owner explicitly says they need to do it, or a human clearly asks the owner to do it. Write a short imperative title such as 'Call the dentist' or 'Buy coffee pods'. Return priority=high only for urgent or critical work, priority=low only when low urgency is explicit, and normal otherwise; never put priority wording in title. Return one fitting emoji separately, not in title. Do not create a to-do for someone else's task, generic advice, news, a pure calendar plan, or a vague need without an action. Use dueAt only for an explicit deadline or date/time; otherwise use 0.",
    "In a group, only create a to-do when the message author is the owner or ownerMentioned=true. A group member saying 'I need to…', making a general request, or asking another member is never an owner to-do.",
    "Return at most 20 insights, 20 commitments, 8 events, and 12 to-dos. Every item must cite one sourceIndex.",
  ].join(" ");
}
