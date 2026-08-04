import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export type ReplyMode = "off" | "suggest" | "auto";
export type OwnerTriggerAccess = "knowledge" | "calendar";
export type KnowledgeTrackingStatus = "pending" | "snoozed" | "enabled" | "disabled";
export type KnowledgeTrackingDefault = "ask" | "private" | "off";
export type ThemeName =
  | "forest"
  | "ocean"
  | "plum"
  | "sand"
  | "indigo"
  | "rose"
  | "graphite";
export type ConnectionStatus =
  | "starting"
  | "qr"
  | "authenticated"
  | "ready"
  | "disconnected";

export type ContactPreferences = {
  mode: ReplyMode;
  relationship: string;
  tone: string;
  language: string;
  memoryEnabled: boolean;
  /** Controls automatic intelligence suggestions. Conversation context remains local. */
  knowledgeTracking: KnowledgeTrackingStatus;
  customInstructions: string;
  ownerTriggerAccess: OwnerTriggerAccess[];
  contactTriggerAccess: OwnerTriggerAccess[];
};

export type ConversationMemoryEntry = {
  role: "user" | "assistant";
  author?: "owner" | "contact" | "group_member" | "assistant";
  content: string;
  senderName?: string;
  timestamp: number;
  messageId?: string;
};

export type ContactMemoryItem = {
  id: string;
  content: string;
  createdAt: number;
};

export type ContactProfile = {
  summary: string;
  updatedAt: number;
  sourceMessageCount: number;
};

export type MemoryEvidence = {
  messageId?: string;
  excerpt: string;
  senderName?: string;
  timestamp: number;
};

export type ContactInsight = {
  id: string;
  clusterId?: string;
  subjectChatIds?: string[];
  subjectNames?: string[];
  kind: "fact" | "preference" | "relationship_change" | "important_date";
  content: string;
  status: "inferred" | "confirmed" | "outdated";
  confidence: number;
  evidence: MemoryEvidence;
  createdAt: number;
  updatedAt: number;
};

export type RelationshipCommitment = {
  id: string;
  content: string;
  owner: "me" | "contact" | "group_member";
  assigneeName?: string;
  status: "open" | "done" | "dismissed";
  dueAt?: number;
  evidence: MemoryEvidence;
  createdAt: number;
  updatedAt: number;
};

export type CalendarEvent = {
  id: string;
  title: string;
  startAt: number;
  endAt?: number;
  allDay: boolean;
  location?: string;
  status: "inferred" | "confirmed" | "dismissed";
  evidence: MemoryEvidence;
  createdAt: number;
  updatedAt: number;
};

export type CalendarEventPatch = {
  status?: CalendarEvent["status"];
  title?: string;
  startAt?: number;
  endAt?: number;
  allDay?: boolean;
  location?: string;
};

export type CalendarCaptureResult = {
  requested: boolean;
  status: "created" | "already_exists" | "dismissed" | "not_created";
  event?: CalendarEvent;
  reason?: string;
};

export type IntelligenceQuestionHistoryItem = {
  id: string;
  question: string;
  answer: string;
  sources: IntelligenceSearchRecord[];
  createdAt: number;
};

export type WritingStyleProfile = {
  summary: string;
  messageLength: string;
  emojiUse: string;
  formality: string;
  replyGuidance: string[];
  updatedAt: number;
  sourceMessageCount: number;
  ownerMessageCountAtUpdate?: number;
};

export type GroupConversationSummary = {
  summary: string;
  decisions: string[];
  tasks: string[];
  unansweredQuestions: string[];
  participants: string[];
  updatedAt: number;
  sourceMessageCount: number;
};

type ConversationMemory = {
  chatName?: string;
  entries: ConversationMemoryEntry[];
  manualItems: ContactMemoryItem[];
  profile?: ContactProfile;
  insights: ContactInsight[];
  commitments: RelationshipCommitment[];
  events: CalendarEvent[];
  styleProfile?: WritingStyleProfile;
  groupSummary?: GroupConversationSummary;
  /** Cursor for automatic relationship analysis, so old messages are never re-scanned. */
  lastKnowledgeAnalysisMessageId?: string;
  lastKnowledgeAnalysisAt?: number;
  incomingMessageCount: number;
  updatedAt: number;
};

export type IntelligenceSearchRecord = {
  id: string;
  chatId: string;
  contactName?: string;
  kind: "message" | "memory" | "insight" | "commitment" | "profile" | "calendar_event";
  content: string;
  senderName?: string;
  sourceAuthor?: "owner" | "contact" | "group_member";
  status?: string;
  timestamp: number;
  score: number;
};

export type OwnerAssistantContext = {
  knowledge: IntelligenceSearchRecord[];
  events: Array<CalendarEvent & { chatId: string; contactName?: string }>;
  /**
   * A deterministic interpretation of relationship words in the current
   * question (for example, "my dad" from Dani means Dani's father). Keeping
   * this separate from the raw records stops the model from transferring a
   * fact about one person's parent to another person's parent.
   */
  relationshipContext: string[];
};

function cleanRelationshipName(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/\s+/g, " ").trim().slice(0, 120);
  return cleaned || undefined;
}

export type IntelligenceChatSnapshot = {
  chatId: string;
  insights: ContactInsight[];
  commitments: RelationshipCommitment[];
  events: CalendarEvent[];
  profile?: ContactProfile;
  styleProfile?: WritingStyleProfile;
  groupSummary?: GroupConversationSummary;
  needsReply: boolean;
  lastIncoming?: ConversationMemoryEntry;
  updatedAt: number;
};

export type KnowledgeTrackingRequest = {
  chatId: string;
  contactName: string;
  isGroup: boolean;
  status: "pending" | "snoozed";
  messageCount: number;
  latestMessageAt: number;
  preview: string;
};

export type AssistantSettings = {
  autoReplySelfChat: boolean;
  allowOutgoingTriggerCommands: boolean;
  allowGroups: boolean;
  webSearchEnabled: boolean;
  botTriggerPrefix: string;
  webTriggerPrefix: string;
  imageTriggerPrefix: string;
  modelsTriggerPrefix: string;
};

export type AmirosDraft = {
  id: string;
  chatId: string;
  contactName: string;
  sourcePreview: string;
  body: string;
  createdAt: number;
  status: "pending" | "sent" | "dismissed";
};

export type AmirosActivity = {
  id: string;
  kind: "text" | "voice" | "image" | "web" | "system";
  title: string;
  detail: string;
  timestamp: number;
};

export type AssistantModels = {
  text: string;
  image: string;
  voice: string;
};

export type OwnerProfile = {
  displayName: string;
  avatarUrl: string;
};

export type OutgoingMediaCaption = {
  caption: string;
  timestamp: number;
};

type PersistedState = {
  theme: ThemeName;
  knowledgeTrackingDefault: KnowledgeTrackingDefault;
  chatNames: Record<string, string>;
  contacts: Record<string, ContactPreferences>;
  memories: Record<string, ConversationMemory>;
  intelligenceHistory: IntelligenceQuestionHistoryItem[];
  quietHours: {
    enabled: boolean;
    start: string;
    end: string;
  };
  monthlyBudgetUsd: number;
  monthlySpend?: {
    month: string;
    estimatedCostUsd: number;
  };
  assistant: AssistantSettings;
  modelPreset?: "economy" | "balanced" | "quality";
  models?: AssistantModels;
  ownerProfile: OwnerProfile;
  activities: AmirosActivity[];
  outgoingMediaCaptions: Record<string, OutgoingMediaCaption[]>;
};

const DEFAULT_CONTACT: ContactPreferences = {
  mode: "off",
  relationship: "Contact",
  tone: "Warm & concise",
  language: "Automatic",
  memoryEnabled: true,
  knowledgeTracking: "pending",
  customInstructions: "",
  ownerTriggerAccess: ["knowledge", "calendar"],
  contactTriggerAccess: [],
};

function normalizeOwnerTriggerAccess(value: unknown): OwnerTriggerAccess[] {
  if (!Array.isArray(value)) return [...DEFAULT_CONTACT.ownerTriggerAccess];
  return (["knowledge", "calendar"] as const).filter((item) => value.includes(item));
}

function normalizeContactTriggerAccess(value: unknown): OwnerTriggerAccess[] {
  if (!Array.isArray(value)) return [];
  return (["knowledge", "calendar"] as const).filter((item) => value.includes(item));
}

function normalizeKnowledgeTracking(value: unknown, fallback: KnowledgeTrackingStatus = "pending"): KnowledgeTrackingStatus {
  return value === "enabled" || value === "disabled" || value === "pending" || value === "snoozed" ? value : fallback;
}

function normalizeKnowledgeTrackingDefault(value: unknown): KnowledgeTrackingDefault {
  return value === "private" || value === "off" ? value : "ask";
}

const DEFAULT_STATE: PersistedState = {
  theme: "forest",
  knowledgeTrackingDefault: "ask",
  chatNames: {},
  contacts: {},
  memories: {},
  intelligenceHistory: [],
  quietHours: { enabled: false, start: "23:00", end: "07:00" },
  monthlyBudgetUsd: 20,
  monthlySpend: undefined,
  assistant: {
    autoReplySelfChat: true,
    allowOutgoingTriggerCommands: true,
    allowGroups: false,
    webSearchEnabled: true,
    botTriggerPrefix: "!bot",
    webTriggerPrefix: "!web",
    imageTriggerPrefix: "!image",
    modelsTriggerPrefix: "!models",
  },
  ownerProfile: {
    displayName: "Amir Friedman",
    avatarUrl: "/profile-avatars/avatar-01.png",
  },
  activities: [],
  outgoingMediaCaptions: {},
};

const MONTHS: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10,
  december: 11, dec: 11,
};

const HEBREW_MONTHS: Record<string, number> = {
  "ינואר": 0, "פברואר": 1, "מרץ": 2, "אפריל": 3, "מאי": 4, "יוני": 5,
  "יולי": 6, "אוגוסט": 7, "ספטמבר": 8, "אוקטובר": 9, "נובמבר": 10, "דצמבר": 11,
};

const ENGLISH_MONTH_PATTERN = "january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept?|october|oct|november|nov|december|dec";
const HEBREW_MONTH_PATTERN = "ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר";
const ENGLISH_WEEKDAY_PATTERN = "sunday|monday|tuesday|wednesday|thursday|friday|saturday";
const HEBREW_WEEKDAY_PATTERN = "ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת";

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

const HEBREW_WEEKDAYS: Record<string, number> = {
  "ראשון": 0, "שני": 1, "שלישי": 2, "רביעי": 3, "חמישי": 4, "שישי": 5, "שבת": 6,
};

function validCalendarDate(year: number, month: number, day: number): Date | undefined {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return undefined;
  const candidate = new Date(year, month, day, 12, 0, 0, 0);
  if (
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month ||
    candidate.getDate() !== day
  ) return undefined;
  return candidate;
}

function resolveDatedMonth(base: Date, month: number, day: number, explicitYear?: number): Date | undefined {
  let year = explicitYear ?? base.getFullYear();
  let candidate = validCalendarDate(year, month, day);
  if (!candidate) return undefined;
  if (explicitYear === undefined && candidate.getTime() < base.getTime() - 30 * 86_400_000) {
    year += 1;
    candidate = validCalendarDate(year, month, day);
  }
  return candidate;
}

function resolveDayOfMonth(base: Date, day: number): Date | undefined {
  if (day < 1 || day > 31) return undefined;
  for (let monthOffset = 0; monthOffset <= 12; monthOffset += 1) {
    const monthAnchor = new Date(base.getFullYear(), base.getMonth() + monthOffset, 1, 12, 0, 0, 0);
    const candidate = validCalendarDate(monthAnchor.getFullYear(), monthAnchor.getMonth(), day);
    if (candidate && candidate.getTime() >= base.getTime() - 12 * 3_600_000) return candidate;
  }
  return undefined;
}

function impliedEventHour(content: string): number | undefined {
  const text = content.toLocaleLowerCase();
  if (/\b(?:breakfast|morning)\b|\bבוקר\b/iu.test(text)) return 9;
  if (/\b(?:lunch|noon)\b|\b(?:צהריים|ארוחת צהריים)\b/iu.test(text)) return 12;
  if (/\bafternoon\b|\bאחר הצהריים\b/iu.test(text)) return 15;
  if (/\b(?:dinner|evening)\b|\b(?:ערב|ארוחת ערב)\b/iu.test(text)) return 19;
  if (/\b(?:tonight|night)\b|\bלילה\b/iu.test(text)) return 20;
  return undefined;
}

function normalizeTimedEventStart(timestamp: number, evidence: string, legacyAllDay = false): number {
  const date = new Date(timestamp);
  const hintedHour = impliedEventHour(evidence);
  if (hintedHour !== undefined && (legacyAllDay || (date.getHours() === 12 && date.getMinutes() === 0))) {
    date.setHours(hintedHour, 0, 0, 0);
  }
  return date.getTime();
}

export function hasCalendarPlanIntent(content: string): boolean {
  const normalized = content.replace(/\s+/g, " ").trim();
  const lower = normalized.toLocaleLowerCase();
  if (!normalized) return false;

  const explicitCalendarCommand = /\b(?:add|put|save|create|schedule|suggest)\b.{0,40}\b(?:calendar|agenda|appointment|event)\b|\b(?:save the date|don['’]?t forget|remind me|you(?:'re| are) invited|i(?:'m| am) inviting|please join)\b|(?:תוסיף|תוסיפי|להוסיף|תקבע|תקבעי|תציע|תציעי).{0,40}(?:יומן|לוח שנה|אירוע|תור)|(?:תזכיר|תזכירי|אל תשכח|אל תשכחי|מוזמנ(?:ים|ות)|מזמין|מזמינה)/iu.test(lower);
  const personalPlan = /\b(?:appointment|therapy|doctor|dentist|house party|birthday party|wedding|dinner|lunch|breakfast|coffee|shopping|concert|theat(?:er|re)|movie|flight|trip|vacation|visit|meeting with|meet(?:ing)? (?:me|us|at|with)|see you|catch up|drop(?:ping)? off|pick(?:ing)? up|bring(?:ing)?|arriv(?:e|es|ing)|coming over|go(?:ing)? to|let['’]?s|we (?:have|are meeting|are going)|i (?:have|am meeting|am going)|(?:[\p{L}'’.-]+(?:\s+[\p{L}'’.-]+){0,3}\s+and\s+i)\s+(?:are\s+)?going|call (?:me|us|with)|(?:i['’]?ll|we['’]?ll) call)\b|(?:ניפגש|נפגשים|נדבר)|(?:יש לנו|יש לי).{0,60}(?:תור|טיפול|פגישה|מסיבה|ארוחה|קפה|קניות|הצגה|סרט|טיסה|נסיעה|ביקור|חתונה|יום הולדת)|(?:תור|טיפול|פגישה|מסיבה|ארוחה|קפה|קניות|הצגה|קולנוע|טיסה|נסיעה|ביקור|חתונה|מסיבת יום הולדת|מגיע|מגיעה|מגיעים|מביא|מביאה|מוריד|מורידה|אוסף|אוספת)/iu.test(lower);
  const datedOccasion = /\bbirthday\b|(?:יום\s*הולדת|יום ההולדת)/iu.test(lower);
  if (!explicitCalendarCommand && !personalPlan && !datedOccasion) return false;

  const newsLike = /\b(?:breaking|top headlines?|news update|according to|reported|report says|published|killed|strikes?|election|markets?|gmt)\b|(?:חדשות|כותרות|דיווח|דווח|נהרג|תקיפה|בחירות)/iu.test(lower);
  const linkHeavy = /(?:https?:\/\/|www\.|t\.me\/)/iu.test(lower) && normalized.length > 120;
  return explicitCalendarCommand || (!newsLike && !linkHeavy);
}

function hasExplicitCalendarCommand(content: string): boolean {
  return /\b(?:add|put|save|create|schedule|suggest)\b.{0,80}\b(?:calendar|agenda|appointment|event)\b|\b(?:save the date|remind me|don['’]?t forget)\b|(?:תוסיף|תוסיפי|להוסיף|תקבע|תקבעי|תציע|תציעי).{0,80}(?:יומן|לוח שנה|אירוע|תור)|(?:תזכיר|תזכירי|אל תשכח|אל תשכחי)/iu.test(content);
}

function isReferentialCalendarCommand(content: string): boolean {
  return /\b(?:add|put|save|create|schedule|suggest)\s+(?:it|that|this)\s+(?:in|to|on)\s+(?:(?:the|my|your|our)\s+)?(?:calendar|agenda)\b|(?:תוסיף|תוסיפי|להוסיף|תקבע|תקבעי|תציע|תציעי)\s+(?:את\s+)?(?:זה|זאת|האירוע)\s+(?:ל|ב)(?:יומן|לוח השנה)/iu.test(content);
}

function isKeepBothCalendarFollowUp(content: string): boolean {
  return /^\s*(?:keep|add|save)\s+(?:them\s+)?both\s*[.!]?\s*$|^\s*(?:תשאיר|תשאירי|תוסיף|תוסיפי|שמור|שמרי)\s+(?:את\s+)?(?:שניהם|שתיהן)\s*[.!]?\s*$/iu.test(content);
}

function hasExplicitCalendarTime(content: string): boolean {
  return /\b(?:at\s*)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b(?:at\s*)?\d{1,2}:\d{2}\b|(?:בשעה\s*)\d{1,2}(?::\d{2})?/iu.test(content);
}

export function inferCalendarEventFromMessage(
  content: string,
  timestamp = Date.now(),
): Pick<CalendarEvent, "title" | "startAt" | "allDay" | "location"> | undefined {
  const normalized = content.replace(/\s+/g, " ").trim();
  const lower = normalized.toLocaleLowerCase();
  if (!normalized || !hasCalendarPlanIntent(normalized)) return undefined;
  const base = new Date(timestamp);
  let date: Date | undefined;
  let inferredFromTimeOnly = false;
  const isoDateMatch = lower.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/u);
  const numericDateMatch = lower.match(/\b(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2}|\d{4}))?\b/u);
  const englishMonthFirstMatch = lower.match(new RegExp(`\\b(${ENGLISH_MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:[,\\s]+(20\\d{2}))?`, "iu"));
  const englishDayFirstMatch = lower.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${ENGLISH_MONTH_PATTERN})(?:[,\\s]+(20\\d{2}))?`, "iu"));
  const hebrewDayFirstMatch = lower.match(new RegExp(`(?<!\\p{L})(\\d{1,2})\\s+ב?(${HEBREW_MONTH_PATTERN})(?:[,\\s]+(20\\d{2}))?`, "iu"));
  const hebrewMonthFirstMatch = lower.match(new RegExp(`(?<!\\p{L})(${HEBREW_MONTH_PATTERN})\\s+(\\d{1,2})(?:[,\\s]+(20\\d{2}))?`, "iu"));
  if (isoDateMatch) {
    date = validCalendarDate(Number(isoDateMatch[1]), Number(isoDateMatch[2]) - 1, Number(isoDateMatch[3]));
  } else if (numericDateMatch) {
    const rawYear = numericDateMatch[3] ? Number(numericDateMatch[3]) : undefined;
    const year = rawYear !== undefined && rawYear < 100 ? 2_000 + rawYear : rawYear;
    date = resolveDatedMonth(base, Number(numericDateMatch[2]) - 1, Number(numericDateMatch[1]), year);
  } else if (englishMonthFirstMatch) {
    date = resolveDatedMonth(
      base,
      MONTHS[englishMonthFirstMatch[1]!.toLocaleLowerCase()]!,
      Number(englishMonthFirstMatch[2]),
      englishMonthFirstMatch[3] ? Number(englishMonthFirstMatch[3]) : undefined,
    );
  } else if (englishDayFirstMatch) {
    date = resolveDatedMonth(
      base,
      MONTHS[englishDayFirstMatch[2]!.toLocaleLowerCase()]!,
      Number(englishDayFirstMatch[1]),
      englishDayFirstMatch[3] ? Number(englishDayFirstMatch[3]) : undefined,
    );
  } else if (hebrewDayFirstMatch) {
    date = resolveDatedMonth(
      base,
      HEBREW_MONTHS[hebrewDayFirstMatch[2]!]!,
      Number(hebrewDayFirstMatch[1]),
      hebrewDayFirstMatch[3] ? Number(hebrewDayFirstMatch[3]) : undefined,
    );
  } else if (hebrewMonthFirstMatch) {
    date = resolveDatedMonth(
      base,
      HEBREW_MONTHS[hebrewMonthFirstMatch[1]!]!,
      Number(hebrewMonthFirstMatch[2]),
      hebrewMonthFirstMatch[3] ? Number(hebrewMonthFirstMatch[3]) : undefined,
    );
  } else if (/\bday after tomorrow\b|מחרתיים/iu.test(lower)) {
    date = new Date(base);
    date.setDate(date.getDate() + 2);
  } else if (/\btomorrow\b|מחר/iu.test(lower)) {
    date = new Date(base);
    date.setDate(date.getDate() + 1);
  } else if (/\b(?:today|tonight)\b|היום|הערב/iu.test(lower)) {
    date = new Date(base);
  } else {
    const englishWeekdayMatch = lower.match(new RegExp(`\\b(${ENGLISH_WEEKDAY_PATTERN})\\b`, "iu"));
    const hebrewWeekdayMatch = lower.match(new RegExp(`(?:(?:ב?יום\\s*)|ב)(${HEBREW_WEEKDAY_PATTERN})(?!\\p{L})|(?<!\\p{L})(שבת)(?!\\p{L})`, "iu"));
    const weekdayName = englishWeekdayMatch?.[1]?.toLocaleLowerCase();
    const hebrewWeekdayName = hebrewWeekdayMatch?.[1] || hebrewWeekdayMatch?.[2];
    const target = weekdayName !== undefined ? WEEKDAYS[weekdayName] : hebrewWeekdayName ? HEBREW_WEEKDAYS[hebrewWeekdayName] : undefined;
    if (target !== undefined) {
      const ordinalMatch = weekdayName
        ? lower.match(new RegExp(`\\b${weekdayName}(?:\\s*,?\\s*(?:the\\s+)?)?(\\d{1,2})(?:st|nd|rd|th)?\\b`, "iu"))
        : undefined;
      if (ordinalMatch) {
        const requestedDay = Number(ordinalMatch[1]);
        const candidate = resolveDayOfMonth(base, requestedDay);
        if (candidate && candidate.getDay() === target) date = candidate;
      }
      if (!date) {
        let daysAhead = (target - base.getDay() + 7) % 7 || 7;
        if (weekdayName && new RegExp(`\\bnext\\s+${weekdayName}\\b`, "iu").test(lower) && daysAhead < 7) {
          daysAhead += 7;
        }
        date = new Date(base);
        date.setDate(date.getDate() + daysAhead);
      }
    } else {
      const ordinalDateMatch = lower.match(/\bon\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/iu);
      if (ordinalDateMatch) date = resolveDayOfMonth(base, Number(ordinalDateMatch[1]));
    }
  }
  if (!date && hasExplicitCalendarTime(lower)) {
    date = new Date(base);
    inferredFromTimeOnly = true;
  }
  if (!date) return undefined;
  const timeMatch = lower.match(/\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(?:at\s*)?(\d{1,2}):(\d{2})\b/iu);
  if (timeMatch) {
    let hour = Number(timeMatch[1] || timeMatch[4]);
    const minute = Number(timeMatch[2] || timeMatch[5] || 0);
    const period = timeMatch[3]?.toLocaleLowerCase();
    if (period === "pm" && hour < 12) hour += 12;
    if (period === "am" && hour === 12) hour = 0;
    date.setHours(hour, minute, 0, 0);
    if (inferredFromTimeOnly && date.getTime() < base.getTime() - 5 * 60_000) {
      date.setDate(date.getDate() + 1);
    }
  } else {
    date.setHours(impliedEventHour(lower) ?? 12, 0, 0, 0);
  }
  let title = normalized
    .replace(/^(?:hi|hey)(?:\s+[\p{L}]+)?[,!\s-]*(?:don['’]?t forget(?: that)?|remember(?: that)?)?\s*/iu, "")
    .replace(/^(?:please\s+)?(?:don['’]?t forget(?: that)?|remember(?: that)?)\s*/iu, "")
    .replace(/^(?:please\s+)?(?:add|put|create|save|schedule)\s+/iu, "")
    .replace(/^(?:hey[,!]?\s*)?(?:save the date|you(?:'re| are) invited|i(?:'m| am) inviting (?:you|us)|please join (?:us|me))\s*[-–—:]?\s*/iu, "")
    .replace(/[,\s]*(?:and\s+)?(?:please\s+)?(?:add|put|save|create|schedule|suggest)\s+(?:it|this|that)?\s*(?:to|in|on)\s+(?:(?:my|the|your|our)\s+)?(?:calendar|agenda)\s*$/iu, "")
    .replace(/\s+(?:to|in|on)\s+(?:my|the|your|our)\s+(?:calendar|agenda)\s*$/iu, "")
    .replace(new RegExp(`\\b(?:on\\s+)?(?:${ENGLISH_MONTH_PATTERN})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:[,\\s]+20\\d{2})?`, "iu"), "")
    .replace(new RegExp(`\\b(?:on\\s+)?\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${ENGLISH_MONTH_PATTERN})(?:[,\\s]+20\\d{2})?`, "iu"), "")
    .replace(new RegExp(`(?<!\\p{L})(?:ב-?\\s*)?\\d{1,2}\\s+ב?(?:${HEBREW_MONTH_PATTERN})(?:[,\\s]+20\\d{2})?`, "iu"), "")
    .replace(new RegExp(`(?<!\\p{L})(?:${HEBREW_MONTH_PATTERN})\\s+\\d{1,2}(?:[,\\s]+20\\d{2})?`, "iu"), "")
    .replace(/\b(?:on\s+)?20\d{2}-\d{1,2}-\d{1,2}\b|\b(?:on\s+)?\d{1,2}[/.\-]\d{1,2}(?:[/.\-](?:\d{2}|\d{4}))?\b/iu, "")
    .replace(new RegExp(`\\b(?:on\\s+)?(?:(?:next|this)\\s+)?(?:${ENGLISH_WEEKDAY_PATTERN})(?:\\s*,?\\s*(?:the\\s+)?\\d{1,2}(?:st|nd|rd|th)?)?\\b|\\b(?:on\\s+)?(?:the\\s+)?\\d{1,2}(?:st|nd|rd|th)\\b`, "iu"), "")
    .replace(new RegExp(`(?:(?:ב?יום\\s*)|ב)(?:${HEBREW_WEEKDAY_PATTERN})(?!\\p{L})|(?<!\\p{L})שבת(?!\\p{L})`, "iu"), "")
    .replace(/\b(?:day after tomorrow|tomorrow|today|tonight)\b|מחרתיים|מחר|היום|הערב/iu, "")
    .replace(/\b(?:at\s*)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b(?:at\s*)?\d{1,2}:\d{2}\b/iu, "")
    .replace(/(?:^|\s)בשעה\s*(?=$|[,;:–—-])/iu, " ")
    .replace(/\b(?:on|at|for)\s*$/iu, "")
    .replace(/\b(?:is|will be|happens|happening|takes place)\s*$/iu, "")
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/\bbirthday\b/iu.test(lower)) {
    const possessiveName = normalized.match(/([\p{L}][\p{L}.-]*)['’]s\s+birthday\b/iu)?.[1];
    const informalPossessiveName = normalized.match(/\bits\s+([\p{L}][\p{L}.-]*?)s\s+birthday\b/iu)?.[1];
    if (possessiveName || informalPossessiveName) title = `${possessiveName || informalPossessiveName}'s birthday`;
    else if (/\bmy birthday\b/iu.test(lower)) title = "My birthday";
    else title = title.replace(/^its\s+/iu, "") || "Birthday";
  } else if (/house party/iu.test(lower)) title = "House party";
  else if (/theat(?:er|re)/iu.test(lower)) title = title.length <= 4 ? "Theater" : title;
  else if (/shopping/iu.test(lower)) title = "Shopping";
  const joinedOwnerPlan = title.match(/^(.+?)\s+and\s+i\s+(?:are\s+)?going\s+(?:for|to)\s+(?:an?|the)?\s*(.+)$/iu);
  title = joinedOwnerPlan
    ? `${joinedOwnerPlan[2]} with ${joinedOwnerPlan[1]}`
    : (title || "Plan from message")
      .replace(/^(?:we|i)\s+(?:have|have got)\s+/iu, "")
      .replace(/^(?:we(?:'re| are)|i(?:'m| am)|let(?:'s| us)|going to)\s+/iu, "")
      .replace(/^(?:an?|the)\s+/iu, "")
      .replace(/[.?!]+$/u, "")
      .trim();
  title = title.charAt(0).toUpperCase() + title.slice(1);
  const locationMatch = normalized.match(/\b(?:at|in)\s+([A-Z][\p{L}\p{N}'’. -]{2,60})(?=\s+(?:on|at)\b|[,.!?]|$)/u);
  return { title: title.slice(0, 240), startAt: date.getTime(), allDay: false, location: locationMatch?.[1]?.trim() };
}

export class AmirosState {
  private readonly filePath: string;
  private persisted: PersistedState;
  private readonly drafts = new Map<string, AmirosDraft>();
  private paused = false;
  private connectionStatus: ConnectionStatus = "starting";
  private connectionDetail = "Starting WhatsApp";

  constructor(filePath = resolve("work/amiros-state.json")) {
    this.filePath = filePath;
    this.persisted = this.load();
    let migratedKnowledgeTracking = false;
    for (const [chatId, memory] of Object.entries(this.persisted.memories)) {
      // Existing derived intelligence is an unambiguous prior opt-in. Preserve
      // it during the new approval-gate migration; unknown chats still begin
      // in the pending state.
      if (
        !this.persisted.contacts[chatId] &&
        (memory.insights.length > 0 || memory.commitments.length > 0 || memory.events.length > 0 || memory.manualItems.length > 0 || memory.profile)
      ) {
        this.persisted.contacts[chatId] = { ...DEFAULT_CONTACT, knowledgeTracking: "enabled" };
        migratedKnowledgeTracking = true;
      }
    }
    const dedupedKnowledge = this.dedupeKnowledgeInsightsAcrossMemories();
    const dedupedCommitments = this.dedupeCommitmentsAcrossMemories();
    const clusteredKnowledge = this.clusterKnowledgeInsightsAcrossMemories();
    if (migratedKnowledgeTracking || dedupedKnowledge || dedupedCommitments || clusteredKnowledge) this.save();
    this.backfillCalendarEvents();
  }

  private load(): PersistedState {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<PersistedState>;
      const ownerDisplayName = parsed.ownerProfile?.displayName?.replace(/\s+/g, " ").trim().slice(0, 120)
        || DEFAULT_STATE.ownerProfile.displayName;
      return {
        theme:
          parsed.theme === "ocean" ||
          parsed.theme === "plum" ||
          parsed.theme === "sand" ||
          parsed.theme === "indigo" ||
          parsed.theme === "rose" ||
          parsed.theme === "graphite"
            ? parsed.theme
            : "forest",
        knowledgeTrackingDefault: normalizeKnowledgeTrackingDefault(parsed.knowledgeTrackingDefault),
        chatNames: Object.fromEntries(
          Object.entries(parsed.chatNames || {}).flatMap(([chatId, name]) => {
            const cleaned = typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, 120) : "";
            return cleaned ? [[chatId, cleaned]] : [];
          }),
        ),
        // Existing contacts were already being analysed before this preference
        // existed, so preserve that opt-in during migration. New chats use the
        // default "pending" state and must be explicitly approved by the user.
        contacts: Object.fromEntries(
          Object.entries(parsed.contacts || {}).map(([chatId, value]) => {
            const contact = value || {};
            return [chatId, {
              ...DEFAULT_CONTACT,
              ...contact,
              knowledgeTracking: normalizeKnowledgeTracking(
                (contact as Partial<ContactPreferences>).knowledgeTracking,
                "enabled",
              ),
              ownerTriggerAccess: normalizeOwnerTriggerAccess(
                (contact as Partial<ContactPreferences>).ownerTriggerAccess,
              ),
              contactTriggerAccess: normalizeContactTriggerAccess(
                (contact as Partial<ContactPreferences>).contactTriggerAccess,
              ),
            } satisfies ContactPreferences];
          }),
        ),
        memories: Object.fromEntries(
          Object.entries(parsed.memories || {}).flatMap(([chatId, memory]) => {
            if (!memory) return [];
            const isOwnerConversation = memory.chatName?.replace(/\s+/g, " ").trim() === ownerDisplayName;
            const entries = (Array.isArray(memory.entries) ? memory.entries : [])
              .filter(
                (entry): entry is ConversationMemoryEntry =>
                  Boolean(entry) &&
                  (entry.role === "user" || entry.role === "assistant") &&
                  typeof entry.content === "string",
              )
              .map((entry) => ({
                role: entry.role,
                author:
                  entry.author === "owner" || entry.author === "contact" || entry.author === "group_member" || entry.author === "assistant"
                    ? entry.author
                    : entry.role === "user" && isOwnerConversation
                      ? "owner" as const
                      : undefined,
                content: entry.content.trim().slice(0, 2_000),
                senderName: entry.senderName?.trim().slice(0, 120) || undefined,
                timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now(),
                messageId: entry.messageId?.trim().slice(0, 240) || undefined,
              }))
              .filter((entry) => entry.content.length > 0);
            const manualItems = (Array.isArray(memory.manualItems) ? memory.manualItems : [])
              .filter(
                (item): item is ContactMemoryItem =>
                  Boolean(item) && typeof item.id === "string" && typeof item.content === "string",
              )
              .slice(-100)
              .map((item): ContactMemoryItem => ({
                id: item.id.slice(0, 120),
                content: item.content.replace(/\s+/g, " ").trim().slice(0, 1_000),
                createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
              }))
              .filter((item) => item.content.length > 0);
            const profile = memory.profile && typeof memory.profile.summary === "string"
              ? {
                  summary: memory.profile.summary.trim().slice(0, 8_000),
                  updatedAt: Number.isFinite(memory.profile.updatedAt)
                    ? memory.profile.updatedAt
                    : Date.now(),
                  sourceMessageCount: Number.isFinite(memory.profile.sourceMessageCount)
                    ? Math.max(0, memory.profile.sourceMessageCount)
                    : 0,
                }
              : undefined;
            const insights = (Array.isArray(memory.insights) ? memory.insights : [])
              .filter((item): item is ContactInsight => Boolean(item) && typeof item.content === "string")
              .slice(-200)
              .map((item): ContactInsight => ({
                id: typeof item.id === "string" ? item.id.slice(0, 120) : randomUUID(),
                clusterId: typeof item.clusterId === "string" ? item.clusterId.slice(0, 120) : undefined,
                subjectChatIds: Array.isArray(item.subjectChatIds)
                  ? [...new Set(item.subjectChatIds.filter((value): value is string => typeof value === "string").map((value) => value.slice(0, 240)))].slice(0, 30)
                  : undefined,
                subjectNames: Array.isArray(item.subjectNames)
                  ? [...new Set(item.subjectNames.filter((value): value is string => typeof value === "string").map((value) => value.replace(/\s+/g, " ").trim().slice(0, 120)).filter(Boolean))].slice(0, 30)
                  : undefined,
                kind: item.kind === "preference" || item.kind === "relationship_change" || item.kind === "important_date" ? item.kind : "fact",
                content: item.content.replace(/\s+/g, " ").trim().slice(0, 1_000),
                status: item.status === "confirmed" || item.status === "outdated" ? item.status : "inferred",
                confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0.5)),
                evidence: {
                  messageId: item.evidence?.messageId?.slice(0, 240),
                  excerpt: (item.evidence?.excerpt || item.content).replace(/\s+/g, " ").trim().slice(0, 600),
                  senderName: item.evidence?.senderName?.replace(/\s+/g, " ").trim().slice(0, 120),
                  timestamp: Number.isFinite(item.evidence?.timestamp) ? item.evidence.timestamp : Date.now(),
                },
                createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
                updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now(),
              }))
              .filter((item) => item.content.length > 0);
            const commitments = (Array.isArray(memory.commitments) ? memory.commitments : [])
              .filter((item): item is RelationshipCommitment => Boolean(item) && typeof item.content === "string")
              .slice(-200)
              .map((item): RelationshipCommitment => ({
                id: typeof item.id === "string" ? item.id.slice(0, 120) : randomUUID(),
                content: item.content.replace(/\s+/g, " ").trim().slice(0, 1_000),
                owner: item.owner === "contact" || item.owner === "group_member" ? item.owner : "me",
                assigneeName: item.assigneeName?.replace(/\s+/g, " ").trim().slice(0, 120),
                status: item.status === "done" || item.status === "dismissed" ? item.status : "open",
                dueAt: Number.isFinite(item.dueAt) ? item.dueAt : undefined,
                evidence: {
                  messageId: item.evidence?.messageId?.slice(0, 240),
                  excerpt: (item.evidence?.excerpt || item.content).replace(/\s+/g, " ").trim().slice(0, 600),
                  senderName: item.evidence?.senderName?.replace(/\s+/g, " ").trim().slice(0, 120),
                  timestamp: Number.isFinite(item.evidence?.timestamp) ? item.evidence.timestamp : Date.now(),
                },
                createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
                updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now(),
              }))
              .filter((item) => item.content.length > 0);
            const events = (Array.isArray(memory.events) ? memory.events : [])
              .filter((item): item is CalendarEvent => Boolean(item) && typeof item.title === "string" && Number.isFinite(item.startAt))
              .slice(-2_200)
              .map((item): CalendarEvent => ({
                id: typeof item.id === "string" ? item.id.slice(0, 120) : randomUUID(),
                title: item.title.replace(/\s+/g, " ").trim().slice(0, 240),
                startAt: normalizeTimedEventStart(item.startAt, item.evidence?.excerpt || item.title, Boolean(item.allDay)),
                endAt: Number.isFinite(item.endAt) ? item.endAt : undefined,
                allDay: false,
                location: item.location?.replace(/\s+/g, " ").trim().slice(0, 240) || undefined,
                status: item.status === "confirmed" || item.status === "dismissed" ? item.status : "inferred",
                evidence: {
                  messageId: item.evidence?.messageId?.slice(0, 240),
                  excerpt: (item.evidence?.excerpt || item.title).replace(/\s+/g, " ").trim().slice(0, 600),
                  senderName: item.evidence?.senderName?.replace(/\s+/g, " ").trim().slice(0, 120),
                  timestamp: Number.isFinite(item.evidence?.timestamp) ? item.evidence.timestamp : Date.now(),
                },
                createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
                updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now(),
              }))
              .filter((item) => item.title.length > 0 && (item.status !== "inferred" || hasCalendarPlanIntent(item.evidence.excerpt)));
            const styleProfile = memory.styleProfile && typeof memory.styleProfile.summary === "string"
              ? {
                  summary: memory.styleProfile.summary.trim().slice(0, 4_000),
                  messageLength: String(memory.styleProfile.messageLength || "Unknown").slice(0, 120),
                  emojiUse: String(memory.styleProfile.emojiUse || "Unknown").slice(0, 120),
                  formality: String(memory.styleProfile.formality || "Unknown").slice(0, 120),
                  replyGuidance: (Array.isArray(memory.styleProfile.replyGuidance) ? memory.styleProfile.replyGuidance : []).map(String).slice(0, 8),
                  updatedAt: Number.isFinite(memory.styleProfile.updatedAt) ? memory.styleProfile.updatedAt : Date.now(),
                  sourceMessageCount: Number.isFinite(memory.styleProfile.sourceMessageCount) ? memory.styleProfile.sourceMessageCount : 0,
                  ownerMessageCountAtUpdate: Number.isFinite(memory.styleProfile.ownerMessageCountAtUpdate)
                    ? Math.max(0, memory.styleProfile.ownerMessageCountAtUpdate!)
                    : undefined,
                }
              : undefined;
            const groupSummary = memory.groupSummary && typeof memory.groupSummary.summary === "string"
              ? {
                  summary: memory.groupSummary.summary.trim().slice(0, 4_000),
                  decisions: (Array.isArray(memory.groupSummary.decisions) ? memory.groupSummary.decisions : []).map(String).slice(0, 20),
                  tasks: (Array.isArray(memory.groupSummary.tasks) ? memory.groupSummary.tasks : []).map(String).slice(0, 20),
                  unansweredQuestions: (Array.isArray(memory.groupSummary.unansweredQuestions) ? memory.groupSummary.unansweredQuestions : []).map(String).slice(0, 20),
                  participants: (Array.isArray(memory.groupSummary.participants) ? memory.groupSummary.participants : []).map(String).slice(0, 50),
                  updatedAt: Number.isFinite(memory.groupSummary.updatedAt) ? memory.groupSummary.updatedAt : Date.now(),
                  sourceMessageCount: Number.isFinite(memory.groupSummary.sourceMessageCount) ? memory.groupSummary.sourceMessageCount : 0,
                }
              : undefined;
            return entries.length > 0 || manualItems.length > 0 || profile || insights.length > 0 || commitments.length > 0 || events.length > 0 || styleProfile || groupSummary
              ? [[chatId, {
                  chatName: memory.chatName?.replace(/\s+/g, " ").trim().slice(0, 120) || undefined,
                  entries,
                  manualItems,
                  profile,
                  insights,
                  commitments,
                  events,
                  styleProfile,
                  groupSummary,
                  // Legacy histories have already been reviewed. Starting the
                  // cursor at their latest item prevents a restart from
                  // reopening their old suggestions.
                  lastKnowledgeAnalysisMessageId: memory.lastKnowledgeAnalysisMessageId?.trim().slice(0, 240)
                    || entries.at(-1)?.messageId,
                  lastKnowledgeAnalysisAt: Number.isFinite(memory.lastKnowledgeAnalysisAt)
                    ? memory.lastKnowledgeAnalysisAt
                    : entries.at(-1)?.timestamp,
                  incomingMessageCount: Number.isFinite(memory.incomingMessageCount)
                    ? Math.max(0, memory.incomingMessageCount)
                    : entries.filter((entry) => entry.role === "user").length,
                  updatedAt: memory.updatedAt || Date.now(),
                }]]
              : [];
          }),
        ),
        intelligenceHistory: (Array.isArray(parsed.intelligenceHistory) ? parsed.intelligenceHistory : [])
          .filter((item): item is IntelligenceQuestionHistoryItem =>
            Boolean(item) && typeof item.question === "string" && typeof item.answer === "string",
          )
          .slice(-30)
          .map((item) => ({
            id: typeof item.id === "string" ? item.id.slice(0, 120) : randomUUID(),
            question: item.question.replace(/\s+/g, " ").trim().slice(0, 500),
            answer: item.answer.trim().slice(0, 8_000),
            sources: (Array.isArray(item.sources) ? item.sources : []).slice(0, 12),
            createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
          }))
          .filter((item) => item.question && item.answer),
        quietHours: {
          enabled: parsed.quietHours?.enabled ?? DEFAULT_STATE.quietHours.enabled,
          start: parsed.quietHours?.start || DEFAULT_STATE.quietHours.start,
          end: parsed.quietHours?.end || DEFAULT_STATE.quietHours.end,
        },
        monthlyBudgetUsd:
          typeof parsed.monthlyBudgetUsd === "number"
            ? parsed.monthlyBudgetUsd
            : DEFAULT_STATE.monthlyBudgetUsd,
        monthlySpend:
          typeof parsed.monthlySpend?.month === "string" &&
          /^\d{4}-\d{2}$/u.test(parsed.monthlySpend.month) &&
          typeof parsed.monthlySpend.estimatedCostUsd === "number" &&
          Number.isFinite(parsed.monthlySpend.estimatedCostUsd) &&
          parsed.monthlySpend.estimatedCostUsd >= 0
            ? {
                month: parsed.monthlySpend.month,
                estimatedCostUsd: parsed.monthlySpend.estimatedCostUsd,
              }
            : undefined,
        assistant: {
          ...DEFAULT_STATE.assistant,
          ...parsed.assistant,
        },
        modelPreset:
          parsed.modelPreset === "economy" ||
          parsed.modelPreset === "balanced" ||
          parsed.modelPreset === "quality"
            ? parsed.modelPreset
            : undefined,
        models: parsed.models &&
          typeof parsed.models.text === "string" &&
          typeof parsed.models.image === "string" &&
          typeof parsed.models.voice === "string"
          ? {
              text: parsed.models.text.trim().slice(0, 120),
              image: parsed.models.image.trim().slice(0, 120),
              voice: parsed.models.voice.trim().slice(0, 120),
            }
          : undefined,
        ownerProfile: {
          displayName: ownerDisplayName,
          avatarUrl: parsed.ownerProfile?.avatarUrl?.trim().slice(0, 500) || DEFAULT_STATE.ownerProfile.avatarUrl,
        },
        activities: (Array.isArray(parsed.activities) ? parsed.activities : [])
          .filter((item): item is AmirosActivity => Boolean(item) && typeof item.title === "string" && typeof item.detail === "string")
          .slice(-1_000)
          .map((item) => ({
            id: typeof item.id === "string" ? item.id.slice(0, 120) : randomUUID(),
            kind: ["text", "voice", "image", "web", "system"].includes(item.kind) ? item.kind : "system",
            title: item.title.replace(/\s+/g, " ").trim().slice(0, 240),
            detail: item.detail.replace(/\s+/g, " ").trim().slice(0, 500),
            timestamp: Number.isFinite(item.timestamp) ? item.timestamp : Date.now(),
          })),
        outgoingMediaCaptions: Object.fromEntries(
          Object.entries(parsed.outgoingMediaCaptions || {}).flatMap(([chatId, captions]) => {
            const cleaned = (Array.isArray(captions) ? captions : [])
              .filter((item): item is OutgoingMediaCaption =>
                Boolean(item) && typeof item.caption === "string" && Number.isFinite(item.timestamp),
              )
              .slice(-100)
              .map((item) => ({
                caption: item.caption.trim().slice(0, 2_000),
                timestamp: item.timestamp,
              }))
              .filter((item) => item.caption.length > 0);
            return cleaned.length ? [[chatId, cleaned]] : [];
          }),
        ),
      };
    } catch {
      return structuredClone(DEFAULT_STATE);
    }
  }

  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(this.persisted, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporaryPath, this.filePath);
  }

  getContact(chatId: string): ContactPreferences {
    const stored = this.persisted.contacts[chatId];
    const defaultTracking = this.persisted.knowledgeTrackingDefault === "private"
      ? (chatId.endsWith("@g.us") ? "pending" : "enabled")
      : this.persisted.knowledgeTrackingDefault === "off"
        ? "disabled"
        : "pending";
    return {
      ...DEFAULT_CONTACT,
      ...stored,
      knowledgeTracking: normalizeKnowledgeTracking(stored?.knowledgeTracking, defaultTracking),
      ownerTriggerAccess: normalizeOwnerTriggerAccess(
        stored?.ownerTriggerAccess ?? DEFAULT_CONTACT.ownerTriggerAccess,
      ),
      contactTriggerAccess: normalizeContactTriggerAccess(
        stored?.contactTriggerAccess ?? DEFAULT_CONTACT.contactTriggerAccess,
      ),
    };
  }

  rememberChatNames(chats: Array<{ id: string; name?: string }>): void {
    let changed = false;
    for (const chat of chats) {
      const memory = this.persisted.memories[chat.id];
      const name = chat.name?.replace(/\s+/g, " ").trim().slice(0, 120);
      if (!name) continue;
      if (this.persisted.chatNames[chat.id] !== name) {
        this.persisted.chatNames[chat.id] = name;
        changed = true;
      }
      if (memory && memory.chatName !== name) {
        memory.chatName = name;
        changed = true;
      }
    }
    if (changed) this.save();
  }

  rememberChatName(chatId: string, name?: string): void {
    this.rememberChatNames([{ id: chatId, name }]);
  }

  getChatName(chatId: string): string | undefined {
    return this.persisted.memories[chatId]?.chatName || this.persisted.chatNames[chatId];
  }

  rememberOutgoingMediaCaption(chatId: string, caption: string, timestamp = Date.now()): void {
    const cleaned = caption.trim().slice(0, 2_000);
    if (!cleaned) return;
    const captions = this.persisted.outgoingMediaCaptions[chatId] || [];
    captions.push({ caption: cleaned, timestamp });
    this.persisted.outgoingMediaCaptions[chatId] = captions.slice(-100);
    this.save();
  }

  getOutgoingMediaCaptions(chatId: string): OutgoingMediaCaption[] {
    return [...(this.persisted.outgoingMediaCaptions[chatId] || [])];
  }

  updateContact(
    chatId: string,
    patch: Partial<ContactPreferences>,
  ): ContactPreferences {
    const current = this.getContact(chatId);
    const updated = {
      ...current,
      ...patch,
      ownerTriggerAccess: patch.ownerTriggerAccess === undefined
        ? current.ownerTriggerAccess
        : normalizeOwnerTriggerAccess(patch.ownerTriggerAccess),
      contactTriggerAccess: patch.contactTriggerAccess === undefined
        ? current.contactTriggerAccess
        : normalizeContactTriggerAccess(patch.contactTriggerAccess),
      knowledgeTracking: patch.knowledgeTracking === undefined
        ? current.knowledgeTracking
        : normalizeKnowledgeTracking(patch.knowledgeTracking),
    };
    this.persisted.contacts[chatId] = updated;
    if (patch.memoryEnabled === false) delete this.persisted.memories[chatId];
    this.save();
    return updated;
  }

  /**
   * Returns only messages that have not already been through the automatic
   * intelligence pipeline. The cursor advances only after a successful model
   * pass, so a transient API failure can be retried without losing a signal.
   */
  getUnanalyzedKnowledgeMessages(chatId: string, limit = 30): ConversationMemoryEntry[] {
    const memory = this.persisted.memories[chatId];
    if (!memory || this.getContact(chatId).knowledgeTracking !== "enabled") return [];
    const cursorIndex = memory.lastKnowledgeAnalysisMessageId
      ? memory.entries.findIndex((entry) => entry.messageId === memory.lastKnowledgeAnalysisMessageId)
      : -1;
    const afterCursor = cursorIndex >= 0
      ? memory.entries.slice(cursorIndex + 1)
      : memory.lastKnowledgeAnalysisAt
        ? memory.entries.filter((entry) => entry.timestamp > memory.lastKnowledgeAnalysisAt!)
        : memory.entries;
    return structuredClone(
      afterCursor
        .filter((entry) => entry.author !== "assistant" && Boolean(entry.content.trim()))
        .slice(0, Math.max(1, Math.min(60, Math.floor(limit)))),
    );
  }

  markKnowledgeMessagesAnalyzed(chatId: string, entries: ConversationMemoryEntry[]): void {
    const memory = this.persisted.memories[chatId];
    const latest = entries.at(-1);
    if (!memory || !latest) return;
    memory.lastKnowledgeAnalysisMessageId = latest.messageId || memory.lastKnowledgeAnalysisMessageId;
    memory.lastKnowledgeAnalysisAt = latest.timestamp;
    memory.updatedAt = Date.now();
    this.save();
  }

  getConversationMemory(chatId: string, limit = 100): ConversationMemoryEntry[] {
    if (!this.getContact(chatId).memoryEnabled) return [];
    const safeLimit = Math.max(1, Math.min(400, Math.floor(limit)));
    return structuredClone(this.persisted.memories[chatId]?.entries.slice(-safeLimit) || []);
  }

  getManualMemory(chatId: string): ContactMemoryItem[] {
    if (!this.getContact(chatId).memoryEnabled) return [];
    return structuredClone(this.persisted.memories[chatId]?.manualItems || []);
  }

  getContactProfile(chatId: string): ContactProfile | undefined {
    if (!this.getContact(chatId).memoryEnabled) return undefined;
    const profile = this.persisted.memories[chatId]?.profile;
    return profile ? structuredClone(profile) : undefined;
  }

  getIncomingMessageCount(chatId: string): number {
    return this.persisted.memories[chatId]?.incomingMessageCount || 0;
  }

  getInsights(chatId: string): ContactInsight[] {
    if (!this.getContact(chatId).memoryEnabled) return [];
    return structuredClone(this.persisted.memories[chatId]?.insights || []);
  }

  getCommitments(chatId: string): RelationshipCommitment[] {
    if (!this.getContact(chatId).memoryEnabled) return [];
    return structuredClone(this.persisted.memories[chatId]?.commitments || []);
  }

  getCalendarEvents(chatId: string): CalendarEvent[] {
    if (!this.getContact(chatId).memoryEnabled) return [];
    return structuredClone(this.persisted.memories[chatId]?.events || []);
  }

  listCalendarEvents(): Array<CalendarEvent & { chatId: string }> {
    return Object.entries(this.persisted.memories)
      .flatMap(([chatId, memory]) => memory.events
        .filter((event) => event.status !== "dismissed")
        .map((event) => ({ ...structuredClone(event), chatId })))
      .sort((a, b) => a.startAt - b.startAt);
  }

  getCalendarCaptureResult(
    chatId: string,
    content: string,
    timestamp = Date.now(),
    messageId?: string,
  ): CalendarCaptureResult {
    const keepBothFollowUp = isKeepBothCalendarFollowUp(content);
    const requested = hasCalendarPlanIntent(content) || keepBothFollowUp;

    if (keepBothFollowUp) {
      const recentRequest = [...(this.persisted.memories[chatId]?.entries || [])]
        .reverse()
        .find((entry) =>
          entry.role === "user" &&
          entry.messageId !== messageId &&
          timestamp >= entry.timestamp &&
          timestamp - entry.timestamp <= 30 * 60_000 &&
          hasExplicitCalendarCommand(entry.content) &&
          Boolean(inferCalendarEventFromMessage(entry.content, entry.timestamp)),
        );
      const recentEvent = recentRequest
        ? (this.persisted.memories[chatId]?.events || []).find((event) =>
          (Boolean(recentRequest.messageId) && event.evidence.messageId === recentRequest.messageId) ||
          this.isSameCalendarEvent(event, {
            ...inferCalendarEventFromMessage(recentRequest.content, recentRequest.timestamp)!,
            evidence: {
              messageId: recentRequest.messageId,
              excerpt: recentRequest.content,
              timestamp: recentRequest.timestamp,
            },
          }),
        )
        : undefined;
      if (recentEvent) {
        return {
          requested: true,
          status: recentEvent.status === "dismissed"
            ? "dismissed"
            : "already_exists",
          event: structuredClone(recentEvent),
        };
      }
      return {
        requested: true,
        status: "not_created",
        reason: recentRequest
          ? "The earlier calendar request was not saved, so AmirOS cannot truthfully confirm both events."
          : "AmirOS could not find a recent calendar request connected to this choice.",
      };
    }

    const inferred = inferCalendarEventFromMessage(content, timestamp);
    if (!inferred) {
      if (requested && isReferentialCalendarCommand(content)) {
        const recent = [...(this.persisted.memories[chatId]?.events || [])]
          .filter((event) => Math.abs(timestamp - event.evidence.timestamp) <= 30 * 60_000)
          .sort((left, right) => right.evidence.timestamp - left.evidence.timestamp)[0];
        if (recent) {
          return {
            requested: true,
            status: recent.status === "dismissed"
              ? "dismissed"
              : "already_exists",
            event: structuredClone(recent),
          };
        }
      }
      return {
        requested,
        status: "not_created",
        reason: requested
          ? "AmirOS could not resolve a specific day or date from the message."
          : "The message did not contain a concrete calendar plan.",
      };
    }

    const direct = this.getCalendarEvents(chatId).find((event) =>
      Boolean(messageId) && event.evidence.messageId === messageId,
    );
    if (direct) {
      return {
        requested: true,
        status: direct.status === "dismissed"
          ? "dismissed"
          : direct.status === "confirmed"
            ? "already_exists"
            : "created",
        event: direct,
      };
    }

    const matching = Object.entries(this.persisted.memories)
      .flatMap(([sourceChatId, memory]) => memory.events.map((event) => ({ ...event, chatId: sourceChatId })))
      .find((event) => this.isSameCalendarEvent(event, {
      title: inferred.title,
      startAt: inferred.startAt,
      evidence: { messageId, excerpt: content, timestamp },
      }));
    if (matching) {
      return {
        requested: true,
        status: matching.status === "dismissed" ? "dismissed" : "already_exists",
        event: matching,
      };
    }

    return {
      requested: true,
      status: "not_created",
      reason: "The calendar suggestion was not saved.",
    };
  }

  ownerAssistantContext(
    query: string,
    _currentChatId: string,
    access: {
      knowledge?: boolean;
      calendar?: boolean;
      requesterName?: string;
      ownerName?: string;
    } = { knowledge: true, calendar: true },
  ): OwnerAssistantContext {
    const relationship = access.knowledge
      ? this.resolveRelationshipKnowledge(query, access.requesterName, access.ownerName)
      : { knowledge: [], context: [] };
    const knowledge = access.knowledge
      ? (relationship.knowledge.length ? relationship.knowledge : this.searchIntelligence(query, 60))
        .filter((record) => record.kind !== "calendar_event")
      : [];
    const events = access.calendar
      ? this.listCalendarEvents()
        .filter((event) => event.startAt >= Date.now() - 86_400_000)
        .slice(0, 80)
        .map((event) => ({
          ...event,
          contactName: this.persisted.memories[event.chatId]?.chatName || event.evidence.senderName,
        }))
      : [];
    return { knowledge, events, relationshipContext: relationship.context };
  }

  updateCalendarEvent(
    chatId: string,
    eventId: string,
    patch: CalendarEventPatch,
  ): CalendarEvent | undefined {
    const memory = this.persisted.memories[chatId];
    const event = memory?.events.find((item) => item.id === eventId);
    if (!memory || !event) return undefined;
    if (patch.status) event.status = patch.status;
    if (patch.title !== undefined) {
      const title = patch.title.replace(/\s+/g, " ").trim().slice(0, 120);
      if (title) event.title = title;
    }
    const previousDuration = event.endAt && event.endAt > event.startAt
      ? event.endAt - event.startAt
      : 60 * 60 * 1_000;
    if (patch.startAt !== undefined && Number.isFinite(patch.startAt)) {
      event.startAt = patch.startAt;
      if (patch.endAt === undefined) event.endAt = event.startAt + previousDuration;
    }
    if (patch.endAt !== undefined && Number.isFinite(patch.endAt) && patch.endAt > event.startAt) {
      event.endAt = patch.endAt;
    }
    if (patch.location !== undefined) {
      event.location = patch.location.replace(/\s+/g, " ").trim().slice(0, 240) || undefined;
    }
    event.allDay = false;
    event.updatedAt = Date.now();
    memory.updatedAt = event.updatedAt;
    this.save();
    return structuredClone(event);
  }

  intelligenceQuestionHistory(limit = 12): IntelligenceQuestionHistoryItem[] {
    const safeLimit = Math.max(1, Math.min(30, Math.floor(limit)));
    return structuredClone(this.persisted.intelligenceHistory.slice(-safeLimit).reverse());
  }

  rememberIntelligenceAnswer(
    question: string,
    answer: string,
    sources: IntelligenceSearchRecord[],
  ): IntelligenceQuestionHistoryItem {
    const item = {
      id: randomUUID(),
      question: question.replace(/\s+/g, " ").trim().slice(0, 500),
      answer: answer.trim().slice(0, 8_000),
      sources: structuredClone(sources.slice(0, 12)),
      createdAt: Date.now(),
    };
    this.persisted.intelligenceHistory.push(item);
    this.persisted.intelligenceHistory = this.persisted.intelligenceHistory.slice(-30);
    this.save();
    return structuredClone(item);
  }

  getWritingStyleProfile(chatId: string): WritingStyleProfile | undefined {
    const profile = this.persisted.memories[chatId]?.styleProfile;
    return profile ? structuredClone(profile) : undefined;
  }

  getOwnerWritingMessages(chatId: string, limit = 120): string[] {
    if (!this.getContact(chatId).memoryEnabled) return [];
    const safeLimit = Math.max(1, Math.min(400, Math.floor(limit)));
    return (this.persisted.memories[chatId]?.entries || [])
      .filter((entry) => entry.author === "owner" && entry.content.trim().length > 0)
      .slice(-safeLimit)
      .map((entry) => entry.content);
  }

  getOwnerWritingMessageCount(chatId: string): number {
    if (!this.getContact(chatId).memoryEnabled) return 0;
    return (this.persisted.memories[chatId]?.entries || [])
      .filter((entry) => entry.author === "owner" && entry.content.trim().length > 0)
      .length;
  }

  getGroupSummary(chatId: string): GroupConversationSummary | undefined {
    const summary = this.persisted.memories[chatId]?.groupSummary;
    return summary ? structuredClone(summary) : undefined;
  }

  listKnowledgeTrackingRequests(): KnowledgeTrackingRequest[] {
    return Object.entries(this.persisted.memories)
      .flatMap(([chatId, memory]) => {
        const status = this.getContact(chatId).knowledgeTracking;
        if (status !== "pending") return [];
        const incoming = memory.entries.filter((entry) =>
          entry.role === "user" && (entry.author === "contact" || entry.author === "group_member"),
        );
        const latest = incoming.at(-1);
        const contactName = (memory.chatName || this.persisted.chatNames[chatId])?.replace(/\s+/g, " ").trim();
        if (!latest || !contactName) return [];
        return [{
          chatId,
          contactName,
          isGroup: chatId.endsWith("@g.us"),
          status,
          messageCount: incoming.length,
          latestMessageAt: latest.timestamp,
          preview: latest.content.slice(0, 280),
        } satisfies KnowledgeTrackingRequest];
      })
      .sort((left, right) => right.latestMessageAt - left.latestMessageAt);
  }

  intelligenceSnapshot(): IntelligenceChatSnapshot[] {
    return Object.entries(this.persisted.memories)
      .map(([chatId, memory]) => {
        let lastIncomingIndex = -1;
        let lastOutgoingIndex = -1;
        for (let index = memory.entries.length - 1; index >= 0; index -= 1) {
          const role = memory.entries[index]?.role;
          if (lastIncomingIndex < 0 && role === "user") lastIncomingIndex = index;
          if (lastOutgoingIndex < 0 && role === "assistant") lastOutgoingIndex = index;
          if (lastIncomingIndex >= 0 && lastOutgoingIndex >= 0) break;
        }
        return {
          chatId,
          insights: structuredClone(memory.insights || []),
          commitments: structuredClone(memory.commitments || []),
          events: structuredClone(memory.events || []),
          profile: memory.profile ? structuredClone(memory.profile) : undefined,
          styleProfile: memory.styleProfile ? structuredClone(memory.styleProfile) : undefined,
          groupSummary: memory.groupSummary ? structuredClone(memory.groupSummary) : undefined,
          needsReply: lastIncomingIndex >= 0 && lastIncomingIndex > lastOutgoingIndex,
          lastIncoming: lastIncomingIndex >= 0 ? structuredClone(memory.entries[lastIncomingIndex]) : undefined,
          updatedAt: memory.updatedAt,
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getKnownKnowledgeSubjectNames(): string[] {
    const names = Object.values(this.persisted.memories)
      .map((memory) => memory.chatName?.replace(/\s+/g, " ").trim())
      .filter((name): name is string => Boolean(name));
    names.push(this.persisted.ownerProfile.displayName);
    return [...new Set(names)].sort((left, right) => left.localeCompare(right));
  }

  mergeRoutedAnalyzedIntelligence(
    sourceChatId: string,
    input: {
      insights: Array<Pick<ContactInsight, "kind" | "content" | "confidence" | "evidence"> & { subjectNames?: string[] }>;
      commitments: Array<Pick<RelationshipCommitment, "content" | "owner" | "assigneeName" | "dueAt" | "evidence">>;
      events?: Array<Pick<CalendarEvent, "title" | "startAt" | "allDay" | "location" | "evidence">>;
    },
  ): {
    source: { insights: ContactInsight[]; commitments: RelationshipCommitment[]; events: CalendarEvent[] };
    targetChatIds: string[];
  } {
    type RoutedInsight = (typeof input.insights)[number] & Pick<ContactInsight, "clusterId" | "subjectChatIds" | "subjectNames">;
    const routedInsights = new Map<string, RoutedInsight[]>();
    for (const insight of input.insights) {
      const targets = this.resolveKnowledgeTargetChatIds(sourceChatId, insight.subjectNames || []);
      const existing = this.findKnowledgeInsightAcrossChats(insight.content, targets);
      const subjectChatIds = [...new Set([...(existing?.subjectChatIds || []), ...targets])];
      const subjectNames = [...new Set([
        ...(existing?.subjectNames || []),
        ...(insight.subjectNames || []),
        ...subjectChatIds.map((chatId) => this.persisted.memories[chatId]?.chatName).filter((name): name is string => Boolean(name)),
      ])];
      // A reviewed decision is a durable tombstone. Re-analysis may find the
      // same fact in another message, but it must not reopen the suggestion.
      if (existing && existing.status !== "inferred") continue;
      const routed: RoutedInsight = {
        ...insight,
        clusterId: existing?.clusterId || randomUUID(),
        subjectChatIds,
        subjectNames,
      };
      for (const chatId of targets) {
        const candidates = routedInsights.get(chatId) || [];
        candidates.push(routed);
        routedInsights.set(chatId, candidates);
      }
    }

    const source = this.mergeAnalyzedIntelligence(sourceChatId, {
      insights: routedInsights.get(sourceChatId) || [],
      commitments: input.commitments,
      events: input.events,
    });
    for (const [targetChatId, insights] of routedInsights) {
      if (targetChatId === sourceChatId) continue;
      this.mergeAnalyzedIntelligence(targetChatId, { insights, commitments: [], events: [] });
    }
    if (this.clusterKnowledgeInsightsAcrossMemories()) this.save();
    return { source, targetChatIds: [...routedInsights.keys()] };
  }

  updateInsight(
    chatId: string,
    insightId: string,
    patch: Partial<Pick<ContactInsight, "status" | "content">>,
  ): ContactInsight | undefined {
    const memory = this.persisted.memories[chatId];
    const insight = memory?.insights.find((item) => item.id === insightId);
    if (!memory || !insight) return undefined;
    const updatedAt = Date.now();
    const clusterId = insight.clusterId;
    const targets = Object.entries(this.persisted.memories).flatMap(([targetChatId, candidate]) => candidate.insights
      .filter((item) =>
        Boolean(clusterId && item.clusterId === clusterId) ||
        (item.kind === insight.kind && this.isDuplicateKnowledgeText(item.content, insight.content)),
      )
      .map((item) => ({ chatId: targetChatId, insight: item })));
    const affectedChatIds = new Set(targets.map((target) => target.chatId));
    for (const { insight: target } of targets) {
      if (patch.status) target.status = patch.status;
      if (patch.content?.trim()) target.content = patch.content.replace(/\s+/g, " ").trim().slice(0, 1_000);
      target.updatedAt = updatedAt;
    }
    for (const [candidateChatId, candidate] of Object.entries(this.persisted.memories)) {
      candidate.insights = this.dedupeKnowledgeInsights(candidate.insights);
      if (affectedChatIds.has(candidateChatId)) candidate.updatedAt = updatedAt;
    }
    memory.updatedAt = updatedAt;
    this.save();
    return structuredClone(insight);
  }

  updateCommitment(
    chatId: string,
    commitmentId: string,
    status: RelationshipCommitment["status"],
  ): RelationshipCommitment | undefined {
    const memory = this.persisted.memories[chatId];
    const commitment = memory?.commitments.find((item) => item.id === commitmentId);
    if (!memory || !commitment) return undefined;
    commitment.status = status;
    commitment.updatedAt = Date.now();
    memory.updatedAt = commitment.updatedAt;
    this.save();
    return structuredClone(commitment);
  }

  mergeAnalyzedIntelligence(
    chatId: string,
    input: {
      insights: Array<Pick<ContactInsight, "kind" | "content" | "confidence" | "evidence"> & Pick<ContactInsight, "clusterId" | "subjectChatIds" | "subjectNames">>;
      commitments: Array<Pick<RelationshipCommitment, "content" | "owner" | "assigneeName" | "dueAt" | "evidence">>;
      events?: Array<Pick<CalendarEvent, "title" | "startAt" | "allDay" | "location" | "evidence">>;
    },
  ): { insights: ContactInsight[]; commitments: RelationshipCommitment[]; events: CalendarEvent[] } {
    const memory = this.persisted.memories[chatId] || {
      entries: [], manualItems: [], insights: [], commitments: [], events: [], incomingMessageCount: 0, updatedAt: 0,
    };
    const now = Date.now();
    for (const candidate of input.insights.slice(0, 40)) {
      const content = candidate.content.replace(/\s+/g, " ").trim().slice(0, 1_000);
      if (!content) continue;
      if (memory.manualItems.some((item) => this.isDuplicateKnowledgeText(item.content, content))) continue;
      const existing = memory.insights.find((item) =>
        (candidate.clusterId && item.clusterId === candidate.clusterId) || this.isDuplicateKnowledgeText(item.content, content) || (
          item.kind === candidate.kind &&
          Boolean(candidate.evidence.messageId) &&
          item.evidence.messageId === candidate.evidence.messageId &&
          this.hasKnowledgeSubsetOverlap(item.content, content)
        ),
      );
      if (existing) {
        existing.confidence = Math.max(existing.confidence, Math.max(0, Math.min(1, candidate.confidence)));
        // Replace the lightweight local extraction with the richer AI wording, but
        // never silently rewrite knowledge that the user has already reviewed.
        if (existing.status === "inferred" && this.similarText(existing.content, existing.evidence.excerpt)) {
          existing.content = content;
          existing.evidence = this.cleanEvidence(candidate.evidence);
          existing.updatedAt = now;
        }
      } else {
        memory.insights.push({
          id: randomUUID(), clusterId: candidate.clusterId || randomUUID(),
          subjectChatIds: candidate.subjectChatIds ? [...new Set(candidate.subjectChatIds)] : [chatId],
          subjectNames: candidate.subjectNames ? [...new Set(candidate.subjectNames)] : undefined,
          kind: candidate.kind, content, status: "inferred",
          confidence: Math.max(0, Math.min(1, candidate.confidence)),
          evidence: this.cleanEvidence(candidate.evidence), createdAt: now, updatedAt: now,
        });
      }
    }
    for (const candidate of input.commitments.slice(0, 40)) {
      const content = candidate.content.replace(/\s+/g, " ").trim().slice(0, 1_000);
      if (!content || memory.commitments.some((item) => this.isDuplicateCommitment(item, candidate))) continue;
      memory.commitments.push({
        id: randomUUID(), content, owner: candidate.owner,
        assigneeName: candidate.assigneeName?.replace(/\s+/g, " ").trim().slice(0, 120),
        status: "open", dueAt: candidate.dueAt,
        evidence: this.cleanEvidence(candidate.evidence), createdAt: now, updatedAt: now,
      });
    }
    for (const candidate of (input.events || []).slice(0, 40)) {
      const title = candidate.title.replace(/\s+/g, " ").trim().slice(0, 240);
      if (!title || !Number.isFinite(candidate.startAt) || !hasCalendarPlanIntent(candidate.evidence.excerpt)) continue;
      const startAt = normalizeTimedEventStart(candidate.startAt, candidate.evidence.excerpt, candidate.allDay);
      const existing = memory.events.find((item) => this.isSameCalendarEvent(item, {
        title,
        startAt,
        evidence: candidate.evidence,
      }));
      if (existing) {
        if (existing.status === "confirmed" || existing.status === "dismissed") continue;
        existing.title = title;
        existing.startAt = startAt;
        existing.allDay = false;
        existing.location = candidate.location?.replace(/\s+/g, " ").trim().slice(0, 240) || undefined;
        existing.evidence = this.cleanEvidence(candidate.evidence);
        existing.updatedAt = now;
      } else {
        memory.events.push({
          id: randomUUID(), title, startAt, allDay: false,
          location: candidate.location?.replace(/\s+/g, " ").trim().slice(0, 240) || undefined,
          status: "inferred", evidence: this.cleanEvidence(candidate.evidence), createdAt: now, updatedAt: now,
        });
      }
    }
    memory.insights = this.dedupeKnowledgeInsights(memory.insights).slice(-200);
    memory.commitments = this.dedupeCommitments(memory.commitments).slice(-200);
    memory.events = memory.events.slice(-2_200);
    memory.updatedAt = now;
    this.persisted.memories[chatId] = memory;
    this.dedupeCalendarEventsAcrossChats();
    this.save();
    return { insights: structuredClone(memory.insights), commitments: structuredClone(memory.commitments), events: structuredClone(memory.events) };
  }

  setWritingStyleProfile(chatId: string, profile: Omit<WritingStyleProfile, "updatedAt">): WritingStyleProfile {
    const memory = this.persisted.memories[chatId] || {
      entries: [], manualItems: [], insights: [], commitments: [], events: [], incomingMessageCount: 0, updatedAt: 0,
    };
    const value = { ...profile, updatedAt: Date.now() };
    memory.styleProfile = value;
    memory.updatedAt = value.updatedAt;
    this.persisted.memories[chatId] = memory;
    this.save();
    return structuredClone(value);
  }

  setGroupSummary(chatId: string, summary: Omit<GroupConversationSummary, "updatedAt">): GroupConversationSummary {
    const memory = this.persisted.memories[chatId] || {
      entries: [], manualItems: [], insights: [], commitments: [], events: [], incomingMessageCount: 0, updatedAt: 0,
    };
    const value = { ...summary, updatedAt: Date.now() };
    memory.groupSummary = value;
    memory.updatedAt = value.updatedAt;
    this.persisted.memories[chatId] = memory;
    this.save();
    return structuredClone(value);
  }

  searchIntelligence(query: string, limit = 36, excludedChatIds = new Set<string>()): IntelligenceSearchRecord[] {
    const terms = this.searchTerms(query);
    const calendarIntent = /\b(schedule|calendar|agenda|plan|plans|event|events|appointment|week|today|tomorrow|upcoming|doing)\b|(?:לוח שנה|יומן|תוכניות|השבוע|מחר)/iu.test(query);
    const records: IntelligenceSearchRecord[] = [];
    for (const [chatId, memory] of Object.entries(this.persisted.memories)) {
      if (excludedChatIds.has(chatId)) continue;
      const push = (record: Omit<IntelligenceSearchRecord, "score">, boost = 0) => {
        const haystack = `${memory.chatName || ""} ${record.senderName || ""} ${record.content}`.toLocaleLowerCase();
        const matches = terms.reduce((score, term) => score + (haystack.includes(term) ? 3 : 0), 0);
        const recency = Math.max(0, 1 - (Date.now() - record.timestamp) / (180 * 86_400_000));
        records.push({ ...record, contactName: memory.chatName, score: matches + recency + boost });
      };
      memory.entries.forEach((entry, index) => {
        const sourceAuthor = entry.author === "owner" || entry.author === "contact" || entry.author === "group_member"
          ? entry.author
          : entry.role === "user"
            ? "contact" as const
            : undefined;
        if (!sourceAuthor) return;
        // Questions are useful as conversational context, but are not evidence.
        // Keeping them out of retrieval prevents old requests such as “Who is
        // Lionel?” from crowding out the factual answer about Lionel.
        const normalizedEntry = entry.content.replace(/\s+/g, " ").trim();
        const isQuestion = /\?|^(?:who|what|when|where|why|how|can|could|do|does|did|is|are|was|were|tell|show|use|please|let[’']?s|remind|i want|i need|make sure)\b|^(?:מי|מה|מתי|איפה|למה|איך|האם)\b/iu.test(normalizedEntry);
        if (isQuestion) return;
        push({
          id: entry.messageId || `${chatId}-message-${index}`, chatId, kind: "message",
          content: entry.content, senderName: entry.senderName, sourceAuthor, timestamp: entry.timestamp,
        }, sourceAuthor === "owner" ? 12 : 6);
      });
      memory.manualItems.forEach((item) => push({
        id: item.id,
        chatId,
        kind: "memory",
        content: item.content,
        sourceAuthor: "owner",
        status: "confirmed",
        timestamp: item.createdAt,
      }, 18));
      memory.insights.filter((item) => item.status !== "outdated").forEach((item) => push({
        id: item.id,
        chatId,
        kind: "insight",
        content: item.content,
        senderName: item.evidence.senderName,
        status: item.status,
        timestamp: item.updatedAt,
      }, item.status === "confirmed" ? 20 : 3));
      memory.commitments.filter((item) => item.status === "open").forEach((item) => push({ id: item.id, chatId, kind: "commitment", content: item.content, senderName: item.assigneeName, status: item.status, timestamp: item.updatedAt }));
      memory.events
        .filter((item) => item.status !== "dismissed" && item.startAt >= Date.now() - 86_400_000)
        .forEach((item) => push({
          id: item.id,
          chatId,
          kind: "calendar_event",
          content: `${item.title} — ${new Date(item.startAt).toLocaleString()}${item.location ? ` — ${item.location}` : ""}`,
          senderName: item.evidence.senderName,
          status: item.status,
          timestamp: item.startAt,
        }, calendarIntent ? 24 : 0));
      if (memory.profile) push({ id: `${chatId}-profile`, chatId, kind: "profile", content: memory.profile.summary, status: "confirmed", timestamp: memory.profile.updatedAt }, 16);
    }
    const hasMatches = records.some((record) => record.score >= 3);
    return records
      .filter((record) => !hasMatches || record.score >= 3)
      .sort((a, b) => b.score - a.score || b.timestamp - a.timestamp)
      .slice(0, Math.max(1, Math.min(80, limit)));
  }

  /**
   * Keyword retrieval alone cannot safely answer possessive relationship
   * questions. For example, a search for "my dad" can find Amir's dad and
   * miss the separate fact that Lionel is Dani's father. Resolve the person
   * first, then use the relationship record to fetch the named relative's
   * other saved facts.
   */
  private resolveRelationshipKnowledge(
    query: string,
    requesterName?: string,
    ownerName?: string,
  ): { knowledge: IntelligenceSearchRecord[]; context: string[] } {
    const relationship = this.relationshipQuestionTarget(query, requesterName, ownerName);
    if (!relationship) return { knowledge: [], context: [] };

    const aliases = relationship.kind === "father"
      ? ["dad", "father", "parent"]
      : relationship.kind === "mother"
        ? ["mom", "mother", "parent"]
        : ["parent", "parents"];
    const scopedQuery = `${query} ${relationship.personName} ${aliases.join(" ")}`;
    const initial = this.searchIntelligence(scopedQuery, 80);
    const familyRecords = initial.filter((record) =>
      this.extractNamedFamilySubjects(record.content, relationship.personName, aliases).length > 0,
    );
    const baseContext = [
      "RELATIONSHIP RESOLUTION (mandatory):",
      `- In this question, \"${relationship.reference}\" means ${relationship.personName}'s ${relationship.label}, not ${cleanRelationshipName(ownerName) || "Amir"}'s ${relationship.label}.`,
      `- Never transfer facts, health details, plans, or preferences between different people's ${relationship.label}s. Name the person the fact belongs to before giving sensitive details.`,
    ];

    // No evidence ties this relationship to a particular person. Returning no
    // relationship records is safer than letting a generic "dad" hit become a
    // false answer about the wrong family member.
    if (!familyRecords.length) {
      return {
        knowledge: [],
        context: [...baseContext, `- AmirOS has not found a saved record naming ${relationship.personName}'s ${relationship.label}; do not substitute another person's family details.`],
      };
    }

    const relatedNames = [...new Set(
      familyRecords.flatMap((record) => this.extractNamedFamilySubjects(record.content, relationship.personName, aliases)),
    )]
      .filter((name) => !this.samePersonName(name, relationship.personName))
      .slice(0, 8);
    const expandedQuery = `${scopedQuery} ${relatedNames.join(" ")}`;
    const expanded = this.searchIntelligence(expandedQuery, 80);
    const relevantNames = relatedNames.length ? relatedNames : [relationship.personName];
    const relatedKnowledge = expanded
      .filter((record) =>
        familyRecords.some((item) => item.id === record.id && item.chatId === record.chatId) ||
        relevantNames.some((name) => this.recordMentionsName(record, name)),
      )
      .sort((left, right) => {
        const rank = (record: IntelligenceSearchRecord) => {
          const mentionsRelative = relatedNames.some((name) => this.recordMentionsName(record, name));
          const isFamilyRecord = familyRecords.some((item) => item.id === record.id && item.chatId === record.chatId);
          const confirmed = record.status === "confirmed" ? 30 : 0;
          return (isFamilyRecord ? 200 : 0) + (mentionsRelative ? 90 : 0) + confirmed + record.score;
        };
        return rank(right) - rank(left) || right.timestamp - left.timestamp;
      })
      .slice(0, 60);

    const resolvedRelative = relatedNames.length ? relatedNames.join(", ") : "the saved family relationship";
    return {
      knowledge: relatedKnowledge,
      context: [
        ...baseContext,
        `- Saved relationship evidence identifies ${resolvedRelative} in connection with ${relationship.personName}'s ${relationship.label}. Use only facts that explicitly belong to that named person.`,
      ],
    };
  }

  private relationshipQuestionTarget(
    query: string,
    requesterName?: string,
    ownerName?: string,
  ): { personName: string; kind: "father" | "mother" | "parent"; label: string; reference: string } | undefined {
    const normalized = this.normalizedSearchText(query);
    const relationMatchers: Array<{ kind: "father" | "mother" | "parent"; label: string; words: string[] }> = [
      { kind: "father", label: "father", words: ["dad", "father"] },
      { kind: "mother", label: "mother", words: ["mom", "mother"] },
      { kind: "parent", label: "parent", words: ["parent", "parents"] },
    ];
    const knownPeople = this.relationshipKnownNames();
    const owner = this.resolveKnownPersonName(ownerName, knownPeople);
    const requester = this.resolveKnownPersonName(requesterName, knownPeople);
    // The requester is the strongest interpretation of an ambiguous first
    // name in a possessive question (for example Dani asking about “Dani's
    // dad”). It must outrank titles or group-derived aliases that happen to
    // begin with the same word.
    const people = [...new Set([requester, owner, ...knownPeople].filter((name): name is string => Boolean(name)))];

    for (const relation of relationMatchers) {
      for (const person of people) {
        const aliases = this.personNameAliases(person);
        for (const alias of aliases) {
          const word = relation.words.find((item) => new RegExp(`(?:^|\\s)${this.escapeSearchPattern(alias)}(?:\\s+s)?\\s+${item}(?:\\s|$)`, "iu").test(normalized));
          if (word) {
            return { personName: person, kind: relation.kind, label: relation.label, reference: `${alias}'s ${word}` };
          }
        }
      }
      if (/(?:^|\s)my\s+(dad|father|mom|mother|parent|parents)(?:\s|$)/iu.test(normalized) && requester) {
        const word = relation.words.find((item) => new RegExp(`(?:^|\\s)my\\s+${item}(?:\\s|$)`, "iu").test(normalized));
        if (word) return { personName: requester, kind: relation.kind, label: relation.label, reference: `my ${word}` };
      }
      if (/(?:^|\s)your\s+(dad|father|mom|mother|parent|parents)(?:\s|$)/iu.test(normalized) && owner) {
        const word = relation.words.find((item) => new RegExp(`(?:^|\\s)your\\s+${item}(?:\\s|$)`, "iu").test(normalized));
        if (word) return { personName: owner, kind: relation.kind, label: relation.label, reference: `your ${word}` };
      }
    }
    return undefined;
  }

  private relationshipKnownNames(): string[] {
    const names = new Set<string>();
    for (const [chatId, memory] of Object.entries(this.persisted.memories)) {
      // Group titles frequently begin with a participant's first name (for
      // example “Dani Amir Shelly Therapy”). They are conversations, not a
      // person, and must not win a possessive lookup for “Dani's dad”.
      if (!chatId.endsWith("@g.us")) {
        const chatName = cleanRelationshipName(memory.chatName);
        if (chatName) names.add(chatName);
      }
      for (const insight of memory.insights) {
        for (const subjectName of insight.subjectNames || []) {
          const name = cleanRelationshipName(subjectName);
          if (name) names.add(name);
        }
      }
    }
    return [...names]
      .filter((name) => name.split(/\s+/u).some((part) => /[\p{L}]/u.test(part)))
      .filter((name) => !/\b(?:group|community|therapy|birthday|chat)\b/iu.test(name))
      .sort((left, right) => right.length - left.length);
  }

  private resolveKnownPersonName(name: string | undefined, people: string[]): string | undefined {
    const cleaned = cleanRelationshipName(name);
    if (!cleaned) return undefined;
    const normalized = this.normalizedSearchText(cleaned);
    return people.find((candidate) => this.normalizedSearchText(candidate) === normalized)
      || people.find((candidate) => {
        const candidateName = this.normalizedSearchText(candidate);
        return candidateName.startsWith(`${normalized} `) || normalized.startsWith(`${candidateName} `);
      })
      || people.find((candidate) => this.samePersonName(candidate, cleaned))
      || cleaned;
  }

  private personNameAliases(name: string): string[] {
    const cleaned = this.normalizedSearchText(name);
    const first = cleaned.split(/\s+/u)[0];
    return [...new Set([cleaned, first].filter((value): value is string => Boolean(value && value.length >= 3)))];
  }

  private recordMentionsName(record: IntelligenceSearchRecord, name: string): boolean {
    const haystack = this.normalizedSearchText(`${record.contactName || ""} ${record.senderName || ""} ${record.content}`);
    return this.personNameAliases(name).some((alias) => new RegExp(`(?:^|\\s)${this.escapeSearchPattern(alias)}(?:\\s|$)`, "iu").test(haystack));
  }

  private extractNamedFamilySubjects(content: string, personName: string, relationAliases: string[]): string[] {
    const subjects = new Set<string>();
    const normalizedContent = this.normalizedSearchText(content);
    const personAliases = this.personNameAliases(personName);
    const knownNames = this.relationshipKnownNames();
    for (const personAlias of personAliases) {
      for (const relation of relationAliases) {
        const marker = `${personAlias} s ${relation}`;
        // Prefer canonical names already known to AmirOS. This normalized
        // comparison deliberately handles curly apostrophes and punctuation
        // consistently ("Dani's father" → "dani s father").
        for (const knownName of knownNames) {
          const known = this.normalizedSearchText(knownName);
          if (!known || this.samePersonName(knownName, personName)) continue;
          if (
            normalizedContent.includes(`${known} is ${marker}`) ||
            normalizedContent.includes(`${known} was ${marker}`) ||
            normalizedContent.includes(`${marker} is ${known}`) ||
            normalizedContent.includes(`${marker} was ${known}`)
          ) {
            subjects.add(knownName);
          }
        }
        // Fallback for natural variants such as “Lionel is Dani's and
        // Ariella's father”, where another sibling appears between Dani's
        // name and the relationship word. It is intentionally used only
        // after the target person's possessive form is present.
        const words = normalizedContent.split(/\s+/u);
        const relationIndex = words.lastIndexOf(relation);
        const targetIndex = normalizedContent.indexOf(`${personAlias} s`);
        const verbIndex = relationIndex > 0
          ? Math.max(words.lastIndexOf("is", relationIndex), words.lastIndexOf("was", relationIndex))
          : -1;
        if (targetIndex >= 0 && verbIndex > 0 && verbIndex < relationIndex) {
          const candidate = words.slice(Math.max(0, verbIndex - 2), verbIndex).join(" ");
          const canonical = this.resolveKnownPersonName(candidate, knownNames);
          if (canonical && !this.samePersonName(canonical, personName)) subjects.add(canonical);
        }
        // Handles common facts such as “Lionel Faitelson is Dani's father.”
        // The extraction only expands retrieval; the original saved evidence
        // is still supplied to the model and remains the factual source.
        const matcher = new RegExp(
          `(^|[.!?]\\s*)([\\p{Lu}][\\p{L}'’-]*(?:\\s+[\\p{Lu}][\\p{L}'’-]*){0,3})\\s+(?:is|was)\\s+(?:the\\s+)?${this.escapeSearchPattern(personAlias)}(?:'s|’s|\\s+s)?\\s+${relation}(?:[.!?,\\s]|$)`,
          "gu",
        );
        for (const match of content.matchAll(matcher)) {
          const candidate = cleanRelationshipName(match[2]);
          if (candidate) subjects.add(candidate);
        }
        // Also supports “Dani's father is Lionel Faitelson.”
        const reverseMatcher = new RegExp(
          `${this.escapeSearchPattern(personAlias)}(?:'s|’s|\\s+s)?\\s+${relation}\\s+(?:is|was)\\s+([\\p{Lu}][\\p{L}'’-]*(?:\\s+[\\p{Lu}][\\p{L}'’-]*){0,3})(?:[.!?,\\s]|$)`,
          "gu",
        );
        for (const match of content.matchAll(reverseMatcher)) {
          const candidate = cleanRelationshipName(match[1]);
          if (candidate) subjects.add(candidate);
        }
      }
    }
    return [...subjects];
  }

  private samePersonName(left: string, right: string): boolean {
    const a = this.normalizedSearchText(left);
    const b = this.normalizedSearchText(right);
    if (!a || !b) return false;
    return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `) || a.split(/\s+/u)[0] === b.split(/\s+/u)[0];
  }

  private normalizedSearchText(value: string | undefined): string {
    return (value || "")
      .toLocaleLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
  }

  private escapeSearchPattern(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  }

  rememberMessage(
    chatId: string,
    entry: Omit<ConversationMemoryEntry, "timestamp"> & {
      timestamp?: number;
      countAsIncoming?: boolean;
      extractSignals?: boolean;
    },
  ): void {
    this.rememberMessages(chatId, [entry]);
  }

  rememberMessages(
    chatId: string,
    entries: Array<Omit<ConversationMemoryEntry, "timestamp"> & {
      timestamp?: number;
      countAsIncoming?: boolean;
      extractSignals?: boolean;
    }>,
  ): number {
    const contactAtFirstMessage = this.getContact(chatId);
    if (!contactAtFirstMessage.memoryEnabled) return 0;
    const memory = this.persisted.memories[chatId] || {
      entries: [],
      manualItems: [],
      insights: [],
      commitments: [],
      events: [],
      incomingMessageCount: 0,
      updatedAt: 0,
    };
    const knownIds = new Set(memory.entries.flatMap((item) => item.messageId ? [item.messageId] : []));
    let added = 0;
    for (const entry of entries) {
      const content = entry.content.replace(/\s+/g, " ").trim().slice(0, 2_000);
      if (!content) continue;
      const messageId = entry.messageId?.trim().slice(0, 240) || undefined;
      if (messageId && knownIds.has(messageId)) continue;
      if (messageId) knownIds.add(messageId);
      const timestamp = entry.timestamp || Date.now();
      memory.entries.push({
        role: entry.role,
        author: entry.author,
        content,
        senderName: entry.senderName?.replace(/\s+/g, " ").trim().slice(0, 120) || undefined,
        timestamp,
        messageId,
      });
      if (
        entry.role === "user" &&
        this.getContact(chatId).knowledgeTracking === "enabled" &&
        (entry.countAsIncoming !== false || entry.extractSignals === true)
      ) {
        this.extractLocalSignals(memory, { content, senderName: entry.senderName, timestamp, messageId });
      }
      if (entry.role === "user" && entry.countAsIncoming !== false) {
        memory.incomingMessageCount += 1;
      }
      added += 1;
    }
    if (added === 0) return 0;
    // Freeze the first-run policy when a conversation actually receives a
    // message. Changing the global default later must not silently change a
    // chat that is already waiting for the user's approval.
    if (!this.persisted.contacts[chatId]) this.persisted.contacts[chatId] = contactAtFirstMessage;
    memory.updatedAt = Date.now();
    this.persisted.memories[chatId] = memory;
    this.dedupeCalendarEventsAcrossChats();
    this.save();
    return added;
  }

  private extractLocalSignals(
    memory: ConversationMemory,
    entry: { content: string; senderName?: string; timestamp: number; messageId?: string },
  ): void {
    const text = entry.content;
    const lower = text.toLocaleLowerCase();
    const evidence = this.cleanEvidence({
      messageId: entry.messageId,
      excerpt: text,
      senderName: entry.senderName,
      timestamp: entry.timestamp,
    });
    const addInsight = (kind: ContactInsight["kind"], confidence: number) => {
      if (memory.insights.some((item) => this.similarText(item.content, text))) return;
      const now = Date.now();
      memory.insights.push({
        id: randomUUID(), kind, content: text, status: "inferred", confidence,
        evidence, createdAt: now, updatedAt: now,
      });
    };
    if (/\b(i (?:really )?(?:like|love|prefer|hate|don't like)|my favou?rite)\b|אני (?:אוהב|אוהבת|מעדיף|מעדיפה|שונא|שונאת)/iu.test(lower)) {
      addInsight("preference", 0.76);
    } else if (/\b(my (?:birthday|job|role|address|phone|email) is|i (?:work|live|moved|started))\b|(?:יום ההולדת שלי|אני עובד|אני עובדת|אני גר|אני גרה)/iu.test(lower)) {
      addInsight(/birthday|יום ההולדת/iu.test(lower) ? "important_date" : "fact", 0.72);
    }

    let owner: RelationshipCommitment["owner"] | undefined;
    if (/\b(can you|could you|would you|please|don't forget|remind me)\b|(?:תוכל|תוכלי|אפשר שת|אל תשכח|אל תשכחי)/iu.test(lower)) {
      owner = "me";
    } else if (/\b(i['’]?ll|i will|let me|i can send|i can do)\b|(?:אני א|אני יכול|אני יכולה)/iu.test(lower)) {
      owner = entry.senderName ? "group_member" : "contact";
    }
    if (owner && !memory.commitments.some((item) => item.status === "open" && this.similarText(item.content, text))) {
      const now = Date.now();
      memory.commitments.push({
        id: randomUUID(), content: text, owner, assigneeName: entry.senderName,
        status: "open", evidence, createdAt: now, updatedAt: now,
      });
    }
    this.addCalendarSignal(memory, entry);
    memory.insights = memory.insights.slice(-200);
    memory.commitments = memory.commitments.slice(-200);
    memory.events = memory.events.slice(-200);
  }

  private addCalendarSignal(
    memory: ConversationMemory,
    entry: { content: string; senderName?: string; timestamp: number; messageId?: string },
  ): boolean {
    const inferred = inferCalendarEventFromMessage(entry.content, entry.timestamp);
    if (!inferred) return false;
    const sender = entry.senderName?.replace(/\s+/g, " ").trim().split(" ")[0];
    if (sender) {
      if (inferred.title === "House party") inferred.title = `${sender}'s house party`;
      else if (/^Meeting$/iu.test(inferred.title)) inferred.title = `Meeting with ${sender}`;
      else if (/^Coffee$/iu.test(inferred.title)) inferred.title = `Coffee with ${sender}`;
      else if (/^Dinner$/iu.test(inferred.title)) inferred.title = `Dinner with ${sender}`;
      else if (/^Birthday(?: party)?$/iu.test(inferred.title)) inferred.title = `${sender}'s birthday`;
    }
    const duplicate = memory.events.find((item) => this.isSameCalendarEvent(item, {
      title: inferred.title,
      startAt: inferred.startAt,
      evidence: { messageId: entry.messageId, excerpt: entry.content, timestamp: entry.timestamp },
    }));
    if (duplicate) {
      const replacesAmbiguousInference =
        duplicate.status === "inferred" &&
        hasExplicitCalendarCommand(entry.content) &&
        hasExplicitCalendarTime(entry.content) &&
        !hasExplicitCalendarTime(duplicate.evidence.excerpt);
      if (!replacesAmbiguousInference) return false;
      duplicate.title = inferred.title;
      duplicate.startAt = inferred.startAt;
      duplicate.endAt = undefined;
      duplicate.allDay = false;
      duplicate.location = inferred.location;
      duplicate.evidence = this.cleanEvidence({
        messageId: entry.messageId,
        excerpt: entry.content,
        senderName: entry.senderName,
        timestamp: entry.timestamp,
      });
      duplicate.updatedAt = Date.now();
      return true;
    }
    const now = Date.now();
    memory.events.push({
      id: randomUUID(),
      ...inferred,
      status: "inferred",
      evidence: this.cleanEvidence({
        messageId: entry.messageId,
        excerpt: entry.content,
        senderName: entry.senderName,
        timestamp: entry.timestamp,
      }),
      createdAt: now,
      updatedAt: now,
    });
    return true;
  }

  private backfillCalendarEvents(): void {
    let changed = false;
    for (const [chatId, memory] of Object.entries(this.persisted.memories)) {
      memory.events ||= [];
      for (const entry of memory.entries) {
        if (entry.role !== "user") continue;
        changed = this.addCalendarSignal(memory, entry) || changed;
      }
      memory.events = memory.events.slice(-2_200);
    }
    changed = this.dedupeCalendarEventsAcrossChats() || changed;
    if (changed) this.save();
  }

  private dedupeCalendarEventsAcrossChats(): boolean {
    const references = Object.entries(this.persisted.memories).flatMap(([chatId, memory]) =>
      memory.events.map((event) => ({ chatId, event })),
    );
    const removed = new Set<string>();
    const key = (chatId: string, eventId: string) => `${chatId}\u001f${eventId}`;
    const priority = (event: CalendarEvent) =>
      (event.status === "confirmed" ? 30 : event.status === "dismissed" ? 20 : 10)
      + (event.evidence.messageId ? 2 : 0)
      + Math.min(1, Math.max(0, event.updatedAt / 10_000_000_000_000));
    for (let leftIndex = 0; leftIndex < references.length; leftIndex += 1) {
      const left = references[leftIndex]!;
      if (removed.has(key(left.chatId, left.event.id))) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < references.length; rightIndex += 1) {
        const right = references[rightIndex]!;
        if (left.chatId === right.chatId || removed.has(key(right.chatId, right.event.id))) continue;
        if (!this.isSameCalendarEvent(left.event, {
          title: right.event.title,
          startAt: right.event.startAt,
          evidence: right.event.evidence,
        })) continue;
        const removeLeft = priority(right.event) > priority(left.event);
        removed.add(removeLeft ? key(left.chatId, left.event.id) : key(right.chatId, right.event.id));
        if (removeLeft) break;
      }
    }
    if (removed.size === 0) return false;
    for (const [chatId, memory] of Object.entries(this.persisted.memories)) {
      memory.events = memory.events.filter((event) => !removed.has(key(chatId, event.id)));
    }
    return true;
  }

  private resolveKnowledgeTargetChatIds(sourceChatId: string, subjectNames: string[]): string[] {
    const normalize = (value: string) => value
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    const records = Object.entries(this.persisted.memories)
      .map(([chatId, memory]) => ({
        chatId,
        name: normalize(memory.chatName || ""),
      }))
      .filter((record) => Boolean(record.name));
    const ownerName = normalize(this.persisted.ownerProfile.displayName);
    const ownerFirstName = ownerName.split(" ")[0] || ownerName;
    const targetIds = new Set<string>();

    for (const rawSubject of subjectNames) {
      let subject = normalize(rawSubject);
      if (!subject) continue;
      if (["i", "me", "myself", "the owner", "owner"].includes(subject)) subject = ownerName;
      if (subject === ownerFirstName) subject = ownerName;

      const exact = records.filter((record) => record.name === subject);
      if (exact.length > 0) {
        for (const record of exact) targetIds.add(record.chatId);
        continue;
      }

      const firstNameMatches = records.filter((record) => record.name.split(" ")[0] === subject);
      if (firstNameMatches.length === 1) {
        targetIds.add(firstNameMatches[0]!.chatId);
        continue;
      }

      const containedMatches = records.filter((record) =>
        subject.length >= 3 && (record.name.startsWith(`${subject} `) || subject.startsWith(`${record.name} `)),
      );
      if (containedMatches.length === 1) targetIds.add(containedMatches[0]!.chatId);
    }

    if (targetIds.size === 0) targetIds.add(sourceChatId);
    return [...targetIds];
  }

  private cleanEvidence(evidence: MemoryEvidence): MemoryEvidence {
    return {
      messageId: evidence.messageId?.trim().slice(0, 240) || undefined,
      excerpt: evidence.excerpt.replace(/\s+/g, " ").trim().slice(0, 600),
      senderName: evidence.senderName?.replace(/\s+/g, " ").trim().slice(0, 120) || undefined,
      timestamp: Number.isFinite(evidence.timestamp) ? evidence.timestamp : Date.now(),
    };
  }

  private similarText(left: string, right: string): boolean {
    const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const a = normalize(left);
    const b = normalize(right);
    return a === b || (a.length > 24 && b.length > 24 && (a.includes(b) || b.includes(a)));
  }

  private knowledgeTokens(value: string): Set<string> {
    const aliases: Record<string, string> = {
      favourite: "like", favorite: "like", favourites: "like", favorites: "like",
      love: "like", loves: "like", loved: "like", liking: "like", likes: "like",
      prefer: "like", prefers: "like", preferred: "like", preference: "like",
      dislike: "dislike", dislikes: "dislike", disliked: "dislike", hate: "dislike", hates: "dislike",
      mom: "mother", mum: "mother", mommy: "mother", mama: "mother",
      dad: "father", daddy: "father", papa: "father",
      partner: "partner", partners: "partner", relationship: "partner",
      reside: "live", resides: "live", residing: "live", lives: "live", lived: "live", living: "live",
      birthdays: "birthday", born: "birthday",
      restaurants: "restaurant", movies: "movie", films: "movie",
    };
    const ignored = new Set([
      "a", "an", "and", "are", "as", "at", "be", "been", "being", "by", "for", "from", "has", "have",
      "he", "her", "hers", "him", "his", "i", "in", "is", "it", "its", "me", "my", "of", "on", "or",
      "our", "ours", "s", "she", "that", "the", "their", "theirs", "them", "they", "this", "to", "was",
      "we", "were", "with", "you", "your", "yours",
      "את", "אני", "אנחנו", "אתה", "אתם", "אתן", "ב", "ה", "הוא", "היא", "הם", "הן", "ו", "זה", "זאת",
      "כי", "כל", "לא", "ל", "לי", "מה", "מי", "מ", "על", "עם", "של", "ש",
    ]);
    const tokens = value
      .normalize("NFKD")
      .toLocaleLowerCase()
      .replace(/\p{M}/gu, "")
      .replace(/\b(\d+)(?:st|nd|rd|th)\b/gu, "$1")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .split(/\s+/u)
      .filter(Boolean)
      .map((token) => aliases[token] || token)
      .map((token) => token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token)
      .filter((token) => !ignored.has(token) && (token.length > 1 || /^\d+$/u.test(token)));
    return new Set(tokens);
  }

  private hasMeaningfulKnowledgeOverlap(left: string, right: string): boolean {
    const leftTokens = this.knowledgeTokens(left);
    const rightTokens = this.knowledgeTokens(right);
    if (leftTokens.size === 0 || rightTokens.size === 0) return false;
    const leftNumbers = new Set([...leftTokens].filter((token) => /^\d+$/u.test(token)));
    const rightNumbers = new Set([...rightTokens].filter((token) => /^\d+$/u.test(token)));
    if (leftNumbers.size > 0 && rightNumbers.size > 0 &&
      (leftNumbers.size !== rightNumbers.size || [...leftNumbers].some((token) => !rightNumbers.has(token)))) return false;
    const negated = (value: string) => /\b(?:not|no|never|don['’]?t|doesn['’]?t|didn['’]?t)\b|(?:לא|אינו|אינה|בלי)/iu.test(value);
    if (negated(left) !== negated(right)) return false;
    const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
    const smaller = Math.min(leftTokens.size, rightTokens.size);
    const union = new Set([...leftTokens, ...rightTokens]).size;
    const containment = intersection / smaller;
    const jaccard = intersection / union;
    return intersection >= 3 && containment >= 0.75 && jaccard >= 0.45;
  }

  private hasKnowledgeSubsetOverlap(left: string, right: string): boolean {
    const leftTokens = this.knowledgeTokens(left);
    const rightTokens = this.knowledgeTokens(right);
    if (leftTokens.size === 0 || rightTokens.size === 0) return false;
    const leftNumbers = new Set([...leftTokens].filter((token) => /^\d+$/u.test(token)));
    const rightNumbers = new Set([...rightTokens].filter((token) => /^\d+$/u.test(token)));
    if (leftNumbers.size > 0 && rightNumbers.size > 0 &&
      (leftNumbers.size !== rightNumbers.size || [...leftNumbers].some((token) => !rightNumbers.has(token)))) return false;
    const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
    return intersection >= 3 && intersection / Math.min(leftTokens.size, rightTokens.size) >= 0.7;
  }

  private isDuplicateKnowledgeText(left: string, right: string): boolean {
    return this.similarText(left, right) || this.hasMeaningfulKnowledgeOverlap(left, right);
  }

  private dedupeKnowledgeInsights(insights: ContactInsight[]): ContactInsight[] {
    const withoutReplacedLocalExtractions = insights.filter((insight) => {
      if (insight.status !== "inferred" || !insight.evidence.messageId ||
        !this.similarText(insight.content, insight.evidence.excerpt)) return true;
      return !insights.some((other) =>
        other.id !== insight.id &&
        other.kind === insight.kind &&
        other.evidence.messageId === insight.evidence.messageId &&
        !this.similarText(other.content, other.evidence.excerpt) &&
        this.hasKnowledgeSubsetOverlap(insight.content, other.content),
      );
    });
    const kept: ContactInsight[] = [];
    const statusPriority = (status: ContactInsight["status"]) =>
      status === "confirmed" ? 3 : status === "outdated" ? 2 : 1;
    for (const insight of withoutReplacedLocalExtractions) {
      const duplicateIndex = kept.findIndex((item) =>
        Boolean(item.clusterId && insight.clusterId && item.clusterId === insight.clusterId) ||
        this.isDuplicateKnowledgeText(item.content, insight.content),
      );
      if (duplicateIndex < 0) {
        kept.push(insight);
        continue;
      }
      const current = kept[duplicateIndex]!;
      const replacement = statusPriority(insight.status) > statusPriority(current.status) ? insight : current;
      replacement.confidence = Math.max(current.confidence, insight.confidence);
      replacement.createdAt = Math.min(current.createdAt, insight.createdAt);
      replacement.updatedAt = Math.max(current.updatedAt, insight.updatedAt);
      replacement.clusterId ||= current.clusterId || insight.clusterId;
      replacement.subjectChatIds = [...new Set([...(current.subjectChatIds || []), ...(insight.subjectChatIds || [])])];
      replacement.subjectNames = [...new Set([...(current.subjectNames || []), ...(insight.subjectNames || [])])];
      kept[duplicateIndex] = replacement;
    }
    return kept;
  }

  private dedupeKnowledgeInsightsAcrossMemories(): boolean {
    let changed = false;
    for (const memory of Object.values(this.persisted.memories)) {
      const deduped = this.dedupeKnowledgeInsights(memory.insights);
      if (deduped.length === memory.insights.length) continue;
      memory.insights = deduped;
      changed = true;
    }
    return changed;
  }

  private clusterKnowledgeInsightsAcrossMemories(): boolean {
    const references = Object.entries(this.persisted.memories).flatMap(([chatId, memory]) =>
      memory.insights.map((insight) => ({ chatId, chatName: memory.chatName, insight })),
    );
    let changed = false;
    const statusPriority = (status: ContactInsight["status"]) =>
      status === "confirmed" ? 3 : status === "outdated" ? 2 : 1;
    for (let leftIndex = 0; leftIndex < references.length; leftIndex += 1) {
      const left = references[leftIndex]!;
      for (let rightIndex = leftIndex + 1; rightIndex < references.length; rightIndex += 1) {
        const right = references[rightIndex]!;
        if (left.chatId === right.chatId) continue;
        const sameEvidence = Boolean(left.insight.evidence.messageId) &&
          left.insight.evidence.messageId === right.insight.evidence.messageId;
        const sameCluster = Boolean(left.insight.clusterId) && left.insight.clusterId === right.insight.clusterId;
        if (!sameCluster && !(sameEvidence && this.isDuplicateKnowledgeText(left.insight.content, right.insight.content))) continue;

        const clusterId = left.insight.clusterId || right.insight.clusterId || randomUUID();
        const subjectChatIds = [...new Set([
          ...(left.insight.subjectChatIds || []), ...(right.insight.subjectChatIds || []), left.chatId, right.chatId,
        ])];
        const subjectNames = [...new Set([
          ...(left.insight.subjectNames || []), ...(right.insight.subjectNames || []), left.chatName, right.chatName,
        ].filter((value): value is string => Boolean(value)))];
        const status = statusPriority(left.insight.status) >= statusPriority(right.insight.status)
          ? left.insight.status
          : right.insight.status;
        for (const insight of [left.insight, right.insight]) {
          if (insight.clusterId !== clusterId || insight.status !== status ||
            JSON.stringify(insight.subjectChatIds || []) !== JSON.stringify(subjectChatIds) ||
            JSON.stringify(insight.subjectNames || []) !== JSON.stringify(subjectNames)) changed = true;
          insight.clusterId = clusterId;
          insight.status = status;
          insight.subjectChatIds = subjectChatIds;
          insight.subjectNames = subjectNames;
        }
      }
    }
    return changed;
  }

  private findKnowledgeInsightAcrossChats(content: string, targetChatIds: string[]): ContactInsight | undefined {
    const targets = new Set(targetChatIds);
    return Object.entries(this.persisted.memories)
      .filter(([chatId]) => targets.has(chatId))
      .flatMap(([, memory]) => memory.insights)
      .find((insight) => this.isDuplicateKnowledgeText(insight.content, content));
  }

  private isDuplicateCommitment(
    existing: RelationshipCommitment,
    candidate: Pick<RelationshipCommitment, "content" | "owner" | "assigneeName" | "dueAt">,
  ): boolean {
    if (existing.owner !== candidate.owner) return false;
    const assignee = (value?: string) => value?.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() || "";
    if (assignee(existing.assigneeName) && assignee(candidate.assigneeName) && assignee(existing.assigneeName) !== assignee(candidate.assigneeName)) return false;
    if (existing.dueAt && candidate.dueAt && Math.abs(existing.dueAt - candidate.dueAt) > 12 * 3_600_000) return false;
    if (this.similarText(existing.content, candidate.content) || this.hasMeaningfulKnowledgeOverlap(existing.content, candidate.content)) return true;
    const meaningfulTokens = (value: string) => new Set(value
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/u)
      .filter((token) => token.length >= 3 && !new Set([
        "the", "and", "for", "about", "into", "look", "looking", "contact", "reach", "will",
        "part", "time", "role", "job", "position", "need", "needs", "keep", "promise",
      ]).has(token))
      .map((token) => token.replace(/(?:ing|ers?|ed|s)$/u, ""))
      .filter((token) => token.length >= 3));
    const leftTokens = meaningfulTokens(existing.content);
    const rightTokens = meaningfulTokens(candidate.content);
    if (leftTokens.size === 0 || rightTokens.size === 0) return false;
    const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
    return shared >= 2 && shared / Math.min(leftTokens.size, rightTokens.size) >= 0.6;
  }

  private dedupeCommitments(commitments: RelationshipCommitment[]): RelationshipCommitment[] {
    const kept: RelationshipCommitment[] = [];
    const priority = (status: RelationshipCommitment["status"]) => status === "done" ? 3 : status === "dismissed" ? 2 : 1;
    for (const commitment of commitments) {
      const index = kept.findIndex((existing) => this.isDuplicateCommitment(existing, commitment));
      if (index < 0) {
        kept.push(commitment);
        continue;
      }
      const current = kept[index]!;
      const replacement = priority(commitment.status) > priority(current.status) ? commitment : current;
      replacement.createdAt = Math.min(current.createdAt, commitment.createdAt);
      replacement.updatedAt = Math.max(current.updatedAt, commitment.updatedAt);
      kept[index] = replacement;
    }
    return kept;
  }

  private dedupeCommitmentsAcrossMemories(): boolean {
    let changed = false;
    for (const memory of Object.values(this.persisted.memories)) {
      const deduped = this.dedupeCommitments(memory.commitments);
      if (deduped.length === memory.commitments.length) continue;
      memory.commitments = deduped;
      changed = true;
    }
    return changed;
  }

  private isSameCalendarEvent(
    existing: CalendarEvent,
    candidate: { title: string; startAt: number; evidence: MemoryEvidence },
  ): boolean {
    const sameEvidence =
      (Boolean(candidate.evidence.messageId) && existing.evidence.messageId === candidate.evidence.messageId) ||
      (existing.evidence.timestamp === candidate.evidence.timestamp &&
        this.similarText(existing.evidence.excerpt, candidate.evidence.excerpt));
    if (sameEvidence) return true;
    const timeDifference = Math.abs(existing.startAt - candidate.startAt);
    if (timeDifference >= 12 * 3_600_000) return false;
    if (
      timeDifference >= 30 * 60_000 &&
      hasExplicitCalendarTime(existing.evidence.excerpt) &&
      hasExplicitCalendarTime(candidate.evidence.excerpt)
    ) return false;
    const normalizedExistingTitle = existing.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const normalizedCandidateTitle = candidate.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const titleContainsOther = Math.min(normalizedExistingTitle.length, normalizedCandidateTitle.length) >= 5 && (
      normalizedExistingTitle === normalizedCandidateTitle ||
      normalizedExistingTitle.startsWith(`${normalizedCandidateTitle} `) ||
      normalizedCandidateTitle.startsWith(`${normalizedExistingTitle} `)
    );
    return titleContainsOther || this.similarText(existing.title, candidate.title) || this.calendarTopicOverlap(
      `${existing.title} ${existing.evidence.excerpt}`,
      `${candidate.title} ${candidate.evidence.excerpt}`,
    );
  }

  private calendarTopicOverlap(left: string, right: string): boolean {
    const ignored = new Set([
      "the", "and", "that", "this", "next", "with", "from", "into", "for", "you", "your",
      "our", "are", "was", "were", "will", "dont", "forget", "remember", "reminder", "please",
      "add", "added", "put", "save", "saved", "create", "created", "schedule", "scheduled", "suggest", "suggested",
      "today", "tomorrow", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
      "morning", "afternoon", "evening", "night", "event", "calendar", "babe", "hello",
    ]);
    const tokens = (value: string) => new Set(
      value.toLocaleLowerCase()
        .normalize("NFKD")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .split(/\s+/u)
        .filter((token) =>
          token.length >= 3 &&
          !ignored.has(token) &&
          !/^\d+$/.test(token) &&
          !/^\d{1,2}(?::\d{2})?(?:am|pm)$/.test(token),
        ),
    );
    const a = tokens(left);
    const b = tokens(right);
    if (a.size < 2 || b.size < 2) return false;
    let shared = 0;
    for (const token of a) if (b.has(token)) shared += 1;
    return shared >= 2 && shared / Math.min(a.size, b.size) >= 0.5;
  }

  private searchTerms(query: string): string[] {
    const stop = new Set([
      "the", "a", "an", "and", "or", "to", "of", "with", "about", "who", "what", "when", "where",
      "did", "do", "does", "i", "me", "my", "we", "our", "is", "are", "was", "were", "in", "on", "at",
    ]);
    return [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [])]
      .filter((term) => !stop.has(term));
  }

  addManualMemory(chatId: string, content: string): ContactMemoryItem {
    if (!this.getContact(chatId).memoryEnabled) {
      throw new Error("Enable contact memory before adding a memory item");
    }
    const normalized = content.replace(/\s+/g, " ").trim().slice(0, 1_000);
    if (!normalized) throw new Error("Memory item cannot be empty");
    const memory = this.persisted.memories[chatId] || {
      entries: [],
      manualItems: [],
      insights: [],
      commitments: [],
      events: [],
      incomingMessageCount: 0,
      updatedAt: 0,
    };
    const item = { id: randomUUID(), content: normalized, createdAt: Date.now() };
    memory.manualItems.push(item);
    memory.manualItems = memory.manualItems.slice(-100);
    memory.updatedAt = Date.now();
    this.persisted.memories[chatId] = memory;
    this.save();
    return structuredClone(item);
  }

  removeManualMemory(chatId: string, itemId: string): boolean {
    const memory = this.persisted.memories[chatId];
    if (!memory) return false;
    const originalLength = memory.manualItems.length;
    memory.manualItems = memory.manualItems.filter((item) => item.id !== itemId);
    if (memory.manualItems.length === originalLength) return false;
    memory.updatedAt = Date.now();
    this.save();
    return true;
  }

  setContactProfile(chatId: string, summary: string): ContactProfile {
    const normalized = summary.trim().slice(0, 8_000);
    if (!normalized) throw new Error("Contact profile cannot be empty");
    const memory = this.persisted.memories[chatId] || {
      entries: [],
      manualItems: [],
      insights: [],
      commitments: [],
      events: [],
      incomingMessageCount: 0,
      updatedAt: 0,
    };
    const profile = {
      summary: normalized,
      updatedAt: Date.now(),
      sourceMessageCount: memory.incomingMessageCount,
    };
    memory.profile = profile;
    memory.updatedAt = profile.updatedAt;
    this.persisted.memories[chatId] = memory;
    this.save();
    return structuredClone(profile);
  }

  rememberExchange(
    chatId: string,
    userMessage: string,
    assistantMessage: string,
    senderName?: string,
    countAsIncoming = true,
    author: ConversationMemoryEntry["author"] = countAsIncoming ? "contact" : "owner",
  ): void {
    if (!this.getContact(chatId).memoryEnabled) return;
    const now = Date.now();
    this.rememberMessage(chatId, {
      role: "user",
      content: userMessage,
      senderName,
      author,
      timestamp: now,
      countAsIncoming,
    });
    this.rememberMessage(chatId, {
      role: "assistant",
      author: "assistant",
      content: assistantMessage,
      timestamp: now + 1,
    });
  }

  contactModes(): Record<string, ReplyMode> {
    return Object.fromEntries(
      Object.entries(this.persisted.contacts).map(([id, value]) => [id, value.mode]),
    );
  }

  addDraft(input: Omit<AmirosDraft, "id" | "createdAt" | "status">): AmirosDraft {
    const draft: AmirosDraft = {
      ...input,
      id: randomUUID(),
      createdAt: Date.now(),
      status: "pending",
    };
    this.drafts.set(draft.id, draft);
    this.addActivity("text", "AI draft prepared", input.contactName);
    return draft;
  }

  listDrafts(): AmirosDraft[] {
    return [...this.drafts.values()]
      .filter((draft) => draft.status === "pending")
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  getDraft(id: string): AmirosDraft | undefined {
    return this.drafts.get(id);
  }

  setDraftStatus(id: string, status: AmirosDraft["status"]): void {
    const draft = this.drafts.get(id);
    if (draft) draft.status = status;
  }

  addActivity(
    kind: AmirosActivity["kind"],
    title: string,
    detail: string,
  ): AmirosActivity {
    const activity = { id: randomUUID(), kind, title, detail, timestamp: Date.now() };
    this.persisted.activities.unshift(activity);
    this.persisted.activities.splice(1_000);
    this.save();
    return activity;
  }

  listActivities(limit = 20): AmirosActivity[] {
    return structuredClone(this.persisted.activities.slice(0, Math.max(1, Math.min(1_000, limit))));
  }

  removeIntelligenceQuestion(id: string): boolean {
    const before = this.persisted.intelligenceHistory.length;
    this.persisted.intelligenceHistory = this.persisted.intelligenceHistory.filter((item) => item.id !== id);
    if (before === this.persisted.intelligenceHistory.length) return false;
    this.save();
    return true;
  }

  updateOwnerProfile(patch: Partial<OwnerProfile>): OwnerProfile {
    this.persisted.ownerProfile = {
      displayName: patch.displayName?.replace(/\s+/g, " ").trim().slice(0, 120) || this.persisted.ownerProfile.displayName,
      avatarUrl: patch.avatarUrl?.trim().slice(0, 500) || this.persisted.ownerProfile.avatarUrl,
    };
    this.save();
    return structuredClone(this.persisted.ownerProfile);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.addActivity(
      "system",
      paused ? "Assistant paused" : "Assistant resumed",
      paused ? "Incoming commands are temporarily ignored" : "Listening for messages",
    );
  }

  isPaused(): boolean {
    return this.paused;
  }

  setConnection(status: ConnectionStatus, detail: string): void {
    this.connectionStatus = status;
    this.connectionDetail = detail;
    this.addActivity("system", `WhatsApp ${status}`, detail);
  }

  connection(): { status: ConnectionStatus; detail: string } {
    return { status: this.connectionStatus, detail: this.connectionDetail };
  }

  getSettings(): PersistedState {
    const settings = structuredClone(this.persisted);
    settings.memories = {};
    settings.intelligenceHistory = [];
    settings.activities = [];
    return settings;
  }

  updateSettings(
    patch: Partial<
      Pick<PersistedState, "theme" | "quietHours" | "monthlyBudgetUsd" | "modelPreset" | "models" | "knowledgeTrackingDefault">
    > & {
      assistant?: Partial<AssistantSettings>;
      ownerProfile?: Partial<OwnerProfile>;
    },
  ): PersistedState {
    this.persisted = {
      ...this.persisted,
      ...patch,
      quietHours: patch.quietHours
        ? { ...this.persisted.quietHours, ...patch.quietHours }
        : this.persisted.quietHours,
      assistant: patch.assistant
        ? { ...this.persisted.assistant, ...patch.assistant }
        : this.persisted.assistant,
      ownerProfile: patch.ownerProfile
        ? { ...this.persisted.ownerProfile, ...patch.ownerProfile }
        : this.persisted.ownerProfile,
    };
    this.save();
    return this.getSettings();
  }

  monthlySpendUsd(date = new Date()): number {
    const month = date.toISOString().slice(0, 7);
    return this.persisted.monthlySpend?.month === month
      ? this.persisted.monthlySpend.estimatedCostUsd
      : 0;
  }

  recordAiSpend(estimatedCostUsd: number, date = new Date()): void {
    if (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd <= 0) return;
    const month = date.toISOString().slice(0, 7);
    const current = this.persisted.monthlySpend?.month === month
      ? this.persisted.monthlySpend.estimatedCostUsd
      : 0;
    this.persisted.monthlySpend = {
      month,
      estimatedCostUsd: Number((current + estimatedCostUsd).toFixed(8)),
    };
    this.save();
  }

  isQuietHoursNow(date = new Date()): boolean {
    const { enabled, start, end } = this.persisted.quietHours;
    if (!enabled) return false;
    const currentMinutes = date.getHours() * 60 + date.getMinutes();
    const toMinutes = (value: string) => {
      const [hours = 0, minutes = 0] = value.split(":").map(Number);
      return hours * 60 + minutes;
    };
    const startMinutes = toMinutes(start);
    const endMinutes = toMinutes(end);
    return startMinutes <= endMinutes
      ? currentMinutes >= startMinutes && currentMinutes < endMinutes
      : currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}
