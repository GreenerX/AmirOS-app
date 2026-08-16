export type ViewName =
  | "overview"
  | "intelligence"
  | "calendar"
  | "inbox"
  | "contacts"
  | "automations"
  | "usage"
  | "terminal"
  | "settings";

export type ReplyMode = "off" | "suggest" | "auto";
export type AutoReplyInitialDelaySeconds = 15 | 30 | 45 | 60 | 90;
export type OwnerTriggerAccess = "knowledge" | "calendar";
export type KnowledgeTrackingStatus = "pending" | "snoozed" | "enabled" | "disabled";
export type KnowledgeTrackingDefault = "ask" | "private" | "off";
export type ModelPreset = "economy" | "balanced" | "quality";

export type ReleaseNote = {
  title: string;
  detail: string;
};

export type AmirOSRelease = {
  version: string;
  releasedAt: string;
  headline: string;
  notes: ReleaseNote[];
  history?: AmirOSRelease[];
};

export type AmirOSUpdateStatus = {
  status: "available" | "current" | "unavailable";
  currentVersion: string;
  latestVersion?: string;
  checkedAt: number;
  detail?: string;
};
export type ThemeName =
  | "forest"
  | "ocean"
  | "plum"
  | "sand"
  | "indigo"
  | "rose"
  | "graphite";

/** An explicit, per-contact preference. AmirOS never infers this from a name or photo. */
export type ContactPronouns = "unspecified" | "she/her" | "he/him" | "they/them";

export type ContactPreferences = {
  mode: ReplyMode;
  autoReplyInitialDelaySeconds?: AutoReplyInitialDelaySeconds;
  relationship: string;
  pinned: boolean;
  hidden: boolean;
  tone: string;
  language: string;
  pronouns: ContactPronouns;
  memoryEnabled: boolean;
  knowledgeTracking: KnowledgeTrackingStatus;
  customInstructions: string;
  ownerTriggerAccess: OwnerTriggerAccess[];
  contactTriggerAccess: OwnerTriggerAccess[];
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

export type Draft = {
  id: string;
  chatId: string;
  contactName: string;
  sourcePreview: string;
  body: string;
  createdAt: number;
  status: "pending" | "sent" | "dismissed";
};

export type Activity = {
  id: string;
  kind: "text" | "voice" | "image" | "web" | "system";
  title: string;
  detail: string;
  timestamp: number;
};

export type DashboardData = {
  release: AmirOSRelease;
  betaSupport: { url?: string; email?: string; build?: string };
  connection: {
    status: "starting" | "qr" | "authenticated" | "ready" | "disconnected";
    detail: string;
  };
  paused: boolean;
  preset: ModelPreset;
  models: { text: string; image: string; voice: string };
  modelOptions: { text: string[]; image: string[]; voice: string[] };
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    textRequests: number;
    imageRequests: number;
    transcriptionRequests: number;
    webSearchCalls: number;
    transcriptionSeconds: number;
    textCostUsd: number;
    imageCostUsd: number;
    transcriptionCostUsd: number;
    webSearchCostUsd: number;
    estimatedCostUsd: number;
    pricingSourceUrl: string;
    imagePricingSourceUrl: string;
    pricingUpdatedAt: string;
  };
  monthlySpendUsd: number;
  drafts: Draft[];
  activities: Activity[];
  knowledgeTrackingRequests: KnowledgeTrackingRequest[];
  settings: {
    theme: ThemeName;
    knowledgeTrackingDefault: KnowledgeTrackingDefault;
    contacts: Record<string, ContactPreferences>;
    quietHours: { enabled: boolean; start: string; end: string };
    monthlyBudgetUsd: number;
    apiKeyConfigured: boolean;
    assistant: {
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
    models?: { text: string; image: string; voice: string };
    ownerProfile: { displayName: string; avatarUrl: string };
  };
};

export type ChatSummary = {
  id: string;
  name: string;
  isGroup: boolean;
  /** Existing favorite state; used to prioritize first-run People suggestions. */
  pinned?: boolean;
  unreadCount: number;
  timestamp: number;
  preview: string;
  mode: ReplyMode;
  avatarUrl?: string;
};

export type ChatMessage = {
  id: string;
  body: string;
  fullBody: string;
  fromMe: boolean;
  timestamp: number;
  type: string;
  hasMedia: boolean;
  mediaUrl?: string;
  senderId?: string;
  senderName?: string;
  quotedMessage?: {
    id: string;
    body: string;
    fromMe: boolean;
    senderId?: string;
    senderName?: string;
  };
  localReaction?: string;
  reactions?: Array<{
    emoji: string;
    hasReactionByMe?: boolean;
    senders: Array<{ id: string; name?: string; timestamp?: number }>;
  }>;
  call?: {
    direction: "incoming" | "outgoing";
    kind?: "voice" | "video";
    missed?: boolean;
    durationSeconds?: number;
  };
};

export type ChatMemoryEntry = {
  role: "user" | "assistant";
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
  sourceKnowledgeUpdatedAt?: number;
  sourceKnowledgeVersion?: string;
  staleAt?: number;
  staleReason?: "canonical_knowledge_changed";
};

export type MemoryEvidence = {
  messageId?: string;
  excerpt: string;
  senderName?: string;
  timestamp: number;
  source?: "whatsapp_bot";
};

export type MemoryExplanation = {
  summary: string;
  statusLabel: "Current" | "Historical" | "Temporary" | "Pending review" | "Outdated";
  confidenceLabel: "High confidence" | "Medium confidence" | "Low confidence";
  confidencePercent: number;
  freshnessLabel: string;
  evidenceCount: number;
  reinforcedCount: number;
  origin: string;
  replaced?: string[];
  replacedBy?: string;
  bullets: string[];
};

export type ContactInsight = {
  id: string;
  clusterId?: string;
  subjectChatIds?: string[];
  subjectNames?: string[];
  kind: "fact" | "preference" | "relationship_change" | "important_date";
  content: string;
  topicTitle?: string;
  topicTitleConfidence?: number;
  canonicalKey?: string;
  validity?: "current" | "historical" | "temporary";
  evolution?: "reinforce" | "replace" | "append";
  supersededById?: string;
  supersededAt?: number;
  reinforcementCount?: number;
  lastReinforcedAt?: number;
  autonomouslyConfirmedAt?: number;
  autonomousConfirmationReason?: "direct_owner_statement" | "direct_contact_statement";
  maintenanceConfirmedAt?: number;
  maintenanceConfirmationReason?: "repeated_direct_evidence";
  freshness?: "timeless" | "fresh" | "aging" | "stale" | "historical" | "uncertain";
  explanation?: MemoryExplanation;
  status: "inferred" | "confirmed" | "outdated";
  confidence: number;
  evidenceHistory?: MemoryEvidence[];
  evidence: MemoryEvidence;
  createdAt: number;
  updatedAt: number;
};

export type RelationshipCommitment = {
  id: string;
  content: string;
  owner: "me" | "contact" | "group_member";
  assigneeName?: string;
  status: "open" | "needs_review" | "done" | "dismissed";
  dueAt?: number;
  note?: string;
  evidence: MemoryEvidence;
  createdAt: number;
  evidenceHistory?: MemoryEvidence[];
  updatedAt: number;
};

export type CalendarEvent = {
  id: string;
  title: string;
  startAt: number;
  endAt?: number;
  allDay: boolean;
  location?: string;
  note?: string;
  imageUrl?: string;
  status: "inferred" | "confirmed" | "completed" | "dismissed";
  completedAt?: number;
  evidence: MemoryEvidence;
  createdAt: number;
  updatedAt: number;
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

export type IntelligenceChat = {
  chatId: string;
  contactName: string;
  isGroup: boolean;
  insights: ContactInsight[];
  commitments: RelationshipCommitment[];
  events: CalendarEvent[];
  /**
   * Older local dashboard data may not have the task pipeline yet. Keep this
   * optional at the boundary so an upgraded interface can render safely while
   * the server catches up; consumers default to an empty list.
   */
  todos?: TodoTask[];
  profile?: ContactProfile;
  styleProfile?: WritingStyleProfile;
  groupSummary?: GroupConversationSummary;
  needsReply: boolean;
  /** Rich reply assessment is intentionally available for future UI treatment; current labels still use needsReply. */
  replyAssessment?: {
    needsReply: boolean;
    mayNeedReply: boolean;
    confidence: number;
    source: "deterministic" | "ai";
    reason: string;
  };
  lastIncoming?: ChatMemoryEntry;
  /** Latest human message in either direction; separate from reply-oriented inbound activity. */
  lastInteraction?: ChatMemoryEntry;
  updatedAt: number;
};

export type TodoTask = {
  id: string;
  chatId: string;
  contactName: string;
  title: string;
  status: "inferred" | "open" | "done" | "dismissed";
  priority: "low" | "normal" | "high";
  dueAt?: number;
  note?: string;
  completedAt?: number;
  evidence: MemoryEvidence;
  createdAt: number;
  updatedAt: number;
};

export type IntelligenceData = {
  generatedAt: number;
  needsReply: IntelligenceChat[];
  commitments: Array<RelationshipCommitment & { chatId: string; contactName: string }>;
  changes: Array<ContactInsight & { chatId: string; contactName: string }>;
  /** Confirmed calendar history plus current suggestions. `events` remains the current dashboard feed. */
  calendarEvents?: Array<CalendarEvent & { chatId: string; contactName: string }>;
  events: Array<CalendarEvent & { chatId: string; contactName: string }>;
  /** Optional while an existing local installation has not yet received the to-do pipeline. */
  todos?: TodoTask[];
  chats: IntelligenceChat[];
  questionHistory: Array<{
    id: string;
    question: string;
    answer: string;
    sources: IntelligenceSearchResult["sources"];
    createdAt: number;
  }>;
  suggestedQuestions: string[];
  proactive?: ProactiveIntelligenceItem[];
};

export type ProactiveIntelligenceItem = {
  id: string;
  fingerprint: string;
  kind: "upcoming_context" | "commitment" | "todo" | "reply" | "meaningful_change";
  priority: number;
  title: string;
  detail: string;
  why: string;
  chatId: string;
  contactName: string;
  sourceIds: string[];
  messageId?: string;
  action: "chat" | "calendar" | "todo";
  timestamp: number;
  aiAssessment?: {
    confidence: number;
    reason: string;
  };
};

export type IntelligenceSearchResult = {
  answer: string;
  evidenceIds: string[];
  sources: Array<{
    id: string;
    chatId: string;
    contactName: string;
    kind: "message" | "memory" | "insight" | "commitment" | "profile" | "calendar_event";
    content: string;
    senderName?: string;
    explanation?: MemoryExplanation;
    timestamp: number;
    score: number;
  }>;
};

export type TerminalLog = {
  output: string;
  updatedAt: number;
};
