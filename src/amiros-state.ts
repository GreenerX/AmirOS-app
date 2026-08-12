import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isDueDateQuery, isWithinTemporalRange, resolveTemporalRange } from "./temporal-memory.js";
import { parseExplicitClockTime, stripExplicitClockTime } from "./temporal-classifier.js";
import type { CachedReplyAssessment } from "./reply-needed.js";
import { presentTodo } from "./todo-presentation.js";
import { assessKnowledgeFreshness, type KnowledgeFreshness } from "./memory-maintenance.js";
import { explainContactInsight, type MemoryExplanation } from "./memory-explainability.js";
import {
  buildRelationshipIntelligence,
  filterRelationshipRecordsForQuestion,
  type RelationshipIntelligenceResult,
} from "./relationship-intelligence.js";
import {
  normalizeOwnerRecordReferences,
  normalizePendingOwnerLifecycleClarification,
  type OwnerRecordReference,
  type PendingOwnerLifecycleClarification,
} from "./owner-lifecycle.js";
import {
  PROACTIVE_AI_POLICY_VERSION,
  type ProactiveAiJudgmentBatch,
  type ProactiveCandidateKind,
  type ProactiveDeliveryDecision,
} from "./proactive-intelligence.js";

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

/**
 * Deliberately explicit rather than inferred from a name, photo, or writing
 * style. This belongs to one direct contact and is ignored for group chats.
 */
export type ContactPronouns = "unspecified" | "she/her" | "he/him" | "they/them";

export type ContactPreferences = {
  mode: ReplyMode;
  relationship: string;
  /** Keeps a favorite contact at the top of the People directory. */
  pinned: boolean;
  /** Removes a contact from ordinary People collections without deleting data. */
  hidden: boolean;
  tone: string;
  language: string;
  pronouns: ContactPronouns;
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
  /** WhatsApp mention IDs captured with the message when available. */
  mentionIds?: string[];
  /** True when WhatsApp confirmed that the owner was mentioned in this message. */
  ownerMentioned?: boolean;
  /**
   * Keeps a message available as private conversation context without letting
   * the automatic intelligence pipeline turn it into a suggestion. This is
   * used for explicit self-chat commands sent to AmirOS.
   */
  excludeFromAutomaticLearning?: boolean;
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
  /** The newest canonical fact included when this derived prose was generated. */
  sourceKnowledgeUpdatedAt?: number;
  sourceKnowledgeVersion?: string;
  /** Derived prose is ignored once canonical truth materially changes. */
  staleAt?: number;
  staleReason?: "canonical_knowledge_changed";
};

export type MemoryEvidence = {
  messageId?: string;
  excerpt: string;
  senderName?: string;
  timestamp: number;
  /** Identifies an authoritative write explicitly requested through WhatsApp. */
  source?: "whatsapp_bot";
};

export type ContactInsight = {
  id: string;
  clusterId?: string;
  subjectChatIds?: string[];
  subjectNames?: string[];
  kind: "fact" | "preference" | "relationship_change" | "important_date";
  content: string;
  /** AI-authored display projection; content remains the canonical insight. */
  topicTitle?: string;
  topicTitleConfidence?: number;
  /** Stable semantic identity used to evolve one fact instead of accumulating rewordings. */
  canonicalKey?: string;
  /** Current facts drive People/Ask AmirOS; historical facts remain retrievable when relevant. */
  validity?: "current" | "historical" | "temporary";
  /** How new evidence relates to other facts sharing the canonical key. */
  evolution?: "reinforce" | "replace" | "append";
  supersededById?: string;
  supersededAt?: number;
  reinforcementCount?: number;
  lastReinforcedAt?: number;
  /** Audit trail for high-confidence facts AmirOS accepted without a review card. */
  autonomouslyConfirmedAt?: number;
  autonomousConfirmationReason?: "direct_owner_statement" | "direct_contact_statement";
  /** Audit trail for maintenance promotion based on repeated independent evidence. */
  maintenanceConfirmedAt?: number;
  maintenanceConfirmationReason?: "repeated_direct_evidence";
  /** Computed projection used by UI/API responses; never replaces validity. */
  freshness?: KnowledgeFreshness;
  /** Derived explanation projection used by UI/API responses; never persisted as source of truth. */
  explanation?: MemoryExplanation;
  status: "inferred" | "confirmed" | "outdated";
  confidence: number;
  evidence: MemoryEvidence;
  /** Every source message that supports this canonical insight. */
  evidenceHistory?: MemoryEvidence[];
  createdAt: number;
  updatedAt: number;
};

type AnalyzedInsight = Pick<ContactInsight, "kind" | "content" | "confidence" | "evidence"> &
  Partial<Pick<ContactInsight,
    "topicTitle" | "topicTitleConfidence" | "canonicalKey" | "validity" | "evolution" |
    "status" | "autonomouslyConfirmedAt" | "autonomousConfirmationReason"
  >>;

/**
 * A model score alone is not trustworthy enough to rewrite long-term memory.
 * This threshold is intentionally paired with direct-source and uncertainty
 * checks in `autonomousConfirmationFor`, rather than used on its own.
 */
export const AUTONOMOUS_KNOWLEDGE_CONFIDENCE = 0.94;

export type RelationshipCommitment = {
  id: string;
  content: string;
  owner: "me" | "contact" | "group_member";
  assigneeName?: string;
  status: "open" | "needs_review" | "done" | "dismissed";
  dueAt?: number;
  note?: string;
  evidence: MemoryEvidence;
  /** Every source message that supports this canonical commitment. */
  evidenceHistory?: MemoryEvidence[];
  createdAt: number;
  updatedAt: number;
};

export type RelationshipCommitmentPatch = {
  status?: RelationshipCommitment["status"];
  content?: string;
  dueAt?: number | null;
  note?: string;
};

/** Product review window for unresolved relationship obligations; deliberately reversible. */
export const RELATIONSHIP_REVIEW_WINDOW_MS = 5 * 24 * 60 * 60 * 1_000;

export function relationshipCommitmentStatus(
  commitment: RelationshipCommitment,
  now = Date.now(),
): RelationshipCommitment["status"] {
  if (commitment.status !== "open" && commitment.status !== "needs_review") return commitment.status;
  const toMilliseconds = (value: number) => value > 0 && value < 10_000_000_000 ? value * 1_000 : value;
  const evidenceAt = [commitment.evidence, ...(commitment.evidenceHistory || [])]
    .reduce((latest, item) => Math.max(latest, toMilliseconds(item.timestamp)), 0);
  const dueAt = commitment.dueAt ? toMilliseconds(commitment.dueAt) : 0;
  const relevantAt = Math.max(evidenceAt, dueAt);
  return relevantAt > 0 && now - relevantAt > RELATIONSHIP_REVIEW_WINDOW_MS ? "needs_review" : "open";
}

/**
 * A personal action for the owner. Unlike a commitment, this is deliberately
 * owner-only: it is surfaced as a reviewable to-do and never represents a
 * promise someone else made.
 */
export type TodoTask = {
  id: string;
  /** A short, owner-facing next action, for example "Call the dentist". */
  title: string;
  /**
   * `inferred` tasks still need a decision, `open` tasks were accepted by the
   * owner, and the remaining states are durable review decisions.
   */
  status: "inferred" | "open" | "done" | "dismissed";
  /** The owner's preferred ordering for an accepted to-do. */
  priority: "low" | "normal" | "high";
  dueAt?: number;
  note?: string;
  /** Set when the owner checks the task off; completed tasks are never deleted. */
  completedAt?: number;
  evidence: MemoryEvidence;
  createdAt: number;
  updatedAt: number;
};

export type TodoTaskPatch = {
  status?: TodoTask["status"];
  title?: string;
  dueAt?: number | null;
  priority?: TodoTask["priority"];
  note?: string;
};

export type CalendarEvent = {
  id: string;
  title: string;
  startAt: number;
  endAt?: number;
  allDay: boolean;
  location?: string;
  note?: string;
  /** Locally cached generated artwork used by Today’s Focus. */
  imageUrl?: string;
  status: "inferred" | "confirmed" | "completed" | "dismissed";
  completedAt?: number;
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
  imageUrl?: string;
  note?: string;
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
  todos: TodoTask[];
  pendingOwnerActionClarification?: PendingOwnerActionClarification;
  pendingOwnerLifecycleClarification?: PendingOwnerLifecycleClarification;
  ownerRecordReferences?: OwnerRecordReference[];
  styleProfile?: WritingStyleProfile;
  groupSummary?: GroupConversationSummary;
  /** Cursor for automatic relationship analysis, so old messages are never re-scanned. */
  lastKnowledgeAnalysisMessageId?: string;
  lastKnowledgeAnalysisAt?: number;
  incomingMessageCount: number;
  updatedAt: number;
};

export type PendingOwnerActionClarification = {
  kind: "todo";
  source: string;
  title: string;
  dueAt: number;
  needsTimeClarification: true;
  messageId?: string;
  sourceTimestamp: number;
  createdAt: number;
};

const OWNER_ACTION_CLARIFICATION_TTL_MS = 30 * 60_000;

export type IntelligenceSearchRecord = {
  id: string;
  chatId: string;
  contactName?: string;
  kind: "message" | "memory" | "insight" | "commitment" | "todo" | "profile" | "calendar_event";
  content: string;
  senderName?: string;
  sourceAuthor?: "owner" | "contact" | "group_member";
  status?: string;
  knowledgeValidity?: ContactInsight["validity"];
  knowledgeFreshness?: KnowledgeFreshness;
  knowledgeNeedsQualification?: boolean;
  explanation?: MemoryExplanation;
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
  todos: TodoTask[];
  profile?: ContactProfile;
  styleProfile?: WritingStyleProfile;
  groupSummary?: GroupConversationSummary;
  needsReply: boolean;
  lastIncoming?: ConversationMemoryEntry;
  /** Latest human message in either direction; independent of intelligence record updates. */
  lastInteraction?: ConversationMemoryEntry;
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
  timeFormat: "12-hour" | "24-hour";
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
  /** AI decisions for only ambiguous reply cases; keyed by one chat and a context fingerprint. */
  replyAssessments: Record<string, CachedReplyAssessment>;
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
  /** Delivery/attention state only; canonical memory remains in `memories`. */
  proactiveDelivery: Record<string, ProactiveDeliveryDecision>;
  /** Cached AI attention editing, keyed by deterministic evidence fingerprints. */
  proactiveJudgments: Record<string, ProactiveAiJudgmentBatch>;
};

const DEFAULT_CONTACT: ContactPreferences = {
  mode: "off",
  relationship: "Contact",
  pinned: false,
  hidden: false,
  tone: "Warm & concise",
  language: "Automatic",
  pronouns: "unspecified",
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

function normalizeContactPronouns(value: unknown): ContactPronouns {
  return value === "she/her" || value === "he/him" || value === "they/them"
    ? value
    : "unspecified";
}

const DEFAULT_STATE: PersistedState = {
  theme: "forest",
  knowledgeTrackingDefault: "ask",
  chatNames: {},
  contacts: {},
  memories: {},
  replyAssessments: {},
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
    timeFormat: "12-hour",
  },
  ownerProfile: {
    // This is only used for a fresh install. Existing local profiles are
    // preserved, while onboarding asks every new person for their own name.
    displayName: "You",
    avatarUrl: "/profile-avatars/avatar-01.png",
  },
  activities: [],
  outgoingMediaCaptions: {},
  proactiveDelivery: {},
  proactiveJudgments: {},
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
  const explicitTime = parseExplicitClockTime(evidence);
  // WhatsApp message text is the source of truth for a time the sender wrote.
  // This corrects occasional model timezone shifts such as "12pm" becoming 1pm.
  if (explicitTime) {
    date.setHours(explicitTime.hour, explicitTime.minute, 0, 0);
    return date.getTime();
  }
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

/**
 * Returns true only for a concrete next action that the owner can actually do.
 * This is deliberately narrower than commitment detection: a plan, a date, or
 * a statement that another person needs something is not automatically a to-do.
 */
export function hasTodoTaskIntent(content: string): boolean {
  const normalized = content.replace(/\s+/g, " ").trim();
  const lower = normalized.toLocaleLowerCase();
  if (!normalized) return false;

  const newsLike = /\b(?:breaking|top headlines?|news update|according to|reported|report says|published|killed|strikes?|election|markets?)\b|(?:חדשות|כותרות|דיווח|דווח|נהרג|תקיפה|בחירות)/iu.test(lower);
  const linkHeavy = /(?:https?:\/\/|www\.|t\.me\/)/iu.test(lower) && normalized.length > 120;
  if (newsLike || linkHeavy) return false;

  const action = /\b(?:call|text|message|email|reply|follow[ -]?up|check|buy|pick up|drop off|bring|book|pay|order|send|return|collect|prepare|write|read|review|contact|ask|confirm|cancel|reschedule|fix|make|take|leave|organize|arrange|remind)\b|(?:תתקשר|תתקשרי|להתקשר|תשלח|תשלחי|לשלוח|תענה|תעני|לענות|תקנה|תקני|לקנות|תאסוף|תאספי|לאסוף|תביא|תביאי|להביא|תקבע|תקבעי|לקבוע|תשלם|תשלמי|לשלם|תבדוק|תבדקי|לבדוק|תכתוב|תכתבי|לכתוב|תשאל|תשאלי|לשאול|תאשר|תאשרי|לאשר|תזכיר|תזכירי|לזכור)/iu.test(lower);
  if (!action) return false;

  const ownerDirected = /\b(?:can|could|would|will)\s+you\b.{0,90}\b(?:call|text|message|email|reply|follow[ -]?up|check|buy|pick up|drop off|bring|book|pay|order|send|return|collect|prepare|write|read|review|contact|ask|confirm|cancel|reschedule|fix|make|take|leave|organize|arrange)\b|\b(?:please|don't forget|do not forget|remember to|remind me to|i need you to|you need to|make sure to)\b.{0,100}|(?:תוכל|תוכלי|אפשר|בבקשה|אל תשכח|אל תשכחי|תזכיר|תזכירי|צריך שת|צריכה שת).{0,100}/iu.test(lower);
  const ownerStated = /\b(?:i need to|i have to|i should|i must|todo|to-do)\b.{0,100}\b(?:call|text|message|email|reply|follow[ -]?up|check|buy|pick up|drop off|bring|book|pay|order|send|return|collect|prepare|write|read|review|contact|ask|confirm|cancel|reschedule|fix|make|take|leave|organize|arrange)\b|(?:אני צריך|אני צריכה|אני חייב|אני חייבת|אני צריך לעשות|תזכיר לי).{0,100}/iu.test(lower);
  return ownerDirected || ownerStated;
}

/**
 * An action phrase alone is not enough to make a personal to-do. In group
 * conversations we require positive evidence that it belongs to the owner:
 * either the owner wrote it or a participant clearly addressed them. This
 * guards against turning "I need to…" from another member into Amir's task.
 */
export function isOwnerTodoSource(
  content: string,
  context: {
    isGroup: boolean;
    author?: ConversationMemoryEntry["author"];
    ownerMentioned?: boolean;
    ownerName?: string;
  },
): boolean {
  if (!hasTodoTaskIntent(content)) return false;
  const normalized = content.replace(/\s+/g, " ").trim();
  const lower = normalized.toLocaleLowerCase();
  const ownerDirected = /\b(?:can|could|would|will)\s+you\b.{0,90}\b(?:call|text|message|email|reply|follow[ -]?up|check|buy|pick up|drop off|bring|book|pay|order|send|return|collect|prepare|write|read|review|contact|ask|confirm|cancel|reschedule|fix|make|take|leave|organize|arrange)\b|\b(?:please|don't forget|do not forget|remember to|remind me to|i need you to|you need to|make sure to)\b.{0,100}|(?:תוכל|תוכלי|אפשר|בבקשה|אל תשכח|אל תשכחי|תזכיר|תזכירי|צריך שת|צריכה שת).{0,100}/iu.test(lower);
  const ownerStated = /\b(?:i need to|i have to|i should|i must|todo|to-do)\b.{0,100}\b(?:call|text|message|email|reply|follow[ -]?up|check|buy|pick up|drop off|bring|book|pay|order|send|return|collect|prepare|write|read|review|contact|ask|confirm|cancel|reschedule|fix|make|take|leave|organize|arrange)\b|(?:אני צריך|אני צריכה|אני חייב|אני חייבת|אני צריך לעשות|תזכיר לי).{0,100}/iu.test(lower);

  if (context.author === "owner") return ownerDirected || ownerStated;
  // A contact's first-person task is theirs, not the owner's. A direct request
  // is still meaningful in a private conversation because it is addressed to
  // the only other participant.
  if (!context.isGroup) return ownerDirected;
  if (!ownerDirected) return false;
  if (context.ownerMentioned) return true;

  const ownerTokens = (context.ownerName || "")
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/u)
    .filter((token) => token.length >= 2);
  const sourceTokens = lower
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/u);
  // Matching any meaningful owner-name token covers natural group phrasing
  // like "Amir, could you…" even when WhatsApp did not encode an @mention.
  return ownerTokens.some((token) => sourceTokens.includes(token));
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
  return Boolean(parseExplicitClockTime(content));
}

export function inferCalendarEventFromMessage(
  content: string,
  timestamp = Date.now(),
): Pick<CalendarEvent, "title" | "startAt" | "allDay" | "location"> | undefined {
  const normalized = content.replace(/\s+/g, " ").trim();
  const lower = normalized.toLocaleLowerCase();
  if (!normalized || !hasCalendarPlanIntent(normalized)) return undefined;
  // WhatsApp transports timestamps in seconds in some events, while the
  // dashboard/API use milliseconds. Normalize once before resolving weekday
  // references so “Saturday” is always anchored to the actual message day.
  const normalizedTimestamp = timestamp > 0 && timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp;
  const base = new Date(normalizedTimestamp);
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
        // A plain “Saturday” in a message sent on Saturday means today. Only
        // “next Saturday” explicitly rolls it forward a full week.
        let daysAhead = (target - base.getDay() + 7) % 7;
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
  const time = parseExplicitClockTime(lower);
  if (time) {
    date.setHours(time.hour, time.minute, 0, 0);
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
    .replace(/\b(?:day after tomorrow|tomorrow|today|tonight)\b|מחרתיים|מחר|היום|הערב/iu, "");
  title = stripExplicitClockTime(title)
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
        (memory.insights.length > 0 || memory.commitments.length > 0 || memory.events.length > 0 || memory.todos.length > 0 || memory.manualItems.length > 0 || memory.profile)
      ) {
        this.persisted.contacts[chatId] = { ...DEFAULT_CONTACT, knowledgeTracking: "enabled" };
        migratedKnowledgeTracking = true;
      }
    }
    const dedupedKnowledge = this.dedupeKnowledgeInsightsAcrossMemories();
    const dedupedCommitments = this.dedupeCommitmentsAcrossMemories();
    const dedupedTodos = this.dedupeTodoTasksAcrossMemories();
    const clusteredKnowledge = this.clusterKnowledgeInsightsAcrossMemories();
    const maintainedKnowledge = this.maintainKnowledge(Date.now(), false).changed;
    if (migratedKnowledgeTracking || dedupedKnowledge || dedupedCommitments || dedupedTodos || clusteredKnowledge || maintainedKnowledge) this.save();
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
              pronouns: normalizeContactPronouns(
                (contact as Partial<ContactPreferences>).pronouns,
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
                mentionIds: Array.isArray(entry.mentionIds)
                  ? [...new Set(entry.mentionIds
                    .filter((value): value is string => typeof value === "string")
                    .map((value) => value.trim().slice(0, 240))
                    .filter(Boolean))].slice(0, 30)
                  : undefined,
                ownerMentioned: entry.ownerMentioned === true || undefined,
                excludeFromAutomaticLearning: entry.excludeFromAutomaticLearning === true || undefined,
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
                  sourceKnowledgeUpdatedAt: Number.isFinite(memory.profile.sourceKnowledgeUpdatedAt)
                    ? Number(memory.profile.sourceKnowledgeUpdatedAt)
                    : undefined,
                  sourceKnowledgeVersion: typeof memory.profile.sourceKnowledgeVersion === "string"
                    ? memory.profile.sourceKnowledgeVersion.slice(0, 64)
                    : undefined,
                  staleAt: Number.isFinite(memory.profile.staleAt) ? Number(memory.profile.staleAt) : undefined,
                  staleReason: memory.profile.staleReason === "canonical_knowledge_changed"
                    ? memory.profile.staleReason
                    : undefined,
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
                topicTitle: typeof item.topicTitle === "string" ? item.topicTitle.replace(/\s+/g, " ").trim().slice(0, 80) || undefined : undefined,
                topicTitleConfidence: Number.isFinite(item.topicTitleConfidence) ? Math.max(0, Math.min(1, Number(item.topicTitleConfidence))) : undefined,
                canonicalKey: typeof item.canonicalKey === "string" ? this.normalizeCanonicalKnowledgeKey(item.canonicalKey) : undefined,
                validity: item.validity === "historical" || item.validity === "temporary" ? item.validity : "current",
                evolution: item.evolution === "replace" || item.evolution === "reinforce" ? item.evolution : "append",
                supersededById: typeof item.supersededById === "string" ? item.supersededById.slice(0, 120) : undefined,
                supersededAt: Number.isFinite(item.supersededAt) ? Number(item.supersededAt) : undefined,
                reinforcementCount: Number.isFinite(item.reinforcementCount) ? Math.max(1, Math.floor(Number(item.reinforcementCount))) : 1,
                lastReinforcedAt: Number.isFinite(item.lastReinforcedAt) ? Number(item.lastReinforcedAt) : undefined,
                autonomouslyConfirmedAt: Number.isFinite(item.autonomouslyConfirmedAt) ? Number(item.autonomouslyConfirmedAt) : undefined,
                autonomousConfirmationReason: item.autonomousConfirmationReason === "direct_owner_statement" || item.autonomousConfirmationReason === "direct_contact_statement"
                  ? item.autonomousConfirmationReason
                  : undefined,
                maintenanceConfirmedAt: Number.isFinite(item.maintenanceConfirmedAt) ? Number(item.maintenanceConfirmedAt) : undefined,
                maintenanceConfirmationReason: item.maintenanceConfirmationReason === "repeated_direct_evidence"
                  ? item.maintenanceConfirmationReason
                  : undefined,
                status: item.status === "confirmed" || item.status === "outdated" ? item.status : "inferred",
                confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0.5)),
                evidence: this.cleanEvidence(item.evidence || { excerpt: item.content, timestamp: Date.now() }),
                evidenceHistory: this.cleanEvidenceHistory(item.evidenceHistory, item.evidence || { excerpt: item.content, timestamp: Date.now() }),
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
                status: item.status === "done" || item.status === "dismissed" || item.status === "needs_review" ? item.status : "open",
                dueAt: Number.isFinite(item.dueAt) ? item.dueAt : undefined,
                note: typeof item.note === "string" ? item.note.replace(/\s+/g, " ").trim().slice(0, 1_000) || undefined : undefined,
                evidence: this.cleanEvidence(item.evidence || { excerpt: item.content, timestamp: Date.now() }),
                evidenceHistory: this.cleanEvidenceHistory(item.evidenceHistory, item.evidence || { excerpt: item.content, timestamp: Date.now() }),
                createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
                updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now(),
              }))
              .filter((item) => item.content.length > 0);
            const events = (Array.isArray(memory.events) ? memory.events : [])
              .filter((item): item is CalendarEvent => Boolean(item) && typeof item.title === "string" && Number.isFinite(item.startAt))
              // Calendar is a durable record, not a sliding suggestion feed.
              // Keep historical events until the owner explicitly deletes them.
              .map((item): CalendarEvent => ({
                id: typeof item.id === "string" ? item.id.slice(0, 120) : randomUUID(),
                title: item.title.replace(/\s+/g, " ").trim().slice(0, 240),
                startAt: normalizeTimedEventStart(item.startAt, item.evidence?.excerpt || item.title, Boolean(item.allDay)),
                endAt: Number.isFinite(item.endAt) ? item.endAt : undefined,
                allDay: false,
                location: item.location?.replace(/\s+/g, " ").trim().slice(0, 240) || undefined,
                note: typeof item.note === "string" ? item.note.replace(/\s+/g, " ").trim().slice(0, 1_000) || undefined : undefined,
                imageUrl: item.imageUrl?.startsWith("/api/todays-focus/icons/") ? item.imageUrl.slice(0, 240) : undefined,
                status: item.status === "confirmed" || item.status === "completed" || item.status === "dismissed" ? item.status : "inferred",
                completedAt: item.status === "completed"
                  ? Number.isFinite(item.completedAt) ? item.completedAt : Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now()
                  : undefined,
                evidence: {
                  messageId: item.evidence?.messageId?.slice(0, 240),
                  excerpt: (item.evidence?.excerpt || item.title).replace(/\s+/g, " ").trim().slice(0, 600),
                  senderName: item.evidence?.senderName?.replace(/\s+/g, " ").trim().slice(0, 120),
                  timestamp: Number.isFinite(item.evidence?.timestamp) ? item.evidence.timestamp : Date.now(),
                  source: item.evidence?.source === "whatsapp_bot" ? "whatsapp_bot" : undefined,
                },
                createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
                updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now(),
              }))
              .filter((item) => item.title.length > 0 && (item.status !== "inferred" || hasCalendarPlanIntent(item.evidence.excerpt)));
            type LegacyTodoTask = Omit<TodoTask, "title" | "status"> & {
              title?: string;
              content?: string;
              status?: string;
            };
            const todos = ((Array.isArray(memory.todos) ? memory.todos : []) as unknown[])
              // Accept the short-lived pre-release `content` field during
              // migration, but persist the public `title` contract from here on.
              .filter((item): item is LegacyTodoTask =>
                Boolean(item) && (
                  typeof (item as LegacyTodoTask).title === "string" ||
                  typeof (item as LegacyTodoTask).content === "string"
                ),
              )
              .slice(-400)
              .map((item): TodoTask => {
                const legacy = item as LegacyTodoTask;
                const rawTitle = (legacy.title || legacy.content || "").replace(/\s+/g, " ").trim().slice(0, 1_000);
                const evidence = {
                  messageId: legacy.evidence?.messageId?.slice(0, 240),
                  excerpt: (legacy.evidence?.excerpt || rawTitle).replace(/\s+/g, " ").trim().slice(0, 600),
                  senderName: legacy.evidence?.senderName?.replace(/\s+/g, " ").trim().slice(0, 120),
                  timestamp: Number.isFinite(legacy.evidence?.timestamp) ? legacy.evidence.timestamp : Date.now(),
                  source: legacy.evidence?.source === "whatsapp_bot" ? "whatsapp_bot" as const : undefined,
                };
                const presentation = rawTitle
                  ? presentTodo({ source: evidence.excerpt, title: rawTitle, priority: legacy.priority })
                  : undefined;
                return {
                  id: typeof legacy.id === "string" ? legacy.id.slice(0, 120) : randomUUID(),
                  title: presentation?.title || "",
                  status: legacy.status === "open" || legacy.status === "done" || legacy.status === "dismissed"
                    ? legacy.status
                    : legacy.status === "confirmed"
                      ? "open"
                      : legacy.status === "completed"
                        ? "done"
                        : "inferred",
                  priority: presentation?.priority || "normal",
                  dueAt: Number.isFinite(legacy.dueAt) ? legacy.dueAt : undefined,
                  note: typeof legacy.note === "string" ? legacy.note.replace(/\s+/g, " ").trim().slice(0, 1_000) || undefined : undefined,
                  // Older releases did not record a dedicated completion
                  // timestamp. Their latest update is the best truthful
                  // completion time we have, so preserve it for the history.
                  completedAt: legacy.status === "done" || legacy.status === "completed"
                    ? Number.isFinite(legacy.completedAt)
                      ? legacy.completedAt
                      : Number.isFinite(legacy.updatedAt)
                        ? legacy.updatedAt
                        : Date.now()
                    : undefined,
                  evidence,
                  createdAt: Number.isFinite(legacy.createdAt) ? legacy.createdAt : Date.now(),
                  updatedAt: Number.isFinite(legacy.updatedAt) ? legacy.updatedAt : Date.now(),
                };
              })
              .filter((item) => item.title.length > 0);
            const pendingRaw = memory.pendingOwnerActionClarification as Partial<PendingOwnerActionClarification> | undefined;
            const pendingOwnerActionClarification = pendingRaw?.kind === "todo"
              && typeof pendingRaw.source === "string"
              && typeof pendingRaw.title === "string"
              && Number.isFinite(pendingRaw.dueAt)
              && Number.isFinite(pendingRaw.sourceTimestamp)
              && Number.isFinite(pendingRaw.createdAt)
              ? {
                  kind: "todo" as const,
                  source: pendingRaw.source.replace(/\s+/g, " ").trim().slice(0, 600),
                  title: pendingRaw.title.replace(/\s+/g, " ").trim().slice(0, 240),
                  dueAt: Number(pendingRaw.dueAt),
                  needsTimeClarification: true as const,
                  messageId: pendingRaw.messageId?.trim().slice(0, 240) || undefined,
                  sourceTimestamp: Number(pendingRaw.sourceTimestamp),
                  createdAt: Number(pendingRaw.createdAt),
                }
              : undefined;
            const pendingOwnerLifecycleClarification = normalizePendingOwnerLifecycleClarification(memory.pendingOwnerLifecycleClarification);
            const ownerRecordReferences = normalizeOwnerRecordReferences(memory.ownerRecordReferences);
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
            return entries.length > 0 || manualItems.length > 0 || profile || insights.length > 0 || commitments.length > 0 || events.length > 0 || todos.length > 0 || pendingOwnerActionClarification || pendingOwnerLifecycleClarification || ownerRecordReferences.length > 0 || styleProfile || groupSummary
              ? [[chatId, {
                  chatName: memory.chatName?.replace(/\s+/g, " ").trim().slice(0, 120) || undefined,
                  entries,
                  manualItems,
                  profile,
                  insights,
                  commitments,
                  events,
                  todos,
                  pendingOwnerActionClarification,
                  pendingOwnerLifecycleClarification,
                  ownerRecordReferences,
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
        replyAssessments: Object.fromEntries(
          Object.entries(parsed.replyAssessments || {}).flatMap(([chatId, value]) => {
            if (!value || typeof value !== "object") return [];
            const assessment = value as Partial<CachedReplyAssessment>;
            if (
              typeof assessment.contextKey !== "string" ||
              !/^[a-f0-9]{64}$/iu.test(assessment.contextKey) ||
              typeof assessment.needsReply !== "boolean" ||
              typeof assessment.mayNeedReply !== "boolean" ||
              typeof assessment.confidence !== "number" ||
              !Number.isFinite(assessment.confidence) ||
              typeof assessment.reason !== "string"
            ) return [];
            return [[chatId, {
              contextKey: assessment.contextKey,
              needsReply: assessment.needsReply,
              mayNeedReply: assessment.mayNeedReply,
              confidence: Math.max(0, Math.min(100, Math.round(assessment.confidence))),
              source: "ai" as const,
              reason: assessment.reason.replace(/\s+/g, " ").trim().slice(0, 160) || "ambiguous_context",
              createdAt: typeof assessment.createdAt === "number" && Number.isFinite(assessment.createdAt)
                ? assessment.createdAt
                : Date.now(),
            } satisfies CachedReplyAssessment]];
          }).slice(-500),
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
          timeFormat: parsed.assistant?.timeFormat === "24-hour" ? "24-hour" : "12-hour",
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
        proactiveDelivery: Object.fromEntries(
          Object.entries(parsed.proactiveDelivery || {}).flatMap(([candidateId, value]) => {
            const decision = value as Partial<ProactiveDeliveryDecision> | undefined;
            if (
              !decision ||
              typeof decision.fingerprint !== "string" ||
              !/^[a-f0-9]{24}$/u.test(decision.fingerprint) ||
              (decision.status !== "opened" && decision.status !== "dismissed" && decision.status !== "resolved") ||
              !Number.isFinite(decision.updatedAt)
            ) return [];
            return [[candidateId.slice(0, 300), {
              candidateId: candidateId.slice(0, 300),
              fingerprint: decision.fingerprint,
              status: decision.status,
              updatedAt: Number(decision.updatedAt),
              kind: ["upcoming_context", "commitment", "todo", "reply", "meaningful_change"].includes(decision.kind || "")
                ? decision.kind as ProactiveCandidateKind
                : undefined,
              chatId: typeof decision.chatId === "string" ? decision.chatId.slice(0, 180) : undefined,
            } satisfies ProactiveDeliveryDecision]];
          }).slice(-1_000),
        ),
        proactiveJudgments: Object.fromEntries(
          Object.entries(parsed.proactiveJudgments || {}).flatMap(([key, value]) => {
            const batch = value as Partial<ProactiveAiJudgmentBatch> | undefined;
            if (
              !/^[a-f0-9]{24}$/u.test(key) || batch?.key !== key ||
              batch.policyVersion !== PROACTIVE_AI_POLICY_VERSION || !Number.isFinite(batch.judgedAt) ||
              !Array.isArray(batch.judgments)
            ) return [];
            const judgments = batch.judgments.filter((item) =>
              item && typeof item.candidateId === "string" && typeof item.show === "boolean" &&
              Number.isFinite(item.usefulness) && Number.isFinite(item.confidence) &&
              typeof item.title === "string" && typeof item.detail === "string" &&
              typeof item.why === "string" && typeof item.reason === "string" && Array.isArray(item.mergeWithIds),
            ).slice(0, 12).map((item) => ({
              candidateId: item.candidateId.slice(0, 300),
              show: item.show,
              usefulness: Math.max(0, Math.min(100, Number(item.usefulness))),
              confidence: Math.max(0, Math.min(100, Number(item.confidence))),
              title: item.title.replace(/\s+/gu, " ").trim().slice(0, 100),
              detail: item.detail.replace(/\s+/gu, " ").trim().slice(0, 170),
              why: item.why.replace(/\s+/gu, " ").trim().slice(0, 220),
              reason: item.reason.replace(/\s+/gu, " ").trim().slice(0, 120),
              mergeWithIds: item.mergeWithIds.filter((id): id is string => typeof id === "string").map((id) => id.slice(0, 300)).slice(0, 6),
            }));
            return judgments.length ? [[key, {
              key,
              policyVersion: PROACTIVE_AI_POLICY_VERSION,
              judgedAt: Number(batch.judgedAt),
              judgments,
            } satisfies ProactiveAiJudgmentBatch]] : [];
          }).sort((left, right) =>
            (right[1] as ProactiveAiJudgmentBatch).judgedAt - (left[1] as ProactiveAiJudgmentBatch).judgedAt,
          ).slice(0, 100),
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

  proactiveDeliveryDecisions(): ProactiveDeliveryDecision[] {
    return structuredClone(Object.values(this.persisted.proactiveDelivery));
  }

  setProactiveDeliveryDecision(
    candidateId: string,
    fingerprint: string,
    status: ProactiveDeliveryDecision["status"],
    now = Date.now(),
    context: { kind?: ProactiveCandidateKind; chatId?: string } = {},
  ): ProactiveDeliveryDecision | undefined {
    const cleanId = candidateId.trim().slice(0, 300);
    if (!cleanId || !/^[a-f0-9]{24}$/u.test(fingerprint)) return undefined;
    const decision = {
      candidateId: cleanId,
      fingerprint,
      status,
      updatedAt: now,
      kind: context.kind,
      chatId: context.chatId?.slice(0, 180),
    } satisfies ProactiveDeliveryDecision;
    this.persisted.proactiveDelivery[cleanId] = decision;
    const entries = Object.values(this.persisted.proactiveDelivery)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 1_000);
    this.persisted.proactiveDelivery = Object.fromEntries(entries.map((item) => [item.candidateId, item]));
    this.save();
    return structuredClone(decision);
  }

  proactiveJudgment(key: string): ProactiveAiJudgmentBatch | undefined {
    const batch = this.persisted.proactiveJudgments[key];
    return batch ? structuredClone(batch) : undefined;
  }

  setProactiveJudgment(batch: ProactiveAiJudgmentBatch): void {
    if (!/^[a-f0-9]{24}$/u.test(batch.key) || batch.policyVersion !== PROACTIVE_AI_POLICY_VERSION) return;
    this.persisted.proactiveJudgments[batch.key] = structuredClone(batch);
    const entries = Object.values(this.persisted.proactiveJudgments)
      .sort((left, right) => right.judgedAt - left.judgedAt)
      .slice(0, 100);
    this.persisted.proactiveJudgments = Object.fromEntries(entries.map((item) => [item.key, item]));
    this.save();
  }

  resolveInactiveProactiveDelivery(activeCandidateIds: Set<string>, now = Date.now()): void {
    let changed = false;
    for (const [candidateId, decision] of Object.entries(this.persisted.proactiveDelivery)) {
      if (decision.status !== "opened" || activeCandidateIds.has(candidateId)) continue;
      this.persisted.proactiveDelivery[candidateId] = { ...decision, status: "resolved", updatedAt: now };
      changed = true;
    }
    if (changed) this.save();
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
      pronouns: normalizeContactPronouns(stored?.pronouns),
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
      pronouns: patch.pronouns === undefined
        ? current.pronouns
        : normalizeContactPronouns(patch.pronouns),
    };
    this.persisted.contacts[chatId] = updated;
    if (patch.memoryEnabled === false) {
      delete this.persisted.memories[chatId];
      delete this.persisted.replyAssessments[chatId];
    }
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
        .filter((entry) =>
          entry.author !== "assistant" &&
          entry.excludeFromAutomaticLearning !== true &&
          Boolean(entry.content.trim()),
        )
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

  getReplyAssessment(chatId: string, contextKey: string): CachedReplyAssessment | undefined {
    const assessment = this.persisted.replyAssessments[chatId];
    if (!assessment || assessment.contextKey !== contextKey) return undefined;
    return structuredClone(assessment);
  }

  setReplyAssessment(chatId: string, assessment: CachedReplyAssessment): void {
    this.persisted.replyAssessments[chatId] = {
      contextKey: assessment.contextKey,
      needsReply: assessment.needsReply,
      mayNeedReply: assessment.mayNeedReply,
      confidence: Math.max(0, Math.min(100, Math.round(assessment.confidence))),
      source: "ai",
      reason: assessment.reason.replace(/\s+/g, " ").trim().slice(0, 160) || "ambiguous_context",
      createdAt: assessment.createdAt,
    };
    const entries = Object.entries(this.persisted.replyAssessments);
    if (entries.length > 500) {
      for (const [expiredChatId] of entries
        .sort((left, right) => left[1].createdAt - right[1].createdAt)
        .slice(0, entries.length - 500)) {
        delete this.persisted.replyAssessments[expiredChatId];
      }
    }
    this.save();
  }

  /**
   * Detect a reply AmirOS already recorded as its own. The linked-device
   * callback can arrive after a process restart, when the in-memory output
   * suppression map is no longer available. Matching this persisted record
   * keeps bot text from being re-imported as a human owner message.
   */
  isKnownAssistantOutput(chatId: string, content: string): boolean {
    const normalized = content.replace(/\s+/g, " ").trim();
    if (!normalized) return false;
    return (this.persisted.memories[chatId]?.entries || [])
      .slice(-120)
      .some((entry) =>
        entry.author === "assistant" &&
        entry.content.replace(/\s+/g, " ").trim() === normalized,
      );
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

  /**
   * Repairs canonical memory in place without deleting facts or evidence.
   * It is safe to run after every learner batch and again at startup.
   */
  maintainKnowledge(now = Date.now(), persist = true): {
    changed: boolean;
    promoted: number;
    historicized: number;
    invalidatedProfiles: number;
  } {
    let changed = false;
    let promoted = 0;
    let historicized = 0;
    let invalidatedProfiles = 0;

    for (const [chatId, memory] of Object.entries(this.persisted.memories)) {
      const beforeLength = memory.insights.length;
      memory.insights = this.dedupeKnowledgeInsights(memory.insights);
      if (memory.insights.length !== beforeLength) changed = true;

      for (const insight of memory.insights) {
        if (!this.canMaintenancePromote(chatId, insight)) continue;
        insight.status = "confirmed";
        insight.maintenanceConfirmedAt = now;
        insight.maintenanceConfirmationReason = "repeated_direct_evidence";
        insight.updatedAt = Math.max(insight.updatedAt, now);
        this.reconcileConfirmedCanonicalInsight(chatId, insight, now);
        promoted += 1;
        changed = true;
      }

      const currentByKey = new Map<string, ContactInsight[]>();
      for (const insight of memory.insights) {
        const canonicalKey = this.normalizeCanonicalKnowledgeKey(insight.canonicalKey) ||
          this.inferredCanonicalKnowledgeKey(insight.content, insight.kind);
        if (!canonicalKey || insight.status !== "confirmed" || (insight.validity || "current") !== "current" || insight.evolution !== "replace") continue;
        const key = `${insight.kind}:${canonicalKey}`;
        const items = currentByKey.get(key) || [];
        items.push(insight);
        currentByKey.set(key, items);
      }
      for (const items of currentByKey.values()) {
        if (items.length < 2) continue;
        const winner = [...items].sort((left, right) =>
          this.latestKnowledgeEvidenceAt(right) - this.latestKnowledgeEvidenceAt(left) ||
          right.confidence - left.confidence ||
          (right.reinforcementCount || 1) - (left.reinforcementCount || 1),
        )[0]!;
        for (const prior of items) {
          if (prior.id === winner.id) continue;
          prior.validity = "historical";
          prior.supersededById = winner.id;
          prior.supersededAt = now;
          prior.updatedAt = Math.max(prior.updatedAt, now);
          historicized += 1;
          changed = true;
        }
      }

      const newestCanonicalUpdate = memory.insights
        .filter((item) => item.status === "confirmed" && (item.validity || "current") !== "historical")
        .reduce((latest, item) => Math.max(latest, item.updatedAt), 0);
      const canonicalVersion = this.canonicalKnowledgeVersion(memory.insights);
      if (
        memory.profile && !memory.profile.staleAt && (
          memory.profile.sourceKnowledgeVersion
            ? memory.profile.sourceKnowledgeVersion !== canonicalVersion
            : newestCanonicalUpdate > (memory.profile.sourceKnowledgeUpdatedAt || memory.profile.updatedAt) + 1_000
        )
      ) {
        memory.profile.staleAt = now;
        memory.profile.staleReason = "canonical_knowledge_changed";
        invalidatedProfiles += 1;
        changed = true;
      }
    }

    if (changed && persist) this.save();
    return { changed, promoted, historicized, invalidatedProfiles };
  }

  private canonicalKnowledgeVersion(insights: ContactInsight[]): string {
    const canonical = insights
      .filter((item) => item.status === "confirmed" && (item.validity || "current") !== "historical")
      .map((item) => [
        item.id,
        item.canonicalKey || "",
        item.validity || "current",
        item.content,
      ].join("\u001f"))
      .sort()
      .join("\u001e");
    return createHash("sha256").update(canonical).digest("hex").slice(0, 24);
  }

  getCommitments(chatId: string): RelationshipCommitment[] {
    if (!this.getContact(chatId).memoryEnabled) return [];
    return structuredClone(this.persisted.memories[chatId]?.commitments || []);
  }

  getCalendarEvents(chatId: string): CalendarEvent[] {
    if (!this.getContact(chatId).memoryEnabled) return [];
    return structuredClone(this.persisted.memories[chatId]?.events || []);
  }

  getTodoTasks(chatId: string): TodoTask[] {
    if (!this.getContact(chatId).memoryEnabled) return [];
    return structuredClone(this.persisted.memories[chatId]?.todos || []);
  }

  getPendingOwnerActionClarification(chatId: string, now = Date.now()): PendingOwnerActionClarification | undefined {
    const memory = this.persisted.memories[chatId];
    const pending = memory?.pendingOwnerActionClarification;
    if (!pending) return undefined;
    if (now - pending.createdAt > OWNER_ACTION_CLARIFICATION_TTL_MS) {
      delete memory.pendingOwnerActionClarification;
      this.save();
      return undefined;
    }
    return structuredClone(pending);
  }

  setPendingOwnerActionClarification(
    chatId: string,
    input: Omit<PendingOwnerActionClarification, "createdAt"> & { createdAt?: number },
  ): PendingOwnerActionClarification {
    const memory = this.ensureMemory(chatId);
    const pending: PendingOwnerActionClarification = {
      kind: "todo",
      source: input.source.replace(/\s+/g, " ").trim().slice(0, 600),
      title: input.title.replace(/\s+/g, " ").trim().slice(0, 240),
      dueAt: input.dueAt,
      needsTimeClarification: true,
      messageId: input.messageId?.trim().slice(0, 240) || undefined,
      sourceTimestamp: input.sourceTimestamp,
      createdAt: input.createdAt || Date.now(),
    };
    memory.pendingOwnerActionClarification = pending;
    memory.updatedAt = pending.createdAt;
    this.save();
    return structuredClone(pending);
  }

  clearPendingOwnerActionClarification(chatId: string): boolean {
    const memory = this.persisted.memories[chatId];
    if (!memory?.pendingOwnerActionClarification) return false;
    delete memory.pendingOwnerActionClarification;
    this.save();
    return true;
  }

  getPendingOwnerLifecycleClarification(chatId: string, now = Date.now()): PendingOwnerLifecycleClarification | undefined {
    const memory = this.persisted.memories[chatId];
    const pending = memory?.pendingOwnerLifecycleClarification;
    if (!pending) return undefined;
    if (now - pending.createdAt > OWNER_ACTION_CLARIFICATION_TTL_MS) {
      delete memory.pendingOwnerLifecycleClarification;
      this.save();
      return undefined;
    }
    return structuredClone(pending);
  }

  setPendingOwnerLifecycleClarification(
    chatId: string,
    pending: PendingOwnerLifecycleClarification,
  ): PendingOwnerLifecycleClarification {
    const normalized = normalizePendingOwnerLifecycleClarification(pending);
    if (!normalized) throw new Error("A lifecycle clarification requires at least two valid candidates");
    const memory = this.ensureMemory(chatId);
    memory.pendingOwnerLifecycleClarification = normalized;
    memory.updatedAt = normalized.createdAt;
    this.save();
    return structuredClone(normalized);
  }

  clearPendingOwnerLifecycleClarification(chatId: string): boolean {
    const memory = this.persisted.memories[chatId];
    if (!memory?.pendingOwnerLifecycleClarification) return false;
    delete memory.pendingOwnerLifecycleClarification;
    this.save();
    return true;
  }

  rememberOwnerRecordReference(ownerChatId: string, reference: OwnerRecordReference): OwnerRecordReference[] {
    const memory = this.ensureMemory(ownerChatId);
    const normalized = normalizeOwnerRecordReferences([reference]);
    if (normalized.length !== 1) throw new Error("A valid owner record reference is required");
    const item = normalized[0]!;
    memory.ownerRecordReferences = [
      ...(memory.ownerRecordReferences || []).filter((existing) =>
        existing.kind !== item.kind || existing.chatId !== item.chatId || existing.id !== item.id),
      item,
    ].slice(-12);
    memory.updatedAt = item.referencedAt;
    this.save();
    return structuredClone(memory.ownerRecordReferences);
  }

  getOwnerRecordReferences(ownerChatId: string): OwnerRecordReference[] {
    return structuredClone(this.persisted.memories[ownerChatId]?.ownerRecordReferences || []);
  }

  listTodoTasks(): Array<TodoTask & { chatId: string; contactName?: string }> {
    const statusPriority = (status: TodoTask["status"]) =>
      status === "inferred" ? 0 : status === "open" ? 1 : status === "done" ? 2 : 3;
    const taskPriority = (priority: TodoTask["priority"]) =>
      priority === "high" ? 0 : priority === "normal" ? 1 : 2;
    return Object.entries(this.persisted.memories)
      .flatMap(([chatId, memory]) => (memory.todos || [])
        .map((task) => ({
          ...structuredClone(task),
          chatId,
          contactName: memory.chatName || this.persisted.chatNames[chatId],
        })))
      .sort((left, right) =>
        statusPriority(left.status) - statusPriority(right.status)
        || taskPriority(left.priority) - taskPriority(right.priority)
        || (left.dueAt || Number.MAX_SAFE_INTEGER) - (right.dueAt || Number.MAX_SAFE_INTEGER)
        || right.updatedAt - left.updatedAt);
  }

  listCalendarEvents(): Array<CalendarEvent & { chatId: string }> {
    return Object.entries(this.persisted.memories)
      .flatMap(([chatId, memory]) => memory.events
        .filter((event) => event.status !== "dismissed")
        .map((event) => ({ ...structuredClone(event), chatId })))
      .sort((a, b) => a.startAt - b.startAt);
  }

  listCommitments(): Array<RelationshipCommitment & { chatId: string; contactName?: string }> {
    return Object.entries(this.persisted.memories)
      .flatMap(([chatId, memory]) => memory.commitments.map((commitment) => ({
        ...structuredClone(commitment),
        chatId,
        contactName: memory.chatName || this.persisted.chatNames[chatId],
      })))
      .sort((left, right) => right.updatedAt - left.updatedAt);
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
    // Keep owner-triggered bot answers on the same retrieval path as Ask
    // AmirOS. This is especially important for deterministic temporal ranges
    // such as "tomorrow" and "אתמול".
    const retrieved = this.searchIntelligence(query, 80);
    const temporalQuery = Boolean(resolveTemporalRange(query));
    const relationship = access.knowledge
      ? this.resolveRelationshipKnowledge(query, access.requesterName, access.ownerName)
      : { knowledge: [], context: [] };
    const knowledgeRecords = temporalQuery || !relationship.knowledge.length
      ? retrieved
      : relationship.knowledge;
    const knowledge = access.knowledge
      ? knowledgeRecords.filter((record) => record.kind !== "calendar_event")
      : [];
    const events = access.calendar
      ? retrieved
        .filter((record) => record.kind === "calendar_event")
        .flatMap((record) => {
          const event = this.persisted.memories[record.chatId]?.events.find((item) => item.id === record.id);
          if (!event) return [];
          return [{
            ...structuredClone(event),
            chatId: record.chatId,
            contactName: this.persisted.memories[record.chatId]?.chatName || event.evidence.senderName,
          }];
        })
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
    if (patch.note !== undefined) event.note = patch.note.replace(/\s+/g, " ").trim().slice(0, 1_000) || undefined;
    if (patch.imageUrl !== undefined && patch.imageUrl.startsWith("/api/todays-focus/icons/")) {
      event.imageUrl = patch.imageUrl.slice(0, 240);
    }
    if (patch.status === "completed") event.completedAt ||= Date.now();
    else if (patch.status === "confirmed" || patch.status === "inferred") event.completedAt = undefined;
    event.allDay = false;
    event.updatedAt = Date.now();
    memory.updatedAt = event.updatedAt;
    this.save();
    return structuredClone(event);
  }

  addOwnerCalendarEvent(
    chatId: string,
    input: Pick<CalendarEvent, "title" | "startAt" | "allDay" | "location" | "evidence">,
  ): { event: CalendarEvent; created: boolean } {
    const memory = this.ensureMemory(chatId);
    const title = input.title.replace(/\s+/g, " ").trim().slice(0, 240);
    if (!title || !Number.isFinite(input.startAt)) throw new Error("A calendar title and time are required");
    const existing = memory.events.find((event) => this.isSameCalendarEvent(event, input));
    const now = Date.now();
    if (existing) {
      existing.status = "confirmed";
      existing.title = title;
      existing.startAt = input.startAt;
      existing.allDay = input.allDay;
      existing.location = input.location?.replace(/\s+/g, " ").trim().slice(0, 240) || undefined;
      existing.evidence = this.cleanEvidence(input.evidence);
      existing.updatedAt = now;
      memory.updatedAt = now;
      this.save();
      return { event: structuredClone(existing), created: false };
    }
    const event: CalendarEvent = {
      id: randomUUID(), title, startAt: input.startAt, endAt: input.startAt + 60 * 60_000,
      allDay: input.allDay,
      location: input.location?.replace(/\s+/g, " ").trim().slice(0, 240) || undefined,
      status: "confirmed", evidence: this.cleanEvidence(input.evidence), createdAt: now, updatedAt: now,
    };
    memory.events.push(event);
    memory.updatedAt = now;
    this.save();
    return { event: structuredClone(event), created: true };
  }

  addOwnerTodo(
    chatId: string,
    input: Pick<TodoTask, "title" | "dueAt" | "evidence"> & { priority?: TodoTask["priority"] },
  ): { task: TodoTask; created: boolean; reopenedFromCompleted?: boolean } {
    const memory = this.ensureMemory(chatId);
    const title = input.title.replace(/\s+/g, " ").trim().slice(0, 1_000);
    const priority = input.priority === "low" || input.priority === "high" ? input.priority : "normal";
    if (!title) throw new Error("A to-do title is required");
    const existing = memory.todos.find((task) => this.isDuplicateTodoTask(task, input));
    const now = Date.now();
    if (existing) {
      // A dismissed or completed task is no longer actionable. An explicit
      // owner request for the same task restores it instead of claiming it is
      // already in the active to-do list.
      const restored = existing.status === "dismissed";
      const reopenedFromCompleted = existing.status === "done";
      existing.status = "open";
      if (restored || reopenedFromCompleted) existing.completedAt = undefined;
      existing.title = title;
      existing.priority = priority;
      existing.dueAt = input.dueAt;
      existing.evidence = this.cleanEvidence(input.evidence);
      existing.updatedAt = now;
      memory.updatedAt = now;
      this.save();
      return { task: structuredClone(existing), created: restored, reopenedFromCompleted };
    }
    const task: TodoTask = {
      id: randomUUID(), title, status: "open", priority, dueAt: input.dueAt,
      evidence: this.cleanEvidence(input.evidence), createdAt: now, updatedAt: now,
    };
    memory.todos.push(task);
    memory.updatedAt = now;
    this.save();
    return { task: structuredClone(task), created: true };
  }

  addOwnerCommitment(
    chatId: string,
    input: Pick<RelationshipCommitment, "content" | "dueAt" | "evidence">,
  ): { commitment: RelationshipCommitment; created: boolean } {
    const memory = this.ensureMemory(chatId);
    const content = input.content.replace(/\s+/g, " ").trim().slice(0, 1_000);
    if (!content) throw new Error("A commitment title is required");
    const reconciled = this.upsertCommitment(memory.commitments, { ...input, content, owner: "me" }, Date.now());
    memory.updatedAt = reconciled.commitment.updatedAt;
    this.save();
    return { commitment: structuredClone(reconciled.commitment), created: reconciled.created };
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
    const historySources = sources.slice(0, 12).map((source) => {
      const historySource = { ...source };
      delete historySource.explanation;
      return historySource;
    });
    const item = {
      id: randomUUID(),
      question: question.replace(/\s+/g, " ").trim().slice(0, 500),
      answer: answer.trim().slice(0, 8_000),
      sources: structuredClone(historySources),
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
      .filter((entry) =>
        entry.author === "owner" &&
        entry.excludeFromAutomaticLearning !== true &&
        entry.content.trim().length > 0,
      )
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
        type IndexedEntry = { entry: ConversationMemoryEntry; index: number };
        const timestampOf = (entry: ConversationMemoryEntry) =>
          entry.timestamp > 0 && entry.timestamp < 10_000_000_000 ? entry.timestamp * 1_000 : entry.timestamp;
        const isMoreRecent = (candidate: IndexedEntry, current: IndexedEntry | undefined) =>
          !current || timestampOf(candidate.entry) > timestampOf(current.entry) || (
            timestampOf(candidate.entry) === timestampOf(current.entry) && candidate.index > current.index
          );
        let lastIncoming: IndexedEntry | undefined;
        let lastOutgoing: IndexedEntry | undefined;
        let lastInteraction: IndexedEntry | undefined;
        memory.entries.forEach((entry, index) => {

          // A WhatsApp message authored by the owner is stored with role
          // "user" so it can inform the assistant, but it is still an
          // outgoing message in the conversation. Treat it as such here so a
          // message Amir sends cannot be surfaced as a false "Needs reply"
          // action for the other person.
          const isOutgoing = entry.role === "assistant" || entry.author === "owner";
          const isIncoming = entry.role === "user" && !isOutgoing;
          const isHumanInteraction = entry.author === "owner" || entry.author === "contact" || entry.author === "group_member" || (
            entry.role === "user" && entry.author !== "assistant"
          );
          const candidate = { entry, index };
          if (isIncoming && isMoreRecent(candidate, lastIncoming)) lastIncoming = candidate;
          if (isOutgoing && isMoreRecent(candidate, lastOutgoing)) lastOutgoing = candidate;
          if (isHumanInteraction && isMoreRecent(candidate, lastInteraction)) lastInteraction = candidate;
        });
        const now = Date.now();
        return {
          chatId,
          insights: structuredClone((memory.insights || []).map((item) => ({
            ...item,
            freshness: assessKnowledgeFreshness(item, now).state,
            explanation: explainContactInsight(item, memory.insights || [], now),
          }))),
          commitments: structuredClone((memory.commitments || []).map((item) => ({ ...item, status: relationshipCommitmentStatus(item) }))),
          events: structuredClone(memory.events || []),
          todos: structuredClone(memory.todos || []),
          profile: memory.profile ? structuredClone(memory.profile) : undefined,
          styleProfile: memory.styleProfile ? structuredClone(memory.styleProfile) : undefined,
          groupSummary: memory.groupSummary ? structuredClone(memory.groupSummary) : undefined,
          needsReply: Boolean(lastIncoming && (!lastOutgoing || isMoreRecent(lastIncoming, lastOutgoing))),
          lastInteraction: lastInteraction ? structuredClone(lastInteraction.entry) : undefined,
          lastIncoming: lastIncoming ? structuredClone(lastIncoming.entry) : undefined,
          updatedAt: memory.updatedAt,
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Builds a bounded, read-only relationship projection for Ask AmirOS.
   * It intentionally derives from the canonical memory/action records above
   * instead of persisting generated relationship prose as another truth store.
   */
  relationshipIntelligence(query: string, now = Date.now()): RelationshipIntelligenceResult {
    const chats = this.intelligenceSnapshot();
    return buildRelationshipIntelligence(query, chats.map((chat) => ({
      chatId: chat.chatId,
      contactName: this.getChatName(chat.chatId),
      isGroup: chat.chatId.endsWith("@g.us"),
      insights: chat.insights,
      commitments: chat.commitments,
      todos: chat.todos,
      events: chat.events,
      needsReply: chat.needsReply,
      lastInteraction: chat.lastInteraction,
    })), now);
  }

  relationshipRecordsForQuestion(
    query: string,
    records: IntelligenceSearchRecord[],
    relationship: RelationshipIntelligenceResult,
    now = Date.now(),
  ): IntelligenceSearchRecord[] {
    return filterRelationshipRecordsForQuestion(records, relationship, now);
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
      insights: Array<AnalyzedInsight & { subjectNames?: string[] }>;
      commitments: Array<Pick<RelationshipCommitment, "content" | "owner" | "assigneeName" | "dueAt" | "evidence">>;
      events?: Array<Pick<CalendarEvent, "title" | "startAt" | "allDay" | "location" | "evidence">>;
      todos?: Array<Pick<TodoTask, "title" | "dueAt" | "evidence"> & { priority?: TodoTask["priority"] }>;
    },
  ): {
    source: { insights: ContactInsight[]; commitments: RelationshipCommitment[]; events: CalendarEvent[]; todos: TodoTask[] };
    targetChatIds: string[];
  } {
    type RoutedInsight = (typeof input.insights)[number] & Pick<ContactInsight, "clusterId" | "subjectChatIds" | "subjectNames">;
    const routedInsights = new Map<string, RoutedInsight[]>();
    for (const insight of input.insights) {
      const targets = this.resolveKnowledgeTargetChatIds(sourceChatId, insight.subjectNames || []);
      const existing = this.findKnowledgeInsightAcrossChats(insight.content, targets, insight.validity || "current");
      const subjectChatIds = [...new Set([...(existing?.subjectChatIds || []), ...targets])];
      const subjectNames = [...new Set([
        ...(existing?.subjectNames || []),
        ...(insight.subjectNames || []),
        ...subjectChatIds.map((chatId) => this.persisted.memories[chatId]?.chatName).filter((name): name is string => Boolean(name)),
      ])];
      // A reviewed decision is a durable tombstone. Re-analysis may find the
      // same fact in another message, but it must not reopen the suggestion.
      if (existing?.status === "outdated") continue;
      const autonomousConfirmation = this.autonomousConfirmationFor(sourceChatId, insight);
      const routed: RoutedInsight = {
        ...insight,
        ...(autonomousConfirmation ? {
          status: "confirmed" as const,
          autonomouslyConfirmedAt: autonomousConfirmation.at,
          autonomousConfirmationReason: autonomousConfirmation.reason,
        } : {}),
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
      todos: input.todos,
    });
    for (const [targetChatId, insights] of routedInsights) {
      if (targetChatId === sourceChatId) continue;
      this.mergeAnalyzedIntelligence(targetChatId, { insights, commitments: [], events: [], todos: [] });
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
        (item.kind === insight.kind && (item.validity || "current") === (insight.validity || "current") && this.isDuplicateKnowledgeText(item.content, insight.content)),
      )
      .map((item) => ({ chatId: targetChatId, insight: item })));
    const affectedChatIds = new Set(targets.map((target) => target.chatId));
    for (const { chatId: targetChatId, insight: target } of targets) {
      if (patch.status) target.status = patch.status;
      if (patch.content?.trim()) target.content = patch.content.replace(/\s+/g, " ").trim().slice(0, 1_000);
      target.updatedAt = updatedAt;
      if (target.status === "confirmed") this.reconcileConfirmedCanonicalInsight(targetChatId, target, updatedAt);
    }
    for (const [candidateChatId, candidate] of Object.entries(this.persisted.memories)) {
      candidate.insights = this.dedupeKnowledgeInsights(candidate.insights);
      if (affectedChatIds.has(candidateChatId)) candidate.updatedAt = updatedAt;
    }
    memory.updatedAt = updatedAt;
    this.maintainKnowledge(updatedAt, false);
    this.save();
    return structuredClone(insight);
  }

  updateCommitment(
    chatId: string,
    commitmentId: string,
    update: RelationshipCommitment["status"] | RelationshipCommitmentPatch,
  ): RelationshipCommitment | undefined {
    const memory = this.persisted.memories[chatId];
    const commitment = memory?.commitments.find((item) => item.id === commitmentId);
    if (!memory || !commitment) return undefined;
    const patch = typeof update === "string" ? { status: update } : update;
    if (patch.status) commitment.status = patch.status;
    if (patch.content !== undefined) {
      const content = patch.content.replace(/\s+/g, " ").trim().slice(0, 1_000);
      if (content) commitment.content = content;
    }
    if (patch.dueAt !== undefined) commitment.dueAt = Number.isFinite(patch.dueAt) && patch.dueAt! > 0 ? patch.dueAt! : undefined;
    if (patch.note !== undefined) commitment.note = patch.note.replace(/\s+/g, " ").trim().slice(0, 1_000) || undefined;
    commitment.updatedAt = Date.now();
    memory.updatedAt = commitment.updatedAt;
    this.save();
    return structuredClone(commitment);
  }

  updateTodoTask(
    chatId: string,
    todoId: string,
    patch: TodoTaskPatch,
  ): TodoTask | undefined {
    const memory = this.persisted.memories[chatId];
    const task = memory?.todos.find((item) => item.id === todoId);
    if (!memory || !task) return undefined;
    if (patch.status) {
      task.status = patch.status;
      if (patch.status === "done") task.completedAt ||= Date.now();
      else if (patch.status === "open" || patch.status === "inferred") task.completedAt = undefined;
    }
    if (patch.title !== undefined) {
      const title = patch.title.replace(/\s+/g, " ").trim().slice(0, 1_000);
      if (title) task.title = title;
    }
    if (patch.dueAt !== undefined) {
      task.dueAt = Number.isFinite(patch.dueAt) && patch.dueAt! > 0 ? patch.dueAt! : undefined;
    }
    if (patch.priority) task.priority = patch.priority;
    if (patch.note !== undefined) task.note = patch.note.replace(/\s+/g, " ").trim().slice(0, 1_000) || undefined;
    task.updatedAt = Date.now();
    memory.updatedAt = task.updatedAt;
    memory.todos = this.dedupeTodoTasks(memory.todos);
    this.save();
    return structuredClone(task);
  }

  /**
   * Marks a task complete without removing its evidence or review history.
   * This is intentionally a status transition rather than a delete operation.
   */
  completeTodoTask(chatId: string, todoId: string): TodoTask | undefined {
    return this.updateTodoTask(chatId, todoId, { status: "done" });
  }

  mergeAnalyzedIntelligence(
    chatId: string,
    input: {
      insights: Array<AnalyzedInsight & Pick<ContactInsight, "clusterId" | "subjectChatIds" | "subjectNames">>;
      commitments: Array<Pick<RelationshipCommitment, "content" | "owner" | "assigneeName" | "dueAt" | "evidence">>;
      events?: Array<Pick<CalendarEvent, "title" | "startAt" | "allDay" | "location" | "evidence">>;
      todos?: Array<Pick<TodoTask, "title" | "dueAt" | "evidence"> & { priority?: TodoTask["priority"] }>;
    },
  ): { insights: ContactInsight[]; commitments: RelationshipCommitment[]; events: CalendarEvent[]; todos: TodoTask[] } {
    const memory = this.persisted.memories[chatId] || {
      entries: [], manualItems: [], insights: [], commitments: [], events: [], todos: [], incomingMessageCount: 0, updatedAt: 0,
    };
    const now = Date.now();
    for (const candidate of input.insights.slice(0, 40)) {
      const content = candidate.content.replace(/\s+/g, " ").trim().slice(0, 1_000);
      if (!content || memory.manualItems.some((item) => this.isDuplicateKnowledgeText(item.content, content))) continue;
      const result = this.upsertInsight(memory.insights, { ...candidate, content }, now, chatId);
      if (result.insight.status === "confirmed") this.reconcileConfirmedCanonicalInsight(chatId, result.insight, now);
    }
    for (const candidate of input.commitments.slice(0, 40)) {
      const content = candidate.content.replace(/\s+/g, " ").trim().slice(0, 1_000);
      const sourceEntry = candidate.evidence.messageId
        ? memory.entries.find((entry) => entry.messageId === candidate.evidence.messageId)
        : undefined;
      if (sourceEntry?.excludeFromAutomaticLearning || !content) continue;
      this.upsertCommitment(memory.commitments, {
        ...candidate,
        content,
        assigneeName: candidate.assigneeName?.replace(/\s+/g, " ").trim().slice(0, 120),
      }, now);
    }
    for (const candidate of (input.todos || []).slice(0, 40)) {
      const title = candidate.title.replace(/\s+/g, " ").trim().slice(0, 1_000);
      const priority = candidate.priority === "low" || candidate.priority === "high" ? candidate.priority : "normal";
      const sourceEntry = candidate.evidence.messageId
        ? memory.entries.find((entry) => entry.messageId === candidate.evidence.messageId)
        : undefined;
      if (sourceEntry?.excludeFromAutomaticLearning) continue;
      if (!title || !isOwnerTodoSource(sourceEntry?.content || candidate.evidence.excerpt, {
        isGroup: chatId.endsWith("@g.us"),
        author: sourceEntry?.author,
        ownerMentioned: sourceEntry?.ownerMentioned,
        ownerName: this.persisted.ownerProfile.displayName,
      })) continue;
      const existing = memory.todos.find((item) => this.isDuplicateTodoTask(item, candidate));
      if (existing) {
        // Any reviewed decision is a durable tombstone. A repeat message may
        // refresh an unreviewed suggestion, but must never reopen an approved,
        // completed, or dismissed to-do.
        if (existing.status !== "inferred") continue;
        existing.title = title;
        existing.priority = priority;
        existing.dueAt = Number.isFinite(candidate.dueAt) && candidate.dueAt! > 0 ? candidate.dueAt : undefined;
        existing.evidence = this.cleanEvidence(candidate.evidence);
        existing.updatedAt = now;
        continue;
      }
      memory.todos.push({
        id: randomUUID(),
        title,
        status: "inferred",
        priority,
        dueAt: Number.isFinite(candidate.dueAt) && candidate.dueAt! > 0 ? candidate.dueAt : undefined,
        evidence: this.cleanEvidence(candidate.evidence),
        createdAt: now,
        updatedAt: now,
      });
    }
    for (const candidate of (input.events || []).slice(0, 40)) {
      const title = candidate.title.replace(/\s+/g, " ").trim().slice(0, 240);
      if (!title || !Number.isFinite(candidate.startAt) || !hasCalendarPlanIntent(candidate.evidence.excerpt)) continue;
      // Prefer deterministic parsing of the actual source message whenever it
      // contains a calendar date or time. The model still supplies a useful
      // title, but it must not shift “Saturday” or “12pm” while serializing.
      const sourceEvent = inferCalendarEventFromMessage(candidate.evidence.excerpt, candidate.evidence.timestamp);
      const startAt = sourceEvent
        ? sourceEvent.startAt
        : normalizeTimedEventStart(candidate.startAt, candidate.evidence.excerpt, candidate.allDay);
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
    memory.todos = this.dedupeTodoTasks(memory.todos).slice(-400);
    memory.updatedAt = now;
    this.persisted.memories[chatId] = memory;
    this.maintainKnowledge(now, false);
    this.dedupeCalendarEventsAcrossChats();
    this.save();
    return {
      insights: structuredClone(memory.insights),
      commitments: structuredClone(memory.commitments),
      events: structuredClone(memory.events),
      todos: structuredClone(memory.todos),
    };
  }

  setWritingStyleProfile(chatId: string, profile: Omit<WritingStyleProfile, "updatedAt">): WritingStyleProfile {
    const memory = this.persisted.memories[chatId] || {
      entries: [], manualItems: [], insights: [], commitments: [], events: [], todos: [], incomingMessageCount: 0, updatedAt: 0,
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
      entries: [], manualItems: [], insights: [], commitments: [], events: [], todos: [], incomingMessageCount: 0, updatedAt: 0,
    };
    const value = { ...summary, updatedAt: Date.now() };
    memory.groupSummary = value;
    memory.updatedAt = value.updatedAt;
    this.persisted.memories[chatId] = memory;
    this.save();
    return structuredClone(value);
  }

  searchIntelligence(query: string, limit = 36, excludedChatIds = new Set<string>(), now = Date.now()): IntelligenceSearchRecord[] {
    const terms = this.searchTerms(query);
    const temporalRange = resolveTemporalRange(query, now);
    const dueDateQuery = isDueDateQuery(query);
    const historicalIntent = /\b(?:previously|formerly|before|past|history|historical|used to|lived|worked|old)\b/iu.test(query);
    const calendarIntent = /\b(schedule|calendar|agenda|plan|plans|event|events|appointment|week|today|tomorrow|upcoming|doing)\b|(?:לוח שנה|יומן|תוכניות|השבוע|מחר)/iu.test(query);
    const records: IntelligenceSearchRecord[] = [];
    for (const [chatId, memory] of Object.entries(this.persisted.memories)) {
      if (excludedChatIds.has(chatId)) continue;
      const push = (record: Omit<IntelligenceSearchRecord, "score">, boost = 0, temporalTimestamp?: number) => {
        if (temporalRange && !isWithinTemporalRange(temporalTimestamp, temporalRange)) return;
        const haystack = `${memory.chatName || ""} ${record.senderName || ""} ${record.content}`.toLocaleLowerCase();
        const matches = terms.reduce((score, term) => score + (haystack.includes(term) ? 3 : 0), 0);
        const recency = Math.max(0, 1 - (now - record.timestamp) / (180 * 86_400_000));
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
        }, sourceAuthor === "owner" ? 12 : 6, entry.timestamp);
      });
      memory.manualItems.forEach((item) => push({
        id: item.id,
        chatId,
        kind: "memory",
        content: item.content,
        sourceAuthor: "owner",
        status: "confirmed",
        timestamp: item.createdAt,
      }, 18, item.createdAt));
      memory.insights.filter((item) => item.status !== "outdated").forEach((item) => {
        const freshness = assessKnowledgeFreshness(item, now);
        const baseBoost = (item.validity || "current") === "historical"
          ? historicalIntent ? 18 : 1
          : item.status === "confirmed"
            ? (historicalIntent ? 4 : 20) + Math.round(item.confidence * 4)
            : 3 + Math.round(item.confidence * 2);
        push({
          id: item.id,
          chatId,
          kind: "insight",
          content: item.content,
          senderName: item.evidence.senderName,
          status: item.status,
          knowledgeValidity: item.validity || "current",
          knowledgeFreshness: freshness.state,
          knowledgeNeedsQualification: freshness.qualify,
          explanation: explainContactInsight(item, memory.insights, now),
          timestamp: item.lastReinforcedAt || item.updatedAt,
        }, Math.max(0, baseBoost * freshness.scoreMultiplier), item.evidence.timestamp);
      });
      memory.commitments.filter((item) => item.status === "open").forEach((item) => push(
        { id: item.id, chatId, kind: "commitment", content: item.content, senderName: item.assigneeName, status: item.status, timestamp: item.updatedAt },
        0,
        dueDateQuery && item.dueAt ? item.dueAt : item.evidence.timestamp,
      ));
      memory.todos
        .filter((item) => item.status === "inferred" || item.status === "open")
        .forEach((item) => push({
          id: item.id,
          chatId,
          kind: "todo",
          content: `${item.title}${item.dueAt ? ` — due ${new Date(item.dueAt).toLocaleString()}` : ""}`,
          senderName: item.evidence.senderName,
          status: item.status,
          timestamp: item.dueAt || item.updatedAt,
        }, 12, dueDateQuery && item.dueAt ? item.dueAt : item.evidence.timestamp));
      memory.events
        .filter((item) => item.status !== "dismissed" && (temporalRange || historicalIntent || item.startAt >= now - 86_400_000))
        .forEach((item) => push({
          id: item.id,
          chatId,
          kind: "calendar_event",
          content: `${item.title} — ${new Date(item.startAt).toLocaleString()}${item.location ? ` — ${item.location}` : ""}`,
          senderName: item.evidence.senderName,
          status: item.status,
          timestamp: item.startAt,
        }, calendarIntent ? 24 : 0, item.startAt));
      if (memory.profile && !memory.profile.staleAt && !temporalRange) {
        push({ id: `${chatId}-profile`, chatId, kind: "profile", content: memory.profile.summary, status: "confirmed", timestamp: memory.profile.updatedAt }, 16);
      }
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
      todos: [],
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
        mentionIds: Array.isArray(entry.mentionIds)
          ? [...new Set(entry.mentionIds
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim().slice(0, 240))
            .filter(Boolean))].slice(0, 30)
          : undefined,
        ownerMentioned: entry.ownerMentioned === true || undefined,
        excludeFromAutomaticLearning: entry.excludeFromAutomaticLearning === true || undefined,
        timestamp,
        messageId,
      });
      if (
        entry.role === "user" &&
        entry.excludeFromAutomaticLearning !== true &&
        this.getContact(chatId).knowledgeTracking === "enabled"
      ) {
        this.reconcileCommitmentLifecycle(memory, {
          content,
          author: entry.author,
          senderName: entry.senderName,
          timestamp,
          messageId,
        });
      }
      if (
        entry.role === "user" &&
        this.getContact(chatId).knowledgeTracking === "enabled" &&
        (entry.countAsIncoming !== false || entry.extractSignals === true)
      ) {
        this.extractLocalSignals(chatId, memory, {
          content,
          author: entry.author,
          senderName: entry.senderName,
          ownerMentioned: entry.ownerMentioned,
          excludeFromAutomaticLearning: entry.excludeFromAutomaticLearning,
          timestamp,
          messageId,
        });
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
    // A new owner or incoming entry changes the reply context. A cache key is
    // also verified on read, but deleting here avoids retaining stale private
    // judgments and guarantees a new relevant message can be reconsidered.
    delete this.persisted.replyAssessments[chatId];
    this.dedupeCalendarEventsAcrossChats();
    this.save();
    return added;
  }

  private extractLocalSignals(
    chatId: string,
    memory: ConversationMemory,
    entry: {
      content: string;
      author?: ConversationMemoryEntry["author"];
      senderName?: string;
      ownerMentioned?: boolean;
      excludeFromAutomaticLearning?: boolean;
      timestamp: number;
      messageId?: string;
    },
  ): void {
    if (entry.excludeFromAutomaticLearning) return;
    const text = entry.content;
    const lower = text.toLocaleLowerCase();
    const evidence = this.cleanEvidence({
      messageId: entry.messageId,
      excerpt: text,
      senderName: entry.senderName,
      timestamp: entry.timestamp,
    });
    const addInsight = (kind: ContactInsight["kind"], confidence: number) => {
      // The immediate extractor and the fuller AI pass share the same canonical
      // record, so a paraphrase only adds supporting evidence rather than a new topic.
      if (memory.manualItems.some((item) => this.isDuplicateKnowledgeText(item.content, text))) return;
      this.upsertInsight(memory.insights, { kind, content: text, confidence, evidence }, Date.now(), chatId);
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
    if (owner) {
      this.upsertCommitment(memory.commitments, {
        content: text, owner, assigneeName: entry.senderName, evidence,
      }, Date.now());
    }
    this.addCalendarSignal(memory, entry);
    this.addTodoSignal(chatId, memory, entry);
    memory.insights = this.dedupeKnowledgeInsights(memory.insights).slice(-200);
    memory.commitments = this.dedupeCommitments(memory.commitments).slice(-200);
    memory.todos = this.dedupeTodoTasks(memory.todos).slice(-400);
  }

  /**
   * Provide a lightweight immediate suggestion while the richer automatic
   * analysis is in flight. The analysis result updates this same task using
   * shared evidence rather than creating a second one.
   */
  private addTodoSignal(
    chatId: string,
    memory: ConversationMemory,
    entry: {
      content: string;
      author?: ConversationMemoryEntry["author"];
      senderName?: string;
      ownerMentioned?: boolean;
      timestamp: number;
      messageId?: string;
    },
  ): boolean {
    if (!isOwnerTodoSource(entry.content, {
      isGroup: chatId.endsWith("@g.us"),
      author: entry.author,
      ownerMentioned: entry.ownerMentioned,
      ownerName: this.persisted.ownerProfile.displayName,
    })) return false;
    const title = entry.content
      .replace(/^\s*(?:can|could|would|will)\s+you\s+/iu, "")
      .replace(/^\s*(?:please\s+|don't forget to\s+|do not forget to\s+|remember to\s+|remind me to\s+|i need to\s+|i have to\s+|i should\s+|i must\s+|you need to\s+|make sure to\s+)/iu, "")
      .replace(/^\s*(?:תוכל(?:י)?\s+|בבקשה\s+|אל תשכח(?:י)?\s+|תזכיר(?:י)?\s+לי\s+|אני צרי[כךה]?\s+|אני חייב(?:ת)?\s+)/iu, "")
      .replace(/[.?!]+$/u, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1_000);
    if (!title) return false;
    const now = Date.now();
    const presentation = presentTodo({
      source: entry.content,
      title: title.charAt(0).toLocaleUpperCase() + title.slice(1),
    });
    const candidate: Pick<TodoTask, "title" | "dueAt" | "evidence"> = {
      title: presentation.title,
      evidence: this.cleanEvidence({
        messageId: entry.messageId,
        excerpt: entry.content,
        senderName: entry.senderName,
        timestamp: entry.timestamp,
      }),
    };
    if (memory.todos.some((item) => this.isDuplicateTodoTask(item, candidate))) return false;
    memory.todos.push({
      id: randomUUID(),
      title: candidate.title,
      status: "inferred",
      priority: presentation.priority,
      evidence: candidate.evidence,
      createdAt: now,
      updatedAt: now,
    });
    return true;
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
      (event.status === "completed" ? 40 : event.status === "confirmed" ? 30 : event.status === "dismissed" ? 20 : 10)
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

  private ensureMemory(chatId: string): ConversationMemory {
    const memory = this.persisted.memories[chatId] || {
      entries: [], manualItems: [], insights: [], commitments: [], events: [], todos: [],
      incomingMessageCount: 0, updatedAt: 0,
    };
    this.persisted.memories[chatId] = memory;
    return memory;
  }

  private cleanEvidence(evidence: MemoryEvidence): MemoryEvidence {
    return {
      messageId: evidence.messageId?.trim().slice(0, 240) || undefined,
      excerpt: evidence.excerpt.replace(/\s+/g, " ").trim().slice(0, 600),
      senderName: evidence.senderName?.replace(/\s+/g, " ").trim().slice(0, 120) || undefined,
      timestamp: Number.isFinite(evidence.timestamp) ? evidence.timestamp : Date.now(),
      source: evidence.source === "whatsapp_bot" ? "whatsapp_bot" : undefined,
    };
  }

  private cleanEvidenceHistory(history: unknown, primary: MemoryEvidence): MemoryEvidence[] | undefined {
    const candidates = [primary, ...(Array.isArray(history) ? history : [])]
      .filter((item): item is MemoryEvidence => Boolean(item) && typeof item === "object" && typeof (item as MemoryEvidence).excerpt === "string")
      .map((item) => this.cleanEvidence(item));
    const unique = new Map<string, MemoryEvidence>();
    for (const item of candidates) {
      const key = item.messageId || item.timestamp + ":" + item.excerpt.toLocaleLowerCase();
      if (!unique.has(key)) unique.set(key, item);
    }
    const cleaned = [...unique.values()].sort((left, right) => left.timestamp - right.timestamp).slice(-12);
    return cleaned.length > 1 ? cleaned : undefined;
  }

  private mergeEvidenceHistory(
    primary: MemoryEvidence,
    history: MemoryEvidence[] | undefined,
    additional: MemoryEvidence,
    additionalHistory?: MemoryEvidence[],
  ): MemoryEvidence[] | undefined {
    return this.cleanEvidenceHistory([...(history || []), ...(additionalHistory || []), additional], primary);
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

  private normalizeCanonicalKnowledgeKey(value: string | undefined): string | undefined {
    const normalized = value?.normalize("NFKD").toLocaleLowerCase().replace(/\p{M}/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/gu, "").slice(0, 80);
    return normalized || undefined;
  }

  /**
   * Confirms only direct, high-confidence, current facts from a private
   * conversation. The AI still decides the canonical property and whether the
   * statement replaces or reinforces it; this gate decides whether that
   * proposal is safe to make authoritative without a review card.
   */
  private autonomousConfirmationFor(
    sourceChatId: string,
    insight: AnalyzedInsight,
  ): { at: number; reason: NonNullable<ContactInsight["autonomousConfirmationReason"]> } | undefined {
    if (
      insight.confidence < AUTONOMOUS_KNOWLEDGE_CONFIDENCE ||
      insight.kind === "relationship_change" ||
      (insight.validity || "current") !== "current" ||
      !this.normalizeCanonicalKnowledgeKey(insight.canonicalKey) ||
      sourceChatId.endsWith("@g.us")
    ) return undefined;

    const source = insight.evidence.messageId
      ? this.persisted.memories[sourceChatId]?.entries.find((entry) => entry.messageId === insight.evidence.messageId)
      : undefined;
    if (
      !source ||
      source.role !== "user" ||
      source.excludeFromAutomaticLearning ||
      (source.author !== "owner" && source.author !== "contact")
    ) return undefined;

    const statement = source.content.replace(/\s+/g, " ").trim();
    if (!statement || this.isUncertainKnowledgeStatement(statement) || this.isSensitiveKnowledgeStatement(statement, insight.content)) {
      return undefined;
    }

    if (source.author === "owner") {
      return { at: Date.now(), reason: "direct_owner_statement" };
    }
    if (!this.isDirectFirstPersonKnowledgeStatement(statement)) return undefined;
    return { at: Date.now(), reason: "direct_contact_statement" };
  }

  private isDirectFirstPersonKnowledgeStatement(value: string): boolean {
    return /(?:^|[.!?]\s+)(?:i(?:\s+(?:am|work|live|reside|moved|joined|left|started|became|prefer|love|like)|['’](?:m|ve))\b|my\s+(?:new\s+)?(?:home|apartment|place|job|office|employer|neighborhood|neighbourhood|favorite|favourite|diet)\b|אני\b|עברתי\b|הצטרפתי\b|עזבתי\b|התחלתי\b|נהייתי\b|גר(?:ה|ים|ות)?\b)/iu.test(value);
  }

  private isUncertainKnowledgeStatement(value: string): boolean {
    return /\b(?:might|may|maybe|perhaps|possibly|probably|thinking about|considering|hope to|want to|plan to|would like|could)\b|(?:אולי|חושב(?:ת|ים|ות)?|שוקל(?:ת|ים|ות)?|מתכננ(?:ת|ים|ות)?|מקווה)/iu.test(value);
  }

  private isSensitiveKnowledgeStatement(...values: string[]): boolean {
    return /\b(?:diagnos(?:is|ed)|medical|health condition|pregnan(?:t|cy)|religion|religious|politic(?:s|al)|ethnic(?:ity)?|sexual(?:ity| orientation))\b|(?:אבחנ|רפוא|בריאות|היריו|דת|פוליטי|מוצא|מיני)/iu.test(values.join(" "));
  }

  private inferredCanonicalKnowledgeKey(content: string, kind: ContactInsight["kind"]): string | undefined {
    const text = content.toLocaleLowerCase();
    if (/\b(?:live|lives|lived|living|reside|resides|moved|home is|based in)\b/iu.test(text)) return "residence";
    if (/\b(?:work|works|worked|working|job|employer|joined|left)\b/iu.test(text)) return "employer";
    if (/\b(?:vegetarian|vegan|diet|kosher|gluten|allerg)\b/iu.test(text)) return "diet";
    if (/\b(?:favorite|favourite)\s+restaurant\b/iu.test(text)) return "favorite_restaurant";
    if (/\b(?:birthday|born)\b/iu.test(text)) return "birthday";
    if (kind === "relationship_change" && /\b(?:partner|wife|husband|girlfriend|boyfriend|married|divorced)\b/iu.test(text)) return "partner";
    return undefined;
  }

  private latestKnowledgeEvidenceAt(insight: ContactInsight): number {
    const toMilliseconds = (value: number) => value > 0 && value < 10_000_000_000 ? value * 1_000 : value;
    return [insight.updatedAt, insight.lastReinforcedAt || 0, insight.evidence.timestamp, ...(insight.evidenceHistory || []).map((item) => item.timestamp)]
      .reduce((latest, value) => Math.max(latest, toMilliseconds(value)), 0);
  }

  private canMaintenancePromote(chatId: string, insight: ContactInsight): boolean {
    if (
      insight.status !== "inferred" ||
      (insight.validity || "current") !== "current" ||
      insight.kind === "relationship_change" ||
      insight.confidence < .88 ||
      chatId.endsWith("@g.us") ||
      !this.normalizeCanonicalKnowledgeKey(insight.canonicalKey) ||
      this.isSensitiveKnowledgeStatement(insight.content)
    ) return false;

    const memory = this.persisted.memories[chatId];
    if (!memory) return false;
    const distinct = new Map<string, ConversationMemoryEntry>();
    for (const evidence of [insight.evidence, ...(insight.evidenceHistory || [])]) {
      const source = evidence.messageId
        ? memory.entries.find((entry) => entry.messageId === evidence.messageId)
        : undefined;
      if (
        !source || source.role !== "user" || source.excludeFromAutomaticLearning ||
        (source.author !== "owner" && source.author !== "contact") ||
        this.isUncertainKnowledgeStatement(source.content) ||
        this.isSensitiveKnowledgeStatement(source.content, insight.content)
      ) continue;
      if (source.author === "contact" && !this.isDirectFirstPersonKnowledgeStatement(source.content)) continue;
      distinct.set(source.messageId || `${source.timestamp}:${source.content}`, source);
    }
    return distinct.size >= 2;
  }

  private reconcileConfirmedCanonicalInsight(chatId: string, insight: ContactInsight, now: number): void {
    const canonicalKey = this.normalizeCanonicalKnowledgeKey(insight.canonicalKey);
    if (!canonicalKey || (insight.validity || "current") !== "current" || insight.evolution !== "replace") return;
    const memory = this.persisted.memories[chatId];
    if (!memory) return;
    for (const prior of memory.insights) {
      if (prior.id === insight.id || prior.clusterId === insight.clusterId || prior.kind !== insight.kind ||
        (prior.validity || "current") !== "current" ||
        (this.normalizeCanonicalKnowledgeKey(prior.canonicalKey) || this.inferredCanonicalKnowledgeKey(prior.content, prior.kind)) !== canonicalKey) continue;
      prior.validity = "historical";
      prior.supersededById = insight.id;
      prior.supersededAt = now;
      prior.updatedAt = Math.max(prior.updatedAt, now);
    }
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
        ((item.validity || "current") === (insight.validity || "current") &&
          (item.canonicalKey && insight.canonicalKey && item.canonicalKey === insight.canonicalKey &&
            (item.evolution === "append" || insight.evolution === "append")
            ? this.similarText(item.content, insight.content)
            : this.isDuplicateKnowledgeText(item.content, insight.content))),
      );
      if (duplicateIndex < 0) {
        kept.push(insight);
        continue;
      }
      const current = kept[duplicateIndex]!;
      const replacement = statusPriority(insight.status) > statusPriority(current.status) ? insight : current;
      replacement.confidence = Math.max(current.confidence, insight.confidence);
      replacement.canonicalKey ||= current.canonicalKey || insight.canonicalKey;
      replacement.validity ||= current.validity || insight.validity || "current";
      replacement.evolution ||= current.evolution || insight.evolution || "append";
      replacement.reinforcementCount = Math.max(1, current.reinforcementCount || 1) + Math.max(1, insight.reinforcementCount || 1);
      replacement.lastReinforcedAt = Math.max(current.lastReinforcedAt || current.evidence.timestamp, insight.lastReinforcedAt || insight.evidence.timestamp);
      const originalEvidence = current.evidence.timestamp <= insight.evidence.timestamp ? current.evidence : insight.evidence;
      replacement.evidence = originalEvidence;
      replacement.evidenceHistory = this.cleanEvidenceHistory(
        [...(current.evidenceHistory || []), ...(insight.evidenceHistory || []), current.evidence, insight.evidence],
        originalEvidence,
      );
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

  private findKnowledgeInsightAcrossChats(
    content: string,
    targetChatIds: string[],
    validity: NonNullable<ContactInsight["validity"]> = "current",
  ): ContactInsight | undefined {
    const targets = new Set(targetChatIds);
    return Object.entries(this.persisted.memories)
      .filter(([chatId]) => targets.has(chatId))
      .flatMap(([, memory]) => memory.insights)
      .find((insight) => (insight.validity || "current") === validity && this.isDuplicateKnowledgeText(insight.content, content));
  }

  private isDuplicateCommitment(
    existing: RelationshipCommitment,
    candidate: Pick<RelationshipCommitment, "content" | "owner" | "assigneeName" | "dueAt" | "evidence">,
  ): boolean {
    if (existing.owner !== candidate.owner) return false;
    if (existing.assigneeName && candidate.assigneeName && !this.samePersonName(existing.assigneeName, candidate.assigneeName)) return false;
    const intent = (value: string) => {
      const normalized = value.toLocaleLowerCase();
      if (/\b(?:wake|alarm|get (?:me|him|her|them)?\s*up|make sure .{0,50}\bup)\b/iu.test(normalized)) return "wake";
      if (/\b(?:bring|deliver|drop off)\b/iu.test(normalized)) return "bring";
      if (/\b(?:send|sent|forward|share)\b/iu.test(normalized)) return "send";
      if (/\b(?:call|phone|ring)\b/iu.test(normalized)) return "call";
      if (/\b(?:book|reserve|schedule)\b/iu.test(normalized)) return "book";
      if (/\b(?:pay|paid|payment)\b/iu.test(normalized)) return "pay";
      if (/\b(?:buy|purchase|order)\b/iu.test(normalized)) return "buy";
      if (/\b(?:remind|remember)\b/iu.test(normalized)) return "remind";
      return undefined;
    };
    const existingIntent = intent(existing.content + " " + existing.evidence.excerpt);
    const candidateIntent = intent(candidate.content + " " + candidate.evidence.excerpt);
    // Shared conversational framing (for example, “I promised Dani I would”)
    // must not merge distinct actions such as sending photos and making a
    // phone call merely because they have the same due date.
    if (existingIntent && candidateIntent && existingIntent !== candidateIntent) return false;
    if (this.similarText(existing.content, candidate.content)) return true;

    const clockTimes = (value: string) => new Set(value.match(/(?<!\d)(?:[01]?\d|2[0-3]):[0-5]\d(?!\d)/gu) || []);
    const existingTimes = clockTimes(existing.content + " " + existing.evidence.excerpt);
    const candidateTimes = clockTimes(candidate.content + " " + candidate.evidence.excerpt);
    const sameClockTime = existingTimes.size > 0 && candidateTimes.size > 0 && [...existingTimes].some((value) => candidateTimes.has(value));
    const sameDueWindow = Boolean(existing.dueAt && candidate.dueAt && Math.abs(existing.dueAt - candidate.dueAt) <= 12 * 3_600_000);
    const toMilliseconds = (value: number) => value > 0 && value < 10_000_000_000 ? value * 1_000 : value;
    const existingEvidenceAt = [existing.evidence, ...(existing.evidenceHistory || [])]
      .reduce((latest, item) => Math.max(latest, toMilliseconds(item.timestamp)), 0);
    const evidenceWindow = Math.abs(
      existingEvidenceAt - toMilliseconds(candidate.evidence.timestamp),
    ) <= RELATIONSHIP_REVIEW_WINDOW_MS;
    if (existingIntent && existingIntent === candidateIntent && (sameClockTime || sameDueWindow) && evidenceWindow) return true;

    const ignored = new Set([
      "the", "and", "for", "about", "into", "look", "looking", "contact", "reach", "will", "part", "time", "role",
      "job", "position", "need", "needs", "keep", "promise", "can", "could", "would", "make", "sure", "please", "send",
      "call", "book", "pay", "buy", "bring", "deliver", "remind", "remember", "wake", "schedule", "message", "text", "email",
      "when", "return", "returning", "back", "from", "any", "place", "with", "source", "specified", "way", "work",
    ]);
    const meaningfulTokens = (value: string) => new Set(value
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/u)
      .filter((token) => token.length >= 3 && !/^\d+$/u.test(token) && !ignored.has(token))
      .map((token) => token.replace(/(?:ing|ers?|ed|s)$/u, ""))
      .filter((token) => token.length >= 3));
    const leftTokens = meaningfulTokens(existing.content);
    const rightTokens = meaningfulTokens(candidate.content);
    if (leftTokens.size === 0 || rightTokens.size === 0) return false;
    const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
    return shared >= 2 && shared / Math.min(leftTokens.size, rightTokens.size) >= 0.7;
  }

  private upsertInsight(
    insights: ContactInsight[],
    candidate: Pick<ContactInsight, "kind" | "content" | "confidence" | "evidence"> & Partial<Pick<ContactInsight, "id" | "clusterId" | "subjectChatIds" | "subjectNames" | "topicTitle" | "topicTitleConfidence" | "canonicalKey" | "validity" | "evolution" | "status" | "evidenceHistory" | "autonomouslyConfirmedAt" | "autonomousConfirmationReason" | "createdAt" | "updatedAt">>,
    now: number,
    chatId: string,
  ): { insight: ContactInsight; created: boolean } {
    const content = candidate.content.replace(/\s+/g, " ").trim().slice(0, 1_000);
    const evidence = this.cleanEvidence(candidate.evidence);
    const validity = candidate.validity === "historical" || candidate.validity === "temporary" ? candidate.validity : "current";
    const evolution = candidate.evolution === "replace" || candidate.evolution === "reinforce" ? candidate.evolution : "append";
    const suppliedCanonicalKey = this.normalizeCanonicalKnowledgeKey(candidate.canonicalKey);
    const canonicalKey = suppliedCanonicalKey;
    const duplicate = insights.find((item) =>
      (candidate.clusterId && item.clusterId === candidate.clusterId) ||
      ((item.validity || "current") === validity && (suppliedCanonicalKey && evolution === "append"
        ? this.similarText(item.content, content)
        : this.isDuplicateKnowledgeText(item.content, content))) ||
      (item.kind === candidate.kind && Boolean(candidate.evidence.messageId) && item.evidence.messageId === candidate.evidence.messageId && this.hasKnowledgeSubsetOverlap(item.content, content)),
    );
    const existing = duplicate || (canonicalKey && validity === "current" && evolution === "reinforce"
      ? insights.find((item) => item.kind === candidate.kind && item.status !== "outdated" &&
        (item.validity || "current") === "current" &&
        (this.normalizeCanonicalKnowledgeKey(item.canonicalKey) || this.inferredCanonicalKnowledgeKey(item.content, item.kind)) === canonicalKey)
      : undefined);
    if (!existing) {
      const insight: ContactInsight = {
        id: candidate.id || randomUUID(),
        clusterId: candidate.clusterId || randomUUID(),
        subjectChatIds: candidate.subjectChatIds ? [...new Set(candidate.subjectChatIds)] : [chatId],
        subjectNames: candidate.subjectNames ? [...new Set(candidate.subjectNames)] : undefined,
        kind: candidate.kind,
        content,
        topicTitle: candidate.topicTitle?.replace(/\s+/g, " ").trim().slice(0, 80) || undefined,
        topicTitleConfidence: Number.isFinite(candidate.topicTitleConfidence) ? Math.max(0, Math.min(1, candidate.topicTitleConfidence!)) : undefined,
        canonicalKey,
        validity,
        evolution,
        status: candidate.status || "inferred",
        confidence: Math.max(0, Math.min(1, candidate.confidence)),
        evidence,
        evidenceHistory: this.cleanEvidenceHistory(candidate.evidenceHistory, evidence),
        reinforcementCount: 1,
        lastReinforcedAt: evidence.timestamp,
        autonomouslyConfirmedAt: candidate.autonomouslyConfirmedAt,
        autonomousConfirmationReason: candidate.autonomousConfirmationReason,
        createdAt: Number.isFinite(candidate.createdAt) ? candidate.createdAt! : now,
        updatedAt: Number.isFinite(candidate.updatedAt) ? candidate.updatedAt! : now,
      };
      if (canonicalKey && validity === "current" && evolution === "replace") {
        for (const prior of insights) {
          if (prior.kind !== candidate.kind || (prior.validity || "current") !== "current" ||
            (this.normalizeCanonicalKnowledgeKey(prior.canonicalKey) || this.inferredCanonicalKnowledgeKey(prior.content, prior.kind)) !== canonicalKey || prior.status === "confirmed") continue;
          prior.validity = "historical";
          prior.supersededById = insight.id;
          prior.supersededAt = now;
        }
      }
      insights.push(insight);
      return { insight, created: true };
    }
    const candidateConfidence = Math.max(0, Math.min(1, candidate.confidence));
    existing.confidence = Math.min(.99, 1 - (1 - existing.confidence) * (1 - candidateConfidence * .35));
    existing.evidenceHistory = this.mergeEvidenceHistory(existing.evidence, existing.evidenceHistory, evidence, candidate.evidenceHistory);
    existing.reinforcementCount = Math.max(1, existing.reinforcementCount || 1) + 1;
    existing.lastReinforcedAt = Math.max(existing.lastReinforcedAt || existing.evidence.timestamp, evidence.timestamp);
    existing.canonicalKey ||= canonicalKey;
    existing.validity ||= validity;
    existing.evolution ||= evolution;
    existing.clusterId ||= candidate.clusterId || randomUUID();
    existing.subjectChatIds = [...new Set([...(existing.subjectChatIds || [chatId]), ...(candidate.subjectChatIds || [])])];
    existing.subjectNames = [...new Set([...(existing.subjectNames || []), ...(candidate.subjectNames || [])])];
    if (candidate.status === "confirmed" && candidate.autonomouslyConfirmedAt && existing.status === "inferred") {
      existing.status = "confirmed";
      existing.autonomouslyConfirmedAt = candidate.autonomouslyConfirmedAt;
      existing.autonomousConfirmationReason = candidate.autonomousConfirmationReason;
    }
    if ((candidate.topicTitleConfidence || 0) > (existing.topicTitleConfidence || 0)) {
      existing.topicTitle = candidate.topicTitle?.replace(/\s+/g, " ").trim().slice(0, 80) || existing.topicTitle;
      existing.topicTitleConfidence = candidate.topicTitleConfidence;
    }
    // Explicit review decisions remain durable. Inferred wording can improve,
    // but the original evidence continues to anchor the canonical topic.
    if ((existing.status === "inferred" && this.similarText(existing.content, existing.evidence.excerpt)) ||
      (evolution === "reinforce" && content.length > existing.content.length && evidence.timestamp >= existing.evidence.timestamp)) {
      existing.content = content;
    }
    existing.updatedAt = Math.max(existing.updatedAt, now);
    return { insight: existing, created: false };
  }

  private reconcileCommitmentLifecycle(
    memory: ConversationMemory,
    entry: Pick<ConversationMemoryEntry, "content" | "author" | "senderName" | "timestamp" | "messageId">,
  ): void {
    const text = entry.content.toLocaleLowerCase();
    const completed = /\b(?:i(?:'ve| have)?\s+(?:done|finished|completed|sent|called|booked|paid|handled)|it(?:'s| is) done|all set|taken care of|confirmed)\b/iu.test(text);
    const cancelled = /\b(?:cancel(?:led)?|called off|never mind|no longer need|don['’]?t (?:need|worry))\b/iu.test(text);
    if (!completed && !cancelled) return;

    const owner = entry.author === "owner"
      ? "me"
      : entry.author === "group_member"
        ? "group_member"
        : entry.author === "contact"
          ? "contact"
          : undefined;
    const candidates = memory.commitments.filter((item) =>
      (item.status === "open" || item.status === "needs_review") && (cancelled || item.owner === owner),
    );
    const matching = candidates.filter((item) => this.commitmentMatchesMessage(item, entry.content));
    // Pronouns such as “I sent it” are only safe to reconcile when there is
    // one open obligation for that speaker; otherwise leave it untouched.
    const referential = /\b(?:it|that|this)\b/iu.test(entry.content);
    const target = matching.length === 1
      ? matching[0]
      : matching.length === 0 && referential && candidates.length === 1
        ? candidates[0]
        : undefined;
    if (!target) return;

    const evidence = this.cleanEvidence({
      messageId: entry.messageId,
      excerpt: entry.content,
      senderName: entry.senderName,
      timestamp: entry.timestamp,
    });
    this.upsertCommitment(memory.commitments, {
      ...target,
      status: cancelled ? "dismissed" : "done",
      evidence,
    }, Date.now());
  }

  private commitmentMatchesMessage(commitment: RelationshipCommitment, message: string): boolean {
    const normalizeAction = (value: string) => value
      .toLocaleLowerCase()
      .replace(/\b(?:sent|sending)\b/gu, "send")
      .replace(/\b(?:called|calling)\b/gu, "call")
      .replace(/\b(?:booked|booking)\b/gu, "book")
      .replace(/\b(?:paid|paying)\b/gu, "pay")
      .replace(/\b(?:finished|finishing|completed|completing)\b/gu, "complete");
    const normalizedMessage = normalizeAction(message);
    const normalizedCommitment = normalizeAction(commitment.content);
    return this.similarText(normalizedCommitment, normalizedMessage) ||
      this.hasMeaningfulKnowledgeOverlap(normalizedCommitment, normalizedMessage);
  }

  private upsertCommitment(
    commitments: RelationshipCommitment[],
    candidate: Pick<RelationshipCommitment, "content" | "owner" | "assigneeName" | "dueAt" | "evidence"> & Partial<Pick<RelationshipCommitment, "id" | "status" | "evidenceHistory" | "createdAt" | "updatedAt">>,
    now: number,
  ): { commitment: RelationshipCommitment; created: boolean } {
    const content = candidate.content.replace(/\s+/g, " ").trim().slice(0, 1_000);
    const evidence = this.cleanEvidence(candidate.evidence);
    const existing = commitments.find((item) => this.isDuplicateCommitment(item, { ...candidate, content }));
    if (!existing) {
      const commitment: RelationshipCommitment = {
        id: candidate.id || randomUUID(), content, owner: candidate.owner,
        assigneeName: candidate.assigneeName?.replace(/\s+/g, " ").trim().slice(0, 120) || undefined,
        status: candidate.status || "open",
        dueAt: Number.isFinite(candidate.dueAt) ? candidate.dueAt : undefined,
        evidence,
        evidenceHistory: this.cleanEvidenceHistory(candidate.evidenceHistory, evidence),
        createdAt: Number.isFinite(candidate.createdAt) ? candidate.createdAt! : now,
        updatedAt: Number.isFinite(candidate.updatedAt) ? candidate.updatedAt! : now,
      };
      commitments.push(commitment);
      return { commitment, created: true };
    }

    existing.evidenceHistory = this.mergeEvidenceHistory(existing.evidence, existing.evidenceHistory, evidence, candidate.evidenceHistory);
    // A reviewed lifecycle decision is durable. New evidence may refine its
    // wording or date, but cannot silently reopen a completed/dismissed item.
    if (existing.status === "open" || existing.status === "needs_review") {
      existing.content = content;
      if (candidate.status === "done" || candidate.status === "dismissed") existing.status = candidate.status;
      else existing.status = "open";
      if (Number.isFinite(candidate.dueAt)) existing.dueAt = candidate.dueAt;
      if (candidate.assigneeName?.trim()) existing.assigneeName = candidate.assigneeName.replace(/\s+/g, " ").trim().slice(0, 120);
    }
    existing.createdAt = Math.min(existing.createdAt, now);
    existing.updatedAt = Math.max(existing.updatedAt, now);
    return { commitment: existing, created: false };
  }

  private dedupeCommitments(commitments: RelationshipCommitment[]): RelationshipCommitment[] {
    const canonical: RelationshipCommitment[] = [];
    for (const commitment of commitments) {
      this.upsertCommitment(canonical, commitment, commitment.updatedAt);
    }
    return canonical;
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

  private isDuplicateTodoTask(
    existing: TodoTask,
    candidate: Pick<TodoTask, "title" | "dueAt" | "evidence">,
  ): boolean {
    const sameEvidence =
      (Boolean(candidate.evidence.messageId) && existing.evidence.messageId === candidate.evidence.messageId) ||
      (existing.evidence.timestamp === candidate.evidence.timestamp &&
        this.similarText(existing.evidence.excerpt, candidate.evidence.excerpt));
    if (sameEvidence) return true;
    if (existing.dueAt && candidate.dueAt && Math.abs(existing.dueAt - candidate.dueAt) > 24 * 3_600_000) return false;
    if (this.similarText(existing.title, candidate.title) || this.hasMeaningfulKnowledgeOverlap(existing.title, candidate.title)) return true;

    // Action words themselves are not enough to make two tasks equivalent.
    // “Call the dentist” and “call David” should coexist, while “follow up
    // with Shelly” and “follow-up Shelly” should collapse.
    const ignored = new Set([
      "call", "text", "message", "email", "reply", "follow", "followup", "up", "check", "buy", "pick", "drop", "bring",
      "book", "pay", "order", "send", "return", "collect", "prepare", "write", "read", "review", "contact", "ask", "confirm",
      "cancel", "reschedule", "fix", "make", "take", "leave", "organize", "arrange", "remind", "the", "a", "an", "to", "with",
      "for", "and", "on", "at", "my", "your", "me", "please", "today", "tomorrow", "monday", "tuesday", "wednesday", "thursday",
      "friday", "saturday", "sunday",
    ]);
    const tokens = (value: string) => new Set(value
      .normalize("NFKD")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/u)
      .map((token) => token.replace(/(?:ing|ed|s)$/u, ""))
      .filter((token) => token.length >= 3 && !ignored.has(token) && !/^\d+$/u.test(token)));
    const left = tokens(existing.title);
    const right = tokens(candidate.title);
    if (left.size === 0 || right.size === 0) return false;
    const shared = [...left].filter((token) => right.has(token)).length;
    return shared >= 1 && shared / Math.min(left.size, right.size) >= 0.8;
  }

  private dedupeTodoTasks(tasks: TodoTask[]): TodoTask[] {
    const kept: TodoTask[] = [];
    const priority = (status: TodoTask["status"]) =>
      status === "done" ? 4 : status === "dismissed" ? 3 : status === "open" ? 2 : 1;
    for (const task of tasks) {
      const index = kept.findIndex((existing) => this.isDuplicateTodoTask(existing, task));
      if (index < 0) {
        kept.push(task);
        continue;
      }
      const current = kept[index]!;
      const replacement = priority(task.status) > priority(current.status) ? task : current;
      replacement.createdAt = Math.min(current.createdAt, task.createdAt);
      replacement.updatedAt = Math.max(current.updatedAt, task.updatedAt);
      kept[index] = replacement;
    }
    return kept;
  }

  private dedupeTodoTasksAcrossMemories(): boolean {
    let changed = false;
    for (const memory of Object.values(this.persisted.memories)) {
      const deduped = this.dedupeTodoTasks(memory.todos || []);
      if (deduped.length === (memory.todos || []).length) continue;
      memory.todos = deduped;
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
      todos: [],
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

  addOwnerKnowledge(chatId: string, content: string): { item: ContactMemoryItem; created: boolean } {
    const normalized = content.replace(/\s+/g, " ").trim().slice(0, 1_000);
    if (!normalized) throw new Error("Knowledge cannot be empty");
    const memory = this.ensureMemory(chatId);
    const existing = memory.manualItems.find((item) => this.isDuplicateKnowledgeText(item.content, normalized));
    if (existing) return { item: structuredClone(existing), created: false };
    const item = { id: randomUUID(), content: normalized, createdAt: Date.now() };
    memory.manualItems.push(item);
    memory.manualItems = memory.manualItems.slice(-100);
    memory.updatedAt = Date.now();
    this.save();
    return { item: structuredClone(item), created: true };
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
      todos: [],
      incomingMessageCount: 0,
      updatedAt: 0,
    };
    const profile = {
      summary: normalized,
      updatedAt: Date.now(),
      sourceMessageCount: memory.incomingMessageCount,
      sourceKnowledgeUpdatedAt: memory.insights
        .filter((item) => item.status === "confirmed" && (item.validity || "current") !== "historical")
        .reduce((latest, item) => Math.max(latest, item.updatedAt), 0),
      sourceKnowledgeVersion: this.canonicalKnowledgeVersion(memory.insights),
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
    excludeFromAutomaticLearning = false,
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
      excludeFromAutomaticLearning,
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
      // A settings request that only changes a profile does not include a
      // theme. Keep the current theme instead of allowing an `undefined`
      // optional field to replace it and fall back to Forest on next load.
      theme: patch.theme ?? this.persisted.theme,
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
