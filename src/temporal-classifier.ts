export type TemporalPrimaryType = "calendar_event" | "todo" | "commitment";

export type TemporalClassificationReason =
  | "explicit_calendar"
  | "explicit_todo"
  | "explicit_commitment"
  | "reminder_action"
  | "scheduled_appointment"
  | "scheduled_action"
  | "task_deadline"
  | "interpersonal_commitment";

export type ExtractedTemporalInformation = {
  phrase: string;
  timestamp: number;
  precision: "day" | "time";
  startAt?: number;
  dueAt?: number;
};

export type TemporalClassification = {
  primaryType: TemporalPrimaryType;
  confidence: number;
  reason: TemporalClassificationReason;
  temporal?: ExtractedTemporalInformation;
};

const EXPLICIT_CALENDAR = /\b(?:add|put|save|create|schedule)\b.{0,100}\b(?:calendar|agenda|appointment|event)\b|(?:תוסיף|תוסיפי|שמור|שמרי|צור|צרי|תקבע|תקבעי).{0,100}(?:יומן|לוח שנה|אירוע|תור)/iu;
const EXPLICIT_TODO = /\b(?:add|put|save|create)\b.{0,100}\b(?:to[ -]?do|task)(?:\s+list)?\b|(?:תוסיף|תוסיפי|שמור|שמרי|צור|צרי).{0,100}(?:משימה|מטלה|רשימת משימות)/iu;
const EXPLICIT_COMMITMENT = /\b(?:add|put|save|create)\b.{0,100}\b(?:commitment|promise)\b|(?:תוסיף|תוסיפי|שמור|שמרי|צור|צרי).{0,100}(?:התחייבות|הבטחה)/iu;
const EXPLICIT_TIMED_WRITE = /^(?:please\s+)?(?:add|put|save|create|schedule)\b|^(?:תוסיף|תוסיפי|שמור|שמרי|צור|צרי|תקבע|תקבעי)\b/iu;
const REMINDER_ACTION = /\bremind\s+me\s+to\s+[\p{L}\p{N}]|(?:תזכיר|תזכירי)\s+לי\s+ל?[\p{L}\p{N}]/iu;
const APPOINTMENT = /\b(?:appointment|therapy|doctor|dentist|meeting|meetup|class|lesson|interview|dinner|lunch|breakfast|coffee|concert|movie|flight|call with|session)\b|(?:תור|טיפול|פגישה|שיעור|ראיון|ארוחת|קפה|הופעה|סרט|טיסה)/iu;
const ACTION = /\b(?:bake|buy|call|charge|clean|collect|cook|dust|email|feed|file|finish|fix|install|message|mop|order|pack|pay|pick up|prepare|print|read|renew|replace|reply|review|send|shop|submit|take|take out|text|throw|unpack|update|vacuum|visit|walk|wash|water|write)\b|(?:לאפות|לקנות|להתקשר|להטעין|לנקות|לאסוף|לבשל|לשלוח|להאכיל|לסיים|לתקן|להתקין|לארוז|לשלם|להכין|להדפיס|לקרוא|לחדש|להחליף|לענות|לבדוק|להגיש|להוציא|לעדכן|לבקר|לטייל|לשטוף|להשקות|לכתוב)/iu;
const INTERPERSONAL_COMMITMENT = /\b(?:i\s+(?:promise|promised)|i['’]?ll|i\s+will|let\s+me)\b|\b(?:can|could|would|will)\s+you\b|\b(?:please|don['’]?t forget|make sure to)\b|(?:אני מבטיח|אני מבטיחה|אני א|תוכל|תוכלי|בבקשה|אל תשכח|אל תשכחי)/iu;

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function normalizeTimestamp(value: number | Date): number {
  const timestamp = value instanceof Date ? value.getTime() : value;
  return timestamp > 0 && timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp;
}

function localDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12, 0, 0, 0);
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

export type ExplicitClockTime = { hour: number; minute: number; phrase: string };

/** One authoritative parser for explicit event clock text across all pipelines. */
export function parseExplicitClockTime(text: string): ExplicitClockTime | undefined {
  const named = text.match(/\b(noon|midnight)\b|(?:צהריים|חצות)/iu);
  if (named) {
    const phrase = named[0];
    return { hour: /midnight|חצות/iu.test(phrase) ? 0 : 12, minute: 0, phrase };
  }
  const match = text.match(
    /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\bat\s+(\d{1,2})(?::(\d{2}))?\b|(?:בשעה\s*)(\d{1,2})(?::(\d{2}))?|\b(\d{1,2}):(\d{2})\b/iu,
  );
  if (!match) return undefined;
  let hour = Number(match[1] || match[4] || match[6] || match[8]);
  const minute = Number(match[2] || match[5] || match[7] || match[9] || 0);
  const period = match[3]?.toLocaleLowerCase();
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59) return undefined;
  if (period && (hour < 1 || hour > 12)) return undefined;
  if (!period && hour > 23) return undefined;
  if (period === "pm" && hour < 12) hour += 12;
  if (period === "am" && hour === 12) hour = 0;
  return { hour, minute, phrase: match[0] };
}

export function stripExplicitClockTime(text: string): string {
  const clock = parseExplicitClockTime(text);
  if (!clock) return text;
  return `${text.slice(0, text.indexOf(clock.phrase))} ${text.slice(text.indexOf(clock.phrase) + clock.phrase.length)}`
    .replace(/\s+/gu, " ")
    .trim();
}

/** Extracts the small, deterministic set of temporal phrases supported by the shared classifier. */
export function extractTemporalInformation(content: string, now: number | Date = Date.now()): Omit<ExtractedTemporalInformation, "startAt" | "dueAt"> | undefined {
  const current = new Date(normalizeTimestamp(now));
  const normalized = content.replace(/\s+/gu, " ").trim();
  let day: Date | undefined;
  let dayPhrase: string | undefined;

  const iso = normalized.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/u);
  const weekday = normalized.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/iu);
  if (iso) {
    day = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12, 0, 0, 0);
    if (day.getFullYear() !== Number(iso[1]) || day.getMonth() !== Number(iso[2]) - 1 || day.getDate() !== Number(iso[3])) return undefined;
    dayPhrase = iso[0];
  } else if (/\bday after tomorrow\b|מחרתיים/iu.test(normalized)) {
    day = addDays(localDay(current), 2);
    dayPhrase = normalized.match(/\bday after tomorrow\b|מחרתיים/iu)![0];
  } else if (/\btomorrow\b|מחר/iu.test(normalized)) {
    day = addDays(localDay(current), 1);
    dayPhrase = normalized.match(/\btomorrow\b|מחר/iu)![0];
  } else if (/\b(?:today|tonight)\b|היום|הערב/iu.test(normalized)) {
    day = localDay(current);
    dayPhrase = normalized.match(/\b(?:today|tonight)\b|היום|הערב/iu)![0];
  } else if (weekday) {
    const target = WEEKDAYS[weekday[1]!.toLocaleLowerCase()]!;
    const delta = (target - current.getDay() + 7) % 7;
    day = addDays(localDay(current), delta);
    dayPhrase = weekday[0];
  }

  const clock = parseExplicitClockTime(normalized);
  if (!day && !clock) return undefined;
  day ||= localDay(current);
  if (clock) day.setHours(clock.hour, clock.minute, 0, 0);
  const timestamp = day.getTime();
  return {
    phrase: [dayPhrase, clock?.phrase].filter(Boolean).join(" "),
    timestamp,
    precision: clock ? "time" : "day",
  };
}

function withTemporal(
  primaryType: TemporalPrimaryType,
  confidence: number,
  reason: TemporalClassificationReason,
  extracted: Omit<ExtractedTemporalInformation, "startAt" | "dueAt"> | undefined,
): TemporalClassification {
  if (!extracted) return { primaryType, confidence, reason };
  return {
    primaryType,
    confidence,
    reason,
    temporal: {
      ...extracted,
      ...(primaryType === "calendar_event" ? { startAt: extracted.timestamp } : { dueAt: extracted.timestamp }),
    },
  };
}

/**
 * Returns one canonical classification without consulting AI or mutating state.
 * Callers decide whether and how an accepted classification is persisted.
 */
export function classifyTemporalRequest(content: string, now: number | Date = Date.now()): TemporalClassification | undefined {
  const normalized = content.replace(/\s+/gu, " ").trim();
  if (!normalized) return undefined;
  const temporal = extractTemporalInformation(normalized, now);

  if (EXPLICIT_CALENDAR.test(normalized)) return withTemporal("calendar_event", 1, "explicit_calendar", temporal);
  if (EXPLICIT_TODO.test(normalized)) return withTemporal("todo", 1, "explicit_todo", temporal);
  if (EXPLICIT_COMMITMENT.test(normalized)) return withTemporal("commitment", 1, "explicit_commitment", temporal);
  if (REMINDER_ACTION.test(normalized)) return withTemporal("todo", .99, "reminder_action", temporal);
  if (INTERPERSONAL_COMMITMENT.test(normalized) && ACTION.test(normalized)) return withTemporal("commitment", .96, "interpersonal_commitment", temporal);
  if (APPOINTMENT.test(normalized) && temporal) return withTemporal("calendar_event", .96, "scheduled_appointment", temporal);
  if (EXPLICIT_TIMED_WRITE.test(normalized) && temporal?.precision === "time") return withTemporal("calendar_event", .95, "scheduled_action", temporal);
  if (ACTION.test(normalized) && temporal?.precision === "time") return withTemporal("calendar_event", .93, "scheduled_action", temporal);
  if (ACTION.test(normalized) && temporal) return withTemporal("todo", .93, "task_deadline", temporal);
  return undefined;
}
