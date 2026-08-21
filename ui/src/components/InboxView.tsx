import {
  ArrowLeft,
  Bot,
  Brain,
  CalendarDays,
  Check,
  Download,
  ExternalLink,
  Image,
  Languages,
  LockKeyhole,
  Mail,
  MemoryStick,
  MessageSquareText,
  MapPin,
  Mic,
  Phone,
  PhoneMissed,
  Paperclip,
  PencilLine,
  Plus,
  Power,
  RefreshCw,
  Search,
  Send,
  Share2,
  ShieldAlert,
  Sparkles,
  Trash2,
  UserRound,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Copy,
  Clock3,
  CalendarClock,
  MoreHorizontal,
  Forward,
  Reply,
  Smile,
  UploadCloud,
  Video,
  X,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { formatDateTime, formatTime } from "../format";
import { contactProfilePdfUrl, searchTimeZoneCities } from "../api";
import { FIRST_RUN_PEOPLE_SCAN_LIMIT } from "../onboarding-people";
import { WhatsAppIcon } from "./BrandIcons";
import { ContactAvatar } from "./ContactAvatar";
import { ChatMedia } from "./ChatMedia";
import { callEventPresentation, mergedMessageReactions } from "../inbox-message-presentation";
import { isNearChatBottom, shouldFollowNewMessages, shouldShowNewMessageJump } from "../inbox-scroll";
import {
  createInboxFilterPreference,
  DEFAULT_INBOX_FILTER,
  readInboxFilterPreference,
  type InboxFilter,
} from "../inbox-filter-preference";
import { messageTimestamp, orderChatsByRecency, orderMessagesChronologically } from "../message-order";
import { textDirection } from "../text-direction";
import { suggestReplyForMessage } from "../api";
import type { TimeZoneCity } from "../timezone-weather";
import type {
  ChatMessage,
  ChatMemoryEntry,
  ChatSummary,
  ContactMemoryItem,
  ContactInsight,
  ContactPreferences,
  AutoReplyInitialDelaySeconds,
  ContactPronouns,
  ContactProfile,
  Draft,
  GroupConversationSummary,
  OwnerTriggerAccess,
  ReplyMode,
  WritingStyleProfile,
  ScheduledMessage,
} from "../types";

type InboxViewProps = {
  chats: ChatSummary[];
  hasMoreChats: boolean;
  loadingMoreChats: boolean;
  onLoadMoreChats: () => Promise<void>;
  unreadCount: number;
  initialFilter?: Filter;
  initialContactSettingsTab?: "configure" | "knowledge";
  selectedChatId?: string;
  highlightedMessageId?: string;
  messages: ChatMessage[];
  memory: ChatMemoryEntry[];
  manualMemory: ContactMemoryItem[];
  profile?: ContactProfile;
  insights: ContactInsight[];
  styleProfile?: WritingStyleProfile;
  groupSummary?: GroupConversationSummary;
  groupDescription?: string;
  composerDraft?: string;
  onComposerDraftConsumed: () => void;
  incomingMessageCount: number;
  contact?: ContactPreferences;
  drafts: Draft[];
  scheduledMessages: ScheduledMessage[];
  loading: boolean;
  onSelectChat: (chatId: string | undefined) => void;
  onMarkRead: (chatId: string) => Promise<void>;
  onModeChange: (chatId: string, mode: ReplyMode) => Promise<void>;
  autoModeEnabled?: boolean;
  deletedMessageArchiveEnabled?: boolean;
  onContactChange: (
    chatId: string,
    patch: Partial<ContactPreferences>,
  ) => Promise<boolean>;
  onAddMemory: (chatId: string, content: string) => Promise<void>;
  onRemoveMemory: (chatId: string, itemId: string) => Promise<void>;
  onGenerateProfile: (chatId: string) => Promise<void>;
  onAnalyzeIntelligence: (chatId: string, messageLimit?: number) => Promise<void>;
  onInsightChange: (chatId: string, insightId: string, patch: { status?: ContactInsight["status"]; content?: string }) => Promise<void>;
  onGenerateWritingStyle: (chatId: string) => Promise<void>;
  onGenerateGroupSummary: (chatId: string) => Promise<void>;
  onApproveDraft: (draft: Draft, body: string) => Promise<void>;
  onDismissDraft: (draft: Draft) => Promise<void>;
  onSend: (chatId: string, body: string) => Promise<void>;
  onSchedule: (chatId: string, input: { body: string; scheduledAt: number; timezone: string }) => Promise<ScheduledMessage>;
  onUpdateScheduled: (id: string, patch: { body?: string; scheduledAt?: number; timezone?: string }) => Promise<ScheduledMessage>;
  onCancelScheduled: (id: string) => Promise<ScheduledMessage>;
  onTranslate: (input: { body: string; targetLanguage: string; sourceLanguage?: string }) => Promise<{ body: string; targetLanguage: string }>;
  onSendMedia: (chatId: string, file: File, caption: string, voiceNote?: boolean) => Promise<void>;
  onGenerateImage: (chatId: string, prompt: string) => Promise<{ data: string; mimetype: string; filename: string; prompt: string }>;
  onReact: (chatId: string, messageId: string, emoji: string) => Promise<void>;
  onReply: (chatId: string, messageId: string, body: string) => Promise<void>;
  onForward: (chatId: string, messageId: string, targetChatId: string) => Promise<void>;
  onScanHistory: (chatId: string, limit?: number) => Promise<{ scanned: number; added: number }>;
  onRevealDeletedMessage: (chatId: string, archiveId: string) => Promise<void>;
  onHideDeletedMessage: (chatId: string, archiveId: string) => void;
};

type Filter = InboxFilter;

const INBOX_FILTER_PREFERENCE_KEY = "amiros-inbox-filter-preference";

type TranslationPreview = {
  original: string;
  body: string;
  targetLanguage: string;
  stale: boolean;
};

type TranslatedMessage = {
  body: string;
  targetLanguage: string;
};

type ScheduleEditor = {
  body: string;
  scheduledAt: string;
  timezone: string;
  timeBasis: "contact" | "owner";
  id?: string;
  composerBeforeEditing?: string;
};

const NEXT_REPLY_MODE: Record<ReplyMode, ReplyMode> = {
  off: "suggest",
  suggest: "auto",
  auto: "off",
};

const AUTO_REPLY_DELAY_OPTIONS: AutoReplyInitialDelaySeconds[] = [15, 30, 45, 60, 90];

const RELATIONSHIP_OPTIONS = [
  "Contact",
  "Acquaintance",
  "Friend",
  "Close friend",
  "Best friend",
  "Partner",
  "Spouse",
  "Family",
  "Parent",
  "Sibling",
  "Relative",
  "Colleague",
  "Manager",
  "Employee",
  "Client",
  "Customer",
  "Lead",
  "Vendor",
  "Neighbor",
  "Other",
] as const;

const GROUP_RELATIONSHIP_OPTIONS = [
  "Friends group",
  "Good friends",
  "Close friends",
  "Family members",
  "Coworkers",
  "Work team",
  "Clients",
  "Community",
  "School or class",
  "Neighbors",
  "Hobby group",
  "Event group",
  "Other group",
] as const;

const TONE_OPTIONS = [
  "Warm & concise",
  "Friendly",
  "Professional",
  "Casual",
  "Detailed",
  "Playful",
  "Enthusiastic",
  "Empathetic",
  "Reassuring",
  "Romantic",
  "Flirty",
  "Witty",
  "Sassy",
  "Blunt",
  "Dry",
  "Sarcastic",
  "Cold",
  "Rude",
  "Formal",
] as const;

const PRONOUN_OPTIONS: Array<{ value: ContactPronouns; label: string }> = [
  { value: "unspecified", label: "Not specified" },
  { value: "she/her", label: "She / her" },
  { value: "he/him", label: "He / him" },
  { value: "they/them", label: "They / them" },
];

const REACTIONS = ["❤️", "👍", "😂", "😮", "😢", "🙏"];
const COMPOSER_EMOJI_CATEGORIES = [
  { id: "smileys", label: "Smileys", icon: "😀", emojis: ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🥹", "😊", "🙂", "😉", "😍", "😘", "😎", "🤔", "😴", "😭", "😤", "😮", "🙃"] },
  { id: "gestures", label: "Gestures", icon: "👍", emojis: ["👍", "👎", "👏", "🙌", "🙏", "🤝", "💪", "👋", "🤞", "✌️", "🤙", "👌", "👀", "🫶", "🤗", "🤷", "🙋", "🫡", "✍️", "💅"] },
  { id: "hearts", label: "Hearts", icon: "❤️", emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "💕", "💖", "💯", "🔥", "✨", "🎉", "✅", "⭐", "🌟", "💫", "☀️"] },
  { id: "objects", label: "Objects", icon: "💬", emojis: ["💬", "📞", "📅", "📍", "🎁", "🎵", "📷", "💡", "💻", "📎", "📝", "📌", "🔗", "⏰", "🚀", "☕", "🍀", "🌈", "🎈", "🎯"] },
  { id: "travel", label: "Places", icon: "🌍", emojis: ["🌍", "🏠", "🏢", "✈️", "🚗", "🚕", "🚆", "🏖️", "🌆", "🌄", "🌞", "🌙", "🌧️", "❄️", "🍕", "🎂", "⚽", "🎮", "🐶", "🌸"] },
] as const;
const PARTICIPANT_COLORS = ["#0f766e", "#7c3aed", "#c2410c", "#0369a1", "#a21caf", "#4d7c0f", "#be123c", "#8a5a16"];
const TRANSLATION_LANGUAGE_OPTIONS = [
  ["ar", "Arabic"],
  ["de", "German"],
  ["en", "English"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["he", "Hebrew"],
  ["it", "Italian"],
  ["ja", "Japanese"],
  ["pt", "Portuguese"],
  ["ru", "Russian"],
  ["uz", "Uzbek"],
] as const;
const INCOMING_TRANSLATION_TARGET_KEY = "amiros-incoming-translation-target";
const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/giu;

function languageLabel(tag: string): string {
  return new Intl.DisplayNames(undefined, { type: "language" }).of(tag) || tag;
}

function defaultIncomingTranslationTarget(): string {
  const supported = new Set<string>(TRANSLATION_LANGUAGE_OPTIONS.map(([value]) => value));
  if (typeof window === "undefined") return "en";
  try {
    const saved = window.localStorage.getItem(INCOMING_TRANSLATION_TARGET_KEY);
    if (saved && supported.has(saved)) return saved;
  } catch {
    // Use the browser language when private browsing prevents local storage.
  }
  const browserLanguage = window.navigator.language?.split("-")[0]?.toLowerCase();
  return browserLanguage && supported.has(browserLanguage) ? browserLanguage : "en";
}

function priorityReason(chat: ChatSummary, drafts: Draft[]): string | undefined {
  if (drafts.some((draft) => draft.chatId === chat.id)) return "Draft ready";
  if (/\?|\b(?:please|can you|could you|would you|need|help)\b/iu.test(chat.preview)) return "Direct question";
  if (/\b(?:urgent|asap|today|tomorrow|deadline|time-sensitive)\b/iu.test(chat.preview)) return "Time-sensitive";
  return undefined;
}

function messageTextWithLinks(value: string): ReactNode {
  return value.split(URL_PATTERN).map((part, index) => {
    if (!part) return null;
    if (/^https?:\/\//iu.test(part)) {
      return <a key={`${part}-${index}`} href={part} target="_blank" rel="noreferrer">{part}</a>;
    }
    return <Fragment key={`${part}-${index}`}>{part}</Fragment>;
  });
}

function LinkCard({ value }: { value: string }) {
  const firstUrl = value.match(URL_PATTERN)?.[0];
  if (!firstUrl) return null;
  try {
    const url = new URL(firstUrl);
    const destination = `${url.hostname.replace(/^www\./iu, "")}${url.pathname === "/" ? "" : url.pathname}`;
    return <a className="message-link-card" href={url.toString()} target="_blank" rel="noreferrer">
      <span className="message-link-icon"><ExternalLink size={17} /></span>
      <span><strong>{url.hostname.replace(/^www\./iu, "")}</strong><small>{destination}</small></span>
      <ExternalLink className="message-link-open" size={14} />
    </a>;
  } catch {
    return null;
  }
}

function ownerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function timeZoneParts(timestamp: number, timeZone: string) {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  return Object.fromEntries(values.filter(({ type }) => type !== "literal").map(({ type, value }) => [type, value]));
}

function dateTimeValueInTimeZone(timestamp: number, timeZone: string): string {
  const parts = timeZoneParts(timestamp, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function dateTimeLocalValue(timestamp: number): string {
  return dateTimeValueInTimeZone(timestamp, ownerTimeZone());
}

function timeZoneOffsetMinutes(timestamp: number, timeZone: string): number {
  const parts = timeZoneParts(timestamp, timeZone);
  const displayedAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return Math.round((displayedAsUtc - timestamp) / 60_000);
}

function dateTimeInTimeZoneToTimestamp(value: string, timeZone: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [, year, month, day, hour, minute] = match;
  const guess = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  let timestamp = guess - timeZoneOffsetMinutes(guess, timeZone) * 60_000;
  timestamp = guess - timeZoneOffsetMinutes(timestamp, timeZone) * 60_000;
  return dateTimeValueInTimeZone(timestamp, timeZone) === value ? timestamp : undefined;
}

function quickScheduleValue(timeZone: string, option: "later" | "morning" | "afternoon"): string {
  if (option === "later") return dateTimeValueInTimeZone(Date.now() + 2 * 60 * 60_000, timeZone);
  const parts = timeZoneParts(Date.now(), timeZone);
  const tomorrow = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + 1));
  const date = tomorrow.toISOString().slice(0, 10);
  return `${date}T${option === "morning" ? "09:00" : "14:00"}`;
}

function participantColor(message: ChatMessage): string {
  const key = message.senderId || message.senderName || message.id;
  let hash = 0;
  for (const char of key) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return PARTICIPANT_COLORS[Math.abs(hash) % PARTICIPANT_COLORS.length]!;
}

function filePreview(file: File): string | undefined {
  return file.type.startsWith("image/") || file.type.startsWith("video/") ? URL.createObjectURL(file) : undefined;
}

function fileFromBase64(data: string, filename: string, mimetype: string): File {
  const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
  return new File([bytes], filename, { type: mimetype });
}

function sourceMessageMatches(messageId: string, sourceMessageId: string) {
  if (messageId === sourceMessageId) return true;
  if (sourceMessageId.length < 10) return false;
  return messageId.includes(sourceMessageId) || sourceMessageId.includes(messageId);
}

function messageDateLabel(timestamp: number): string {
  const date = new Date(messageTimestamp(timestamp));
  const today = new Date();
  const startOfDay = (input: Date) => new Date(input.getFullYear(), input.getMonth(), input.getDate()).getTime();
  const days = Math.round((startOfDay(today) - startOfDay(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  }).format(date);
}

export function InboxView({
  chats,
  hasMoreChats,
  loadingMoreChats,
  onLoadMoreChats,
  unreadCount,
  initialFilter = DEFAULT_INBOX_FILTER,
  initialContactSettingsTab = "configure",
  selectedChatId,
  highlightedMessageId,
  messages,
  memory,
  manualMemory,
  profile,
  insights,
  styleProfile,
  groupSummary,
  groupDescription,
  composerDraft,
  onComposerDraftConsumed,
  incomingMessageCount,
  contact,
  drafts,
  scheduledMessages,
  loading,
  onSelectChat,
  onMarkRead,
  onModeChange,
  autoModeEnabled = true,
  deletedMessageArchiveEnabled = true,
  onContactChange,
  onAddMemory,
  onRemoveMemory,
  onGenerateProfile,
  onAnalyzeIntelligence,
  onInsightChange,
  onGenerateWritingStyle,
  onGenerateGroupSummary,
  onApproveDraft,
  onDismissDraft,
  onSend,
  onSchedule,
  onUpdateScheduled,
  onCancelScheduled,
  onTranslate,
  onSendMedia,
  onGenerateImage,
  onReact,
  onReply,
  onForward,
  onScanHistory,
  onRevealDeletedMessage,
  onHideDeletedMessage,
}: InboxViewProps) {
  const [search, setSearch] = useState("");
  const [filterState, setFilterState] = useState(() => {
    const preference = readInboxFilterPreference(localStorage.getItem(INBOX_FILTER_PREFERENCE_KEY));
    // When there is nothing unread, opening to an empty work queue is not useful.
    if (unreadCount === 0) return { filter: "all" as Filter, expiresAt: undefined };
    return { filter: preference?.filter ?? initialFilter ?? DEFAULT_INBOX_FILTER, expiresAt: preference?.expiresAt };
  });
  const filter = filterState.filter;
  const [composer, setComposer] = useState("");
  const [translationTarget, setTranslationTarget] = useState("es");
  const [translationPreview, setTranslationPreview] = useState<TranslationPreview>();
  const [translating, setTranslating] = useState(false);
  const [incomingTranslationTarget, setIncomingTranslationTarget] = useState(defaultIncomingTranslationTarget);
  const [incomingTranslationMenuOpen, setIncomingTranslationMenuOpen] = useState(false);
  const [autoReplyDelayMenuOpen, setAutoReplyDelayMenuOpen] = useState(false);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [composerTranslationMenuOpen, setComposerTranslationMenuOpen] = useState(false);
  const [translatedMessages, setTranslatedMessages] = useState<Record<string, TranslatedMessage>>({});
  const [translatingMessageId, setTranslatingMessageId] = useState<string>();
  const [messageMoreFor, setMessageMoreFor] = useState<string>();
  const [draftingReplyFor, setDraftingReplyFor] = useState<string>();
  const [scheduleEditor, setScheduleEditor] = useState<ScheduleEditor>();
  const [scheduledMessageMenuOpen, setScheduledMessageMenuOpen] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [attachment, setAttachment] = useState<{ file: File; preview?: string }>();
  const [replyingTo, setReplyingTo] = useState<ChatMessage>();
  const [forwarding, setForwarding] = useState<ChatMessage>();
  const [reactionFor, setReactionFor] = useState<string>();
  const [revealingDeletedMessageIds, setRevealingDeletedMessageIds] = useState<Set<string>>(() => new Set());
  const [composerEmojiOpen, setComposerEmojiOpen] = useState(false);
  const [composerEmojiCategory, setComposerEmojiCategory] = useState<(typeof COMPOSER_EMOJI_CATEGORIES)[number]["id"]>("smileys");
  const [composerAttachmentMenuOpen, setComposerAttachmentMenuOpen] = useState(false);
  const [imagePromptOpen, setImagePromptOpen] = useState(false);
  const [imagePrompt, setImagePrompt] = useState("");
  const [generatingImage, setGeneratingImage] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [insertedDraftId, setInsertedDraftId] = useState<string>();
  const [chatRailCollapsed, setChatRailCollapsed] = useState(() => localStorage.getItem("amiros-chat-rail") === "collapsed");
  const [contactRailCollapsed, setContactRailCollapsed] = useState(() => localStorage.getItem("amiros-contact-rail") !== "expanded");
  const [contactSettingsTab, setContactSettingsTab] = useState<"configure" | "knowledge">(initialContactSettingsTab);
  const [openContactSection, setOpenContactSection] = useState<string | undefined>("relationship");
  const [scanState, setScanState] = useState<"idle" | "scanning" | string>("idle");
  const [contactCityQuery, setContactCityQuery] = useState("");
  const [contactCityResults, setContactCityResults] = useState<TimeZoneCity[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const incomingTranslationRef = useRef<HTMLDivElement>(null);
  const autoReplyDelayRef = useRef<HTMLDivElement>(null);
  const locationPickerRef = useRef<HTMLDivElement>(null);
  const composerTranslationRef = useRef<HTMLDivElement>(null);
  const composerAttachmentRef = useRef<HTMLDivElement>(null);
  const composerEmojiRef = useRef<HTMLDivElement>(null);
  const imagePromptRef = useRef<HTMLFormElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const selectedChat = chats.find((chat) => chat.id === selectedChatId) || chats[0];
  const chronologicalMessages = useMemo(
    () => orderMessagesChronologically(messages),
    [messages],
  );
  const highlightedMessage = highlightedMessageId
    ? chronologicalMessages.find((message) => sourceMessageMatches(message.id, highlightedMessageId))
    : undefined;
  const activeDraft = drafts.find((draft) => draft.chatId === selectedChat?.id);

  useEffect(() => {
    if (!filterState.expiresAt) return;
    const remainingMs = filterState.expiresAt - Date.now();
    const restoreUnread = () => {
      setFilterState((current) => current.expiresAt === filterState.expiresAt
        ? { filter: DEFAULT_INBOX_FILTER, expiresAt: undefined }
        : current);
      localStorage.removeItem(INBOX_FILTER_PREFERENCE_KEY);
    };
    if (remainingMs <= 0) {
      restoreUnread();
      return;
    }
    const timeout = window.setTimeout(restoreUnread, remainingMs);
    return () => window.clearTimeout(timeout);
  }, [filterState.expiresAt]);

  useEffect(() => {
    if (unreadCount > 0 || filterState.filter !== "unread") return;
    localStorage.removeItem(INBOX_FILTER_PREFERENCE_KEY);
    setFilterState({ filter: "all", expiresAt: undefined });
  }, [filterState.filter, unreadCount]);

  useEffect(() => {
    if (!incomingTranslationMenuOpen && !autoReplyDelayMenuOpen && !locationPickerOpen && !composerTranslationMenuOpen && !composerAttachmentMenuOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!incomingTranslationRef.current?.contains(target)) setIncomingTranslationMenuOpen(false);
      if (!autoReplyDelayRef.current?.contains(target)) setAutoReplyDelayMenuOpen(false);
      if (!locationPickerRef.current?.contains(target)) setLocationPickerOpen(false);
      if (!composerTranslationRef.current?.contains(target)) setComposerTranslationMenuOpen(false);
      if (!composerAttachmentRef.current?.contains(target)) setComposerAttachmentMenuOpen(false);
      if (!composerEmojiRef.current?.contains(target)) setComposerEmojiOpen(false);
      if (!imagePromptRef.current?.contains(target)) setImagePromptOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIncomingTranslationMenuOpen(false);
        setAutoReplyDelayMenuOpen(false);
        setLocationPickerOpen(false);
        setComposerTranslationMenuOpen(false);
        setComposerAttachmentMenuOpen(false);
        setComposerEmojiOpen(false);
        setImagePromptOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [incomingTranslationMenuOpen, composerTranslationMenuOpen, composerAttachmentMenuOpen, composerEmojiOpen, imagePromptOpen]);

  useEffect(() => {
    const query = contactCityQuery.trim();
    if (query.length < 2) { setContactCityResults([]); return; }
    const timer = window.setTimeout(() => {
      void searchTimeZoneCities(query).then(setContactCityResults).catch(() => setContactCityResults([]));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [contactCityQuery]);

  const selectFilter = (nextFilter: Filter) => {
    if (nextFilter === "unread") {
      localStorage.removeItem(INBOX_FILTER_PREFERENCE_KEY);
      setFilterState({ filter: DEFAULT_INBOX_FILTER, expiresAt: undefined });
      return;
    }
    const preference = createInboxFilterPreference(nextFilter);
    localStorage.setItem(INBOX_FILTER_PREFERENCE_KEY, JSON.stringify(preference));
    setFilterState(preference);
  };

  const [draftBody, setDraftBody] = useState(activeDraft?.body || "");
  const [ownerTriggerAccess, setOwnerTriggerAccess] = useState<OwnerTriggerAccess[]>(
    contact?.ownerTriggerAccess ?? ["knowledge", "calendar"],
  );
  const [contactTriggerAccess, setContactTriggerAccess] = useState<OwnerTriggerAccess[]>(
    contact?.contactTriggerAccess ?? [],
  );
  const [instructionDraft, setInstructionDraft] = useState(
    contact?.customInstructions || "",
  );
  const [manualMemoryDraft, setManualMemoryDraft] = useState("");
  const [savingInstructions, setSavingInstructions] = useState(false);
  const [instructionsSaved, setInstructionsSaved] = useState(false);
  const [savingMemory, setSavingMemory] = useState(false);
  const [generatingProfile, setGeneratingProfile] = useState(false);
  const [analyzingIntelligence, setAnalyzingIntelligence] = useState(false);
  const [learningRelationship, setLearningRelationship] = useState(false);
  const [relationshipLearningError, setRelationshipLearningError] = useState<string>();
  const [learningStyle, setLearningStyle] = useState(false);
  const [summarizingGroup, setSummarizingGroup] = useState(false);
  const [sending, setSending] = useState(false);
  const messageCanvasRef = useRef<HTMLDivElement>(null);
  const restoredChatRef = useRef("");
  const restoringChatScrollRef = useRef(false);
  const restoreChatScrollRef = useRef<(() => void) | undefined>(undefined);
  const knownMessageIdsRef = useRef<Set<string>>(new Set());
  const latestMessageTimestampRef = useRef(0);
  const nearChatBottomRef = useRef(true);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const pendingInsights = insights.filter((item) => item.status === "inferred");
  const actionableScheduledMessages = scheduledMessages
    .filter((message) => message.status === "pending" || message.status === "failed")
    .sort((left, right) => left.scheduledAt - right.scheduledAt);
  const shouldManageScheduledMessages = actionableScheduledMessages.length > 0 && (!composer.trim() || Boolean(translationPreview?.stale));

  useEffect(() => setDraftBody(activeDraft?.body || ""), [activeDraft?.id, activeDraft?.body]);
  useEffect(() => {
    setTranslationTarget(contact?.composerTranslationPreference?.targetLanguage || "es");
    setTranslationPreview(undefined);
    setTranslatedMessages({});
    setMessageMoreFor(undefined);
    setScheduleEditor(undefined);
    setScheduledMessageMenuOpen(false);
  }, [selectedChat?.id]);
  useEffect(() => {
    const rememberedTarget = contact?.composerTranslationPreference?.targetLanguage || "es";
    setTranslationTarget(rememberedTarget);
    setTranslationPreview((current) => current && current.targetLanguage !== rememberedTarget ? { ...current, stale: true } : current);
  }, [contact?.composerTranslationPreference?.targetLanguage]);
  useEffect(() => {
    if (!composerDraft) return;
    setComposer(composerDraft);
    setImagePromptOpen(false);
    onComposerDraftConsumed();
    window.requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus());
  }, [composerDraft, onComposerDraftConsumed]);
  useEffect(() => {
    setInstructionsSaved(false);
    setManualMemoryDraft("");
    setRelationshipLearningError(undefined);
    setInsertedDraftId(undefined);
    setContactSettingsTab(initialContactSettingsTab);
    if (initialContactSettingsTab !== "configure") {
      setContactRailCollapsed(false);
      localStorage.setItem("amiros-contact-rail", "expanded");
    }
    setOpenContactSection("relationship");
  }, [initialContactSettingsTab, selectedChat?.id]);
  useEffect(() => () => { if (attachment?.preview) URL.revokeObjectURL(attachment.preview); }, [attachment?.preview]);
  useEffect(() => () => {
    if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);
  useEffect(
    () => setInstructionDraft(contact?.customInstructions || ""),
    [contact?.customInstructions],
  );
  useEffect(
    () => setOwnerTriggerAccess(contact?.ownerTriggerAccess ?? ["knowledge", "calendar"]),
    [contact?.ownerTriggerAccess, selectedChat?.id],
  );
  useEffect(
    () => setContactTriggerAccess(contact?.contactTriggerAccess ?? []),
    [contact?.contactTriggerAccess, selectedChat?.id],
  );
  useEffect(() => {
    // A message refresh must not reset a reader back to the first message. Only a newly
    // selected conversation receives the one-time open-position restoration.
    restoredChatRef.current = "";
    knownMessageIdsRef.current = new Set();
    latestMessageTimestampRef.current = 0;
    nearChatBottomRef.current = true;
    setNewMessageCount(0);
  }, [selectedChat?.id]);

  useEffect(() => {
    if (loading || !selectedChat || chronologicalMessages.length === 0) return;
    if (restoredChatRef.current === selectedChat.id) return;

    restoredChatRef.current = selectedChat.id;
    restoringChatScrollRef.current = true;
    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;
    let settleTimer: number | undefined;
    let secondFrame: number | undefined;
    const firstUnreadMessage = selectedChat.unreadCount > 0
      ? chronologicalMessages.filter((message) => !message.fromMe).at(-selectedChat.unreadCount)
      : undefined;

    const restorePosition = () => {
      if (cancelled) return;
      const canvas = messageCanvasRef.current;
      if (!canvas) return;

      if (firstUnreadMessage) {
        const row = canvas.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(firstUnreadMessage.id)}"]`);
        if (row) {
          row.scrollIntoView({ block: "center", behavior: "auto" });
          return;
        }
      }

      const savedPosition = Number(sessionStorage.getItem(`amiros-chat-scroll:${selectedChat.id}`));
      const maxScroll = Math.max(0, canvas.scrollHeight - canvas.clientHeight);
      // Ignore a zero or end-of-list position written while a chat is still mounting.
      // Genuine manual positions are preserved, otherwise new chats always open at the end.
      const hasMeaningfulSavedPosition = Number.isFinite(savedPosition)
        && savedPosition > 16
        && savedPosition < maxScroll - 16;
      canvas.scrollTop = hasMeaningfulSavedPosition ? savedPosition : canvas.scrollHeight;
    };

    restoreChatScrollRef.current = restorePosition;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        restorePosition();
        const canvas = messageCanvasRef.current;
        if (canvas && typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(restorePosition);
          resizeObserver.observe(canvas);
        }
        settleTimer = window.setTimeout(() => {
          restorePosition();
          restoringChatScrollRef.current = false;
          resizeObserver?.disconnect();
          const canvas = messageCanvasRef.current;
          knownMessageIdsRef.current = new Set(chronologicalMessages.map((message) => message.id));
          latestMessageTimestampRef.current = Math.max(0, ...chronologicalMessages.map((message) => messageTimestamp(message.timestamp)));
          nearChatBottomRef.current = canvas ? isNearChatBottom(canvas) : true;
          setNewMessageCount(0);
          const incoming = [...(messageCanvasRef.current?.querySelectorAll<HTMLElement>('[data-from-me="false"]') ?? [])];
          if (incoming.length > 0) void onMarkRead(selectedChat.id);
        }, 450);
      });
      // The nested animation frame is intentionally kept separate so the message DOM,
      // including media, has a chance to lay out before scrolling.
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== undefined) window.cancelAnimationFrame(secondFrame);
      if (settleTimer !== undefined) window.clearTimeout(settleTimer);
      resizeObserver?.disconnect();
      if (restoreChatScrollRef.current === restorePosition) restoreChatScrollRef.current = undefined;
      restoringChatScrollRef.current = false;
    };
  }, [chronologicalMessages, loading, onMarkRead, selectedChat?.id, selectedChat?.unreadCount]);

  const rememberChatScroll = () => {
    if (!selectedChat || !messageCanvasRef.current || restoringChatScrollRef.current) return;
    const canvas = messageCanvasRef.current;
    nearChatBottomRef.current = isNearChatBottom(canvas);
    if (nearChatBottomRef.current) setNewMessageCount(0);
    sessionStorage.setItem(`amiros-chat-scroll:${selectedChat.id}`, String(canvas.scrollTop));
  };

  const scrollToNewest = (behavior: ScrollBehavior = "smooth") => {
    const canvas = messageCanvasRef.current;
    if (!canvas) return;
    canvas.scrollTo({ top: canvas.scrollHeight, behavior });
    nearChatBottomRef.current = true;
    setNewMessageCount(0);
  };

  const restoreAfterMediaLoad = () => {
    if (restoringChatScrollRef.current) restoreChatScrollRef.current?.();
  };

  useEffect(() => {
    if (loading || !selectedChat || restoredChatRef.current !== selectedChat.id) return;
    const known = knownMessageIdsRef.current;
    if (known.size === 0) {
      knownMessageIdsRef.current = new Set(chronologicalMessages.map((message) => message.id));
      latestMessageTimestampRef.current = Math.max(0, ...chronologicalMessages.map((message) => messageTimestamp(message.timestamp)));
      return;
    }
    const newMessages = chronologicalMessages.filter((message) => !known.has(message.id));
    if (newMessages.length === 0) return;
    const previousLatestTimestamp = latestMessageTimestampRef.current;
    newMessages.forEach((message) => known.add(message.id));
    latestMessageTimestampRef.current = Math.max(
      previousLatestTimestamp,
      ...newMessages.map((message) => messageTimestamp(message.timestamp)),
    );
    // Loading older history should never interrupt a reader. Only messages that are newer
    // than the conversation already on screen count as live arrivals.
    const arriving = newMessages.filter((message) => messageTimestamp(message.timestamp) >= previousLatestTimestamp);
    if (arriving.length === 0) return;
    if (shouldFollowNewMessages(nearChatBottomRef.current, arriving)) {
      window.requestAnimationFrame(() => scrollToNewest(arriving.some((message) => message.fromMe) ? "auto" : "smooth"));
    } else {
      setNewMessageCount((count) => count + arriving.length);
    }
  }, [chronologicalMessages, loading, selectedChat?.id]);

  useEffect(() => {
    if (loading || !highlightedMessage) return;
    const frame = window.requestAnimationFrame(() => {
      const row = messageCanvasRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(highlightedMessage.id)}"]`);
      row?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [highlightedMessage?.id, loading]);

  const saveInstructions = async () => {
    if (!selectedChat) return;
    setSavingInstructions(true);
    setInstructionsSaved(false);
    try {
      const saved = await onContactChange(selectedChat.id, {
        customInstructions: instructionDraft.trim(),
      });
      setInstructionsSaved(saved);
    } finally {
      setSavingInstructions(false);
    }
  };

  const addMemoryItem = async () => {
    if (!selectedChat || !manualMemoryDraft.trim()) return;
    setSavingMemory(true);
    try {
      await onAddMemory(selectedChat.id, manualMemoryDraft.trim());
      setManualMemoryDraft("");
    } finally {
      setSavingMemory(false);
    }
  };

  const toggleOwnerTriggerAccess = async (access: OwnerTriggerAccess) => {
    if (!selectedChat) return;
    const next = ownerTriggerAccess.includes(access)
      ? ownerTriggerAccess.filter((item) => item !== access)
      : (["knowledge", "calendar"] as const).filter((item) => (
        item === access || ownerTriggerAccess.includes(item)
      ));
    setOwnerTriggerAccess([...next]);
    const saved = await onContactChange(selectedChat.id, { ownerTriggerAccess: [...next] });
    if (!saved) setOwnerTriggerAccess(contact?.ownerTriggerAccess ?? ["knowledge", "calendar"]);
  };

  const toggleContactTriggerAccess = async (access: OwnerTriggerAccess) => {
    if (!selectedChat) return;
    const next = contactTriggerAccess.includes(access)
      ? contactTriggerAccess.filter((item) => item !== access)
      : (["knowledge", "calendar"] as const).filter((item) => (
        item === access || contactTriggerAccess.includes(item)
      ));
    setContactTriggerAccess([...next]);
    const saved = await onContactChange(selectedChat.id, { contactTriggerAccess: [...next] });
    if (!saved) setContactTriggerAccess(contact?.contactTriggerAccess ?? []);
  };

  const createProfile = async () => {
    if (!selectedChat) return;
    setGeneratingProfile(true);
    try {
      await onGenerateProfile(selectedChat.id);
    } finally {
      setGeneratingProfile(false);
    }
  };

  const refreshIntelligence = async () => {
    if (!selectedChat) return;
    setAnalyzingIntelligence(true);
    try {
      await onAnalyzeIntelligence(selectedChat.id);
    } finally {
      setAnalyzingIntelligence(false);
    }
  };

  const learnRelationshipFromHistory = async () => {
    if (!selectedChat || selectedChat.isGroup) return;
    setLearningRelationship(true);
    setRelationshipLearningError(undefined);
    try {
      await onScanHistory(selectedChat.id, FIRST_RUN_PEOPLE_SCAN_LIMIT);
      await onAnalyzeIntelligence(selectedChat.id, FIRST_RUN_PEOPLE_SCAN_LIMIT);
      const saved = await onContactChange(selectedChat.id, { knowledgeTracking: "enabled" });
      if (!saved) throw new Error("AmirOS could not turn on learning for this chat.");
    } catch (error) {
      setRelationshipLearningError(error instanceof Error ? error.message : "AmirOS could not learn from this chat. Please try again.");
    } finally {
      setLearningRelationship(false);
    }
  };

  const learnStyle = async () => {
    if (!selectedChat) return;
    setLearningStyle(true);
    try {
      await onGenerateWritingStyle(selectedChat.id);
    } finally {
      setLearningStyle(false);
    }
  };

  const summarizeGroup = async () => {
    if (!selectedChat) return;
    setSummarizingGroup(true);
    try {
      await onGenerateGroupSummary(selectedChat.id);
    } finally {
      setSummarizingGroup(false);
    }
  };

  const visibleChats = useMemo(() => {
    const query = search.trim().toLowerCase();
    return orderChatsByRecency(
      chats.filter((chat) => {
        if (filter === "unread" && chat.unreadCount <= 0) return false;
        if (filter === "priority" && !priorityReason(chat, drafts)) return false;
        if (filter === "auto" && chat.mode !== "auto") return false;
        return !query || `${chat.name} ${chat.preview}`.toLowerCase().includes(query);
      }),
    );
  }, [chats, drafts, filter, search]);

  const filterCounts = useMemo(() => ({
    all: chats.length,
    priority: chats.filter((chat) => Boolean(priorityReason(chat, drafts))).length,
    unread: chats.reduce((total, chat) => total + chat.unreadCount, 0),
    auto: chats.filter((chat) => chat.mode === "auto").length,
  }), [chats, drafts]);

  const chooseAttachment = (file?: File) => {
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) {
      setScanState("Media must be under 16 MB");
      return;
    }
    setAttachment((current) => {
      if (current?.preview) URL.revokeObjectURL(current.preview);
      return { file, preview: filePreview(file) };
    });
  };

  const generateImageAttachment = async () => {
    if (!selectedChat || !imagePrompt.trim() || generatingImage) return;
    setGeneratingImage(true);
    try {
      const generated = await onGenerateImage(selectedChat.id, imagePrompt.trim());
      chooseAttachment(fileFromBase64(generated.data, generated.filename, generated.mimetype));
      setImagePrompt("");
      setImagePromptOpen(false);
      setScanState("Image added as an attachment — review it, then send when ready");
    } catch (error) {
      setScanState(error instanceof Error ? error.message : "Image could not be generated");
    } finally {
      setGeneratingImage(false);
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
  };

  const translateComposer = async (requestedTarget = translationTarget) => {
    const original = composer.trim();
    if (!original || translating) return;
    setTranslating(true);
    try {
      const result = await onTranslate({ body: original, targetLanguage: requestedTarget });
      setComposer(result.body);
      setTranslationTarget(result.targetLanguage);
      setTranslationPreview({ original, body: result.body, targetLanguage: result.targetLanguage, stale: false });
      setScanState(`Translation ready · review before sending`);
    } catch (error) {
      setScanState(error instanceof Error ? error.message : "Translation could not be prepared");
    } finally {
      setTranslating(false);
    }
  };

  const translateIncomingMessage = async (message: ChatMessage) => {
    if (translatingMessageId) return;
    const body = (message.fullBody || message.body).trim();
    if (!body) return;
    setTranslatingMessageId(message.id);
    try {
      // Incoming translation is intentionally independent from the owner's
      // remembered outgoing composer preference.
      const result = await onTranslate({ body, targetLanguage: incomingTranslationTarget });
      setTranslatedMessages((current) => ({ ...current, [message.id]: { body: result.body, targetLanguage: result.targetLanguage } }));
    } catch (error) {
      setScanState(error instanceof Error ? error.message : "Message could not be translated");
    } finally {
      setTranslatingMessageId(undefined);
    }
  };

  const changeIncomingTranslationTarget = (targetLanguage: string) => {
    setIncomingTranslationTarget(targetLanguage);
    try {
      window.localStorage.setItem(INCOMING_TRANSLATION_TARGET_KEY, targetLanguage);
    } catch {
      // Translation still uses the selected language for this session.
    }
  };

  const prepareDraftReply = async (message: ChatMessage) => {
    if (!selectedChat || draftingReplyFor) return;
    setDraftingReplyFor(message.id);
    try {
      const result = await suggestReplyForMessage(selectedChat.id, message.id);
      setComposer(result.body);
      setReplyingTo(message);
      setTranslationPreview(undefined);
      window.requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus());
    } catch (error) {
      setScanState(error instanceof Error ? error.message : "Reply draft could not be prepared");
    } finally {
      setDraftingReplyFor(undefined);
    }
  };

  const persistTranslationTarget = async (targetLanguage: string) => {
    setTranslationTarget(targetLanguage);
    setTranslationPreview((current) => current && current.targetLanguage !== targetLanguage ? { ...current, stale: true } : current);
    if (!selectedChat) return;
    const saved = await onContactChange(selectedChat.id, {
      composerTranslationPreference: {
        targetLanguage,
        direction: "outgoing_to_target",
        source: "user_confirmed",
        confirmedAt: Date.now(),
      },
    });
    if (!saved) setScanState("Could not save this translation preference");
  };

  const openScheduleEditor = (message?: ScheduledMessage) => {
    setScheduledMessageMenuOpen(false);
    const timestamp = message?.scheduledAt || Date.now() + 60 * 60_000;
    const contactTimeZone = contact?.timezone;
    const timezone = message?.timezone || contactTimeZone || ownerTimeZone();
    const timeBasis = contactTimeZone && timezone === contactTimeZone ? "contact" : "owner";
    if (message) {
      setComposer(message.body);
      setTranslationPreview(undefined);
    }
    setScheduleEditor({
      id: message?.id,
      body: message?.body || composer.trim(),
      scheduledAt: dateTimeValueInTimeZone(timestamp, timezone),
      timezone,
      timeBasis,
      composerBeforeEditing: message ? composer : undefined,
    });
  };

  const dismissScheduleEditor = () => {
    if (scheduleEditor?.id && composer.trim() === scheduleEditor.body.trim()) setComposer(scheduleEditor.composerBeforeEditing || "");
    setScheduleEditor(undefined);
  };

  const saveScheduledMessage = async () => {
    if (!selectedChat || !scheduleEditor || scheduling) return;
    if (translationPreview?.stale) {
      setScanState("Translate the changed draft again or restore the original before scheduling it.");
      return;
    }
    const scheduledAt = dateTimeInTimeZoneToTimestamp(scheduleEditor.scheduledAt, scheduleEditor.timezone);
    if (!scheduleEditor.body.trim() || scheduledAt === undefined || scheduledAt < Date.now() + 10_000) {
      setScanState("Choose a message and a delivery time at least a few seconds from now");
      return;
    }
    setScheduling(true);
    try {
      const timezone = scheduleEditor.timezone;
      if (scheduleEditor.id) {
        await onUpdateScheduled(scheduleEditor.id, { body: scheduleEditor.body.trim(), scheduledAt, timezone });
        if (composer.trim() === scheduleEditor.body.trim()) setComposer(scheduleEditor.composerBeforeEditing || "");
      } else {
        await onSchedule(selectedChat.id, { body: scheduleEditor.body.trim(), scheduledAt, timezone });
        if (scheduleEditor.body.trim() === composer.trim()) setComposer("");
      }
      setScheduleEditor(undefined);
      setTranslationPreview(undefined);
      setScanState("Message scheduled — you can edit or cancel it before delivery");
    } catch (error) {
      setScanState(error instanceof Error ? error.message : "Message could not be scheduled");
    } finally {
      setScheduling(false);
    }
  };

  const startVoiceRecording = async () => {
    if (!selectedChat) return;
    if (recording) { stopVoiceRecording(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setScanState("Voice recording is not supported by this browser");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type)) || "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recordingStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];
      setRecordingSeconds(0);
      recorder.ondataavailable = (event) => { if (event.data.size) recordingChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
        stream.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        setRecording(false);
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (blob.size < 100) { setScanState("Voice recording was too short"); return; }
        const extension = blob.type.includes("mp4") ? "m4a" : "webm";
        const file = new File([blob], `voice-message.${extension}`, { type: blob.type });
        setSending(true);
        void onSendMedia(selectedChat.id, file, "", true)
          .then(() => {
            setScanState("Voice memo sent");
            window.requestAnimationFrame(() => scrollToNewest("auto"));
          })
          .catch(() => setScanState("Voice memo could not be sent"))
          .finally(() => setSending(false));
      };
      recorder.start(250);
      setRecording(true);
      recordingTimerRef.current = window.setInterval(() => setRecordingSeconds((seconds) => seconds + 1), 1_000);
    } catch {
      setScanState("Microphone access is needed to record a voice memo");
    }
  };

  const submitMessage = async () => {
    if (!selectedChat || sending || (!composer.trim() && !attachment)) return;
    if (translationPreview?.stale) {
      setScanState("The draft changed after translation. Translate again or restore the original before sending.");
      return;
    }
    const message = composer.trim();
    const sentTranslation = translationPreview && !translationPreview.stale ? translationPreview : undefined;
    setSending(true);
    try {
      if (attachment) {
        await onSendMedia(selectedChat.id, attachment.file, message);
        if (attachment.preview) URL.revokeObjectURL(attachment.preview);
        setAttachment(undefined);
      } else if (replyingTo) {
        await onReply(selectedChat.id, replyingTo.id, message);
      } else {
        await onSend(selectedChat.id, message);
      }
      setComposer("");
      if (sentTranslation) {
        window.setTimeout(() => setTranslationPreview((current) => current?.original === sentTranslation.original && current.body === sentTranslation.body ? undefined : current), 5_000);
      } else {
        setTranslationPreview(undefined);
      }
      if (insertedDraftId && activeDraft?.id === insertedDraftId) {
        await onDismissDraft(activeDraft);
        setInsertedDraftId(undefined);
      }
      setReplyingTo(undefined);
      window.requestAnimationFrame(() => scrollToNewest("auto"));
    } catch {
      setScanState("Message was not sent — your text is still here");
    } finally {
      setSending(false);
    }
  };

  const scanOlder = async () => {
    if (!selectedChat) return;
    setScanState("scanning");
    const canvas = messageCanvasRef.current;
    const previousHeight = canvas?.scrollHeight || 0;
    const previousTop = canvas?.scrollTop || 0;
    try {
      const result = await onScanHistory(selectedChat.id);
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
      if (canvas) canvas.scrollTop = previousTop + Math.max(0, canvas.scrollHeight - previousHeight);
      setScanState(`${result.scanned} checked · ${result.added} new messages saved`);
    } catch {
      setScanState("Could not scan older messages");
    }
  };

  const toggleChatRail = () => setChatRailCollapsed((value) => {
    localStorage.setItem("amiros-chat-rail", value ? "expanded" : "collapsed");
    return !value;
  });
  const toggleContactRail = () => setContactRailCollapsed((value) => {
    localStorage.setItem("amiros-contact-rail", value ? "expanded" : "collapsed");
    return !value;
  });
  const scrollToQuotedMessage = (messageId: string) => {
    const elements = messageCanvasRef.current?.querySelectorAll<HTMLElement>("[data-message-id]");
    const target = elements ? [...elements].find((element) => sourceMessageMatches(element.dataset.messageId || "", messageId)) : undefined;
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("quoted-source-highlight");
    window.setTimeout(() => target.classList.remove("quoted-source-highlight"), 1_800);
  };

  if (!selectedChat) {
    return (
      <main className="main-content centered-state">
        <MessageSquareText size={34} />
        <h1>No conversations yet</h1>
        <p>Incoming WhatsApp conversations will appear here after the bot connects.</p>
      </main>
    );
  }

  const savedReplyMode = contact?.mode || selectedChat.mode;
  const activeReplyMode: ReplyMode = savedReplyMode === "auto" && !autoModeEnabled ? "suggest" : savedReplyMode;
  const nextReplyMode = autoModeEnabled ? NEXT_REPLY_MODE[activeReplyMode] : activeReplyMode === "off" ? "suggest" : "off";
  const rtlChatIdentity = textDirection(selectedChat.name) === "rtl" || Boolean(selectedChat.isGroup && groupDescription && textDirection(groupDescription) === "rtl");
  const replyModes = autoModeEnabled ? (["off", "suggest", "auto"] as const) : (["off", "suggest"] as const);
  const autoReplyInitialDelay = contact?.autoReplyInitialDelaySeconds || 30;
  const changeAutoReplyInitialDelay = (value: string) => {
    const delay = Number(value) as AutoReplyInitialDelaySeconds;
    if (!AUTO_REPLY_DELAY_OPTIONS.includes(delay)) return;
    void onContactChange(selectedChat.id, { autoReplyInitialDelaySeconds: delay });
  };

  return (
    <main className={`inbox-page ${selectedChatId ? "mobile-chat" : "mobile-list"} ${chatRailCollapsed ? "chat-rail-collapsed" : ""} ${contactRailCollapsed ? "contact-rail-collapsed" : ""}`} onPointerDownCapture={(event) => {
      if (composerEmojiOpen && !composerEmojiRef.current?.contains(event.target as Node)) setComposerEmojiOpen(false);
    }}>
      <section className="conversation-list-panel">
        <div className="inbox-title-row">
          <div className="inbox-page-heading">
            <h1>Inbox</h1>
            {unreadCount > 0 ? (
              <p className="inbox-unread-summary" aria-label={`${unreadCount} unread messages`}>
                <Mail size={15} aria-hidden="true" />
                <span>{unreadCount} unread {unreadCount === 1 ? "message" : "messages"}</span>
              </p>
            ) : null}
            <p className="inbox-page-subtitle">Your conversations, in context.</p>
          </div>
          <button className="rail-collapse-button" aria-label={chatRailCollapsed ? "Expand conversation list" : "Collapse conversation list"} onClick={toggleChatRail}>{chatRailCollapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}</button>
        </div>
        <label className="search-box"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" /></label>
        <div className="filter-tabs" aria-label="Conversation filters">
          <button className={filter === "all" ? "active" : ""} aria-pressed={filter === "all"} onClick={() => selectFilter("all")}>All <span>{filterCounts.all}</span></button>
          <button className={filter === "priority" ? "active" : ""} aria-pressed={filter === "priority"} title="Direct questions, time-sensitive requests, and chats with a draft ready" onClick={() => selectFilter("priority")}>Priority <span>{filterCounts.priority}</span></button>
          <button className={filter === "unread" ? "active" : ""} aria-pressed={filter === "unread"} onClick={() => selectFilter("unread")}>Unread <span>{filterCounts.unread}</span></button>
          <button className={filter === "auto" ? "active" : ""} aria-pressed={filter === "auto"} onClick={() => selectFilter("auto")}>Auto <span>{filterCounts.auto}</span></button>
        </div>
        <div className="conversation-list" onScroll={(event) => {
          const list = event.currentTarget;
          if (hasMoreChats && !loadingMoreChats && list.scrollTop + list.clientHeight >= list.scrollHeight - 120) void onLoadMoreChats();
        }}>
          {visibleChats.map((chat, index) => (
            <button key={chat.id} className={selectedChat.id === chat.id ? "conversation-row selected" : "conversation-row"} onClick={() => onSelectChat(chat.id)}>
              <ContactAvatar name={chat.name} src={chat.avatarUrl} tone={index} />
              <span className="conversation-copy">
                <span><strong dir="auto">{chat.name}</strong><time>{formatTime(chat.timestamp)}</time></span>
                <small dir={textDirection(chat.preview)}>{chat.preview}</small>
                {priorityReason(chat, drafts) ? <span className="priority-reason">{priorityReason(chat, drafts)}</span> : <span className={`mode-label ${chat.mode}`}>{chat.mode === "auto" ? <Bot size={13} /> : chat.mode === "suggest" ? <PencilLine size={13} /> : <LockKeyhole size={13} />}<span className="capitalize">{chat.mode}</span></span>}
              </span>
              {chat.unreadCount > 0 ? <span className="unread-count">{chat.unreadCount}</span> : null}
            </button>
          ))}
          {visibleChats.length === 0 ? (
            <div className="conversation-empty">{filter === "auto" && !search.trim() ? "No conversations are in Auto Mode." : (filter === "unread" || filter === "priority") && !search.trim() ? "You’re all caught up — nothing needs your attention." : "No conversations match this filter."}</div>
          ) : null}
          {hasMoreChats && filter === "all" && !search.trim() ? <button className="load-more-chats" disabled={loadingMoreChats} onClick={() => void onLoadMoreChats()}>{loadingMoreChats ? "Loading older conversations…" : "Load older conversations"}</button> : null}
        </div>
      </section>

      <section className="chat-panel">
        <header className={`chat-header ${rtlChatIdentity ? "rtl-chat-identity" : ""}`}>
          <button className="icon-button mobile-back-button" aria-label="Back to conversations" onClick={() => onSelectChat(undefined)}><ArrowLeft size={20} /></button>
          <ContactAvatar name={selectedChat.name} src={selectedChat.avatarUrl} />
          <span className={`chat-person ${selectedChat.isGroup && groupDescription && textDirection(groupDescription) === "rtl" ? "rtl-group-identity" : ""}`}><strong dir="auto">{selectedChat.name}</strong>{selectedChat.isGroup && groupDescription ? <small className={`group-description ${textDirection(groupDescription) === "rtl" ? "rtl" : "ltr"}`} dir={textDirection(groupDescription)}>{groupDescription}</small> : null}{contact?.timezone ? <small className="contact-local-time">{contact.location ? `${contact.location} · ` : ""}{new Intl.DateTimeFormat(undefined, { timeZone: contact.timezone, hour: "numeric", minute: "2-digit" }).format(new Date())}</small> : null}<small><WhatsAppIcon size={13} /> Live sync · WhatsApp conversation</small></span>
          <div className="auto-reply-header-control">
            {activeReplyMode === "auto" ? <div ref={autoReplyDelayRef} className={`auto-reply-delay-select ${autoReplyDelayMenuOpen ? "open" : ""}`}><button type="button" aria-label={`First automatic reply: ${autoReplyInitialDelay} seconds`} title={`First reply: ${autoReplyInitialDelay} seconds`} aria-haspopup="listbox" aria-expanded={autoReplyDelayMenuOpen} onClick={() => setAutoReplyDelayMenuOpen((open) => !open)}><Clock3 size={15} /></button>{autoReplyDelayMenuOpen ? <div className="auto-reply-delay-menu" role="listbox" aria-label="First automatic reply delay">{AUTO_REPLY_DELAY_OPTIONS.map((seconds) => <button key={seconds} type="button" role="option" aria-selected={seconds === autoReplyInitialDelay} className={seconds === autoReplyInitialDelay ? "selected" : ""} onClick={() => { changeAutoReplyInitialDelay(String(seconds)); setAutoReplyDelayMenuOpen(false); }}>{seconds}s{seconds === autoReplyInitialDelay ? <Check size={13} /> : null}</button>)}</div> : null}</div> : null}
            <button className={`mode-select ${activeReplyMode}`} aria-label={`${activeReplyMode} mode. Switch to ${nextReplyMode} mode`} title={`Switch to ${nextReplyMode} mode`} onClick={() => onModeChange(selectedChat.id, nextReplyMode)}>{activeReplyMode === "suggest" ? <Sparkles size={16} /> : <Power size={16} />}</button>
          </div>
          <div ref={incomingTranslationRef} className={`incoming-translation-select ${incomingTranslationMenuOpen ? "open" : ""}`} title="Language used when translating received messages">
            <button className="incoming-translation-trigger" type="button" aria-label="Translate received messages to" aria-haspopup="listbox" aria-expanded={incomingTranslationMenuOpen} onClick={() => setIncomingTranslationMenuOpen((open) => !open)}>
              <Languages size={16} />
            </button>
            {incomingTranslationMenuOpen ? <div className="incoming-translation-menu" role="listbox" aria-label="Translate received messages to">
              {TRANSLATION_LANGUAGE_OPTIONS.map(([value, label]) => <button key={value} type="button" role="option" aria-selected={value === incomingTranslationTarget} className={value === incomingTranslationTarget ? "selected" : ""} onClick={() => { changeIncomingTranslationTarget(value); setIncomingTranslationMenuOpen(false); }}><span>{label}</span>{value === incomingTranslationTarget ? <Check size={13} /> : null}</button>)}
            </div> : null}
          </div>
          <div ref={locationPickerRef} className={`header-location-picker ${locationPickerOpen ? "open" : ""}`}><button className={`header-icon-button ${contact?.timezone ? "configured" : ""}`} type="button" aria-label="Set contact location" title={contact?.location ? `${contact.location} · ${contact.timezone}` : "Set contact location"} aria-expanded={locationPickerOpen} onClick={() => setLocationPickerOpen((open) => !open)}><MapPin size={16} /></button>{locationPickerOpen ? <div className="header-location-menu"><label><Search size={14} /><input autoFocus aria-label="Search contact city" value={contactCityQuery} placeholder={contact?.location || "Search city…"} onChange={(event) => setContactCityQuery(event.target.value)} /></label>{contactCityResults.length ? <div className="contact-city-results">{contactCityResults.map((city) => <button type="button" key={city.id} onClick={() => { void onContactChange(selectedChat.id, { location: `${city.name}, ${city.country}`, timezone: city.timezone }); setContactCityQuery(""); setContactCityResults([]); setLocationPickerOpen(false); }}><span>{city.name}, {city.country}</span><small>{city.timezone}</small></button>)}</div> : null}</div> : null}</div>
          <button className="contact-rail-toggle details-button header-icon-button" aria-expanded={!contactRailCollapsed} aria-label={contactRailCollapsed ? "Show chat details" : "Hide chat details"} title={contactRailCollapsed ? "Show chat details" : "Hide chat details"} onClick={toggleContactRail}><UserRound size={16} /></button>
        </header>

        <div ref={messageCanvasRef} onScroll={rememberChatScroll} onLoadCapture={restoreAfterMediaLoad} className={loading ? "message-canvas loading" : "message-canvas"}>
          <div className="history-scan-row"><button onClick={() => void scanOlder()} disabled={scanState === "scanning"}><RefreshCw size={14} className={scanState === "scanning" ? "spin" : ""} />{scanState === "idle" ? "Fetch & scan older messages" : scanState === "scanning" ? "Scanning older messages…" : scanState}</button></div>
          {loading ? <div className="empty-chat"><RefreshCw className="loading-history-icon" size={18} />Loading this conversation…</div> : null}
          {chronologicalMessages.map((message, index) => {
            const groupIncoming = selectedChat.isGroup && !message.fromMe;
            const color = participantColor(message);
            const dateLabel = messageDateLabel(message.timestamp);
            const previousDateLabel = index > 0 ? messageDateLabel(chronologicalMessages[index - 1]!.timestamp) : undefined;
            const reactions = mergedMessageReactions(message);
            const deletedArchive = deletedMessageArchiveEnabled ? message.deletedArchive : undefined;
            const deletedMessage = deletedArchive || message.deleted;
            const revealedDeletedArchive = Boolean(deletedArchive?.revealed);
            const callPresentation = message.call ? callEventPresentation(message.call) : undefined;
            const CallIcon = message.call?.missed ? PhoneMissed : message.call?.kind === "video" ? Video : Phone;
            return <Fragment key={message.id}>{dateLabel !== previousDateLabel ? <div className="day-divider sticky-day-divider"><span>{dateLabel}</span></div> : null}<div
              data-from-me={String(message.fromMe)}
              data-message-id={message.id}
              className={`message-row ${message.fromMe ? "sent" : "received"} ${groupIncoming ? "group-message-row" : ""} ${message.id === highlightedMessage?.id ? "source-highlight" : ""}`}
              style={{ "--participant-color": color } as CSSProperties}
            >
              {groupIncoming ? <ContactAvatar name={message.senderName || "Group participant"} src={message.senderId ? `/api/chats/${encodeURIComponent(message.senderId)}/avatar` : undefined} tone={Math.abs(color.length)} /> : null}
              <div className={`message-bubble ${message.fromMe ? "sent" : "received"}${message.hasMedia && !message.call && !deletedMessage ? " media-bubble" : ""}${reactions.length > 0 ? " has-reactions" : ""}`}>
                {groupIncoming && message.senderName ? <strong className="group-sender-name" dir="auto">{message.senderName}</strong> : null}
                {deletedMessage ? <div className="deleted-message-notice">
                  <strong>{deletedArchive?.kind === "view_once" ? "Deleted one-time media" : "Deleted message"}</strong>
                  <span>{deletedArchive
                    ? deletedArchive.kind === "view_once"
                      ? "A private local copy was saved when it arrived."
                      : deletedArchive.hasMedia ? "A private local copy may include the original media." : "A private local copy was saved before it was deleted."
                    : "This message was deleted in WhatsApp. It was not saved on this Mac."}</span>
                  <small>Sent {formatDateTime(message.timestamp, { dateStyle: "medium", timeStyle: "short" })}</small>
                  {deletedArchive?.deletedAt || message.deleted?.deletedAt
                    ? <small>Deleted {formatDateTime(deletedArchive?.deletedAt || message.deleted?.deletedAt || 0, { dateStyle: "medium", timeStyle: "short" })}</small>
                    : <small>Deletion time unavailable</small>}
                  {deletedArchive && !revealedDeletedArchive ? <button
                    type="button"
                    disabled={revealingDeletedMessageIds.has(deletedArchive.id)}
                    onClick={() => {
                      setRevealingDeletedMessageIds((current) => new Set(current).add(deletedArchive.id));
                      void onRevealDeletedMessage(selectedChat.id, deletedArchive.id).finally(() => {
                        setRevealingDeletedMessageIds((current) => {
                          const next = new Set(current);
                          next.delete(deletedArchive.id);
                          return next;
                        });
                      });
                    }}
                  >{revealingDeletedMessageIds.has(deletedArchive.id) ? "Revealing…" : "Reveal saved content"}</button> : null}
                  {deletedArchive && revealedDeletedArchive ? <div className="deleted-message-revealed-content">
                    {deletedArchive.revealedText ? <p className="deleted-message-revealed-text" dir={textDirection(deletedArchive.revealedText)}>{deletedArchive.revealedText}</p> : null}
                    {deletedArchive.revealedMediaUrl ? <a className="deleted-message-media-link" href={deletedArchive.revealedMediaUrl} target="_blank" rel="noreferrer">Open saved {deletedArchive.kind === "view_once" ? "one-time media" : "media"}</a> : null}
                    {!deletedArchive.revealedText && !deletedArchive.revealedMediaUrl ? <small>Saved content is no longer available.</small> : null}
                    <button type="button" className="deleted-message-hide-content" onClick={() => onHideDeletedMessage(selectedChat.id, deletedArchive.id)}>Hide saved content</button>
                  </div> : null}
                </div> : null}
                {!deletedMessage && message.quotedMessage ? <button className="quoted-message" type="button" onClick={() => scrollToQuotedMessage(message.quotedMessage!.id)}><strong>{message.quotedMessage.fromMe ? "You" : message.quotedMessage.senderName || selectedChat.name}</strong><span dir={textDirection(message.quotedMessage.body)}>{message.quotedMessage.body}</span></button> : null}
                {message.call && callPresentation ? <div className={`chat-call-event${message.call.missed ? " missed" : ""}`}><CallIcon size={17} /><span><strong>{callPresentation.title}</strong><small>{callPresentation.detail}</small></span></div> : null}
                {message.hasMedia && !message.call && !deletedMessage ? <ChatMedia message={message} /> : null}
                {!message.call && !deletedMessage && (message.fullBody || (message.body && message.body !== "Media message")) ? <>
                  <p dir={textDirection(message.fullBody || message.body)}>{messageTextWithLinks(message.fullBody || message.body)}</p>
                  <LinkCard value={message.fullBody || message.body} />
                  {translatedMessages[message.id] ? <div className="message-translation"><span><Languages size={13} /> {languageLabel(translatedMessages[message.id]!.targetLanguage)} translation</span><p dir={textDirection(translatedMessages[message.id]!.body)}>{translatedMessages[message.id]!.body}</p><button onClick={() => setTranslatedMessages((current) => { const next = { ...current }; delete next[message.id]; return next; })}>Show original</button></div> : null}
                </> : null}
                {!deletedMessage ? <time>{formatTime(message.timestamp)} {message.fromMe ? <Check size={13} /> : null}</time> : null}
                {!deletedMessage && reactions.length > 0 ? <div className="message-reactions" aria-label="Message reactions">{reactions.map((reaction) => {
                  const names = [...new Set(reaction.senders.map((sender) => sender.name).filter((name): name is string => Boolean(name)))];
                  const label = names.length > 0
                    ? `${reaction.emoji} by ${names.join(", ")}`
                    : reaction.senders.length > 1
                      ? `${reaction.emoji} by ${reaction.senders.length} people`
                      : reaction.emoji;
                  return <span className="message-reaction" key={`${reaction.emoji}:${reaction.senders.map((sender) => sender.id).join(",")}`} title={label} aria-label={label}><span>{reaction.emoji}</span>{reaction.senders.length > 1 ? <b>{reaction.senders.length}</b> : null}{names.length > 0 ? <small>{names.join(", ")}</small> : null}</span>;
                })}</div> : null}
                {!deletedMessage ? <div className="message-actions" aria-label="Message actions">
                  <button aria-label="Reply" onClick={() => { setReplyingTo(message); setForwarding(undefined); }}><Reply size={15} /><span>Reply</span></button>
                  <button aria-label="Translate message" disabled={translatingMessageId === message.id} onClick={() => void translateIncomingMessage(message)}><Languages size={15} /><span>{translatingMessageId === message.id ? "Translating" : "Translate"}</span></button>
                  <button aria-label="Draft a reply" disabled={draftingReplyFor === message.id} onClick={() => void prepareDraftReply(message)}><PencilLine size={15} /><span>{draftingReplyFor === message.id ? "Drafting" : "Draft reply"}</span></button>
                  <button aria-label="More message actions" aria-expanded={messageMoreFor === message.id} onClick={() => setMessageMoreFor((current) => current === message.id ? undefined : message.id)}><MoreHorizontal size={16} /><span>More</span></button>
                  {messageMoreFor === message.id ? <span className="message-actions-more">
                    <button aria-label="React" onClick={() => setReactionFor((current) => current === message.id ? undefined : message.id)}><Smile size={15} /><span>React</span></button>
                    <button aria-label="Forward" onClick={() => setForwarding(message)}><Forward size={15} /><span>Forward</span></button>
                    <button aria-label="Copy message" onClick={() => void navigator.clipboard.writeText(message.fullBody || message.body)}><Copy size={15} /><span>Copy</span></button>
                  </span> : null}
                </div> : null}
                {!deletedMessage && reactionFor === message.id ? <div className="reaction-picker">{REACTIONS.map((emoji) => <button key={emoji} onClick={() => { setReactionFor(undefined); void onReact(selectedChat.id, message.id, emoji).catch(() => undefined); }}>{emoji}</button>)}</div> : null}
              </div>
            </div></Fragment>;
          })}

          {shouldShowNewMessageJump(newMessageCount, nearChatBottomRef.current) ? <button className="new-messages-jump" type="button" onClick={() => scrollToNewest()}><ChevronDown size={16} /> <span>{newMessageCount === 1 ? "New message" : "New messages"}</span><b>{newMessageCount}</b></button> : null}

          {!loading && chronologicalMessages.length === 0 ? <div className="empty-chat">No recent messages in this conversation.</div> : null}
        </div>

        {forwarding ? <div className="forward-picker"><span><Forward size={16} /><strong>Forward message</strong><small>{forwarding.fullBody || forwarding.body}</small></span><select aria-label="Forward to conversation" defaultValue=""><option value="" disabled>Choose a chat…</option>{chats.filter((chat) => chat.id !== selectedChat.id).map((chat) => <option key={chat.id} value={chat.id}>{chat.name}</option>)}</select><button className="icon-button" aria-label="Cancel forwarding" onClick={() => setForwarding(undefined)}><X size={15} /></button><button className="button primary compact" onClick={(event) => { const select = event.currentTarget.parentElement?.querySelector("select") as HTMLSelectElement | null; if (select?.value) { void onForward(selectedChat.id, forwarding.id, select.value); setForwarding(undefined); } }}>Forward</button></div> : null}
        {activeDraft && activeDraft.id !== insertedDraftId ? <div className="draft-ready-bar"><span><Sparkles size={15} /><strong>Draft ready</strong><small>Private until you use it</small></span><div><button onClick={() => { setComposer(draftBody); setInsertedDraftId(activeDraft.id); setTranslationPreview(undefined); window.requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus()); }}>Use</button><button onClick={() => { setComposer(draftBody); setInsertedDraftId(activeDraft.id); setTranslationPreview(undefined); window.requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus()); }}>Edit</button><button aria-label="Dismiss draft" onClick={() => void onDismissDraft(activeDraft)}><X size={15} /></button></div></div> : null}
        <div className="composer" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); chooseAttachment(event.dataTransfer.files[0]); }}>
          {replyingTo ? <div className="reply-preview"><Reply size={15} /><span><strong>Replying to {replyingTo.fromMe ? "yourself" : replyingTo.senderName || selectedChat.name}</strong><small>{replyingTo.fullBody || replyingTo.body}</small></span><button aria-label="Cancel reply" onClick={() => setReplyingTo(undefined)}><X size={15} /></button></div> : null}
          {attachment ? <div className="attachment-preview">{attachment.preview ? attachment.file.type.startsWith("video/") ? <video src={attachment.preview} muted /> : <img src={attachment.preview} alt="Upload preview" /> : <UploadCloud size={24} />}<span><strong>{attachment.file.name}</strong><small>{Math.max(1, Math.round(attachment.file.size / 1024))} KB</small></span><button aria-label="Remove attachment" onClick={() => setAttachment(undefined)}><X size={16} /></button></div> : null}
          {translationPreview ? <section className={`translation-preview ${translationPreview.stale ? "stale" : ""}`} aria-label="Translation preview">
            <span className="translation-preview-status"><Languages size={15} /><strong>{translationPreview.stale ? "Translation needs updating" : "Original"}</strong></span>
            <p className="translation-preview-copy" dir={textDirection(translationPreview.original)}>{translationPreview.original}</p>
            <footer>
              <button onClick={() => { setComposer(translationPreview.original); setTranslationPreview(undefined); }}>Use original</button>
              {translationPreview.stale ? <button onClick={() => void translateComposer()}>Translate again</button> : null}
            </footer>
            <button className="translation-preview-dismiss" aria-label="Dismiss translation preview" title="Keep this translation and close the preview" onClick={() => setTranslationPreview(undefined)}><X size={15} /></button>
          </section> : null}
          {scheduleEditor ? <section className="schedule-popover schedule-popover-expanded" role="dialog" aria-label={scheduleEditor.id ? "Edit scheduled message" : "Choose scheduled send time"}>
            <header><span><CalendarClock size={14} /><strong>{scheduleEditor.id ? "Edit scheduled send" : "Schedule message"}</strong></span><button className="schedule-popover-close" aria-label="Close scheduled send" disabled={scheduling} onClick={dismissScheduleEditor}><X size={14} /></button></header>
            <div className="schedule-time-basis" role="group" aria-label="Schedule time zone">
              <button type="button" aria-pressed={scheduleEditor.timeBasis === "contact"} disabled={!contact?.timezone} onClick={() => setScheduleEditor((current) => { if (!current || !contact?.timezone) return current; const instant = dateTimeInTimeZoneToTimestamp(current.scheduledAt, current.timezone) || Date.now(); return { ...current, timeBasis: "contact", timezone: contact.timezone, scheduledAt: dateTimeValueInTimeZone(instant, contact.timezone) }; })}><UserRound size={14} />{contact?.location || "Contact time"}</button>
              <button type="button" aria-pressed={scheduleEditor.timeBasis === "owner"} onClick={() => setScheduleEditor((current) => { if (!current) return current; const timezone = ownerTimeZone(); const instant = dateTimeInTimeZoneToTimestamp(current.scheduledAt, current.timezone) || Date.now(); return { ...current, timeBasis: "owner", timezone, scheduledAt: dateTimeValueInTimeZone(instant, timezone) }; })}><Clock3 size={14} />My time</button>
            </div>
            <div className="schedule-quick-times" role="group" aria-label="Quick schedule times">
              <button type="button" onClick={() => setScheduleEditor((current) => current ? { ...current, scheduledAt: quickScheduleValue(current.timezone, "later") } : current)}>Later today</button>
              <button type="button" onClick={() => setScheduleEditor((current) => current ? { ...current, scheduledAt: quickScheduleValue(current.timezone, "morning") } : current)}>Tomorrow morning</button>
              <button type="button" onClick={() => setScheduleEditor((current) => current ? { ...current, scheduledAt: quickScheduleValue(current.timezone, "afternoon") } : current)}>Tomorrow afternoon</button>
            </div>
            <label><span>Delivery time · {scheduleEditor.timezone}</span><input type="datetime-local" value={scheduleEditor.scheduledAt} min={dateTimeValueInTimeZone(Date.now() + 10_000, scheduleEditor.timezone)} onChange={(event) => setScheduleEditor((current) => current ? { ...current, scheduledAt: event.target.value } : current)} /></label>
            <small className="schedule-time-conversion">{scheduleEditor.timeBasis === "contact" ? `That’s ${formatDateTime(dateTimeInTimeZoneToTimestamp(scheduleEditor.scheduledAt, scheduleEditor.timezone) || Date.now(), { hour: "numeric", minute: "2-digit", timeZone: ownerTimeZone() })} your time.` : contact?.timezone ? `That’s ${formatDateTime(dateTimeInTimeZoneToTimestamp(scheduleEditor.scheduledAt, scheduleEditor.timezone) || Date.now(), { hour: "numeric", minute: "2-digit", timeZone: contact.timezone })} for ${contact.location || selectedChat.name}.` : "Set the contact’s city in Details to schedule in their local time."}</small>
            <footer><button className="schedule-popover-confirm" onClick={() => void saveScheduledMessage()} disabled={scheduling}>{scheduling ? "Scheduling…" : scheduleEditor.id ? "Update" : "Schedule"}</button></footer>
          </section> : null}
          {recording ? <div className="voice-recording-status"><span className="recording-dot" /><strong>Recording voice memo</strong><time>{Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, "0")}</time><button onClick={stopVoiceRecording}>Stop &amp; send</button></div> : null}
          <div className="composer-inline-row">
          <div ref={composerAttachmentRef} className={`composer-attachment-menu-control ${composerAttachmentMenuOpen ? "open" : ""}`}>
            <button type="button" className="composer-attachment-trigger" aria-label="Add to message" aria-haspopup="menu" aria-expanded={composerAttachmentMenuOpen} onClick={() => { setComposerAttachmentMenuOpen((open) => !open); setComposerEmojiOpen(false); setImagePromptOpen(false); }}><Plus size={18} /></button>
            {composerAttachmentMenuOpen ? <div className="composer-attachment-menu" role="menu" aria-label="Add to message">
              <button type="button" role="menuitem" onClick={() => { setComposerEmojiCategory("smileys"); setComposerEmojiOpen(true); setComposerAttachmentMenuOpen(false); }}><Smile size={16} /><span>Emoji</span></button>
              <button type="button" role="menuitem" onClick={() => { fileInputRef.current?.click(); setComposerAttachmentMenuOpen(false); }}><Paperclip size={16} /><span>Attachment</span></button>
              <button type="button" role="menuitem" disabled={sending} onClick={() => { setComposerAttachmentMenuOpen(false); void startVoiceRecording(); }}><Mic size={16} /><span>Voice note</span></button>
              <button type="button" role="menuitem" onClick={() => { setImagePromptOpen(true); setComposerEmojiOpen(false); setReplyingTo(undefined); setComposerAttachmentMenuOpen(false); }}><Image size={16} /><span>Generate image</span></button>
            </div> : null}
            {composerEmojiOpen ? <div ref={composerEmojiRef} className="composer-emoji-picker" role="menu" aria-label="Choose emoji"><nav aria-label="Emoji categories">{COMPOSER_EMOJI_CATEGORIES.map((category) => <button key={category.id} type="button" className={category.id === composerEmojiCategory ? "active" : ""} aria-label={category.label} aria-pressed={category.id === composerEmojiCategory} onClick={() => setComposerEmojiCategory(category.id)}>{category.icon}</button>)}</nav><div className="composer-emoji-grid">{COMPOSER_EMOJI_CATEGORIES.find((category) => category.id === composerEmojiCategory)!.emojis.map((emoji) => <button key={emoji} aria-label={`Insert ${emoji}`} onClick={() => { setComposer((current) => `${current}${emoji}`); setComposerEmojiOpen(false); }}>{emoji}</button>)}</div></div> : null}
            {imagePromptOpen ? <form ref={imagePromptRef} className="image-prompt-popover" aria-label="Generate image attachment" onSubmit={(event) => { event.preventDefault(); void generateImageAttachment(); }}><label><Image size={15} /><span>Generate image</span></label><input autoFocus value={imagePrompt} onChange={(event) => setImagePrompt(event.target.value)} placeholder="Describe the image…" /><footer><button type="button" onClick={() => setImagePromptOpen(false)}>Cancel</button><button type="submit" disabled={!imagePrompt.trim() || generatingImage}>{generatingImage ? "Creating…" : "Create"}</button></footer></form> : null}
          </div>
          <textarea dir={textDirection(composer)} value={composer} onChange={(event) => { const next = event.target.value; setComposer(next); setScheduleEditor((current) => current ? { ...current, body: next } : current); setTranslationPreview((current) => current && current.body !== next ? { ...current, stale: true } : current); }} onPaste={(event) => { const media = [...event.clipboardData.files].find((file) => file.type.startsWith("image/") || file.type.startsWith("video/") || file.type.startsWith("audio/")); if (media) { event.preventDefault(); chooseAttachment(media); } }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submitMessage(); } }} placeholder="Write a message or paste media…" />
          <div className="composer-tools">
            <span><input ref={fileInputRef} type="file" hidden accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt" onChange={(event) => chooseAttachment(event.target.files?.[0])} /></span>
            <div className="composer-send-actions"><div ref={composerTranslationRef} className={`composer-translation-target ${composerTranslationMenuOpen ? "open" : ""}`}><button className="translation-target-select" type="button" aria-label="Translation destination language" aria-haspopup="listbox" aria-expanded={composerTranslationMenuOpen} onClick={() => setComposerTranslationMenuOpen((open) => !open)}><span>{languageLabel(translationTarget)}</span><ChevronDown size={13} /></button>{composerTranslationMenuOpen ? <div className="composer-translation-menu" role="listbox" aria-label="Translation destination language">{TRANSLATION_LANGUAGE_OPTIONS.map(([value, label]) => <button key={value} type="button" role="option" aria-selected={value === translationTarget} className={value === translationTarget ? "selected" : ""} onClick={() => { void persistTranslationTarget(value); setComposerTranslationMenuOpen(false); }}><span>{label}</span>{value === translationTarget ? <Check size={13} /> : null}</button>)}</div> : null}</div><button className="composer-translate" aria-label={translating ? "Translating draft" : `Translate draft to ${languageLabel(translationTarget)}`} title={translating ? "Translating draft" : `Translate draft to ${languageLabel(translationTarget)}`} disabled={!composer.trim() || translating} onClick={() => void translateComposer()}><Languages size={18} /></button><span className="composer-schedule-anchor"><button className={`composer-schedule ${actionableScheduledMessages.length > 0 ? "has-scheduled-message" : ""}`} disabled={Boolean(attachment) || translating || (!shouldManageScheduledMessages && (!composer.trim() || translationPreview?.stale))} onClick={() => { if (scheduleEditor) { dismissScheduleEditor(); return; } if (shouldManageScheduledMessages) { setScheduledMessageMenuOpen((current) => !current); return; } openScheduleEditor(); }} aria-label={shouldManageScheduledMessages ? `Manage ${actionableScheduledMessages.length === 1 ? "scheduled message" : `${actionableScheduledMessages.length} scheduled messages`}` : "Schedule message"} aria-expanded={Boolean(scheduleEditor) || scheduledMessageMenuOpen} title={shouldManageScheduledMessages ? "Manage scheduled messages" : "Schedule message"}><CalendarClock size={18} />{actionableScheduledMessages.length > 0 ? <span className={`scheduled-message-badge ${actionableScheduledMessages.some((message) => message.status === "failed") ? "failed" : ""}`} aria-hidden="true">{actionableScheduledMessages.length > 1 ? (actionableScheduledMessages.length > 9 ? "9+" : actionableScheduledMessages.length) : null}</span> : null}</button>{scheduleEditor ? <section className="schedule-popover" role="dialog" aria-label={scheduleEditor.id ? "Edit scheduled message" : "Choose scheduled send time"}><header><span><CalendarClock size={14} /><strong>Send at</strong></span><button className="schedule-popover-close" aria-label="Close scheduled send" disabled={scheduling} onClick={dismissScheduleEditor}><X size={14} /></button></header><label><span>Delivery time</span><input type="datetime-local" value={scheduleEditor.scheduledAt} min={dateTimeLocalValue(Date.now() + 10_000)} onChange={(event) => setScheduleEditor((current) => current ? { ...current, scheduledAt: event.target.value } : current)} /></label><footer><button className="schedule-popover-confirm" onClick={() => void saveScheduledMessage()} disabled={scheduling}>{scheduling ? "Scheduling…" : scheduleEditor.id ? "Update" : "Schedule"}</button></footer></section> : null}{scheduledMessageMenuOpen ? <section className="scheduled-message-popover" role="dialog" aria-label="Manage scheduled messages"><header><span><CalendarClock size={14} /><strong>Scheduled</strong></span><button className="schedule-popover-close" aria-label="Close scheduled messages" onClick={() => setScheduledMessageMenuOpen(false)}><X size={14} /></button></header>{actionableScheduledMessages.map((message) => <div className={`scheduled-message-popover-item ${message.status}`} key={message.id}><time>{message.status === "failed" ? "Needs review" : formatDateTime(message.scheduledAt, { dateStyle: "medium", timeStyle: "short" })}</time><span>{message.status === "pending" ? <button aria-label="Edit scheduled send" title="Edit scheduled message and time" onClick={() => openScheduleEditor(message)}><PencilLine size={14} /></button> : <button aria-label="Use scheduled message again" title="Use scheduled message again" onClick={() => { setComposer(message.body); setTranslationPreview(undefined); setScheduledMessageMenuOpen(false); }}><X size={14} /></button>}<button className="scheduled-message-cancel" aria-label="Cancel scheduled send" title="Cancel scheduled send" onClick={() => { setScheduledMessageMenuOpen(false); void onCancelScheduled(message.id); }}><X size={14} /></button></span></div>)}</section> : null}</span><button className="composer-send" disabled={sending || translating || translationPreview?.stale} onClick={() => void submitMessage()} aria-label={sending ? "Sending message" : "Send message"}><Send size={18} /></button></div>
          </div>
          </div>
        </div>
      </section>

      <aside className="contact-panel">
        <header className="contact-settings-header">
          <ContactAvatar name={selectedChat.name} src={selectedChat.avatarUrl} className="contact-settings-avatar" />
          <span className="contact-settings-identity"><strong dir="auto">{selectedChat.name}</strong><small>{selectedChat.isGroup ? "Group conversation" : "Private chat"}</small><em><span />Live context</em></span>
        </header>

        <section className="response-profile-card" aria-label="AI response profile">
          <div><span><Sparkles size={15} />AI response profile</span><b className={`response-mode ${contact?.mode || selectedChat.mode}`}><Bot size={13} /><span className="capitalize">{contact?.mode || selectedChat.mode}</span></b></div>
          <ul>
            <li><UserRound size={13} />{contact?.relationship || (selectedChat.isGroup ? "Friends group" : "Contact")}</li>
            <li><MessageSquareText size={13} />{contact?.tone || "Warm & concise"}</li>
            <li><Languages size={13} />{contact?.language || "Automatic"}</li>
            <li><MemoryStick size={13} />Memory {contact?.memoryEnabled === false ? "off" : "on"}</li>
          </ul>
          <small>Applied whenever AmirOS replies in this chat.</small>
        </section>

        <div className="contact-settings-tabs" role="tablist" aria-label="Contact settings sections">
          <button role="tab" aria-selected={contactSettingsTab === "configure"} className={contactSettingsTab === "configure" ? "active" : ""} onClick={() => setContactSettingsTab("configure")}>Configure</button>
          <button role="tab" aria-selected={contactSettingsTab === "knowledge"} className={contactSettingsTab === "knowledge" ? "active" : ""} onClick={() => setContactSettingsTab("knowledge")}>Knowledge {pendingInsights.length > 0 ? <span>{pendingInsights.length}</span> : null}</button>
        </div>

        {contactSettingsTab === "configure" ? <div className="contact-settings-section" role="tabpanel">
        <details className="contact-accordion">
          <summary><span><Bot size={17} />Reply behavior</span><small className="capitalize">{contact?.mode || selectedChat.mode}</small><ChevronDown size={16} /></summary>
          <div className="contact-accordion-body setting-section">
          <p className="contact-setting-help">Choose whether AmirOS replies, prepares a private draft, or waits for a trigger.</p>
          <div className="mode-segmented">
            {replyModes.map((mode) => (
              <button key={mode} className={activeReplyMode === mode ? `selected ${mode}` : ""} onClick={() => onModeChange(selectedChat.id, mode)}>{mode === "off" ? <LockKeyhole size={16} /> : mode === "suggest" ? <PencilLine size={16} /> : <Bot size={16} />}<span className="capitalize">{mode}</span></button>
            ))}
          </div>
          {activeReplyMode === "auto" ? <p className="auto-reply-delay-help"><Clock3 size={14} /><span>The first automatic reply waits <strong>{autoReplyInitialDelay} seconds</strong>. Each later automatic reply waits 15 seconds after a new message.</span></p> : null}
          </div>
        </details>

        <details className="contact-accordion owner-access-accordion">
          <summary><span><Brain size={17} />Owner trigger access</span><small>{ownerTriggerAccess.length} selected</small><ChevronDown size={16} /></summary>
          <div className="contact-accordion-body owner-access-body">
            <p className="contact-setting-help">Choose which private AmirOS resources are available only when you send an explicit bot trigger in this chat. This chat's own context is always included.</p>
            <div className="owner-access-options" role="group" aria-label="Owner trigger knowledge access">
              <label className={`owner-access-option ${ownerTriggerAccess.includes("knowledge") ? "selected" : ""}`}>
                <input type="checkbox" checked={ownerTriggerAccess.includes("knowledge")} onChange={() => void toggleOwnerTriggerAccess("knowledge")} />
                <span className="owner-access-icon"><Brain size={17} /></span>
                <span><strong>All contacts knowledge</strong><small>Saved facts, profiles, and insights from every known chat.</small></span>
                <span className="owner-access-check"><Check size={13} /></span>
              </label>
              <label className={`owner-access-option ${ownerTriggerAccess.includes("calendar") ? "selected" : ""}`}>
                <input type="checkbox" checked={ownerTriggerAccess.includes("calendar")} onChange={() => void toggleOwnerTriggerAccess("calendar")} />
                <span className="owner-access-icon"><CalendarDays size={17} /></span>
                <span><strong>Calendar</strong><small>Confirmed events and suggestions from all conversations.</small></span>
                <span className="owner-access-check"><Check size={13} /></span>
              </label>
            </div>
            <p className="owner-access-warning"><ShieldAlert size={15} /><span><strong>Visible in this conversation.</strong> The answer is posted here, so participants can read it. Incoming triggers use the separate permissions below.</span></p>
          </div>
        </details>

        <details className="contact-accordion contact-access-accordion">
          <summary><span><Share2 size={17} />{selectedChat.isGroup ? "Participant trigger access" : "Contact trigger access"}</span><small>{contactTriggerAccess.length} selected</small><ChevronDown size={16} /></summary>
          <div className="contact-accordion-body owner-access-body">
            <p className="contact-setting-help">{selectedChat.isGroup ? "Choose what any group participant may access when they explicitly trigger AmirOS." : `Choose what ${selectedChat.name} may access when they explicitly trigger AmirOS.`} Automatic replies remain restricted to this chat.</p>
            <div className="owner-access-options" role="group" aria-label={selectedChat.isGroup ? "Participant trigger knowledge access" : "Contact trigger knowledge access"}>
              <label className={`owner-access-option ${contactTriggerAccess.includes("knowledge") ? "selected" : ""}`}>
                <input type="checkbox" checked={contactTriggerAccess.includes("knowledge")} onChange={() => void toggleContactTriggerAccess("knowledge")} />
                <span className="owner-access-icon"><Brain size={17} /></span>
                <span><strong>All contacts knowledge</strong><small>Allows saved facts, profiles, and insights from other known chats.</small></span>
                <span className="owner-access-check"><Check size={13} /></span>
              </label>
              <label className={`owner-access-option ${contactTriggerAccess.includes("calendar") ? "selected" : ""}`}>
                <input type="checkbox" checked={contactTriggerAccess.includes("calendar")} onChange={() => void toggleContactTriggerAccess("calendar")} />
                <span className="owner-access-icon"><CalendarDays size={17} /></span>
                <span><strong>Calendar</strong><small>Allows Amir's calendar events and schedule from all conversations.</small></span>
                <span className="owner-access-check"><Check size={13} /></span>
              </label>
            </div>
            <p className="owner-access-warning contact-sharing-warning"><ShieldAlert size={15} /><span><strong>Shared with {selectedChat.isGroup ? "every group participant" : selectedChat.name}.</strong> Selected information may be sent directly into this conversation. Grant only what you are comfortable sharing.</span></p>
          </div>
        </details>

        <details className="contact-accordion" open={openContactSection === "relationship"} onToggle={(event) => setOpenContactSection(event.currentTarget.open ? "relationship" : undefined)}>
          <summary><span><UserRound size={17} />Relationship &amp; tone</span><small>{contact?.relationship || (selectedChat.isGroup ? "Friends group" : "Contact")} · {contact?.tone || "Warm & concise"}</small><ChevronDown size={16} /></summary>
          <div className="contact-accordion-body contact-form">
          <p className="contact-setting-help">These settings directly shape the next AI reply.</p>
          <label><span><UserRound size={18} />Relationship</span><select aria-label="Contact relationship" value={contact?.relationship || (selectedChat.isGroup ? "Friends group" : "Contact")} onChange={(event) => void onContactChange(selectedChat.id, { relationship: event.target.value })}>{(selectedChat.isGroup ? GROUP_RELATIONSHIP_OPTIONS : RELATIONSHIP_OPTIONS).map((option) => <option key={option}>{option}</option>)}</select></label>
          <label><span><MessageSquareText size={18} />Tone</span><select aria-label="Contact tone" value={contact?.tone || "Warm & concise"} onChange={(event) => void onContactChange(selectedChat.id, { tone: event.target.value })}>{TONE_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></label>
          <label><span><Languages size={18} />Language</span><select aria-label="Contact language" value={contact?.language || "Automatic"} onChange={(event) => void onContactChange(selectedChat.id, { language: event.target.value })}><option>Automatic</option><option>English</option><option>Hebrew</option><option>Arabic</option></select></label>
          <div className="contact-timezone-setting"><span><Clock3 size={18} />Location &amp; time<small>{contact?.timezone ? `${contact.location || contact.timezone} · ${new Intl.DateTimeFormat(undefined, { timeZone: contact.timezone, hour: "numeric", minute: "2-digit" }).format(new Date())}` : "Use the location button beside Details to set their city."}</small></span></div>
          <label className="translation-preference-setting"><span><Languages size={18} />Outgoing translation<small>{contact?.composerTranslationPreference ? `Offer ${languageLabel(contact.composerTranslationPreference.targetLanguage)} when you choose Translate. This never changes contact-language detection or sends automatically.` : "No language is remembered for outgoing translations."}</small></span>{contact?.composerTranslationPreference ? <div><button type="button" onClick={() => setTranslationTarget(contact.composerTranslationPreference!.targetLanguage)}>Use {languageLabel(contact.composerTranslationPreference.targetLanguage)}</button><button type="button" onClick={() => void onContactChange(selectedChat.id, { composerTranslationPreference: null })}>Clear</button></div> : <small>Choose a language in the composer to remember it for this chat.</small>}</label>
          {!selectedChat.isGroup ? <label><span><UserRound size={18} />How AmirOS refers to them</span><select aria-label="Contact pronouns" value={contact?.pronouns || "unspecified"} onChange={(event) => void onContactChange(selectedChat.id, { pronouns: event.target.value as ContactPronouns })}>{PRONOUN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>Optional. AmirOS uses this only for this contact and never guesses.</small></label> : null}
          <label className="contact-toggle"><span><MemoryStick size={18} />Remember context</span><input aria-label="Remember context" type="checkbox" checked={contact?.memoryEnabled ?? true} onChange={(event) => void onContactChange(selectedChat.id, { memoryEnabled: event.target.checked })} /></label>
          <label className="knowledge-tracking-setting"><span><Brain size={18} />Knowledge tracking<small>{contact?.knowledgeTracking === "pending" ? "Approval needed before AmirOS creates suggestions from this chat." : contact?.knowledgeTracking === "snoozed" ? "AmirOS will not ask again unless you choose a new setting here." : contact?.knowledgeTracking === "disabled" ? "This chat is ignored by automatic Intelligence suggestions." : "New messages are scanned once for useful, non-duplicate suggestions."}</small></span><select aria-label="Knowledge tracking" value={contact?.knowledgeTracking || "pending"} onChange={(event) => void onContactChange(selectedChat.id, { knowledgeTracking: event.target.value as ContactPreferences["knowledgeTracking"] })}><option value="pending">Ask me first</option><option value="snoozed">Decide later</option><option value="enabled">Track knowledge</option><option value="disabled">Do not track</option></select></label>
          </div>
        </details>

        <details className="contact-accordion">
          <summary><span><PencilLine size={17} />Custom instructions</span><small>{contact?.customInstructions ? "Active" : "Default"}</small><ChevronDown size={16} /></summary>
          <section className="contact-accordion-body instruction-card editable-instructions">
          <div><h3>Custom instructions</h3><small>{instructionsSaved ? "Saved — this will affect the very next AI reply." : contact?.customInstructions ? "Active on every AI reply and overrides the default personality." : "Applied only to this chat."}</small></div>
          <p className="contact-setting-help">Add chat-specific rules. These override the default assistant personality.</p>
          <textarea aria-label="Custom contact instructions" value={instructionDraft} onChange={(event) => { setInstructionDraft(event.target.value); setInstructionsSaved(false); }} placeholder="Example: Be blunt and sarcastic. Keep every reply under two sentences." />
          <button className="button primary compact" disabled={savingInstructions || instructionDraft.trim() === (contact?.customInstructions || "")} onClick={() => void saveInstructions()}>{savingInstructions ? "Saving…" : instructionsSaved ? "Saved" : "Save instructions"}</button>
          </section>
        </details>
        </div> : null}

        {contactSettingsTab === "knowledge" ? <div className="contact-settings-section" role="tabpanel">
        <div className="contact-section-eyebrow"><Brain size={14} />Memory &amp; intelligence</div>
        <details className="contact-accordion">
          <summary><span><MemoryStick size={17} />Memory</span><small>{contact?.memoryEnabled === false ? "Off" : `${incomingMessageCount} tracked`}</small><ChevronDown size={16} /></summary>
          <section className="contact-accordion-body memory-card contact-memory-card">
          <div className="memory-heading"><h3>Contact memory</h3><small>{contact?.memoryEnabled === false ? "Off" : `${incomingMessageCount} tracked`}</small></div>
          <p><span><UserRound size={17} /></span><span><strong>{contact?.relationship || "Contact"}</strong> relationship · {contact?.language === "Automatic" ? "matches their language" : `replies in ${contact?.language}`}</span></p>
          <p><span><MessageSquareText size={17} /></span><span><strong>{contact?.tone || "Warm & concise"}</strong> tone is applied to every AI reply.</span></p>
          {contact?.memoryEnabled === false ? (
            <p className="memory-empty"><span><MemoryStick size={17} /></span><span>Memory is disabled. Stored messages, manual facts, and the profile are cleared.</span></p>
          ) : (
            <>
              <div className="manual-memory-list">
                {manualMemory.map((item) => (
                  <div className="manual-memory-item" key={item.id}>
                    <span><MemoryStick size={15} /></span>
                    <p>{item.content}</p>
                    <button aria-label={`Remove memory: ${item.content}`} onClick={() => void onRemoveMemory(selectedChat.id, item.id)}><Trash2 size={14} /></button>
                  </div>
                ))}
                {manualMemory.length === 0 ? <small>No manually saved facts yet.</small> : null}
              </div>
              <div className="memory-add-row">
                <textarea aria-label="New contact memory" value={manualMemoryDraft} onChange={(event) => setManualMemoryDraft(event.target.value)} placeholder="Add a fact, preference, boundary, nickname…" />
                <button className="button compact" disabled={savingMemory || !manualMemoryDraft.trim()} onClick={() => void addMemoryItem()}><Plus size={15} />{savingMemory ? "Adding…" : "Add memory"}</button>
              </div>
              <p className="tracking-note"><span><Brain size={17} /></span><span><strong>Automatic tracking is on</strong>{memory.length > 0 ? `${memory.length} recent messages are available for replies and profiling.` : "New incoming messages will be saved locally for replies and profiling."}</span></p>
            </>
          )}
          </section>
        </details>

        <details className="contact-accordion">
          <summary><span><Brain size={17} />Relationship intelligence</span><small>{pendingInsights.length} to review</small><ChevronDown size={16} /></summary>
          <section className="contact-accordion-body instruction-card intelligence-contact-card">
          <div className="profile-card-heading">
            <span><Brain size={17} /></span>
            <div><h3>Evidence-backed intelligence</h3><small>Every incoming message is analyzed automatically once you turn on learning for this chat.</small></div>
          </div>
          {!selectedChat.isGroup ? <div className="relationship-history-learning">
            <div><strong>{contact?.knowledgeTracking === "enabled" ? "Refresh this person from recent history" : "Get to know this person"}</strong><small>Scans up to {FIRST_RUN_PEOPLE_SCAN_LIMIT} recent messages, creates an initial relationship profile, and turns on learning for new messages in this chat.</small></div>
            <button className="button primary compact intelligence-refresh" disabled={learningRelationship || contact?.memoryEnabled === false} onClick={() => void learnRelationshipFromHistory()}>
              <Sparkles size={15} />{learningRelationship ? "Learning…" : contact?.knowledgeTracking === "enabled" ? "Refresh recent history" : "Learn from recent history"}
            </button>
            {relationshipLearningError ? <p className="relationship-learning-error" role="alert">{relationshipLearningError}</p> : null}
          </div> : null}
          <button className="button compact intelligence-refresh" disabled={analyzingIntelligence || contact?.memoryEnabled === false || memory.length < 2} onClick={() => void refreshIntelligence()}>
            <Sparkles size={15} />{analyzingIntelligence ? "Reviewing…" : "Review saved messages"}
          </button>
          <div className="contact-intelligence-list">
            {pendingInsights.slice(-10).reverse().map((item) => (
              <article className="contact-insight" key={item.id}>
                <div className="insight-title"><span className={`signal-kind ${item.kind}`}>{item.kind.replace("_", " ")}</span><span className={`evidence-status ${item.status}`}>Pending</span></div>
                <p>{item.content}</p>
                <details><summary>View evidence · {Math.round(item.confidence * 100)}%</summary><blockquote>{item.evidence.senderName ? `${item.evidence.senderName}: ` : ""}{item.evidence.excerpt}</blockquote><small>{formatTime(item.evidence.timestamp)}</small></details>
                <div className="insight-actions">
                  <button onClick={() => void onInsightChange(selectedChat.id, item.id, { status: "confirmed" })}><Check size={13} />Approve</button>
                  <button onClick={() => void onInsightChange(selectedChat.id, item.id, { status: "outdated" })}><Trash2 size={13} />Dismiss</button>
                </div>
              </article>
            ))}
            {pendingInsights.length === 0 ? <p className="profile-empty">No knowledge is waiting for review. Approved knowledge remains saved and available in Intelligence.</p> : null}
          </div>
          </section>
        </details>

        <details className="contact-accordion">
          <summary><span><MessageSquareText size={17} />Your writing style</span><small>{styleProfile ? `Learned ${formatDateTime(styleProfile.updatedAt, { dateStyle: "medium", timeStyle: "short" })}` : "Learning automatically"}</small><ChevronDown size={16} /></summary>
          <section className="contact-accordion-body instruction-card writing-style-card">
          <div className="profile-card-heading"><span><MessageSquareText size={17} /></span><div><h3>Your writing style</h3><small>AmirOS learns this chat separately and uses the style on every AI reply.</small></div></div>
          <div className="style-learning-status"><RefreshCw size={15} /><span><strong>Automatic per-chat learning</strong><small>{styleProfile ? <>Last learned <time dateTime={new Date(styleProfile.updatedAt).toISOString()}>{formatDateTime(styleProfile.updatedAt, { dateStyle: "medium", timeStyle: "short" })}</time> · Refreshes after every 5 messages you send.</> : <>The first style will be learned after 5 messages you send in this chat.</>}</small></span></div>
          {styleProfile ? <>
            <p className="style-summary">{styleProfile.summary}</p>
            <div className="style-facts"><span>Length · {styleProfile.messageLength}</span><span>Emoji · {styleProfile.emojiUse}</span><span>Formality · {styleProfile.formality}</span></div>
            <ul>{styleProfile.replyGuidance.map((item) => <li key={item}>{item}</li>)}</ul>
          </> : <p className="profile-empty">No writing-style profile yet. AI-generated replies do not count as your writing.</p>}
          <button className="button compact" disabled={learningStyle} onClick={() => void learnStyle()}><RefreshCw size={14} />{learningStyle ? "Learning…" : styleProfile ? "Refresh style" : "Learn my style"}</button>
          </section>
        </details>

        {selectedChat.isGroup ? <details className="contact-accordion"><summary><span><UserRound size={17} />Group digest</span><small>{groupSummary ? "Ready" : "Not generated"}</small><ChevronDown size={16} /></summary><section className="contact-accordion-body instruction-card group-summary-card">
          <div className="profile-card-heading"><span><UserRound size={17} /></span><div><h3>Group digest</h3><small>Decisions, tasks and unanswered questions with participant attribution.</small></div></div>
          {groupSummary ? <div className="group-digest"><p>{groupSummary.summary}</p>{groupSummary.decisions.length > 0 ? <><strong>Decisions</strong><ul>{groupSummary.decisions.map((item) => <li key={item}>{item}</li>)}</ul></> : null}{groupSummary.tasks.length > 0 ? <><strong>Tasks</strong><ul>{groupSummary.tasks.map((item) => <li key={item}>{item}</li>)}</ul></> : null}{groupSummary.unansweredQuestions.length > 0 ? <><strong>Open questions</strong><ul>{groupSummary.unansweredQuestions.map((item) => <li key={item}>{item}</li>)}</ul></> : null}</div> : <p className="profile-empty">Generate a focused summary from locally saved group messages.</p>}
          <button className="button compact" disabled={summarizingGroup || memory.length < 3} onClick={() => void summarizeGroup()}><RefreshCw size={14} />{summarizingGroup ? "Summarizing…" : groupSummary ? "Refresh digest" : "Generate digest"}</button>
        </section></details> : null}

        <details className="contact-accordion">
          <summary><span><Sparkles size={17} />{selectedChat.isGroup ? "Group profile" : "Person profile"}</span><small>{profile ? "Ready" : "Not generated"}</small><ChevronDown size={16} /></summary>
          <section className="contact-accordion-body instruction-card contact-profile-card">
          <div className="profile-card-heading">
            <span><Sparkles size={17} /></span>
            <div><h3>{selectedChat.isGroup ? "Group profile" : "Person profile"}</h3><small>AI summary from saved messages and manual memory.</small></div>
          </div>
          {profile ? <div className="profile-summary">{profile.summary}</div> : <p className="profile-empty">Generate a private summary of the relationship, personality signals, communication style, preferences, and useful response guidance.</p>}
          {profile && incomingMessageCount > profile.sourceMessageCount ? <small className="profile-stale">New messages are available. Refresh the profile to include them.</small> : null}
          <div className="profile-actions">
            <button className="button primary compact" disabled={generatingProfile || contact?.memoryEnabled === false || (incomingMessageCount === 0 && manualMemory.length === 0)} onClick={() => void createProfile()}><Sparkles size={15} />{generatingProfile ? "Analyzing…" : profile ? "Refresh profile" : "Generate profile"}</button>
            {profile ? <a className="button compact profile-export-button" href={contactProfilePdfUrl(selectedChat.id)} download><Download size={15} />Export PDF</a> : null}
          </div>
          </section>
        </details>
        </div> : null}

        <footer className="contact-settings-footer"><span><Check size={14} />Selections save automatically</span><small>Instructions save with their button</small></footer>
      </aside>
    </main>
  );
}
