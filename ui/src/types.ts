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
export type ThemeName =
  | "forest"
  | "ocean"
  | "plum"
  | "sand"
  | "indigo"
  | "rose"
  | "graphite";

export type ContactPreferences = {
  mode: ReplyMode;
  relationship: string;
  tone: string;
  language: string;
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
    };
    models?: { text: string; image: string; voice: string };
    ownerProfile: { displayName: string; avatarUrl: string };
  };
};

export type ChatSummary = {
  id: string;
  name: string;
  isGroup: boolean;
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
  profile?: ContactProfile;
  styleProfile?: WritingStyleProfile;
  groupSummary?: GroupConversationSummary;
  needsReply: boolean;
  lastIncoming?: ChatMemoryEntry;
  updatedAt: number;
};

export type IntelligenceData = {
  generatedAt: number;
  needsReply: IntelligenceChat[];
  commitments: Array<RelationshipCommitment & { chatId: string; contactName: string }>;
  changes: Array<ContactInsight & { chatId: string; contactName: string }>;
  events: Array<CalendarEvent & { chatId: string; contactName: string }>;
  chats: IntelligenceChat[];
  questionHistory: Array<{
    id: string;
    question: string;
    answer: string;
    sources: IntelligenceSearchResult["sources"];
    createdAt: number;
  }>;
  suggestedQuestions: string[];
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
    timestamp: number;
    score: number;
  }>;
};

export type TerminalLog = {
  output: string;
  updatedAt: number;
};
