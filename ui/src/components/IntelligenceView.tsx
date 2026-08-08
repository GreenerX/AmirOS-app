import {
  ArrowRight, BookOpenCheck, CalendarCheck, CalendarDays, CalendarPlus, Check, CheckCircle2,
  ChevronDown, ChevronUp, CircleHelp, Clock3, ExternalLink, History, ListTodo,
  MessageCircleQuestion, MessageSquareText, PencilLine, RefreshCw, Reply, Search, Sparkles, Trash2, Users, X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type {
  CalendarEvent, ChatSummary, ContactInsight, ContactPreferences, IntelligenceChat,
  IntelligenceData, TodoTask,
} from "../types";
import {
  HIDDEN_INTELLIGENCE_ACTIONS_KEY,
  readHiddenIntelligenceActions,
  replyActionId,
} from "../intelligence-visibility";
import { buildIntelligenceSnapshot, isKnownIntelligenceContactName } from "../intelligence-snapshot";
import { replaceIntelligencePhoneReferences, resolveIntelligenceContactName } from "../intelligence-contact-name";
import { confirmedPlansForRelationship, type RelationshipPlan } from "../relationship-plans";
import { isLegacyProfileSummary, profileSummaryParagraph } from "../profile-summary";
import { CalendarEventForm, type CalendarEventDraft } from "./CalendarEventForm";
import { ContactAvatar } from "./ContactAvatar";
import { PeopleExperience } from "./PeopleExperience";

type IntelligenceTab = "briefing" | "knowledge" | "people" | "history";
type QueueFilter = "all" | "reply" | "event" | "todo" | "signal";
type ActionKind = Exclude<QueueFilter, "all">;
type KnowledgeFilter = "all" | ContactInsight["kind"];
type PeopleFilter = "all" | "people" | "groups";
type PeopleMetric = "knowledge" | "plans";
type TodoFilter = "all" | "open" | "completed";

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
  entity: IntelligenceData["events"][number] | IntelligenceData["changes"][number] | TodoTask | IntelligenceChat;
};

type IntelligenceViewProps = {
  data?: IntelligenceData;
  chats: ChatSummary[];
  contacts: Record<string, ContactPreferences>;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onOpenChat: (chatId: string, messageId?: string) => void;
  onOpenCalendar: () => void;
  onGenerateSummary: (chatId: string, isGroup: boolean) => Promise<void>;
  onCalendarStatus: (chatId: string, eventId: string, patch: { status?: CalendarEvent["status"]; title?: string; startAt?: number; endAt?: number; allDay?: boolean; location?: string }) => Promise<void>;
  onRegenerateCalendarTitle: (chatId: string, eventId: string) => Promise<string>;
  onInsightStatus: (chatId: string, insightId: string, status: ContactInsight["status"]) => Promise<void>;
  onTodoStatus?: (chatId: string, todoId: string, status: TodoTask["status"]) => Promise<void>;
  onTodoUpdate?: (chatId: string, todoId: string, patch: { status?: TodoTask["status"]; title?: string; dueAt?: number | null; priority?: TodoTask["priority"] }) => Promise<void>;
  onDeleteQuestion: (id: string) => Promise<void>;
  navigationRequest?: {
    id: number;
    tab: IntelligenceTab;
    queueFilter: QueueFilter;
  };
};

const ACTION_LABELS: Record<ActionKind, string> = {
  reply: "Reply",
  event: "Calendar",
  todo: "To-do",
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
  return "people";
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

function todoDateLabel(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(toMilliseconds(value)));
}

function todoPriorityLabel(priority: TodoTask["priority"]) {
  return priority === "high" ? "High priority" : priority === "low" ? "Low priority" : "Normal priority";
}

export function TodoEditorDialog({
  todo,
  onClose,
  onSave,
}: {
  todo: TodoTask & { contactName: string };
  onClose: () => void;
  onSave: (patch: { title?: string; dueAt?: number | null; priority?: TodoTask["priority"] }) => Promise<void>;
}) {
  const [title, setTitle] = useState(todo.title);
  const [dueAt, setDueAt] = useState(todo.dueAt ? localDateTime(todo.dueAt) : "");
  const [priority, setPriority] = useState<TodoTask["priority"]>(todo.priority || "normal");
  const [saving, setSaving] = useState(false);

  return <div className="event-detail-backdrop todo-editor-backdrop" role="presentation" onClick={onClose}>
    <section className="event-detail-bubble todo-editor" role="dialog" aria-modal="true" aria-labelledby="todo-editor-title" onClick={(event) => event.stopPropagation()}>
      <header><span className="event-detail-icon"><ListTodo size={22} /></span><span><small>Personal to-do</small><h2 id="todo-editor-title" dir="auto">{todo.title}</h2></span><button className="icon-button" aria-label="Close to-do editor" onClick={onClose}><X size={17} /></button></header>
      <div className="todo-editor-content">
        <div className="todo-editor-meta"><span>Added {todoDateLabel(todo.createdAt)}</span><span>{todo.status === "done" ? `Completed ${todoDateLabel(todo.completedAt || todo.updatedAt)}` : todo.contactName}</span></div>
        <label>Task <input value={title} maxLength={1_000} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>Due date <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
        <label>Priority <select value={priority} onChange={(event) => setPriority(event.target.value as TodoTask["priority"])}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
      </div>
      <footer><button className="button" type="button" onClick={onClose}>Cancel</button><button className="button primary" type="button" disabled={saving || !title.trim()} onClick={() => void (async () => { setSaving(true); try { await onSave({ title: title.trim(), dueAt: dueAt ? new Date(dueAt).getTime() : null, priority }); onClose(); } finally { setSaving(false); } })()}>{saving ? "Saving…" : "Save task"}</button></footer>
    </section>
  </div>;
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

function buildQueue(data: IntelligenceData | undefined, chats: ChatSummary[], contacts: Record<string, ContactPreferences>, hidden: Set<string>): QueueAction[] {
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

  for (const item of (data.todos || []).filter((entry) => entry.status === "inferred")) {
    if (!isKnownIntelligenceContactName(item.contactName)) continue;
    const dueAt = item.dueAt ? toMilliseconds(item.dueAt) : undefined;
    actions.push({
      id: `todo:${item.chatId}:${item.id}`, kind: "todo", chatId: item.chatId, contactName: item.contactName,
      title: item.title,
      summary: dueAt ? `Due ${relativeTime(dueAt)}` : "Task detected in a message",
      reason: "To-do detected in a message · awaiting review",
      timestamp: dueAt || item.updatedAt,
      score: dueAt && dueAt < Date.now() + 3 * 86_400_000 ? 88 : 74,
      evidence: item.evidence.excerpt, senderName: item.evidence.senderName, messageId: item.evidence.messageId, entity: item,
    });
  }

  for (const item of data.changes.filter((entry) => entry.status === "inferred")) {
    if (!isKnownIntelligenceContactName(item.contactName)) continue;
    const chat = chatById.get(item.chatId);
    const subjects = knowledgeSuggestionSubjects(item).map((subject) => resolveIntelligenceContactName(subject, chats));
    const subjectLabel = subjects.length > 1
      ? `${subjects[0]} +${subjects.length - 1}`
      : subjects[0] || item.contactName;
    actions.push({
      id: `signal:${item.chatId}:${item.id}`, kind: "signal", chatId: item.chatId, contactName: subjectLabel,
      // The insight itself is the useful decision here. Keep it as the primary
      // queue copy instead of hiding it behind a generic "Review …" label.
      title: replaceIntelligencePhoneReferences(item.content, chats),
      summary: "",
      reason: `${Math.round(item.confidence * 100)}% confidence · ${chat?.isGroup ? "learned in a group" : "new relationship signal"}`,
      timestamp: item.updatedAt, score: 54 + Math.round(item.confidence * 20),
      evidence: item.evidence.excerpt, senderName: item.evidence.senderName, messageId: item.evidence.messageId, entity: item,
    });
  }

  return actions.sort((left, right) => right.score - left.score || toMilliseconds(right.timestamp) - toMilliseconds(left.timestamp));
}

function ActionIcon({ kind }: { kind: ActionKind }) {
  if (kind === "reply") return <MessageSquareText size={17} />;
  if (kind === "event") return <CalendarCheck size={17} />;
  if (kind === "todo") return <ListTodo size={17} />;
  return <Sparkles size={17} />;
}

function PrimaryActionIcon({ action }: { action: QueueAction }) {
  if (action.kind === "reply") return <Reply size={15} />;
  if (action.kind === "event") return <CalendarPlus size={15} />;
  if (action.kind === "todo") return (action.entity as TodoTask).status === "inferred" ? <ListTodo size={15} /> : <Check size={15} />;
  return <CheckCircle2 size={15} />;
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
  const count = metric === "knowledge" ? knowledge.length : plans.length;
  const title = metric === "knowledge" ? "Known details" : "Confirmed plans";
  const eyebrow = metric === "knowledge" ? "Relationship knowledge" : "Calendar";
  const emptyCopy = metric === "knowledge"
    ? "No confirmed details have been saved for this conversation yet."
    : "There are no confirmed calendar plans for this conversation.";
  const manageLabel = metric === "knowledge" ? "Manage knowledge" : "Open Calendar";
  const ModalIcon = metric === "knowledge" ? BookOpenCheck : CalendarDays;
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
  data, chats, contacts, loading, onRefresh, onOpenChat, onOpenCalendar,
  onGenerateSummary, onCalendarStatus, onRegenerateCalendarTitle, onInsightStatus, onTodoStatus, onTodoUpdate, onDeleteQuestion, navigationRequest,
}: IntelligenceViewProps) {
  const [activeTab, setActiveTab] = useState<IntelligenceTab>(() => navigationRequest?.tab || initialIntelligenceTab());
  const [queueFilter, setQueueFilter] = useState<QueueFilter>(() => navigationRequest?.queueFilter || "all");
  const [selectedActionId, setSelectedActionId] = useState<string>();
  const [latestOpen, setLatestOpen] = useState(false);
  const [peopleSearch, setPeopleSearch] = useState("");
  const [peopleFilter, setPeopleFilter] = useState<PeopleFilter>("all");
  const [expandedSummaryIds, setExpandedSummaryIds] = useState<Set<string>>(() => new Set());
  const [summaryBusyChatId, setSummaryBusyChatId] = useState<string>();
  const [historySearch, setHistorySearch] = useState("");
  const [knowledgeContactSearch, setKnowledgeContactSearch] = useState("");
  const [knowledgeFilter, setKnowledgeFilter] = useState<KnowledgeFilter>("all");
  const [selectedKnowledgeChatId, setSelectedKnowledgeChatId] = useState<string>();
  const [hiddenActions, setHiddenActions] = useState<Set<string>>(readHiddenIntelligenceActions);
  const [calendarAction, setCalendarAction] = useState<QueueAction>();
  const [calendarDraft, setCalendarDraft] = useState<CalendarEventDraft>();
  const [calendarSaving, setCalendarSaving] = useState(false);
  const [calendarTitleBusy, setCalendarTitleBusy] = useState(false);
  const [calendarError, setCalendarError] = useState("");
  const [peopleMetricSelection, setPeopleMetricSelection] = useState<PeopleMetricSelection>();
  const [todoEditor, setTodoEditor] = useState<(TodoTask & { contactName: string })>();
  const [completingTodoIds, setCompletingTodoIds] = useState<Set<string>>(() => new Set());
  const [todoFilter, setTodoFilter] = useState<TodoFilter>("all");
  const [todoListExpanded, setTodoListExpanded] = useState(false);

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
  const queue = useMemo(() => buildQueue(data, chats, contacts, hiddenActions), [data, chats, contacts, hiddenActions]);
  const selectedAction = queue.find((item) => item.id === selectedActionId);
  const visibleQueue = queueFilter === "all" ? queue : queue.filter((item) => item.kind === queueFilter);
  const latest = data?.questionHistory[0];
  const intelligenceSnapshot = useMemo(
    () => buildIntelligenceSnapshot(data, hiddenActions),
    [data, hiddenActions],
  );
  const nextEvent = intelligenceSnapshot.upcomingEvents[0];
  const openTodos = useMemo(() => (data?.todos || [])
    .filter((item) => item.status === "open" && isKnownIntelligenceContactName(item.contactName))
    .sort((left, right) => {
      const leftWhen = left.dueAt || left.updatedAt;
      const rightWhen = right.dueAt || right.updatedAt;
      return toMilliseconds(leftWhen) - toMilliseconds(rightWhen);
    }), [data?.todos]);
  const trackedTodos = useMemo(() => (data?.todos || [])
    .filter((item) => (item.status === "open" || item.status === "done") && isKnownIntelligenceContactName(item.contactName))
    .sort((left, right) => {
      const leftDone = left.status === "done" ? 1 : 0;
      const rightDone = right.status === "done" ? 1 : 0;
      if (leftDone !== rightDone) return leftDone - rightDone;
      if (leftDone) return toMilliseconds(right.completedAt || right.updatedAt) - toMilliseconds(left.completedAt || left.updatedAt);
      const leftWhen = left.dueAt || left.createdAt;
      const rightWhen = right.dueAt || right.createdAt;
      return toMilliseconds(leftWhen) - toMilliseconds(rightWhen);
    }), [data?.todos]);
  const suggestedTodoCount = useMemo(() => (data?.todos || [])
    .filter((item) => item.status === "inferred" && isKnownIntelligenceContactName(item.contactName)).length, [data?.todos]);
  const todoCounts = useMemo(() => ({
    all: trackedTodos.length,
    open: trackedTodos.filter((item) => item.status === "open").length,
    completed: trackedTodos.filter((item) => item.status === "done").length,
  }), [trackedTodos]);
  const filteredTrackedTodos = useMemo(() => trackedTodos.filter((item) => (
    todoFilter === "all" || (todoFilter === "open" ? item.status === "open" : item.status === "done")
  )), [todoFilter, trackedTodos]);
  const visibleTrackedTodos = useMemo(
    () => todoListExpanded ? filteredTrackedTodos : filteredTrackedTodos.slice(0, 4),
    [filteredTrackedTodos, todoListExpanded],
  );
  const knowledgeSummary = {
    relationships: intelligenceSnapshot.relationships,
    details: intelligenceSnapshot.details,
  };

  const toggleTodo = async (todo: TodoTask & { contactName: string }) => {
    if (!onTodoStatus) return;
    const isCompleting = todo.status !== "done";
    if (isCompleting) setCompletingTodoIds((current) => new Set(current).add(todo.id));
    try {
      await Promise.all(isCompleting
        ? [onTodoStatus(todo.chatId, todo.id, "done"), new Promise<void>((resolve) => window.setTimeout(resolve, 330))]
        : [onTodoStatus(todo.chatId, todo.id, "open")]);
    } finally {
      if (isCompleting) setCompletingTodoIds((current) => {
        const next = new Set(current);
        next.delete(todo.id);
        return next;
      });
    }
  };

  const deleteTodo = async (todo: TodoTask & { contactName: string }) => {
    if (!onTodoStatus) return;
    if (!window.confirm(`Delete “${todo.title}”?`)) return;
    await onTodoStatus(todo.chatId, todo.id, "dismissed");
    if (todoEditor?.id === todo.id) setTodoEditor(undefined);
  };

  useEffect(() => {
    if (selectedActionId && !selectedAction) setSelectedActionId(undefined);
  }, [selectedAction, selectedActionId]);

  useEffect(() => {
    sessionStorage.setItem(INTELLIGENCE_TAB_KEY, activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (!navigationRequest) return;
    setActiveTab(navigationRequest.tab);
    setQueueFilter(navigationRequest.queueFilter);
    setSelectedActionId(undefined);
  }, [navigationRequest]);

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
    if (action.kind === "event") {
      const item = action.entity as IntelligenceData["events"][number];
      setCalendarError("");
      setCalendarAction(action);
      setCalendarDraft({ title: item.title, startAt: localDateTime(item.startAt), endAt: localDateTime(eventEnd(item)), location: item.location || "" });
      return;
    } else if (action.kind === "todo") {
      if (!onTodoStatus) return;
      const item = action.entity as TodoTask;
      await onTodoStatus(action.chatId, item.id, "open");
      hideAction(action.id);
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
    else if (action.kind === "event") await onCalendarStatus(action.chatId, (action.entity as IntelligenceData["events"][number]).id, { status: "dismissed" });
    else if (action.kind === "todo") {
      if (!onTodoStatus) return;
      await onTodoStatus(action.chatId, (action.entity as TodoTask).id, "dismissed");
    }
    else await onInsightStatus(action.chatId, (action.entity as IntelligenceData["changes"][number]).id, "outdated");
    setSelectedActionId(undefined);
  };

  const actionButtonLabel = (action: QueueAction) => {
    if (action.kind === "reply") return "Reply";
    if (action.kind === "event") return "Add to calendar";
    if (action.kind === "todo") return (action.entity as TodoTask).status === "inferred" ? "Add to to-dos" : "Mark done";
    return "Confirm detail";
  };
  const counts = useMemo(() => ({
    all: queue.length,
    reply: queue.filter((item) => item.kind === "reply").length,
    event: queue.filter((item) => item.kind === "event").length,
    todo: queue.filter((item) => item.kind === "todo").length,
    signal: queue.filter((item) => item.kind === "signal").length,
  }), [queue]);
  const briefCopy = queue.length === 0
    ? "You are caught up. AmirOS will keep watching conversations for plans, to-dos, questions, and new relationship signals."
    : `You have ${queue.length} item${queue.length === 1 ? "" : "s"} worth your attention. ${counts.reply ? `${counts.reply} conversation${counts.reply === 1 ? " needs" : "s need"} a reply` : "No replies are waiting"}${counts.todo ? ` · ${counts.todo} to-do${counts.todo === 1 ? "" : "s"}` : ""}${counts.event ? ` · ${counts.event} calendar review${counts.event === 1 ? "" : "s"}` : ""}.`;

  const renderActionRow = (action: QueueAction, index: number) => {
    const chat = chatById.get(action.chatId);
    return <article key={action.id} className={`intel-action-row kind-${action.kind} ${selectedActionId === action.id ? "selected" : ""}`} onClick={() => setSelectedActionId(action.id)}>
      <span className="intel-action-priority">
        <span className="intel-priority" aria-label={`Priority ${index + 1}`}>{index + 1}</span>
        <ContactAvatar name={action.contactName} src={chat?.avatarUrl} tone={index} className="intel-avatar" />
      </span>
      <span className="intel-action-copy"><span className="intel-action-meta"><b>{action.contactName}</b><small><ActionIcon kind={action.kind} />{ACTION_LABELS[action.kind]}</small></span><strong dir="auto">{action.title}</strong>{action.summary ? <p dir="auto">{action.summary}</p> : null}</span>
      <span className="intel-action-reason"><small>Why this is here</small><span>{action.reason}</span><time>{relativeTime(action.timestamp)}</time></span>
      <span className="intel-row-actions">
        <button className={`intel-row-action primary action-${action.kind}`} aria-label={actionButtonLabel(action)} title={actionButtonLabel(action)} onClick={(event) => { event.stopPropagation(); void primaryAction(action); }}><PrimaryActionIcon action={action} /></button>
        <button className="intel-row-action source" aria-label="Open source message" title="Open source message" onClick={(event) => { event.stopPropagation(); openActionSource(action); }}><ExternalLink size={15} /></button>
        <button className="intel-row-action dismiss" aria-label="Dismiss suggestion" title="Dismiss suggestion" onClick={(event) => { event.stopPropagation(); void dismissAction(action); }}><X size={15} /></button>
      </span>
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
  const confirmedKnowledge = intelligenceSnapshot.confirmedKnowledge;
  const allKnowledgeGroups = useMemo(() => {
    const grouped = new Map<string, {
      chatId: string;
      contactName: string;
      items: typeof intelligenceSnapshot.confirmedKnowledge;
      updatedAt: number;
    }>();
    for (const item of intelligenceSnapshot.confirmedKnowledge) {
      const group = grouped.get(item.chatId) || {
        chatId: item.chatId,
        contactName: item.contactName,
        items: [],
        updatedAt: 0,
      };
      group.items.push(item);
      group.updatedAt = Math.max(group.updatedAt, toMilliseconds(item.updatedAt));
      grouped.set(item.chatId, group);
    }
    return [...grouped.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }, [intelligenceSnapshot.confirmedKnowledge]);
  const knowledgeGroups = useMemo(() => {
    const query = knowledgeContactSearch.trim().toLocaleLowerCase();
    return allKnowledgeGroups.filter((group) => !query || group.contactName.toLocaleLowerCase().includes(query));
  }, [allKnowledgeGroups, knowledgeContactSearch]);
  const selectedKnowledgeGroup = useMemo(
    () => allKnowledgeGroups.find((group) => group.chatId === selectedKnowledgeChatId),
    [allKnowledgeGroups, selectedKnowledgeChatId],
  );
  const selectedKnowledgeItems = useMemo(
    () => selectedKnowledgeGroup?.items.filter((item) => knowledgeFilter === "all" || item.kind === knowledgeFilter) || [],
    [knowledgeFilter, selectedKnowledgeGroup],
  );
  const recentKnowledge = confirmedKnowledge.slice(0, 10);

  useEffect(() => {
    if (selectedKnowledgeChatId && !selectedKnowledgeGroup) setSelectedKnowledgeChatId(undefined);
  }, [selectedKnowledgeChatId, selectedKnowledgeGroup]);

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

  if (activeTab === "people") return <PeopleExperience
    data={data}
    chats={chats}
    contacts={contacts}
    loading={loading}
    onRefresh={onRefresh}
    onOpenChat={onOpenChat}
    onOpenCalendar={onOpenCalendar}
  />;

  return <main className="main-content intelligence-page intelligence-command">
    <header className="page-header intel-command-header"><div><div className="intel-title-row"><h1>Intelligence</h1><span className="beta-badge intel-beta">Beta</span></div><p>Your personal command center for priorities, people, and next best actions.</p></div><div className="intelligence-sync"><CheckCircle2 size={15} /><span>{loading ? "Syncing knowledge…" : data ? `Synced ${relativeTime(data.generatedAt)}` : "Waiting for knowledge"}</span><button className="icon-button" aria-label="Refresh intelligence" disabled={loading} onClick={() => void onRefresh()}><RefreshCw size={17} className={loading ? "spin" : ""} /></button></div></header>

    <nav className="intel-tabs" aria-label="Intelligence sections">
      {([
        ["briefing", "Briefing", Sparkles], ["knowledge", "Knowledge", BookOpenCheck], ["people", "People", Users], ["history", "Ask History", History],
      ] as const).map(([id, label, Icon]) => <button key={id} className={activeTab === id ? "active" : ""} aria-current={activeTab === id ? "page" : undefined} onClick={() => { setActiveTab(id); setSelectedActionId(undefined); }}><Icon size={17} /><span>{label}</span></button>)}
    </nav>

    <div className={`intel-workspace ${selectedAction ? "has-inspector" : ""}`}>
      <div className="intel-primary">
        {activeTab === "briefing" ? <>
          <section className="intel-briefing"><span className="intel-eyebrow">Today’s briefing</span><h2>{queue.length ? "A few things deserve your attention." : "Everything important is in hand."}</h2><p>{briefCopy}</p><div className="intel-briefing-stats intel-briefing-filters" aria-label="Filter action queue">{(["all", "reply", "todo", "event", "signal"] as QueueFilter[]).map((filter) => <button key={filter} type="button" className={queueFilter === filter ? "active" : ""} aria-pressed={queueFilter === filter} onClick={() => { setQueueFilter(filter); setSelectedActionId(undefined); }}><b>{counts[filter]}</b><span>{filter === "all" ? "All" : filter === "reply" ? "Waiting replies" : filter === "todo" ? "To-dos" : filter === "event" ? "Calendar decisions" : "New signals"}</span></button>)}</div></section>
          <section className="intel-priority-list"><header><div><span className="intel-eyebrow">Your next best actions</span><h2>Everything that needs a decision</h2></div></header><div className="intel-action-head"><span>Priority</span><span>Conversation & action</span><span>Why this is here</span><span>Actions</span></div>{visibleQueue.map(renderActionRow)}{visibleQueue.length === 0 ? <div className="intel-empty"><CheckCircle2 size={28} /><strong>{queueFilter === "all" ? "You’re caught up" : "No actions in this category"}</strong><p>{queueFilter === "all" ? "New actions will appear when AmirOS finds a question, plan, to-do, or useful detail." : "Try another filter or refresh Intelligence."}</p></div> : null}</section>
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

        {activeTab === "knowledge" ? <section className="intel-knowledge-view">
          <header>
            <div><span className="intel-eyebrow">Relationship memory</span><h2>Knowledge</h2><p>Explore confirmed relationship knowledge one conversation at a time.</p></div>
          </header>
          <div className="intel-knowledge-columns">
            <section className="intel-knowledge-relationships">
              <header><div><span className="intel-knowledge-section-icon confirmed"><Users size={17} /></span><span><h3>Knowledge by relationship</h3><small>{knowledgeGroups.length} people and groups · {intelligenceSnapshot.details} saved items</small></span></div><label className="intel-relationship-search"><Search size={15} /><input value={knowledgeContactSearch} onChange={(event) => setKnowledgeContactSearch(event.target.value)} placeholder="Search people and groups" aria-label="Search people and groups" />{knowledgeContactSearch ? <button type="button" onClick={() => setKnowledgeContactSearch("")} aria-label="Clear people and groups search"><X size={13} /></button> : null}</label></header>
              <div className="intel-knowledge-bubbles" aria-label="People and groups with saved knowledge">
                {knowledgeGroups.map((group, index) => <button
                  key={group.chatId}
                  className={selectedKnowledgeChatId === group.chatId ? "active" : ""}
                  aria-pressed={selectedKnowledgeChatId === group.chatId}
                  onClick={() => { setSelectedKnowledgeChatId(group.chatId); setKnowledgeFilter("all"); }}
                >
                  <ContactAvatar name={group.contactName} src={chatById.get(group.chatId)?.avatarUrl} tone={index} className="intel-knowledge-bubble-avatar" />
                  <span><strong>{group.contactName}</strong><small>{group.items.length} knowledge item{group.items.length === 1 ? "" : "s"}</small></span>
                  <b>{group.items.length}</b>
                </button>)}
                {knowledgeGroups.length === 0 ? <div className="intel-knowledge-empty"><Search size={22} /><strong>No people or groups match</strong><p>Try another name.</p></div> : null}
              </div>
            </section>
            <section className="intel-contact-knowledge">
              {selectedKnowledgeGroup ? <>
                <header className="intel-contact-knowledge-header"><div><ContactAvatar name={selectedKnowledgeGroup.contactName} src={chatById.get(selectedKnowledgeGroup.chatId)?.avatarUrl} className="intel-contact-knowledge-avatar" /><span><h3>{selectedKnowledgeGroup.contactName}</h3><small>{selectedKnowledgeItems.length} {knowledgeFilter === "all" ? "saved" : KNOWLEDGE_LABELS[knowledgeFilter].toLocaleLowerCase()} item{selectedKnowledgeItems.length === 1 ? "" : "s"}</small></span></div><label className="intel-contact-knowledge-filter"><span>Show</span><select value={knowledgeFilter} onChange={(event) => setKnowledgeFilter(event.target.value as KnowledgeFilter)} aria-label={`Filter ${selectedKnowledgeGroup.contactName}'s knowledge by type`}><option value="all">All knowledge</option><option value="fact">Facts</option><option value="preference">Preferences</option><option value="relationship_change">Relationships</option><option value="important_date">Important dates</option></select></label></header>
                <div className="intel-contact-knowledge-list">
                  {selectedKnowledgeItems.map((item) => <article key={item.id}>
                    <header><em>{KNOWLEDGE_LABELS[item.kind]}</em><time>Confirmed {relativeTime(item.updatedAt)}</time></header>
                    <p dir="auto">{item.content}</p>
                    <footer><button className="text-action" onClick={() => onOpenChat(item.chatId, item.evidence.messageId)}>Open source<ArrowRight size={13} /></button></footer>
                  </article>)}
                  {selectedKnowledgeItems.length === 0 ? <div className="intel-contact-knowledge-empty"><BookOpenCheck size={24} /><strong>No {knowledgeFilter === "all" ? "saved knowledge" : KNOWLEDGE_LABELS[knowledgeFilter].toLocaleLowerCase()} yet</strong><p>Choose another type or let AmirOS learn more from this conversation.</p></div> : null}
                </div>
              </> : <div className="intel-knowledge-selection-hint"><BookOpenCheck size={24} /><span><strong>Select a person or group</strong><small>Their confirmed knowledge appears here. New suggestions are reviewed in Briefing.</small></span></div>}
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

        {false ? <section className="intel-people-view">
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
        {selectedAction ? <section className="intel-inspector"><header><span className={`intel-kind-icon kind-${selectedAction.kind}`}><ActionIcon kind={selectedAction.kind} /></span><div><small>{ACTION_LABELS[selectedAction.kind]} evidence</small><h2 dir="auto">{selectedAction.title}</h2></div><button aria-label="Close evidence" onClick={() => setSelectedActionId(undefined)}><X size={17} /></button></header><div className="intel-inspector-contact"><ContactAvatar name={selectedAction.contactName} src={chatById.get(selectedAction.chatId)?.avatarUrl} className="intel-inspector-avatar" /><span><strong>{selectedAction.contactName}</strong><small>{contacts[selectedAction.chatId]?.relationship || (intelligenceById.get(selectedAction.chatId)?.isGroup ? "Group conversation" : "Private conversation")}</small></span></div><section><small>Why AmirOS surfaced this</small><p>{selectedAction.reason}</p></section><section><small>Original evidence</small><blockquote dir="auto">“{selectedAction.evidence || selectedAction.title || selectedAction.summary}”</blockquote>{selectedAction.senderName ? <span>Sent by {selectedAction.senderName}</span> : null}</section><footer><button className="button primary" onClick={() => void primaryAction(selectedAction)}>{actionButtonLabel(selectedAction)}</button><button className="button" onClick={() => openActionSource(selectedAction)}>Open source message</button><button className="text-action muted" onClick={() => void dismissAction(selectedAction)}>Dismiss suggestion</button></footer></section> : <>
          <section className="intel-rail-card intel-next"><header><h2>Up next</h2><CalendarDays size={17} /></header>{nextEvent ? (() => { const date = eventLabel(nextEvent.startAt); return <><div className="intel-next-event"><span><small>{date.month}</small><b>{date.day}</b><em>{date.weekday}</em></span><div><strong dir="auto">{nextEvent.title}</strong><small><Clock3 size={13} />{date.time}</small>{nextEvent.location ? <small>{nextEvent.location}</small> : null}</div></div><button className="button secondary" onClick={onOpenCalendar}>Open in Calendar</button></>; })() : <div className="intel-rail-empty"><CalendarCheck size={22} /><p>No upcoming confirmed events.</p><button onClick={onOpenCalendar}>View Calendar</button></div>}</section>
          <section className="intel-rail-card intel-next intel-todos">
            <header><h2>To-dos</h2><ListTodo size={17} /></header>
            {trackedTodos.length > 0 ? <>
              <div className="todo-filter-bar" aria-label="Filter to-dos">
                {(["all", "open", "completed"] as TodoFilter[]).map((filter) => <button key={filter} type="button" className={todoFilter === filter ? "is-active" : ""} aria-pressed={todoFilter === filter} onClick={() => { setTodoFilter(filter); setTodoListExpanded(false); }}>
                  {filter === "all" ? "All" : filter === "open" ? "Open" : "Completed"}<span>{todoCounts[filter]}</span>
                </button>)}
              </div>
              {visibleTrackedTodos.length > 0 ? <div className="intel-todo-list">{visibleTrackedTodos.map((todo) => {
                const isDone = todo.status === "done";
                const isCompleting = completingTodoIds.has(todo.id);
                return <div className={`intel-todo-row ${isDone ? "is-completed" : ""} ${isCompleting ? "is-completing" : ""}`} key={todo.id}>
                  <button className="intel-todo-check" type="button" aria-label={isDone ? `Mark ${todo.title} as open` : `Mark ${todo.title} as complete`} disabled={!onTodoStatus} onClick={() => void toggleTodo(todo)}><Check size={14} aria-hidden="true" /></button>
                  <button className="intel-todo-copy" type="button" onClick={() => setTodoEditor(todo)}><strong dir="auto">{todo.title}</strong><small>{isDone ? `Completed ${todoDateLabel(todo.completedAt || todo.updatedAt)}` : `Added ${todoDateLabel(todo.createdAt)}${todo.dueAt ? ` · Due ${todoDateLabel(todo.dueAt)}` : ""} · ${todoPriorityLabel(todo.priority || "normal")}`}</small></button>
                  <span className="intel-todo-actions"><button className="intel-todo-edit" type="button" aria-label={`Edit ${todo.title}`} onClick={() => setTodoEditor(todo)}><PencilLine size={13} /></button><button className="intel-todo-delete" type="button" aria-label={`Delete ${todo.title}`} disabled={!onTodoStatus} onClick={() => void deleteTodo(todo)}><Trash2 size={13} /></button></span>
                </div>;
              })}</div> : <p className="intel-todo-filter-empty">No {todoFilter === "completed" ? "completed" : "open"} to-dos.</p>}
              {filteredTrackedTodos.length > 4 ? <button className="todo-expand-button" type="button" onClick={() => setTodoListExpanded((value) => !value)}>{todoListExpanded ? "Show fewer" : `Show all ${filteredTrackedTodos.length}`}</button> : null}
              <button className="button secondary" onClick={() => { setActiveTab("briefing"); setQueueFilter("todo"); }}>{suggestedTodoCount > 0 ? `Review ${suggestedTodoCount} suggestion${suggestedTodoCount === 1 ? "" : "s"}` : "Review task suggestions"}</button>
            </> : suggestedTodoCount > 0 ? <div className="intel-rail-empty"><ListTodo size={22} /><p>{suggestedTodoCount} to-do {suggestedTodoCount === 1 ? "suggestion is" : "suggestions are"} waiting for review.</p><button onClick={() => { setActiveTab("briefing"); setQueueFilter("todo"); }}>Review suggestions</button></div> : <div className="intel-rail-empty"><ListTodo size={22} /><p>No to-dos yet.</p><button onClick={() => { setActiveTab("briefing"); setQueueFilter("todo"); }}>View To-dos</button></div>}
          </section>
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
        else {
          setActiveTab("knowledge");
          setSelectedKnowledgeChatId(chatId);
          setKnowledgeFilter("all");
        }
      }}
    /> : null}
    {calendarAction && calendarDraft ? <div className="event-detail-backdrop" role="presentation" onClick={() => { setCalendarAction(undefined); setCalendarDraft(undefined); }}><section className="event-detail-bubble editing" role="dialog" aria-modal="true" aria-labelledby="intelligence-calendar-event-title" onClick={(event) => event.stopPropagation()}><header><span className="event-detail-icon"><CalendarDays size={22} /></span><span><small>Adding to calendar</small><h2 id="intelligence-calendar-event-title">Review event details</h2></span><button className="icon-button" aria-label="Close calendar event editor" onClick={() => { setCalendarAction(undefined); setCalendarDraft(undefined); }}><X size={17} /></button></header><blockquote className="intel-calendar-editor-evidence" dir="auto"><MessageSquareText size={16} /><span><strong>{calendarAction.senderName || calendarAction.contactName}</strong>{calendarAction.evidence || calendarAction.summary}</span></blockquote><CalendarEventForm draft={calendarDraft} error={calendarError} saving={calendarSaving} regeneratingTitle={calendarTitleBusy} submitLabel="Add to calendar" onChange={setCalendarDraft} onCancel={() => { setCalendarAction(undefined); setCalendarDraft(undefined); setCalendarError(""); }} onSubmit={() => void saveCalendarAction()} onRegenerateTitle={() => void regenerateCalendarDraftTitle()} /></section></div> : null}
    {todoEditor ? <TodoEditorDialog todo={todoEditor} onClose={() => setTodoEditor(undefined)} onSave={async (patch) => {
      if (!onTodoUpdate) return;
      await onTodoUpdate(todoEditor.chatId, todoEditor.id, patch);
    }} /> : null}
  </main>;
}
