import {
  ArrowRight, BookmarkCheck, BookOpenCheck, CalendarCheck, CalendarDays, Check, CheckCircle2,
  ChevronDown, ChevronUp, CircleHelp, Clock3, ExternalLink, History, ListTodo,
  MessageCircleQuestion, MessageSquareText, RefreshCw, Search, Sparkles, Users, X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type {
  CalendarEvent, ChatSummary, ContactInsight, ContactPreferences, IntelligenceChat,
  IntelligenceData, RelationshipCommitment,
} from "../types";
import {
  HIDDEN_INTELLIGENCE_ACTIONS_KEY,
  readHiddenIntelligenceActions,
  replyActionId,
} from "../intelligence-visibility";
import { buildIntelligenceSnapshot, isKnownIntelligenceContactName } from "../intelligence-snapshot";
import { confirmedPlansForRelationship, type RelationshipPlan } from "../relationship-plans";
import { isLegacyProfileSummary, profileSummaryParagraph } from "../profile-summary";
import { CalendarEventForm, type CalendarEventDraft } from "./CalendarEventForm";
import { ContactAvatar } from "./ContactAvatar";

type IntelligenceTab = "briefing" | "actions" | "knowledge" | "people" | "history";
type QueueFilter = "all" | "reply" | "commitment" | "event" | "signal";
type ActionKind = Exclude<QueueFilter, "all">;
type KnowledgeFilter = "all" | ContactInsight["kind"];
type PeopleFilter = "all" | "people" | "groups";
type PeopleMetric = "knowledge" | "commitments" | "plans";

type PeopleMetricSelection = {
  chatId: string;
  metric: PeopleMetric;
  avatarUrl?: string;
};

type QueueAction = {
  id: string;
  kind: ActionKind;
  chatId: string;
  contactName: string;
  title: string;
  summary: string;
  reason: string;
  timestamp: number;
  score: number;
  evidence?: string;
  senderName?: string;
  messageId?: string;
  entity: IntelligenceData["commitments"][number] | IntelligenceData["events"][number] | IntelligenceData["changes"][number] | IntelligenceChat;
};

type IntelligenceViewProps = {
  data?: IntelligenceData;
  chats: ChatSummary[];
  contacts: Record<string, ContactPreferences>;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onOpenChat: (chatId: string, messageId?: string) => void;
  onOpenContactSettings: (chatId: string, tab: "knowledge" | "commitments") => void;
  onOpenCalendar: () => void;
  onGenerateSummary: (chatId: string, isGroup: boolean) => Promise<void>;
  onCommitmentStatus: (chatId: string, commitmentId: string, status: RelationshipCommitment["status"]) => Promise<void>;
  onCalendarStatus: (chatId: string, eventId: string, patch: { status?: CalendarEvent["status"]; title?: string; startAt?: number; endAt?: number; allDay?: boolean; location?: string }) => Promise<void>;
  onRegenerateCalendarTitle: (chatId: string, eventId: string) => Promise<string>;
  onInsightStatus: (chatId: string, insightId: string, status: ContactInsight["status"]) => Promise<void>;
  onDeleteQuestion: (id: string) => Promise<void>;
};

const ACTION_LABELS: Record<ActionKind, string> = {
  reply: "Reply",
  commitment: "Promise",
  event: "Calendar",
  signal: "New detail",
};

const KNOWLEDGE_LABELS: Record<ContactInsight["kind"], string> = {
  fact: "Fact",
  preference: "Preference",
  relationship_change: "Relationship",
  important_date: "Important date",
};

const INTELLIGENCE_TAB_KEY = "amiros-intelligence-tab";

function initialIntelligenceTab(): IntelligenceTab {
  const saved = sessionStorage.getItem(INTELLIGENCE_TAB_KEY);
  return saved === "actions" || saved === "knowledge" || saved === "people" || saved === "history" ? saved : "briefing";
}

function toMilliseconds(value: number) {
  return value < 10_000_000_000 ? value * 1_000 : value;
}

function relativeTime(value: number) {
  const delta = Date.now() - toMilliseconds(value);
  const minutes = Math.max(1, Math.round(Math.abs(delta) / 60_000));
  if (minutes < 60) return `${minutes}m ${delta >= 0 ? "ago" : "from now"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ${delta >= 0 ? "ago" : "from now"}`;
  const days = Math.round(hours / 24);
  return `${days}d ${delta >= 0 ? "ago" : "from now"}`;
}

function eventLabel(value: number) {
  const date = new Date(toMilliseconds(value));
  return {
    month: new Intl.DateTimeFormat(undefined, { month: "short" }).format(date).toUpperCase(),
    day: new Intl.DateTimeFormat(undefined, { day: "numeric" }).format(date),
    weekday: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date),
    time: new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date),
  };
}

function localDateTime(value: number) {
  const timestamp = toMilliseconds(value);
  const date = new Date(timestamp);
  return new Date(timestamp - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function knowledgeSuggestionKey(item: IntelligenceData["changes"][number]) {
  const normalizedContent = item.content
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return `${item.kind}:${normalizedContent}`;
}

function knowledgeSuggestionSubjects(item: IntelligenceData["changes"][number]) {
  // Older aggregate responses used a comma-joined contactName in addition to
  // subjectNames. Split it defensively so a stale response cannot render the
  // entire list as an extra duplicate person.
  return [...new Set(
    [...(item.subjectNames || []), item.contactName]
      .flatMap((name) => name.split(","))
      .map((name) => name.replace(/\s+/g, " ").trim())
      .filter(Boolean),
  )];
}

function eventEnd(event: CalendarEvent) {
  const startAt = toMilliseconds(event.startAt);
  return event.endAt && toMilliseconds(event.endAt) > startAt ? toMilliseconds(event.endAt) : startAt + 60 * 60 * 1_000;
}

function buildQueue(data: IntelligenceData | undefined, contacts: Record<string, ContactPreferences>, hidden: Set<string>): QueueAction[] {
  if (!data) return [];
  const chatById = new Map(data.chats.map((chat) => [chat.chatId, chat]));
  const actions: QueueAction[] = [];

  for (const chat of data.needsReply) {
    if (!isKnownIntelligenceContactName(chat.contactName)) continue;
    const actionId = replyActionId(chat);
    if (hidden.has(actionId)) continue;
    const message = chat.lastIncoming?.content || "Recent incoming message";
    const directQuestion = /[?？]\s*$/.test(message.trim());
    const relationship = contacts[chat.chatId]?.relationship || (chat.isGroup ? "Group chat" : "Private chat");
    actions.push({
      id: actionId, kind: "reply", chatId: chat.chatId, contactName: chat.contactName,
      title: `Reply to ${chat.contactName}`,
      summary: message,
      reason: directQuestion ? `Direct question · ${relationship} · waiting ${relativeTime(chat.lastIncoming?.timestamp || chat.updatedAt).replace(" ago", "")}` : `Latest message is waiting · ${relationship}`,
      timestamp: chat.lastIncoming?.timestamp || chat.updatedAt,
      score: (chat.isGroup ? 76 : 96) + (directQuestion ? 18 : 0),
      evidence: message, senderName: chat.lastIncoming?.senderName, messageId: chat.lastIncoming?.messageId, entity: chat,
    });
  }

  for (const item of data.commitments.filter((entry) => entry.status === "open")) {
    if (!isKnownIntelligenceContactName(item.contactName)) continue;
    const dueBoost = item.dueAt && toMilliseconds(item.dueAt) < Date.now() + 3 * 86_400_000 ? 18 : 0;
    actions.push({
      id: `commitment:${item.chatId}:${item.id}`, kind: "commitment", chatId: item.chatId, contactName: item.contactName,
      title: item.owner === "me" ? `Keep your promise to ${item.contactName}` : `Follow up with ${item.assigneeName || item.contactName}`,
      summary: item.content,
      reason: `${item.owner === "me" ? "Your commitment" : "Open promise"}${item.dueAt ? ` · due ${relativeTime(item.dueAt)}` : " · no due date"}`,
      timestamp: item.dueAt || item.updatedAt, score: 86 + dueBoost,
      evidence: item.evidence.excerpt, senderName: item.evidence.senderName, messageId: item.evidence.messageId, entity: item,
    });
  }

  for (const item of data.events.filter((entry) => entry.status === "inferred")) {
    if (!isKnownIntelligenceContactName(item.contactName)) continue;
    actions.push({
      id: `event:${item.chatId}:${item.id}`, kind: "event", chatId: item.chatId, contactName: item.contactName,
      title: item.title,
      summary: `${new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(toMilliseconds(item.startAt)))}${item.location ? ` · ${item.location}` : ""}`,
      reason: `Plan detected in a message · awaiting calendar approval`,
      timestamp: item.startAt, score: 82,
      evidence: item.evidence.excerpt, senderName: item.evidence.senderName, messageId: item.evidence.messageId, entity: item,
    });
  }

  for (const item of data.changes.filter((entry) => entry.status === "inferred")) {
    if (!isKnownIntelligenceContactName(item.contactName)) continue;
    const chat = chatById.get(item.chatId);
    const subjects = knowledgeSuggestionSubjects(item);
    const subjectLabel = subjects.length > 1
      ? `${subjects[0]} +${subjects.length - 1}`
      : subjects[0] || item.contactName;
    actions.push({
      id: `signal:${item.chatId}:${item.id}`, kind: "signal", chatId: item.chatId, contactName: subjectLabel,
      title: subjects.length > 1
        ? `Review ${item.kind.replaceAll("_", " ")} for ${subjects.length} people`
        : `Review ${item.kind.replaceAll("_", " ")} about ${subjectLabel}`,
      summary: item.content,
      reason: `${Math.round(item.confidence * 100)}% confidence · ${chat?.isGroup ? "learned in a group" : "new relationship signal"}`,
      timestamp: item.updatedAt, score: 54 + Math.round(item.confidence * 20),
      evidence: item.evidence.excerpt, senderName: item.evidence.senderName, messageId: item.evidence.messageId, entity: item,
    });
  }

  return actions.sort((left, right) => right.score - left.score || toMilliseconds(right.timestamp) - toMilliseconds(left.timestamp));
}

function ActionIcon({ kind }: { kind: ActionKind }) {
  if (kind === "reply") return <MessageSquareText size={17} />;
  if (kind === "commitment") return <BookmarkCheck size={17} />;
  if (kind === "event") return <CalendarCheck size={17} />;
  return <Sparkles size={17} />;
}

function PeopleMetricModal({
  selection,
  person,
  plans,
  onClose,
  onOpenSource,
  onManage,
}: {
  selection: PeopleMetricSelection;
  person: IntelligenceChat;
  plans: RelationshipPlan[];
  onClose: () => void;
  onOpenSource: (messageId?: string, sourceChatId?: string) => void;
  onManage: () => void;
}) {
  const { metric, avatarUrl } = selection;
  const [knowledgeFilter, setKnowledgeFilter] = useState<KnowledgeFilter>("all");
  const knowledge = person.insights.filter((item) => item.status === "confirmed");
  const knowledgeFilters = ["all", "fact", "preference", "relationship_change", "important_date"] as const;
  const knowledgeCounts = Object.fromEntries(knowledgeFilters.map((filter) => [
    filter,
    filter === "all" ? knowledge.length : knowledge.filter((item) => item.kind === filter).length,
  ])) as Record<KnowledgeFilter, number>;
  const visibleKnowledge = knowledgeFilter === "all"
    ? knowledge
    : knowledge.filter((item) => item.kind === knowledgeFilter);
  const commitments = person.commitments.filter((item) => item.status === "open");
  const count = metric === "knowledge" ? knowledge.length : metric === "commitments" ? commitments.length : plans.length;
  const title = metric === "knowledge" ? "Known details" : metric === "commitments" ? "Open promises" : "Confirmed plans";
  const eyebrow = metric === "knowledge" ? "Relationship knowledge" : metric === "commitments" ? "Commitments" : "Calendar";
  const emptyCopy = metric === "knowledge"
    ? "No confirmed details have been saved for this conversation yet."
    : metric === "commitments"
      ? "There are no open promises for this conversation."
      : "There are no confirmed calendar plans for this conversation.";
  const manageLabel = metric === "knowledge" ? "Manage knowledge" : metric === "commitments" ? "Manage commitments" : "Open Calendar";
  const ModalIcon = metric === "knowledge" ? BookOpenCheck : metric === "commitments" ? BookmarkCheck : CalendarDays;
  const dateTime = (value: number) => new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(toMilliseconds(value)));

  return <div className="event-detail-backdrop" role="presentation" onClick={onClose}>
    <section className="intel-person-metric-modal" role="dialog" aria-modal="true" aria-labelledby="intel-person-metric-title" onClick={(event) => event.stopPropagation()}>
      <header>
        <span className={`intel-person-metric-icon metric-${metric}`}><ModalIcon size={22} /></span>
        <div><small>{eyebrow}</small><h2 id="intel-person-metric-title">{title}</h2></div>
        <button className="icon-button" autoFocus aria-label="Close details" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="intel-person-metric-contact">
        <ContactAvatar name={person.contactName} src={avatarUrl} className="intel-person-metric-avatar" />
        <span><strong>{person.contactName}</strong><small>{count} {count === 1 ? "item" : "items"}</small></span>
      </div>
      {metric === "knowledge" ? <div className="intel-person-metric-filters" aria-label="Filter known details by type">
        {knowledgeFilters.map((filter) => <button
          key={filter}
          type="button"
          className={knowledgeFilter === filter ? "active" : ""}
          aria-pressed={knowledgeFilter === filter}
          onClick={() => setKnowledgeFilter(filter)}
        >
          <span>{filter === "all" ? "All" : KNOWLEDGE_LABELS[filter]}</span>
          <b>{knowledgeCounts[filter]}</b>
        </button>)}
      </div> : null}
      <div className="intel-person-metric-list">
        {metric === "knowledge" ? visibleKnowledge.map((item) => <article key={item.id}>
          <span className="intel-person-metric-label">{KNOWLEDGE_LABELS[item.kind]}</span>
          <p dir="auto">{item.content}</p>
          <footer><span><Clock3 size={13} />Confirmed {relativeTime(item.updatedAt)}</span><button onClick={() => onOpenSource(item.evidence.messageId)}>Open source<ArrowRight size={13} /></button></footer>
        </article>) : null}
        {metric === "commitments" ? commitments.map((item) => <article key={item.id}>
          <span className="intel-person-metric-label">{item.owner === "me" ? "Your promise" : "Their promise"}</span>
          <p dir="auto">{item.content}</p>
          {item.dueAt ? <small className="intel-person-metric-date"><Clock3 size={13} />Due {dateTime(item.dueAt)}</small> : null}
          <footer><span>{item.assigneeName ? `Assigned to ${item.assigneeName}` : "No due date"}</span><button onClick={() => onOpenSource(item.evidence.messageId)}>Open source<ArrowRight size={13} /></button></footer>
        </article>) : null}
        {metric === "plans" ? plans.map((item) => <article key={`${item.sourceChatId}:${item.id}`}>
          <span className="intel-person-metric-label">Confirmed event</span>
          <p dir="auto">{item.title}</p>
          <small className="intel-person-metric-date"><CalendarDays size={13} />{dateTime(item.startAt)}{item.location ? ` · ${item.location}` : ""}</small>
          <footer><span>Added {relativeTime(item.updatedAt)}</span><button onClick={() => onOpenSource(item.evidence.messageId, item.sourceChatId)}>Open source<ArrowRight size={13} /></button></footer>
        </article>) : null}
        {(metric === "knowledge" ? visibleKnowledge.length === 0 : count === 0) ? <div className="intel-person-metric-empty"><ModalIcon size={26} /><strong>Nothing here yet</strong><p>{metric === "knowledge" && knowledgeFilter !== "all" ? `No ${KNOWLEDGE_LABELS[knowledgeFilter].toLocaleLowerCase()} details have been saved for this conversation.` : emptyCopy}</p></div> : null}
      </div>
      <footer><button className="button" onClick={onClose}>Close</button><button className="button primary" onClick={onManage}>{manageLabel}</button></footer>
    </section>
  </div>;
}

export function IntelligenceView({
  data, chats, contacts, loading, onRefresh, onOpenChat, onOpenContactSettings, onOpenCalendar,
  onGenerateSummary, onCommitmentStatus, onCalendarStatus, onRegenerateCalendarTitle, onInsightStatus, onDeleteQuestion,
}: IntelligenceViewProps) {
  const [activeTab, setActiveTab] = useState<IntelligenceTab>(initialIntelligenceTab);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");
  const [selectedActionId, setSelectedActionId] = useState<string>();
  const [latestOpen, setLatestOpen] = useState(false);
  const [peopleSearch, setPeopleSearch] = useState("");
  const [peopleFilter, setPeopleFilter] = useState<PeopleFilter>("all");
  const [expandedSummaryIds, setExpandedSummaryIds] = useState<Set<string>>(() => new Set());
  const [summaryBusyChatId, setSummaryBusyChatId] = useState<string>();
  const [historySearch, setHistorySearch] = useState("");
  const [knowledgeSearch, setKnowledgeSearch] = useState("");
  const [knowledgeFilter, setKnowledgeFilter] = useState<KnowledgeFilter>("all");
  const [knowledgeBusyId, setKnowledgeBusyId] = useState<string>();
  const [reviewedSuggestionKeys, setReviewedSuggestionKeys] = useState<Set<string>>(() => new Set());
  const [knowledgeActionNotice, setKnowledgeActionNotice] = useState<{ tone: "success" | "error"; message: string }>();
  const [expandedKnowledgeChatId, setExpandedKnowledgeChatId] = useState<string>();
  const [hiddenActions, setHiddenActions] = useState<Set<string>>(readHiddenIntelligenceActions);
  const [calendarAction, setCalendarAction] = useState<QueueAction>();
  const [calendarDraft, setCalendarDraft] = useState<CalendarEventDraft>();
  const [calendarSaving, setCalendarSaving] = useState(false);
  const [calendarTitleBusy, setCalendarTitleBusy] = useState(false);
  const [calendarError, setCalendarError] = useState("");
  const [peopleMetricSelection, setPeopleMetricSelection] = useState<PeopleMetricSelection>();

  const chatById = useMemo(() => new Map(chats.map((chat) => [chat.id, chat])), [chats]);
  const intelligenceById = useMemo(() => new Map((data?.chats || []).map((chat) => [chat.chatId, chat])), [data?.chats]);
  const peopleMetricPerson = peopleMetricSelection ? intelligenceById.get(peopleMetricSelection.chatId) : undefined;
  const relationshipPlansByChatId = useMemo(() => {
    const intelligenceChats = (data?.chats || []).filter((person) => isKnownIntelligenceContactName(person.contactName));
    return new Map(intelligenceChats.map((person) => [
      person.chatId,
      confirmedPlansForRelationship(person, intelligenceChats),
    ]));
  }, [data?.chats]);
  const peopleMetricPlans = peopleMetricSelection
    ? relationshipPlansByChatId.get(peopleMetricSelection.chatId) || []
    : [];
  const queue = useMemo(() => buildQueue(data, contacts, hiddenActions), [data, contacts, hiddenActions]);
  const selectedAction = queue.find((item) => item.id === selectedActionId);
  const visibleQueue = queueFilter === "all" ? queue : queue.filter((item) => item.kind === queueFilter);
  const latest = data?.questionHistory[0];
  const intelligenceSnapshot = useMemo(
    () => buildIntelligenceSnapshot(data, hiddenActions),
    [data, hiddenActions],
  );
  const nextEvent = intelligenceSnapshot.upcomingEvents[0];
  const knowledgeSummary = {
    relationships: intelligenceSnapshot.relationships,
    details: intelligenceSnapshot.details,
  };

  useEffect(() => {
    if (selectedActionId && !selectedAction) setSelectedActionId(undefined);
  }, [selectedAction, selectedActionId]);

  useEffect(() => {
    sessionStorage.setItem(INTELLIGENCE_TAB_KEY, activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (!calendarAction) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setCalendarAction(undefined); setCalendarDraft(undefined); }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [calendarAction]);

  useEffect(() => {
    if (!peopleMetricSelection) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPeopleMetricSelection(undefined);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [peopleMetricSelection]);

  const hideAction = (id: string) => {
    setHiddenActions((current) => {
      const next = new Set(current); next.add(id);
      localStorage.setItem(HIDDEN_INTELLIGENCE_ACTIONS_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const primaryAction = async (action: QueueAction) => {
    if (action.kind === "reply") return onOpenChat(action.chatId);
    if (action.kind === "commitment") {
      const item = action.entity as IntelligenceData["commitments"][number];
      await onCommitmentStatus(action.chatId, item.id, "done");
    } else if (action.kind === "event") {
      const item = action.entity as IntelligenceData["events"][number];
      setCalendarError("");
      setCalendarAction(action);
      setCalendarDraft({ title: item.title, startAt: localDateTime(item.startAt), endAt: localDateTime(eventEnd(item)), location: item.location || "" });
      return;
    } else {
      const item = action.entity as IntelligenceData["changes"][number];
      await onInsightStatus(action.chatId, item.id, "confirmed");
    }
    setSelectedActionId(undefined);
  };

  const saveCalendarAction = async () => {
    if (!calendarAction || !calendarDraft) return;
    const item = calendarAction.entity as IntelligenceData["events"][number];
    const title = calendarDraft.title.replace(/\s+/g, " ").trim();
    const startAt = new Date(calendarDraft.startAt).getTime();
    const endAt = new Date(calendarDraft.endAt).getTime();
    if (!title) { setCalendarError("Add an event title before saving."); return; }
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) { setCalendarError("The event end time must be after its start time."); return; }
    setCalendarSaving(true);
    setCalendarError("");
    try {
      await onCalendarStatus(calendarAction.chatId, item.id, { status: "confirmed", title, startAt, endAt, location: calendarDraft.location.trim(), allDay: false });
      setCalendarAction(undefined);
      setCalendarDraft(undefined);
      setSelectedActionId(undefined);
    } catch (error) {
      setCalendarError(error instanceof Error ? error.message : "Could not add this event to the calendar");
    } finally {
      setCalendarSaving(false);
    }
  };

  const regenerateCalendarDraftTitle = async () => {
    if (!calendarAction || !calendarDraft) return;
    const item = calendarAction.entity as IntelligenceData["events"][number];
    setCalendarTitleBusy(true);
    setCalendarError("");
    try {
      const title = await onRegenerateCalendarTitle(calendarAction.chatId, item.id);
      setCalendarDraft((current) => current ? { ...current, title } : current);
    } catch (error) {
      setCalendarError(error instanceof Error ? error.message : "Could not generate a better title");
    } finally {
      setCalendarTitleBusy(false);
    }
  };

  const openActionSource = (action: QueueAction) => onOpenChat(action.chatId, action.messageId);

  const dismissAction = async (action: QueueAction) => {
    if (action.kind === "reply") hideAction(action.id);
    else if (action.kind === "commitment") await onCommitmentStatus(action.chatId, (action.entity as IntelligenceData["commitments"][number]).id, "dismissed");
    else if (action.kind === "event") await onCalendarStatus(action.chatId, (action.entity as IntelligenceData["events"][number]).id, { status: "dismissed" });
    else await onInsightStatus(action.chatId, (action.entity as IntelligenceData["changes"][number]).id, "outdated");
    setSelectedActionId(undefined);
  };

  const actionButtonLabel = (kind: ActionKind) => kind === "reply" ? "Reply" : kind === "commitment" ? "Mark done" : kind === "event" ? "Add to calendar" : "Confirm detail";
  const counts = useMemo(() => ({
    all: queue.length,
    reply: queue.filter((item) => item.kind === "reply").length,
    commitment: queue.filter((item) => item.kind === "commitment").length,
    event: queue.filter((item) => item.kind === "event").length,
    signal: queue.filter((item) => item.kind === "signal").length,
  }), [queue]);
  const briefCopy = queue.length === 0
    ? "You are caught up. AmirOS will keep watching conversations for plans, promises, questions, and new relationship signals."
    : `You have ${queue.length} item${queue.length === 1 ? "" : "s"} worth your attention. ${counts.reply ? `${counts.reply} conversation${counts.reply === 1 ? " needs" : "s need"} a reply` : "No replies are waiting"}${counts.event ? ` and ${counts.event} plan${counts.event === 1 ? " needs" : "s need"} calendar review` : ""}.`;

  const renderActionRow = (action: QueueAction, index: number) => {
    const chat = chatById.get(action.chatId);
    return <article key={action.id} className={`intel-action-row kind-${action.kind} ${selectedActionId === action.id ? "selected" : ""}`} onClick={() => setSelectedActionId(action.id)}>
      <span className="intel-priority" aria-label={`Priority ${index + 1}`}>{index + 1}</span>
      <ContactAvatar name={action.contactName} src={chat?.avatarUrl} tone={index} className="intel-avatar" />
      <span className="intel-action-copy"><span className="intel-action-meta"><b>{action.contactName}</b><small><ActionIcon kind={action.kind} />{ACTION_LABELS[action.kind]}</small></span><strong dir="auto">{action.title}</strong><p dir="auto">{action.summary}</p></span>
      <span className="intel-action-reason"><small>Why this is here</small><span>{action.reason}</span></span>
      <time>{relativeTime(action.timestamp)}</time>
      <span className="intel-row-actions"><button className="text-action primary" onClick={(event) => { event.stopPropagation(); void primaryAction(action); }}>{actionButtonLabel(action.kind)}</button><button className="text-action" onClick={(event) => { event.stopPropagation(); openActionSource(action); }}>Source</button><button className="text-action muted" onClick={(event) => { event.stopPropagation(); void dismissAction(action); }}>Dismiss</button></span>
    </article>;
  };

  const knownPeople = useMemo(
    () => (data?.chats || []).filter((person) => isKnownIntelligenceContactName(person.contactName)),
    [data?.chats],
  );
  const peopleCounts = useMemo(() => ({
    all: knownPeople.length,
    people: knownPeople.filter((person) => !person.isGroup).length,
    groups: knownPeople.filter((person) => person.isGroup).length,
  }), [knownPeople]);
  const people = useMemo(() => {
    const query = peopleSearch.trim().toLocaleLowerCase();
    return [...knownPeople]
      .filter((person) => peopleFilter === "all" || (peopleFilter === "groups" ? person.isGroup : !person.isGroup))
      .filter((person) => !query || person.contactName.toLocaleLowerCase().includes(query))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [knownPeople, peopleFilter, peopleSearch]);
  const history = useMemo(() => (data?.questionHistory || []).filter((item) => `${item.question} ${item.answer}`.toLocaleLowerCase().includes(historySearch.toLocaleLowerCase())), [data?.questionHistory, historySearch]);
  const confirmedKnowledge = useMemo(() => {
    const query = knowledgeSearch.trim().toLocaleLowerCase();
    return intelligenceSnapshot.confirmedKnowledge.filter((item) => {
      if (knowledgeFilter !== "all" && item.kind !== knowledgeFilter) return false;
      return !query || `${item.contactName} ${item.content} ${KNOWLEDGE_LABELS[item.kind]}`.toLocaleLowerCase().includes(query);
    });
  }, [intelligenceSnapshot.confirmedKnowledge, knowledgeFilter, knowledgeSearch]);
  const knowledgeGroups = useMemo(() => {
    const query = knowledgeSearch.trim().toLocaleLowerCase();
    const grouped = new Map<string, {
      chatId: string;
      contactName: string;
      items: typeof intelligenceSnapshot.confirmedKnowledge;
      matchingItems: typeof intelligenceSnapshot.confirmedKnowledge;
      updatedAt: number;
    }>();
    for (const item of intelligenceSnapshot.confirmedKnowledge) {
      const group = grouped.get(item.chatId) || {
        chatId: item.chatId,
        contactName: item.contactName,
        items: [],
        matchingItems: [],
        updatedAt: 0,
      };
      group.items.push(item);
      group.updatedAt = Math.max(group.updatedAt, toMilliseconds(item.updatedAt));
      const typeMatches = knowledgeFilter === "all" || item.kind === knowledgeFilter;
      const queryMatches = !query || `${item.contactName} ${item.content} ${KNOWLEDGE_LABELS[item.kind]}`.toLocaleLowerCase().includes(query);
      if (typeMatches && queryMatches) group.matchingItems.push(item);
      grouped.set(item.chatId, group);
    }
    return [...grouped.values()]
      .filter((group) => group.matchingItems.length > 0)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }, [intelligenceSnapshot.confirmedKnowledge, knowledgeFilter, knowledgeSearch]);
  const expandedKnowledgeGroup = knowledgeGroups.find((group) => group.chatId === expandedKnowledgeChatId);
  const recentKnowledge = confirmedKnowledge.slice(0, 10);
  const knowledgeSuggestions = useMemo(() => {
    const query = knowledgeSearch.trim().toLocaleLowerCase();
    const matches = (data?.changes || [])
      .filter((item) => item.status === "inferred" && isKnownIntelligenceContactName(item.contactName))
      .filter((item) => knowledgeFilter === "all" || item.kind === knowledgeFilter)
      .filter((item) => !query || `${item.contactName} ${item.content} ${KNOWLEDGE_LABELS[item.kind]} ${item.evidence.excerpt}`.toLocaleLowerCase().includes(query));
    const grouped = new Map<string, IntelligenceData["changes"][number]>();
    for (const item of matches) {
      const key = knowledgeSuggestionKey(item);
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, item);
        continue;
      }
      const newest = toMilliseconds(item.updatedAt) > toMilliseconds(existing.updatedAt) ? item : existing;
      grouped.set(key, {
        ...newest,
        confidence: Math.max(existing.confidence, item.confidence),
        subjectChatIds: [...new Set([...(existing.subjectChatIds || []), ...(item.subjectChatIds || []), existing.chatId, item.chatId])],
        subjectNames: [...new Set([...knowledgeSuggestionSubjects(existing), ...knowledgeSuggestionSubjects(item)])],
      });
    }
    return [...grouped.values()]
      .filter((item) => !reviewedSuggestionKeys.has(knowledgeSuggestionKey(item)))
      .sort((left, right) => toMilliseconds(right.updatedAt) - toMilliseconds(left.updatedAt));
  }, [data?.changes, knowledgeFilter, knowledgeSearch, reviewedSuggestionKeys]);

  const reviewKnowledge = async (item: IntelligenceData["changes"][number], status: "confirmed" | "outdated") => {
    setKnowledgeBusyId(item.id);
    setKnowledgeActionNotice(undefined);
    try {
      await onInsightStatus(item.chatId, item.id, status);
      setReviewedSuggestionKeys((current) => new Set(current).add(knowledgeSuggestionKey(item)));
      setKnowledgeActionNotice({
        tone: "success",
        message: status === "confirmed" ? "Saved to knowledge for every linked person." : "Suggestion dismissed.",
      });
    } catch (error) {
      setKnowledgeActionNotice({
        tone: "error",
        message: error instanceof Error && error.message ? error.message : "Could not update this suggestion. Please try again.",
      });
    } finally {
      setKnowledgeBusyId(undefined);
    }
  };

  const generatePersonSummary = async (person: IntelligenceChat) => {
    setSummaryBusyChatId(person.chatId);
    try {
      await onGenerateSummary(person.chatId, person.isGroup);
      await onRefresh();
    } finally {
      setSummaryBusyChatId(undefined);
    }
  };

  const renderPersonCard = (person: IntelligenceChat, index: number) => {
    const chat = chatById.get(person.chatId);
    const prefs = contacts[person.chatId];
    const open = person.commitments.filter((item) => item.status === "open").length;
    const known = person.insights.filter((item) => item.status === "confirmed").length;
    const plans = relationshipPlansByChatId.get(person.chatId)?.length || 0;
    const summaryRecord = person.isGroup ? person.groupSummary : person.profile;
    const summary = summaryRecord?.summary;
    const displaySummary = summary ? profileSummaryParagraph(summary, person.contactName) : undefined;
    const summaryNeedsRewrite = summary ? isLegacyProfileSummary(summary) : false;
    const summaryUpdatedAt = summaryRecord?.updatedAt;
    const summaryNeedsRefresh = summaryUpdatedAt !== undefined
      && toMilliseconds(person.updatedAt) > toMilliseconds(summaryUpdatedAt) + 1_000;
    const summaryBusy = summaryBusyChatId === person.chatId;
    const summaryCollapsed = !expandedSummaryIds.has(person.chatId);
    return <article key={person.chatId} style={{ "--people-order": index } as CSSProperties}>
      <button className="intel-person-main" onClick={() => onOpenChat(person.chatId)}><ContactAvatar name={person.contactName} src={chat?.avatarUrl} tone={index} className="intel-person-avatar" /><span><strong>{person.contactName}</strong><small>{prefs?.relationship || (person.isGroup ? "Group chat" : "Contact")} · {prefs?.tone || "Natural tone"}</small></span><ArrowRight size={16} /></button>
      <div className="intel-person-snapshot">
        <button aria-haspopup="dialog" aria-label={`Open known details for ${person.contactName}`} onClick={() => setPeopleMetricSelection({ chatId: person.chatId, metric: "knowledge", avatarUrl: chat?.avatarUrl })}><b>{known}</b><span>known details</span></button>
        <button aria-haspopup="dialog" aria-label={`Open promises for ${person.contactName}`} onClick={() => setPeopleMetricSelection({ chatId: person.chatId, metric: "commitments", avatarUrl: chat?.avatarUrl })}><b>{open}</b><span>open promises</span></button>
        <button aria-haspopup="dialog" aria-label={`Open plans for ${person.contactName}`} onClick={() => setPeopleMetricSelection({ chatId: person.chatId, metric: "plans", avatarUrl: chat?.avatarUrl })}><b>{plans}</b><span>plans</span></button>
      </div>
      {displaySummary ? <div className={`intel-person-summary-block ${summaryCollapsed ? "collapsed" : "expanded"}`}>
        <p className="intel-person-summary" dir="auto">{displaySummary}</p>
        {displaySummary.length > 180 ? <button
          className="intel-person-summary-toggle"
          aria-expanded={!summaryCollapsed}
          onClick={() => setExpandedSummaryIds((current) => {
            const next = new Set(current);
            if (next.has(person.chatId)) next.delete(person.chatId);
            else next.add(person.chatId);
            return next;
          })}
        >{summaryCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}{summaryCollapsed ? "Show full summary" : "Collapse summary"}</button> : null}
        <div className="intel-person-summary-meta">
          <span title={new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(toMilliseconds(summaryUpdatedAt!)))}><Clock3 size={12} />Summary generated {relativeTime(summaryUpdatedAt!)}</span>
          {summaryNeedsRefresh || summaryNeedsRewrite ? <button disabled={summaryBusy} onClick={() => void generatePersonSummary(person)}>{summaryBusy ? <RefreshCw size={13} className="spin" /> : <RefreshCw size={13} />}{summaryBusy ? "Rewriting…" : summaryNeedsRewrite ? "Rewrite summary" : "Regenerate summary"}{!summaryBusy ? <em>{summaryNeedsRewrite ? "New format" : "New knowledge"}</em> : null}</button> : null}
        </div>
      </div> : <div className="intel-person-summary-missing"><span><Sparkles size={15} /><span><strong>No summary yet</strong><small>Generate one from saved conversation history.</small></span></span><button disabled={summaryBusy} onClick={() => void generatePersonSummary(person)}>{summaryBusy ? <RefreshCw size={13} className="spin" /> : <Sparkles size={13} />}{summaryBusy ? "Generating…" : "Generate summary"}</button></div>}
      <footer><span><Clock3 size={13} />Meaningful activity {relativeTime(person.updatedAt)}</span><button onClick={() => onOpenChat(person.chatId)}>Open conversation</button></footer>
    </article>;
  };

  return <main className="main-content intelligence-page intelligence-command">
    <header className="page-header intel-command-header"><div><div className="intel-title-row"><h1>Intelligence</h1><span className="beta-badge intel-beta">Beta</span></div><p>Your personal command center for priorities, people, and next best actions.</p></div><div className="intelligence-sync"><CheckCircle2 size={15} /><span>{loading ? "Syncing knowledge…" : data ? `Synced ${relativeTime(data.generatedAt)}` : "Waiting for knowledge"}</span><button className="icon-button" aria-label="Refresh intelligence" disabled={loading} onClick={() => void onRefresh()}><RefreshCw size={17} className={loading ? "spin" : ""} /></button></div></header>

    <nav className="intel-tabs" aria-label="Intelligence sections">
      {([
        ["briefing", "Briefing", Sparkles], ["actions", "Action Queue", ListTodo], ["knowledge", "Knowledge", BookOpenCheck], ["people", "People", Users], ["history", "Ask History", History],
      ] as const).map(([id, label, Icon]) => <button key={id} className={activeTab === id ? "active" : ""} aria-current={activeTab === id ? "page" : undefined} onClick={() => { setActiveTab(id); setSelectedActionId(undefined); }}><Icon size={17} /><span>{label}</span>{id === "actions" && queue.length > 0 ? <em>{queue.length}</em> : id === "knowledge" && knowledgeSuggestions.length > 0 ? <em>{knowledgeSuggestions.length}</em> : null}</button>)}
    </nav>

    <div className={`intel-workspace ${selectedAction ? "has-inspector" : ""}`}>
      <div className="intel-primary">
        {activeTab === "briefing" ? <>
          <section className="intel-briefing"><span className="intel-eyebrow">Today’s briefing</span><h2>{queue.length ? "A few things deserve your attention." : "Everything important is in hand."}</h2><p>{briefCopy}</p><div className="intel-briefing-stats"><span><b>{counts.reply}</b> waiting replies</span><span><b>{counts.commitment}</b> open promises</span><span><b>{counts.event}</b> calendar decisions</span><span><b>{counts.signal}</b> new signals</span></div></section>
          <section className="intel-priority-list"><header><div><span className="intel-eyebrow">Your next best actions</span><h2>Priority queue</h2></div>{queue.length > 3 ? <button onClick={() => setActiveTab("actions")}>View all {queue.length}<ArrowRight size={15} /></button> : null}</header><div className="intel-action-head"><span>Priority</span><span>Conversation and action</span><span>Reason</span><span>When</span><span>Actions</span></div>{queue.slice(0, 3).map(renderActionRow)}{queue.length === 0 ? <div className="intel-empty"><CheckCircle2 size={28} /><strong>You’re caught up</strong><p>New actions will appear when AmirOS finds a question, promise, plan, or useful detail.</p></div> : null}</section>
          <section className="intel-changes"><header><div><span className="intel-eyebrow">Since your last visit</span><h2>What changed</h2></div></header><div>{(data?.changes || []).slice(0, 4).map((item) => <button key={item.id} onClick={() => onOpenChat(item.chatId)}><Sparkles size={15} /><span><b>{item.contactName}</b><small>{item.kind.replaceAll("_", " ")}</small><p dir="auto">{item.content}</p></span><ArrowRight size={14} /></button>)}{(data?.changes || []).length === 0 ? <p className="intel-muted-empty">No new relationship details since the last scan.</p> : null}</div></section>
          <section className="intel-snapshot-detail">
            <header><div><span className="intel-eyebrow">Intelligence snapshot</span><h2>The information behind your Overview</h2><p>These are the exact confirmed records used by the Overview snapshot. Open any item to see its source conversation.</p></div></header>
            <div className="intel-snapshot-stats" aria-label="Intelligence snapshot totals">
              <span><Users size={16} /><b>{knowledgeSummary.relationships}</b><small>relationships understood</small></span>
              <span><Sparkles size={16} /><b>{knowledgeSummary.details}</b><small>confirmed details</small></span>
              <span><MessageSquareText size={16} /><b>{counts.reply}</b><small>replies due</small></span>
              <span><CalendarCheck size={16} /><b>{intelligenceSnapshot.upcomingEvents.length}</b><small>upcoming events</small></span>
            </div>
            <div className="intel-snapshot-content">
              <section>
                <header><div><span className="intel-snapshot-symbol knowledge"><Sparkles size={16} /></span><span><small>Verified relationship knowledge</small><h3>Confirmed details</h3></span></div><button onClick={() => setActiveTab("knowledge")}>View all knowledge<ArrowRight size={14} /></button></header>
                <div className="intel-snapshot-knowledge-list">
                  {intelligenceSnapshot.confirmedKnowledge.map((item, index) => <button key={`${item.chatId}:${item.id}`} onClick={() => onOpenChat(item.chatId)}>
                    <ContactAvatar name={item.contactName} src={chatById.get(item.chatId)?.avatarUrl} tone={index} className="intel-snapshot-avatar" />
                    <span><span><strong>{item.contactName}</strong><small>{item.kind.replaceAll("_", " ")}</small></span><p dir="auto">{item.content}</p></span>
                    <ArrowRight size={14} />
                  </button>)}
                  {intelligenceSnapshot.confirmedKnowledge.length === 0 ? <div className="intel-snapshot-empty"><Sparkles size={20} /><span><strong>No confirmed details yet</strong><small>Confirmed relationship knowledge will appear here.</small></span></div> : null}
                </div>
              </section>
              <section>
                <header><div><span className="intel-snapshot-symbol calendar"><CalendarDays size={16} /></span><span><small>Confirmed schedule</small><h3>Upcoming plans</h3></span></div><button onClick={onOpenCalendar}>Open Calendar<ArrowRight size={14} /></button></header>
                <div className="intel-snapshot-event-list">
                  {intelligenceSnapshot.upcomingEvents.map((item) => { const date = eventLabel(item.startAt); return <button key={`${item.chatId}:${item.id}`} onClick={onOpenCalendar}>
                    <span className="intel-snapshot-date"><small>{date.month}</small><b>{date.day}</b></span>
                    <span><strong dir="auto">{item.title}</strong><small>{date.weekday} · {date.time} · {item.contactName}</small></span>
                    <ArrowRight size={14} />
                  </button>; })}
                  {intelligenceSnapshot.upcomingEvents.length === 0 ? <div className="intel-snapshot-empty"><CalendarCheck size={20} /><span><strong>No upcoming confirmed events</strong><small>Approved plans will appear here and in Calendar.</small></span></div> : null}
                </div>
              </section>
            </div>
          </section>
        </> : null}

        {activeTab === "actions" ? <section className="intel-queue-view"><header><div><span className="intel-eyebrow">Unified action queue</span><h2>Everything that needs a decision</h2><p>Ranked by urgency, relationship context, message type, and waiting time.</p></div></header><div className="intel-filter-tabs">{(["all", "reply", "commitment", "event", "signal"] as QueueFilter[]).map((filter) => <button key={filter} className={queueFilter === filter ? "active" : ""} onClick={() => setQueueFilter(filter)}>{filter === "all" ? "All" : ACTION_LABELS[filter]}<span>{counts[filter]}</span></button>)}</div><div className="intel-action-head"><span>Priority</span><span>Conversation and action</span><span>Reason</span><span>When</span><span>Actions</span></div>{visibleQueue.map(renderActionRow)}{visibleQueue.length === 0 ? <div className="intel-empty"><CheckCircle2 size={28} /><strong>No actions in this category</strong><p>Try another filter or refresh Intelligence.</p></div> : null}</section> : null}

        {activeTab === "knowledge" ? <section className="intel-knowledge-view">
          <header>
            <div><span className="intel-eyebrow">Relationship memory</span><h2>Knowledge</h2><p>Incoming messages are analyzed automatically. Review new suggestions or explore saved knowledge by relationship.</p></div>
            <label className="intel-search"><Search size={16} /><input value={knowledgeSearch} onChange={(event) => setKnowledgeSearch(event.target.value)} placeholder="Search saved knowledge" aria-label="Search saved knowledge" />{knowledgeSearch ? <button onClick={() => setKnowledgeSearch("")} aria-label="Clear knowledge search"><X size={14} /></button> : null}</label>
          </header>
          <div className="intel-knowledge-toolbar">
            <div className="intel-knowledge-filters" aria-label="Filter knowledge by type">{(["all", "fact", "preference", "relationship_change", "important_date"] as KnowledgeFilter[]).map((filter) => <button key={filter} className={knowledgeFilter === filter ? "active" : ""} onClick={() => setKnowledgeFilter(filter)}>{filter === "all" ? "All knowledge" : KNOWLEDGE_LABELS[filter]}</button>)}</div>
            <span className="intel-live-analysis"><span />Automatic analysis active</span>
            <button className="intel-check-suggestions" disabled={loading} onClick={() => void onRefresh()}><RefreshCw size={14} className={loading ? "spin" : ""} />Refresh live suggestions</button>
          </div>
          <div className="intel-knowledge-columns">
            <section className="intel-knowledge-relationships">
              <header><div><span className="intel-knowledge-section-icon confirmed"><Users size={17} /></span><span><h3>Knowledge by relationship</h3><small>{knowledgeGroups.length} people and groups · {intelligenceSnapshot.details} saved items</small></span></div></header>
              <div className="intel-knowledge-bubbles" aria-label="People and groups with saved knowledge">
                {knowledgeGroups.map((group, index) => <button
                  key={group.chatId}
                  className={expandedKnowledgeChatId === group.chatId ? "active" : ""}
                  aria-expanded={expandedKnowledgeChatId === group.chatId}
                  onClick={() => setExpandedKnowledgeChatId((current) => current === group.chatId ? undefined : group.chatId)}
                >
                  <ContactAvatar name={group.contactName} src={chatById.get(group.chatId)?.avatarUrl} tone={index} className="intel-knowledge-bubble-avatar" />
                  <span><strong>{group.contactName}</strong><small>{group.items.length} knowledge item{group.items.length === 1 ? "" : "s"}</small></span>
                  <b>{group.items.length}</b>
                </button>)}
                {knowledgeGroups.length === 0 ? <div className="intel-knowledge-empty"><Search size={22} /><strong>No relationships match</strong><p>Try another search or knowledge type.</p></div> : null}
              </div>
              {expandedKnowledgeGroup ? <div className="intel-expanded-knowledge">
                <header><span><strong>{expandedKnowledgeGroup.contactName}</strong><small>{expandedKnowledgeGroup.matchingItems.length} matching saved item{expandedKnowledgeGroup.matchingItems.length === 1 ? "" : "s"}</small></span><button aria-label="Collapse saved knowledge" onClick={() => setExpandedKnowledgeChatId(undefined)}><X size={15} /></button></header>
                <div>{expandedKnowledgeGroup.matchingItems.map((item) => <article key={item.id}>
                  <span><em>{KNOWLEDGE_LABELS[item.kind]}</em><time>{relativeTime(item.updatedAt)}</time></span>
                  <p dir="auto">{item.content}</p>
                  <button className="text-action" onClick={() => onOpenChat(item.chatId, item.evidence.messageId)}>Open source</button>
                </article>)}</div>
              </div> : <div className="intel-knowledge-selection-hint"><BookOpenCheck size={20} /><span><strong>Select a person or group</strong><small>Their saved knowledge will expand here without leaving this page.</small></span></div>}
            </section>
            <section className="intel-suggested-knowledge">
              <header><div><span className="intel-knowledge-section-icon suggested"><Sparkles size={17} /></span><span><h3>Suggested from messages</h3><small>{knowledgeSuggestions.length} awaiting your review</small></span></div></header>
              <div className="intel-suggestion-list">
                {knowledgeActionNotice ? <p className={`intel-suggestion-feedback ${knowledgeActionNotice.tone}`} role={knowledgeActionNotice.tone === "error" ? "alert" : "status"}>{knowledgeActionNotice.message}</p> : null}
                {knowledgeSuggestions.map((item, index) => {
                  const subjects = knowledgeSuggestionSubjects(item);
                  return <article key={knowledgeSuggestionKey(item)}>
                  <header><ContactAvatar name={subjects[0] || item.contactName} src={chatById.get(item.chatId)?.avatarUrl} tone={index} className="intel-knowledge-avatar" /><span><strong>{subjects.length > 1 ? `Applies to ${subjects.length} people` : subjects[0]}</strong><small>{KNOWLEDGE_LABELS[item.kind]} · {Math.round(item.confidence * 100)}% confidence</small></span></header>
                  {subjects.length > 1 ? <div className="intel-knowledge-subjects" aria-label="People this knowledge applies to">{subjects.map((subject) => <span key={subject}>{subject}</span>)}</div> : null}
                  <p dir="auto">{item.content}</p>
                  <blockquote dir="auto"><small>Detected in message</small>“{item.evidence.excerpt}”{item.evidence.senderName ? <cite>— {item.evidence.senderName}</cite> : null}</blockquote>
                  <footer><button className="text-action" onClick={() => onOpenChat(item.chatId)}>View source</button><span><button className="knowledge-reject" aria-label={`Reject suggestion about ${item.contactName}`} disabled={knowledgeBusyId === item.id} onClick={() => void reviewKnowledge(item, "outdated")}><X size={14} />Reject</button><button className="knowledge-confirm" disabled={knowledgeBusyId === item.id} onClick={() => void reviewKnowledge(item, "confirmed")}><Check size={14} />Add to knowledge</button></span></footer>
                </article>;})}
                {knowledgeSuggestions.length === 0 ? <div className="intel-knowledge-empty positive"><CheckCircle2 size={23} /><strong>No suggestions waiting</strong><p>AmirOS watches incoming messages for useful facts, preferences, dates, and relationship changes. New suggestions will appear here before they are saved.</p></div> : null}
              </div>
            </section>
          </div>
          <section className="intel-recent-knowledge">
            <header><span><small>Saved automatically after your approval</small><h3>Recently saved knowledge</h3></span><strong>{recentKnowledge.length} shown</strong></header>
            <div className="intel-knowledge-table" role="table" aria-label="Recently saved knowledge">
              <div role="row" className="intel-knowledge-table-head"><span role="columnheader">Person or group</span><span role="columnheader">Type</span><span role="columnheader">Knowledge</span><span role="columnheader">Saved</span><span role="columnheader">Source</span></div>
              {recentKnowledge.map((item, index) => <div role="row" key={`${item.chatId}:${item.id}`}>
                <span role="cell"><ContactAvatar name={item.contactName} src={chatById.get(item.chatId)?.avatarUrl} tone={index} className="intel-recent-avatar" /><strong>{item.contactName}</strong></span>
                <span role="cell"><em>{KNOWLEDGE_LABELS[item.kind]}</em></span>
                <p role="cell" dir="auto">{item.content}</p>
                <time role="cell">{relativeTime(item.updatedAt)}</time>
                <span role="cell"><button className="text-action" onClick={() => onOpenChat(item.chatId, item.evidence.messageId)}>Open</button></span>
              </div>)}
              {recentKnowledge.length === 0 ? <div className="intel-knowledge-empty"><BookOpenCheck size={22} /><strong>No recently saved knowledge</strong><p>Approve a suggestion and it will appear here.</p></div> : null}
            </div>
          </section>
        </section> : null}

        {activeTab === "people" ? <section className="intel-people-view">
          <header><div><span className="intel-eyebrow">Relationship knowledge</span><h2>People and groups</h2><p>See what AmirOS knows, what is changing, and where attention may be useful.</p></div><label className="intel-search"><Search size={16} /><input value={peopleSearch} onChange={(event) => setPeopleSearch(event.target.value)} placeholder="Search people and groups" aria-label="Search people and groups" />{peopleSearch ? <button onClick={() => setPeopleSearch("")} aria-label="Clear search"><X size={14} /></button> : null}</label></header>
          <div className="intel-filter-tabs intel-people-filter-tabs" aria-label="Filter people and groups">
            {(["all", "people", "groups"] as PeopleFilter[]).map((filter) => <button key={filter} className={peopleFilter === filter ? "active" : ""} aria-pressed={peopleFilter === filter} onClick={() => setPeopleFilter(filter)}>{filter === "all" ? "All" : filter === "people" ? "People" : "Groups"}<span>{peopleCounts[filter]}</span></button>)}
          </div>
          <div className="intel-people-grid">{[0, 1].map((column) => <div className="intel-people-column" key={column}>
            {people.map((person, index) => ({ person, index })).filter(({ index }) => index % 2 === column).map(({ person, index }) => renderPersonCard(person, index))}
          </div>)}</div>
          {people.length === 0 ? <div className="intel-empty"><Users size={28} /><strong>No matching {peopleFilter === "groups" ? "groups" : peopleFilter === "people" ? "people" : "conversations"}</strong><p>Try another filter or search.</p></div> : null}
        </section> : null}

        {activeTab === "history" ? <section className="intel-history-view"><header><div><span className="intel-eyebrow">Ask AmirOS</span><h2>Your question history</h2><p>Search past answers, reopen their evidence, or remove what you no longer need.</p></div><label className="intel-search"><Search size={16} /><input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Search questions and answers" aria-label="Search question history" />{historySearch ? <button onClick={() => setHistorySearch("")} aria-label="Clear search"><X size={14} /></button> : null}</label></header><div className="intel-history-list">{history.map((item) => <article key={item.id}><span className="question-mark"><MessageCircleQuestion size={18} /></span><div><header><strong dir="auto">{item.question}</strong><time>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(toMilliseconds(item.createdAt)))}</time></header><p dir="auto">{item.answer}</p><footer>{item.sources[0] ? <button onClick={() => onOpenChat(item.sources[0]!.chatId)}><ExternalLink size={13} />Open {item.sources[0]!.contactName}</button> : <small>No direct source cited</small>}<button className="danger" onClick={() => void onDeleteQuestion(item.id)}><X size={13} />Remove</button></footer></div></article>)}</div>{history.length === 0 ? <div className="intel-empty"><CircleHelp size={28} /><strong>No matching questions</strong><p>Ask AmirOS from the floating button on any page.</p></div> : null}</section> : null}
      </div>

      <aside className="intel-rail">
        {selectedAction ? <section className="intel-inspector"><header><span className={`intel-kind-icon kind-${selectedAction.kind}`}><ActionIcon kind={selectedAction.kind} /></span><div><small>{ACTION_LABELS[selectedAction.kind]} evidence</small><h2>{selectedAction.title}</h2></div><button aria-label="Close evidence" onClick={() => setSelectedActionId(undefined)}><X size={17} /></button></header><div className="intel-inspector-contact"><ContactAvatar name={selectedAction.contactName} src={chatById.get(selectedAction.chatId)?.avatarUrl} className="intel-inspector-avatar" /><span><strong>{selectedAction.contactName}</strong><small>{contacts[selectedAction.chatId]?.relationship || (intelligenceById.get(selectedAction.chatId)?.isGroup ? "Group conversation" : "Private conversation")}</small></span></div><section><small>Why AmirOS surfaced this</small><p>{selectedAction.reason}</p></section><section><small>Original evidence</small><blockquote dir="auto">“{selectedAction.evidence || selectedAction.summary}”</blockquote>{selectedAction.senderName ? <span>Sent by {selectedAction.senderName}</span> : null}</section>{intelligenceById.get(selectedAction.chatId)?.styleProfile ? <section><small>Conversation style</small><p>{intelligenceById.get(selectedAction.chatId)?.styleProfile?.summary}</p></section> : null}<footer><button className="button primary" onClick={() => void primaryAction(selectedAction)}>{actionButtonLabel(selectedAction.kind)}</button><button className="button" onClick={() => openActionSource(selectedAction)}>Open source message</button><button className="text-action muted" onClick={() => void dismissAction(selectedAction)}>Dismiss suggestion</button></footer></section> : <>
          <section className="intel-rail-card intel-next"><header><h2>Up next</h2><CalendarDays size={17} /></header>{nextEvent ? (() => { const date = eventLabel(nextEvent.startAt); return <><div className="intel-next-event"><span><small>{date.month}</small><b>{date.day}</b><em>{date.weekday}</em></span><div><strong dir="auto">{nextEvent.title}</strong><small><Clock3 size={13} />{date.time}</small>{nextEvent.location ? <small>{nextEvent.location}</small> : null}</div></div><button className="button secondary" onClick={onOpenCalendar}>Open in Calendar</button></>; })() : <div className="intel-rail-empty"><CalendarCheck size={22} /><p>No upcoming confirmed events.</p><button onClick={onOpenCalendar}>View Calendar</button></div>}</section>
          <section className="intel-rail-card intel-recent"><button className="intel-rail-heading" onClick={() => setLatestOpen((value) => !value)}><span><MessageCircleQuestion size={16} /><b>Recent answer</b></span>{latestOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>{latest ? <div className={latestOpen ? "open" : "collapsed"}><strong dir="auto">{latest.question}</strong>{latestOpen ? <><p dir="auto">{latest.answer}</p>{latest.sources[0] ? <button onClick={() => onOpenChat(latest.sources[0]!.chatId)}>Open source chat<ExternalLink size={12} /></button> : null}</> : null}</div> : <p className="intel-muted-empty">Ask your first question from the AmirOS bubble.</p>}<button className="intel-history-shortcut" onClick={() => setActiveTab("history")}><History size={14} />View question history</button></section>
          <section className="intel-rail-card intel-knowledge"><header><h2>Knowledge snapshot</h2><Users size={17} /></header><div><span><b>{knowledgeSummary.relationships}</b><small>relationships understood</small></span><span><b>{knowledgeSummary.details}</b><small>confirmed details</small></span></div><button onClick={() => setActiveTab("knowledge")}>Open knowledge<ArrowRight size={14} /></button></section>
        </>}
      </aside>
    </div>

    {peopleMetricSelection && peopleMetricPerson ? <PeopleMetricModal
      selection={peopleMetricSelection}
      person={peopleMetricPerson}
      plans={peopleMetricPlans}
      onClose={() => setPeopleMetricSelection(undefined)}
      onOpenSource={(messageId, sourceChatId) => { const chatId = sourceChatId || peopleMetricSelection.chatId; setPeopleMetricSelection(undefined); onOpenChat(chatId, messageId); }}
      onManage={() => {
        const { chatId, metric } = peopleMetricSelection;
        setPeopleMetricSelection(undefined);
        if (metric === "plans") onOpenCalendar();
        else if (metric === "knowledge") {
          setExpandedKnowledgeChatId(chatId);
          setActiveTab("knowledge");
        } else onOpenContactSettings(chatId, metric);
      }}
    /> : null}
    {calendarAction && calendarDraft ? <div className="event-detail-backdrop" role="presentation" onClick={() => { setCalendarAction(undefined); setCalendarDraft(undefined); }}><section className="event-detail-bubble editing" role="dialog" aria-modal="true" aria-labelledby="intelligence-calendar-event-title" onClick={(event) => event.stopPropagation()}><header><span className="event-detail-icon"><CalendarDays size={22} /></span><span><small>Adding to calendar</small><h2 id="intelligence-calendar-event-title">Review event details</h2></span><button className="icon-button" aria-label="Close calendar event editor" onClick={() => { setCalendarAction(undefined); setCalendarDraft(undefined); }}><X size={17} /></button></header><blockquote className="intel-calendar-editor-evidence" dir="auto"><MessageSquareText size={16} /><span><strong>{calendarAction.senderName || calendarAction.contactName}</strong>{calendarAction.evidence || calendarAction.summary}</span></blockquote><CalendarEventForm draft={calendarDraft} error={calendarError} saving={calendarSaving} regeneratingTitle={calendarTitleBusy} submitLabel="Add to calendar" onChange={setCalendarDraft} onCancel={() => { setCalendarAction(undefined); setCalendarDraft(undefined); setCalendarError(""); }} onSubmit={() => void saveCalendarAction()} onRegenerateTitle={() => void regenerateCalendarDraftTitle()} /></section></div> : null}
  </main>;
}
