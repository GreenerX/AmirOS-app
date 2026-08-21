import {
  ArrowRight,
  BellRing,
  Bot,
  Brain,
  CakeSlice,
  CalendarDays,
  CalendarCheck,
  CalendarClock,
  Check,
  ExternalLink,
  ListTodo,
  MessageCircle,
  PencilLine,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ensureTodaysFocusIcon, suggestReplyForMessage, summarizeDashboardActionMessage } from "../api";
import { readDashboardActionSummaries, saveDashboardActionSummary } from "../dashboard-action-summary-cache";
import { formatDateTime, formatTime, timeOfDayGreeting } from "../format";
import { hideIntelligenceAction, readHiddenIntelligenceActions, replyActionId } from "../intelligence-visibility";
import { buildIntelligenceSnapshot, isKnownIntelligenceContactName } from "../intelligence-snapshot";
import { isTrustworthyIntelligenceCard } from "../../../shared/intelligence-card-eligibility";
import { replyAssessmentCopy } from "../reply-assessment-copy";
import { buildTodaysFocus, isRecentlyPassedCalendarEvent, todaysFocusDismissalIds, todaysFocusPresentation, type TodaysFocusItem } from "../todays-focus";
import { readHiddenTodaysFocus, saveHiddenTodaysFocus } from "../todays-focus-visibility";
import type { CalendarEvent, ChatSummary, DashboardData, IntelligenceData, KnowledgeTrackingStatus, ProactiveIntelligenceItem, TodoTask, ViewName } from "../types";
import { CalendarEventForm, type CalendarEventDraft } from "./CalendarEventForm";
import { ContactAvatar } from "./ContactAvatar";
import { TodoEditorDialog } from "./IntelligenceView";
import { OverviewHeaderExperience } from "./OverviewHeaderExperience";

type OverviewProps = {
  data: DashboardData;
  chats: ChatSummary[];
  intelligence?: IntelligenceData;
  onNavigate: (view: ViewName) => void;
  onTrackingDecision: (chatId: string, status: KnowledgeTrackingStatus) => Promise<void>;
  onOpenTrackingChat: (chatId: string) => void;
  onOpenNextBestAction: (chatId: string, messageId?: string) => void;
  onTodoStatus: (chatId: string, todoId: string, status: TodoTask["status"]) => Promise<void>;
  onTodoUpdate: (chatId: string, todoId: string, patch: { title?: string; dueAt?: number | null; priority?: TodoTask["priority"] }) => Promise<void>;
  onCalendarStatus: (chatId: string, eventId: string, patch: { status?: CalendarEvent["status"]; title?: string; startAt?: number; endAt?: number; allDay?: boolean; location?: string }) => Promise<void>;
  onRegenerateCalendarTitle: (chatId: string, eventId: string) => Promise<string>;
  onReplyToMessage: (chatId: string, messageId: string, body: string) => Promise<void>;
  onReplySuggestionFeedback?: (chatId: string, messageId: string, input: { rating: "helpful" | "needs_work"; reasons?: string[]; note?: string }) => Promise<void>;
  onInsightStatus: (chatId: string, insightId: string, status: "confirmed" | "outdated") => Promise<void>;
  onDismissNextBestAction: (action: NextBestAction) => Promise<void>;
  onProactiveDecision: (item: ProactiveIntelligenceItem, status: "opened" | "dismissed" | "resolved") => Promise<void>;
};

export type NextBestAction = {
  kind: string;
  title: string;
  detail: string;
  chatId: string;
  contactName: string;
  messageId?: string;
  actionType: "reply" | "calendar" | "todo" | "insight";
  actionId: string;
  replyAssessment?: IntelligenceData["chats"][number]["replyAssessment"];
};

type TodoFilter = "all" | "open" | "completed";

type RelationshipBriefKind = "change" | "thread" | "upcoming" | "reconnect";
type RelationshipBriefItem = {
  id: string;
  kind: RelationshipBriefKind;
  contactName: string;
  chatId: string;
  messageId?: string;
  detail: string;
  timestamp: number;
};

const OVERVIEW_QUOTES = [
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Your time is limited, so don’t waste it living someone else’s life.", author: "Steve Jobs" },
  { text: "Have the courage to follow your heart and intuition.", author: "Steve Jobs" },
  { text: "Failure and invention are inseparable twins.", author: "Jeff Bezos" },
  { text: "It’s all about the long term.", author: "Jeff Bezos" },
  { text: "Don’t be a know-it-all. Be a learn-it-all.", author: "Satya Nadella" },
  { text: "Frustration can be an enormous driver of change when you spot the opportunity inside the problem.", author: "Richard Branson" },
  { text: "Surround yourself with people who inspire you, believe in you and challenge you.", author: "Richard Branson" },
  { text: "Screw it, let’s do it.", author: "Richard Branson" },
  { text: "We can afford to lose money, but we can’t afford to lose reputation.", author: "Warren Buffett" },
  { text: "It’s good for society when productivity goes up.", author: "Bill Gates" },
  { text: "If we execute well, the opportunity will be enormous.", author: "Jeff Bezos" },
] as const;

const LAST_OVERVIEW_QUOTE_KEY = "amiros.overview-quote.v1";
function chooseOverviewQuote() {
  const previous = Number(window.localStorage.getItem(LAST_OVERVIEW_QUOTE_KEY));
  const hasPrevious = Number.isInteger(previous) && previous >= 0 && previous < OVERVIEW_QUOTES.length;
  let index = Math.floor(Math.random() * (OVERVIEW_QUOTES.length - (hasPrevious ? 1 : 0)));
  if (hasPrevious && index >= previous) index += 1;
  window.localStorage.setItem(LAST_OVERVIEW_QUOTE_KEY, String(index));
  return OVERVIEW_QUOTES[index]!;
}

function sameLocalDay(left: number, right: Date) {
  const date = new Date(left);
  return date.getFullYear() === right.getFullYear()
    && date.getMonth() === right.getMonth()
    && date.getDate() === right.getDate();
}

function eventDateTime(timestamp: number) {
  return formatDateTime(timestamp, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function toMilliseconds(timestamp: number) {
  return timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp;
}

function todoTimingLabel(todo: TodoTask) {
  const sourceAt = todo.evidence?.timestamp;
  const sourceTime = suggestedSourceTime(sourceAt);
  if (typeof todo.dueAt === "number" && Number.isFinite(todo.dueAt)) {
    return sourceTime
      ? `Due ${eventDateTime(toMilliseconds(todo.dueAt))} · Suggested from ${sourceTime}`
      : `Due ${eventDateTime(toMilliseconds(todo.dueAt))}`;
  }
  if (todo.status === "inferred") return sourceTime ? `Suggested from ${sourceTime}` : "Suggested from a message";
  return "No due date";
}

function suggestedSourceTime(timestamp: number | undefined) {
  return typeof timestamp === "number" && Number.isFinite(timestamp)
    ? eventDateTime(toMilliseconds(timestamp))
    : undefined;
}

function compactTodoSuggestionTitle(title: string) {
  const normalized = title.replace(/\s+/g, " ").trim();
  const contextualClause = normalized.search(/\s+(?:when|if|after|before|because|so|for|at|on|כש|אחרי|לפני|אם|כי|כדי)\s+/i);
  // Prefer the task itself to the conversational context, but never cut a
  // meaningful title off with an ellipsis. Long task names wrap in the card.
  return contextualClause > 0 ? normalized.slice(0, contextualClause).trim() : normalized;
}

function nextBestText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function contactFirstName(value: string) {
  return value.trim().split(/\s+/u)[0] || value;
}

function agendaEventDetails(event: CalendarEvent & { contactName?: string }) {
  const title = event.title.replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const location = event.location?.replace(/\s+/g, " ").trim();
  // Calendar imports can repeat the event name inside the location/description.
  // Keep the useful person or place, but never repeat the title in a second line.
  const locationRepeatsTitle = Boolean(location && title && location.toLocaleLowerCase().includes(title));
  return [event.contactName, location && !locationRepeatsTitle ? location : undefined]
    .filter(Boolean)
    .join(" · ") || "Confirmed event";
}

function relationshipBriefItems(intelligence: IntelligenceData | undefined, now: number, activeChatIds?: ReadonlySet<string>, hidden?: ReadonlySet<string>): RelationshipBriefItem[] {
  if (!intelligence) return [];
  const directChats = new Map(intelligence.chats
    .filter((chat) => !chat.isGroup)
    .map((chat) => [chat.chatId, chat]));
  const selected = new Set<string>();
  const items: RelationshipBriefItem[] = [];
  const eligible = (
    chatId: string,
    title: string,
    detail: string,
    evidence: { messageId?: string; timestamp?: number },
    options: { currentClaim?: boolean; openFollowUp?: boolean; dueAt?: number } = {},
  ) => {
    const chat = directChats.get(chatId);
    return Boolean(chat && (!activeChatIds || activeChatIds.has(chatId)) && isTrustworthyIntelligenceCard({
      chatId,
      isGroup: false,
      title,
      detail,
      sourceIds: [evidence.messageId || title],
      evidence: [evidence],
      retainedMessageIds: chat.retainedMessageIds,
      now,
      ...options,
    }));
  };
  const add = (item: RelationshipBriefItem) => {
    if (selected.has(item.chatId)) return false;
    selected.add(item.chatId);
    items.push(item);
    return true;
  };
  const change = [...intelligence.changes]
    .filter((insight) => insight.status !== "outdated" && isKnownIntelligenceContactName(insight.contactName))
    .sort((left, right) => toMilliseconds(right.evidence.timestamp) - toMilliseconds(left.evidence.timestamp))
    .find((insight) => !selected.has(insight.chatId) && !hidden?.has(`change:${insight.id}`) && eligible(
      insight.chatId, `What changed with ${contactFirstName(insight.contactName)}`, insight.content, insight.evidence,
      { currentClaim: insight.validity === "current" || insight.freshness === "fresh" },
    ));
  if (change) add({ id: `change:${change.id}`, kind: "change", contactName: change.contactName, chatId: change.chatId, messageId: change.evidence.messageId, detail: nextBestText(change.content), timestamp: toMilliseconds(change.evidence.timestamp) });

  const thread = [...intelligence.commitments]
    .filter((commitment) => commitment.status === "open" || commitment.status === "needs_review")
    .sort((left, right) => toMilliseconds(right.evidence.timestamp) - toMilliseconds(left.evidence.timestamp))
    .find((commitment) => !selected.has(commitment.chatId) && !hidden?.has(`thread:${commitment.id}`) && eligible(
      commitment.chatId, `Open thread with ${contactFirstName(commitment.contactName)}`, commitment.content, commitment.evidence,
      { openFollowUp: true, dueAt: commitment.dueAt },
    ));
  if (thread) add({ id: `thread:${thread.id}`, kind: "thread", contactName: thread.contactName, chatId: thread.chatId, messageId: thread.evidence.messageId, detail: nextBestText(thread.content), timestamp: toMilliseconds(thread.evidence.timestamp) });

  const upcoming = [...intelligence.events]
    .filter((event) => event.status === "confirmed" && toMilliseconds(event.startAt) >= now)
    .sort((left, right) => toMilliseconds(left.startAt) - toMilliseconds(right.startAt))
    .find((event) => !selected.has(event.chatId) && !hidden?.has(`upcoming:${event.id}`) && eligible(
      event.chatId, `Upcoming with ${contactFirstName(event.contactName)}: ${event.title}`, event.note || event.title, event.evidence,
      { dueAt: toMilliseconds(event.startAt) },
    ));
  if (upcoming) add({ id: `upcoming:${upcoming.id}`, kind: "upcoming", contactName: upcoming.contactName, chatId: upcoming.chatId, messageId: upcoming.evidence.messageId, detail: `${nextBestText(upcoming.title)} · ${eventDateTime(toMilliseconds(upcoming.startAt))}`, timestamp: toMilliseconds(upcoming.evidence.timestamp) });

  if (items.length < 3) {
    const reconnect = [...directChats.values()]
      .filter((chat) => chat.lastInteraction?.messageId && chat.lastInteraction.timestamp)
      .map((chat) => ({ chat, timestamp: toMilliseconds(chat.lastInteraction!.timestamp) }))
      .filter(({ timestamp }) => timestamp <= now - 21 * 86_400_000 && timestamp >= now - 120 * 86_400_000)
      .sort((left, right) => left.timestamp - right.timestamp)
      .find(({ chat, timestamp }) => !selected.has(chat.chatId) && !hidden?.has(`reconnect:${chat.chatId}`) && eligible(
        chat.chatId, `Reconnect with ${contactFirstName(chat.contactName)}`, chat.lastInteraction?.content || "",
        { messageId: chat.lastInteraction?.messageId, timestamp },
      ));
    if (reconnect) add({
      id: `reconnect:${reconnect.chat.chatId}`, kind: "reconnect", contactName: reconnect.chat.contactName, chatId: reconnect.chat.chatId,
      messageId: reconnect.chat.lastInteraction?.messageId,
      detail: `You last spoke ${eventDateTime(reconnect.timestamp)}. ${nextBestText(reconnect.chat.lastInteraction?.content || "")}`,
      timestamp: reconnect.timestamp,
    });
  }
  return items;
}

function localDateTime(value: number) {
  const timestamp = toMilliseconds(value);
  const date = new Date(timestamp);
  return new Date(timestamp - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function calendarEnd(event: CalendarEvent) {
  const startAt = toMilliseconds(event.startAt);
  return event.endAt && toMilliseconds(event.endAt) > startAt ? toMilliseconds(event.endAt) : startAt + 60 * 60 * 1_000;
}

type OverviewReadiness = {
  kind: "connection" | "consent" | "learning" | "quiet";
  eyebrow: string;
  title: string;
  detail: string;
  action?: { label: string; view: ViewName };
};

function OverviewReadinessPanel({ state, onNavigate }: { state: OverviewReadiness; onNavigate: (view: ViewName) => void }) {
  const icon = state.kind === "connection"
    ? <MessageCircle size={23} />
    : state.kind === "consent"
      ? <ShieldCheck size={23} />
      : state.kind === "learning"
        ? <Sparkles size={23} />
        : <CalendarClock size={23} />;
  return <div className={`overview-readiness overview-readiness-${state.kind}`} role="status">
    <span className="overview-readiness-icon" aria-hidden="true">{icon}</span>
    <span className="overview-readiness-copy"><small>{state.eyebrow}</small><strong>{state.title}</strong><span>{state.detail}</span></span>
    {state.action ? <button className="button compact primary overview-readiness-action" type="button" onClick={() => onNavigate(state.action!.view)}>{state.action.label}<ArrowRight size={15} /></button> : null}
  </div>;
}

export function Overview({ data, chats, intelligence, onNavigate, onTrackingDecision, onOpenTrackingChat, onOpenNextBestAction, onTodoStatus, onTodoUpdate, onCalendarStatus, onRegenerateCalendarTitle, onReplyToMessage, onReplySuggestionFeedback, onInsightStatus, onDismissNextBestAction, onProactiveDecision }: OverviewProps) {
  const [deviceTime, setDeviceTime] = useState(() => new Date());
  const [quote] = useState(chooseOverviewQuote);
  const [todoFilter, setTodoFilter] = useState<TodoFilter>("open");
  const [hiddenActionVersion, setHiddenActionVersion] = useState(0);
  const [hiddenTodaysFocus, setHiddenTodaysFocus] = useState<Set<string>>(() => readHiddenTodaysFocus());
  const [todaysFocusIcons, setTodaysFocusIcons] = useState<Record<string, string>>({});
  const [actionSummaries, setActionSummaries] = useState<Record<string, string>>(readDashboardActionSummaries);
  const pendingActionSummaries = useRef(new Set<string>());
  const pendingTodaysFocusIcons = useRef(new Set<string>());
  const failedTodaysFocusIcons = useRef(new Set<string>());
  const [completingTodoIds, setCompletingTodoIds] = useState<Set<string>>(() => new Set());
  const [todoEditor, setTodoEditor] = useState<(TodoTask & { contactName: string }) | undefined>();
  const [calendarEditor, setCalendarEditor] = useState<(CalendarEvent & { chatId: string; contactName: string }) | undefined>();
  const [calendarDraft, setCalendarDraft] = useState<CalendarEventDraft>();
  const [calendarSaving, setCalendarSaving] = useState(false);
  const [calendarError, setCalendarError] = useState("");
  const [calendarRegeneratingTitle, setCalendarRegeneratingTitle] = useState(false);
  const [replyEditor, setReplyEditor] = useState<NextBestAction>();
  const [replyBody, setReplyBody] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);
  const [replySending, setReplySending] = useState(false);
  const [replyError, setReplyError] = useState("");
  const [replyFeedback, setReplyFeedback] = useState<"helpful" | "needs_work">();
  const [replyFeedbackReasons, setReplyFeedbackReasons] = useState<string[]>([]);
  const [replyFeedbackNote, setReplyFeedbackNote] = useState("");
  const [replyFeedbackState, setReplyFeedbackState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  useEffect(() => {
    const interval = window.setInterval(() => setDeviceTime(new Date()), 1_000);
    return () => window.clearInterval(interval);
  }, []);
  const firstName = data.settings.ownerProfile.displayName.trim().split(/\s+/)[0] || "Amir";
  const intelligenceSnapshot = useMemo(() => buildIntelligenceSnapshot(
    intelligence,
    readHiddenIntelligenceActions(),
    deviceTime.getTime(),
  ), [intelligence, deviceTime, hiddenActionVersion]);
  const visibleNeedsReply = intelligenceSnapshot.replies;
  const planSuggestions = intelligence?.events.filter((item) => item.status === "inferred" && isKnownIntelligenceContactName(item.contactName)) || [];
  const trackedTodos = useMemo(() => (intelligence?.todos || [])
    .filter((todo) => todo.status === "open" || todo.status === "done")
    .sort((left, right) => {
      const leftDone = left.status === "done" ? 1 : 0;
      const rightDone = right.status === "done" ? 1 : 0;
      if (leftDone !== rightDone) return leftDone - rightDone;
      if (leftDone) return toMilliseconds(right.completedAt || right.updatedAt) - toMilliseconds(left.completedAt || left.updatedAt);
      const priority = (value: TodoTask["priority"]) => value === "high" ? 0 : value === "normal" ? 1 : 2;
      const priorityDifference = priority(left.priority) - priority(right.priority);
      if (priorityDifference) return priorityDifference;
      const leftTime = typeof left.dueAt === "number" ? toMilliseconds(left.dueAt) : Number.MAX_SAFE_INTEGER;
      const rightTime = typeof right.dueAt === "number" ? toMilliseconds(right.dueAt) : Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime || toMilliseconds(right.updatedAt) - toMilliseconds(left.updatedAt);
    }), [intelligence]);
  const todoCounts = useMemo(() => ({
    all: trackedTodos.length,
    open: trackedTodos.filter((todo) => todo.status === "open").length,
    completed: trackedTodos.filter((todo) => todo.status === "done").length,
  }), [trackedTodos]);
  const filteredTrackedTodos = useMemo(() => trackedTodos.filter((todo) => (
    todoFilter === "all" || (todoFilter === "open" ? todo.status === "open" : todo.status === "done")
  )), [todoFilter, trackedTodos]);
  const suggestedTodos = useMemo(() => {
    const hidden = readHiddenIntelligenceActions();
    return (intelligence?.todos || [])
      .filter((todo) => todo.status === "inferred" && !hidden.has(todo.id))
      .sort((left, right) => toMilliseconds(right.evidence.timestamp) - toMilliseconds(left.evidence.timestamp));
  }, [hiddenActionVersion, intelligence]);
  const relationshipBrief = useMemo(
    () => relationshipBriefItems(intelligence, deviceTime.getTime(), new Set(chats.map((chat) => chat.id)), readHiddenIntelligenceActions()),
    [chats, deviceTime, hiddenActionVersion, intelligence],
  );
  const trackingRequests = data.knowledgeTrackingRequests.filter((item) => item.status === "pending").slice(0, 3);
  const trackedChatCount = useMemo(() => Object.values(data.settings.contacts)
    .filter((contact) => contact.knowledgeTracking === "enabled").length, [data.settings.contacts]);
  const hasRecordedIntelligence = Boolean(intelligence && [
    intelligence.chats.length,
    intelligence.events.length,
    intelligence.todos?.length || 0,
    intelligence.changes.length,
  ].some((count) => count > 0));
  const todaysAgenda = useMemo(() => (intelligence?.events || [])
    .filter((event) => (
      event.status === "confirmed"
      && isKnownIntelligenceContactName(event.contactName)
      && sameLocalDay(toMilliseconds(event.startAt), deviceTime)
    ))
    .sort((left, right) => toMilliseconds(left.startAt) - toMilliseconds(right.startAt)), [deviceTime, intelligence]);
  const todaysFocus = useMemo(() => buildTodaysFocus(intelligence, deviceTime), [deviceTime, intelligence]);
  const visibleTodaysFocus = useMemo(
    () => todaysFocus.filter((item) => !hiddenTodaysFocus.has(item.id)),
    [hiddenTodaysFocus, todaysFocus],
  );
  const focusPresentation = useMemo(
    () => todaysFocusPresentation(visibleTodaysFocus, deviceTime),
    [deviceTime, visibleTodaysFocus],
  );
  const overviewReadiness = useMemo<OverviewReadiness>(() => {
    if (data.connection.status !== "ready") return {
      kind: "connection",
      eyebrow: "Private workspace",
      title: "Connect WhatsApp to begin",
      detail: "Once connected, AmirOS can help you review the conversations you choose—nothing is learned without your permission.",
      action: { label: "Open settings", view: "settings" },
    };
    if (trackingRequests.length > 0) return {
      kind: "consent",
      eyebrow: "First value",
      title: "A conversation is ready for your approval",
      detail: "Choose whether AmirOS should learn from it before it can surface private context.",
      action: { label: "Review conversation", view: "inbox" },
    };
    if (trackedChatCount === 0) return {
      kind: "consent",
      eyebrow: "First value",
      title: "Choose your first conversation",
      detail: "Start with a chat you care about. AmirOS will only learn from conversations you explicitly allow.",
      action: { label: "Choose a chat", view: "inbox" },
    };
    if (!hasRecordedIntelligence) return {
      kind: "learning",
      eyebrow: "Building your first brief",
      title: "AmirOS is looking for what is worth keeping",
      detail: "It surfaces plans, requests, and relationship context only when they can point back to an original message.",
      action: { label: "Explore people", view: "intelligence" },
    };
    return {
      kind: "quiet",
      eyebrow: "Today",
      title: "Nothing confirmed needs your attention",
      detail: "Your approved conversations are checked for evidence-backed plans, requests, and meaningful changes.",
    };
  }, [data.connection.status, hasRecordedIntelligence, trackedChatCount, trackingRequests.length]);
  useEffect(() => {
    for (const item of visibleTodaysFocus) {
      const isBirthday = item.action === "calendar" && /birthday/i.test(item.title);
      const isPersonFocus = isBirthday || item.type === "commitment" || item.action === "reply";
      const chat = isPersonFocus ? chats.find((candidate) => candidate.id === item.chatId) : undefined;
      if (item.proactive || (isPersonFocus && chat?.avatarUrl) || item.imageUrl || todaysFocusIcons[item.id]
        || pendingTodaysFocusIcons.current.has(item.id) || failedTodaysFocusIcons.current.has(item.id)) continue;
      pendingTodaysFocusIcons.current.add(item.id);
      void ensureTodaysFocusIcon({ title: item.title, type: item.type })
        .then(({ url }) => {
          if (!url) {
            failedTodaysFocusIcons.current.add(item.id);
            return;
          }
          setTodaysFocusIcons((current) => current[item.id] ? current : { ...current, [item.id]: url });
        })
        .catch(() => failedTodaysFocusIcons.current.add(item.id))
        .finally(() => pendingTodaysFocusIcons.current.delete(item.id));
    }
  }, [chats, todaysFocusIcons, visibleTodaysFocus]);
  const focusActions = useMemo<NextBestAction[]>(() => [
    ...visibleNeedsReply.map((reply) => ({
      kind: "May need your reply",
      title: reply.contactName,
      detail: reply.lastIncoming?.content || "A recent message is waiting for you.",
      chatId: reply.chatId,
      contactName: reply.contactName,
      messageId: reply.lastIncoming?.messageId,
      actionType: "reply" as const,
      actionId: replyActionId(reply),
      replyAssessment: reply.replyAssessment,
    })),
    ...planSuggestions.map((event) => ({
      kind: "Calendar suggestion",
      title: nextBestText(event.title),
      detail: `From ${event.contactName} · ${eventDateTime(event.startAt)}${suggestedSourceTime(event.evidence.timestamp) ? ` · Suggested from ${suggestedSourceTime(event.evidence.timestamp)}` : ""}`,
      chatId: event.chatId,
      contactName: event.contactName,
      messageId: event.evidence.messageId,
      actionType: "calendar" as const,
      actionId: event.id,
    })),
    ...suggestedTodos.map((todo) => ({
      kind: "To-do suggestion",
      title: compactTodoSuggestionTitle(todo.title),
      detail: `From ${todo.contactName} · ${todoTimingLabel(todo)}`,
      chatId: todo.chatId,
      contactName: todo.contactName,
      messageId: todo.evidence.messageId,
      actionType: "todo" as const,
      actionId: todo.id,
    })),
  ].slice(0, 6), [planSuggestions, suggestedTodos, visibleNeedsReply]);
  const focus = focusActions[0];

  useEffect(() => {
    for (const action of focusActions) {
      if (action.actionType !== "reply" || !action.detail || actionSummaries[action.actionId] || pendingActionSummaries.current.has(action.actionId)) continue;
      pendingActionSummaries.current.add(action.actionId);
      void summarizeDashboardActionMessage(action.detail)
        .then(({ summary }) => {
          const nextSummary = summary.trim();
          if (!nextSummary) return;
          setActionSummaries((current) => current[action.actionId] ? current : saveDashboardActionSummary(action.actionId, nextSummary));
        })
        .catch(() => undefined)
        .finally(() => pendingActionSummaries.current.delete(action.actionId));
    }
  }, [actionSummaries, focusActions]);
  const toggleTodo = async (todo: TodoTask) => {
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
  const dismissFocus = async (action: NextBestAction) => {
    if (action.actionType === "reply" || (action.actionType === "todo" && action.kind === "To-do")) {
      hideIntelligenceAction(action.actionId);
      setHiddenActionVersion((version) => version + 1);
      return;
    }
    await onDismissNextBestAction(action);
  };
  const dismissRelationshipBrief = (item: RelationshipBriefItem) => {
    // This only hides the item from this local briefing. It never deletes a
    // message or changes the underlying relationship knowledge.
    hideIntelligenceAction(item.id);
    setHiddenActionVersion((version) => version + 1);
  };
  const openCalendarSuggestion = (action: NextBestAction) => {
    const event = planSuggestions.find((candidate) => candidate.id === action.actionId && candidate.chatId === action.chatId);
    if (!event) return;
    setCalendarEditor(event);
    setCalendarDraft({ title: event.title, startAt: localDateTime(event.startAt), endAt: localDateTime(calendarEnd(event)), location: event.location || "" });
    setCalendarError("");
  };
  const openTodoSuggestion = (action: NextBestAction) => {
    const todo = suggestedTodos.find((candidate) => candidate.id === action.actionId && candidate.chatId === action.chatId);
    if (todo) setTodoEditor(todo);
  };
  const openReplySuggestion = async (action: NextBestAction) => {
    if (!action.messageId) {
      onOpenNextBestAction(action.chatId);
      return;
    }
    setReplyEditor(action);
    setReplyBody("");
    setReplyError("");
    setReplyFeedback(undefined);
    setReplyFeedbackReasons([]);
    setReplyFeedbackNote("");
    setReplyFeedbackState("idle");
    setReplyLoading(true);
    try {
      const response = await suggestReplyForMessage(action.chatId, action.messageId);
      setReplyBody(response.body);
    } catch (error) {
      setReplyError(error instanceof Error ? error.message : "Could not prepare a reply.");
    } finally {
      setReplyLoading(false);
    }
  };
  const saveHelpfulReplyFeedback = async () => {
    if (!replyEditor?.messageId || !onReplySuggestionFeedback) return;
    setReplyFeedback("helpful");
    setReplyFeedbackState("saving");
    try {
      await onReplySuggestionFeedback(replyEditor.chatId, replyEditor.messageId, { rating: "helpful" });
      setReplyFeedbackState("saved");
    } catch {
      setReplyFeedbackState("error");
    }
  };
  const improveReplyFromFeedback = async () => {
    if (!replyEditor?.messageId || !onReplySuggestionFeedback) return;
    const note = replyFeedbackNote.trim() || undefined;
    if (replyFeedbackReasons.length === 0 && !note) return;
    setReplyFeedbackState("saving");
    setReplyLoading(true);
    setReplyError("");
    try {
      await onReplySuggestionFeedback(replyEditor.chatId, replyEditor.messageId, {
        rating: "needs_work",
        reasons: replyFeedbackReasons,
        note,
      });
      const response = await suggestReplyForMessage(replyEditor.chatId, replyEditor.messageId);
      setReplyBody(response.body);
      setReplyFeedback(undefined);
      setReplyFeedbackReasons([]);
      setReplyFeedbackNote("");
      setReplyFeedbackState("saved");
    } catch (error) {
      setReplyFeedbackState("error");
      setReplyError(error instanceof Error ? error.message : "Could not improve this reply.");
    } finally {
      setReplyLoading(false);
    }
  };
  const openFocus = (action: NextBestAction) => {
    if (action.actionType === "calendar") return openCalendarSuggestion(action);
    if (action.actionType === "todo") return openTodoSuggestion(action);
    if (action.actionType === "reply") return void openReplySuggestion(action);
    onOpenNextBestAction(action.chatId, action.messageId);
  };
  const applyFocus = async (action: NextBestAction) => {
    if (action.actionType === "calendar") {
      openCalendarSuggestion(action);
      return;
    }
    if (action.actionType === "insight") {
      await onInsightStatus(action.chatId, action.actionId, "confirmed");
      return;
    }
    openFocus(action);
  };
  const openTodaysFocus = (item: TodaysFocusItem) => {
    if (item.proactive) void onProactiveDecision(item.proactive, "opened").catch(() => {
      // Opening the requested destination is more important than optional ranking feedback.
    });
    if (item.action === "calendar") {
      onNavigate("calendar");
      return;
    }
    if (item.action === "todo") {
      const todo = trackedTodos.find((candidate) => candidate.id === item.recordId && candidate.chatId === item.chatId);
      if (todo) setTodoEditor(todo);
      return;
    }
    onOpenNextBestAction(item.chatId, item.messageId);
  };

  const hideTodaysFocus = (itemIds: string[]) => {
    setHiddenTodaysFocus((current) => {
      const next = new Set(current);
      let changed = false;
      for (const itemId of itemIds) {
        if (next.has(itemId)) continue;
        next.add(itemId);
        changed = true;
      }
      if (!changed) return current;
      saveHiddenTodaysFocus(next);
      return next;
    });
  };
  const dismissTodaysFocus = async (item: TodaysFocusItem) => {
    hideTodaysFocus(todaysFocusDismissalIds(item));
    if (item.proactive) {
      await onProactiveDecision(item.proactive, "dismissed");
    }
  };
  const removeTodo = async (todo: TodoTask & { contactName: string }) => {
    if (!window.confirm(`Remove “${todo.title}” from your to-do list?`)) return;
    await onTodoStatus(todo.chatId, todo.id, "dismissed");
    if (todoEditor?.id === todo.id) setTodoEditor(undefined);
  };
  const regenerateCalendarSuggestionTitle = async () => {
    if (!calendarEditor) return;
    setCalendarRegeneratingTitle(true);
    setCalendarError("");
    try {
      const title = await onRegenerateCalendarTitle(calendarEditor.chatId, calendarEditor.id);
      setCalendarDraft((current) => current ? { ...current, title } : current);
    } catch (error) {
      setCalendarError(error instanceof Error ? error.message : "Could not generate a title.");
    } finally {
      setCalendarRegeneratingTitle(false);
    }
  };
  return (
    <main className="main-content overview-page">
      <header className="page-header overview-header">
        <div className="overview-header-copy">
          <h1>{timeOfDayGreeting(deviceTime)}, {firstName} <span aria-hidden="true">👋</span></h1>
          <figure className="overview-quote"><blockquote>“{quote.text}”</blockquote><figcaption>— {quote.author}</figcaption></figure>
        </div>
        <OverviewHeaderExperience now={deviceTime} />
      </header>

      <section className="overview-reminders-panel todays-focus-panel" aria-labelledby="overview-reminders-title">
        <div className="todays-focus-heading">
          <div className="todays-focus-title-block">
            <span>
              <span className="todays-focus-title-row">
                <h2 id="overview-reminders-title">{visibleTodaysFocus.length > 0 ? focusPresentation.title : overviewReadiness.kind === "quiet" ? "Today" : "Your private workspace"}</h2>
                {visibleTodaysFocus.length > 0 ? <span className="count-badge intelligence-count">{visibleTodaysFocus.length}</span> : null}
              </span>
              <small>{visibleTodaysFocus.length > 0 ? focusPresentation.subtitle : overviewReadiness.kind === "quiet" ? "A calm, evidence-backed view of what matters." : "Your private relationship intelligence, on your terms."}</small>
            </span>
          </div>
        </div>
        {visibleTodaysFocus.length > 0 ? <div className="overview-reminders-list todays-focus-grid">
          {visibleTodaysFocus.map((item) => {
            const followUpAt = item.sourceTimestamp || item.timestamp;
            const isOverdue = (item.type === "todo" || item.type === "commitment")
              && item.hasExplicitDueAt === true
              && item.timestamp < deviceTime.getTime();
            const isRecentlyPassedEvent = isRecentlyPassedCalendarEvent(item, deviceTime);
            const isAttentionPastDue = isOverdue || isRecentlyPassedEvent;
            const category = isOverdue
              ? `Overdue · ${eventDateTime(item.timestamp)}`
              : isRecentlyPassedEvent
                ? `Started · ${eventDateTime(item.timestamp)}`
              : item.proactive
                ? item.proactive.kind === "upcoming_context" ? "Worth knowing"
                  : item.proactive.kind === "meaningful_change" ? "Recent change"
                    : item.proactive.kind === "reply" || item.proactive.kind === "commitment" ? `Follow-up from ${eventDateTime(followUpAt)}`
                      : "Due today"
                : item.type === "calendar" ? item.detail
                  : item.type === "reply" || item.type === "commitment" ? `Follow-up from ${eventDateTime(followUpAt)}`
                    : "Due today";
            const context = item.proactive ? item.detail : item.type === "calendar"
              ? [item.allDay ? "All day" : formatTime(item.timestamp), item.location].filter(Boolean).join(" · ")
              : item.contactName ? `${item.detail} · ${item.contactName}` : item.detail;
            const replyCopy = item.type === "reply" ? replyAssessmentCopy(item.replyAssessment) : undefined;
            const isBirthday = item.action === "calendar" && /birthday/i.test(item.title);
            const isPersonFocus = Boolean(item.proactive) || isBirthday || item.type === "commitment" || item.action === "reply";
            const chat = isPersonFocus ? chats.find((candidate) => candidate.id === item.chatId) : undefined;
            const itemIcon = isBirthday
              ? <CakeSlice size={30} />
              : item.action === "todo"
                ? <ListTodo size={30} />
                : item.action === "calendar"
                  ? <CalendarCheck size={30} />
                  : item.action === "reply"
                    ? <MessageCircle size={30} />
                    : <BellRing size={30} />;
            const openItem = () => openTodaysFocus(item);
            return <article
              className={`overview-reminder todays-focus-item todays-focus-${item.type} ${isAttentionPastDue ? "is-overdue" : ""}`}
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={openItem}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openItem();
                }
              }}
            >
              <button
                className="todays-focus-dismiss"
                type="button"
                aria-label={`Hide ${item.title} from Today's Focus`}
                title="Hide from Today's Focus"
                onClick={(event) => {
                  event.stopPropagation();
                  void dismissTodaysFocus(item);
                }}
              >
                ×
              </button>
              {isPersonFocus && chat?.avatarUrl
                ? <ContactAvatar name={item.contactName} src={chat.avatarUrl} className="todays-focus-item-avatar" />
                : item.imageUrl || todaysFocusIcons[item.id]
                  ? <img className="todays-focus-item-icon todays-focus-generated-icon" src={item.imageUrl || todaysFocusIcons[item.id]} alt="" />
                : <span className="todays-focus-item-icon" aria-hidden="true">{itemIcon}</span>}
              <div className="todays-focus-item-copy">
                <small>{category}</small>
                <span className="overview-reminder-copy">
                  <strong dir="auto">{item.title}</strong>
                  <span dir="auto">{context}</span>
                  {item.source === "whatsapp_bot" ? <span className="whatsapp-origin"><Bot size={12} /> Added by WhatsApp Bot</span> : null}
                  {replyCopy ? <span className="reply-assessment-indicator">{replyCopy.text}</span> : null}
                  {item.proactive?.aiAssessment ? <span className="reply-assessment-indicator" title={item.proactive.aiAssessment.reason}>AI checked · {item.proactive.aiAssessment.confidence >= 80 ? "High confidence" : "Worth considering"}</span> : null}
                </span>
              </div>
            </article>;
          })}
        </div> : <OverviewReadinessPanel state={overviewReadiness} onNavigate={onNavigate} />}
      </section>

      <div className="overview-primary-grid">
        <div className="overview-agenda-pair">
          <section className="panel intelligence-snapshot-panel overview-today-agenda-panel" aria-labelledby="overview-agenda-title">
            <div className="panel-heading overview-card-heading">
              <h2 id="overview-agenda-title"><CalendarCheck size={19} /> Agenda {todaysAgenda.length > 0 ? <span className="count-badge intelligence-count">{todaysAgenda.length}</span> : null}</h2>
              <span className="overview-agenda-today">Today</span>
            </div>
            {todaysAgenda.length > 0 ? <div className="overview-today-agenda" data-event-count={todaysAgenda.length > 5 ? "many" : todaysAgenda.length}>
              {todaysAgenda.map((event, index) => {
                const startAt = toMilliseconds(event.startAt);
                const details = agendaEventDetails(event);
                return <button className="overview-timeline-event" type="button" key={event.id} onClick={() => onNavigate("calendar")}>
                  <time dateTime={new Date(startAt).toISOString()}>{event.allDay ? "All day" : formatTime(startAt)}</time>
                  <span className="overview-timeline-rail" aria-hidden="true"><span className={`overview-timeline-marker marker-${index % 4}`} /></span>
                  <span className="overview-timeline-copy"><strong dir="auto">{event.title}</strong><small dir="auto">{details}</small></span>
                  <ArrowRight size={15} />
                </button>;
              })}
            </div> : <div className="overview-empty-state"><span className="overview-empty-state-icon"><CalendarDays size={21} /></span><span className="overview-empty-state-copy"><strong>No confirmed plans for today.</strong><small>Your day stays clear until a plan is confirmed.</small></span></div>}
            <footer className="overview-today-agenda-footer"><button className="text-button" type="button" onClick={() => onNavigate("calendar")}>View full agenda <ArrowRight size={15} /></button></footer>
          </section>

          <section className="panel overview-todos-panel" aria-labelledby="overview-todo-list-title">
            <div className="panel-heading overview-card-heading">
              <h2 id="overview-todo-list-title"><ListTodo size={19} /> To-dos <span className="count-badge intelligence-count">{todoCounts.open}</span></h2>
              <button className="text-button" type="button" onClick={() => setTodoFilter("all")}>View all <ArrowRight size={14} /></button>
            </div>
            {trackedTodos.length > 0 ? <><div className="overview-todo-filter-bar" aria-label="Filter to-dos">
              {(["all", "open", "completed"] as TodoFilter[]).map((filter) => <button key={filter} className={todoFilter === filter ? "is-active" : ""} type="button" aria-pressed={todoFilter === filter} onClick={() => setTodoFilter(filter)}>{filter === "all" ? "All" : filter === "open" ? "Open" : "Completed"}<span>{todoCounts[filter]}</span></button>)}
            </div>
            {filteredTrackedTodos.length > 0 ? <div className="overview-agenda-list">
              {filteredTrackedTodos.map((todo) => <div className={`overview-agenda-todo-row ${todo.status === "done" ? "is-completed" : ""} ${completingTodoIds.has(todo.id) ? "is-completing" : ""}`} key={todo.id}>
                <button className="overview-todo-check" type="button" aria-label={todo.status === "done" ? `Mark ${todo.title} as open` : `Mark ${todo.title} as complete`} onClick={() => void toggleTodo(todo)}><Check size={16} /></button>
                <button className="overview-todo-title" type="button" onClick={() => setTodoEditor(todo)} title={`Edit ${todo.title}`}><span className={`overview-todo-priority priority-${todo.priority || "normal"}`} role="img" aria-label={`${todo.priority || "normal"} priority`} /><strong dir="auto">{todo.title}</strong></button>
                <span className="overview-todo-actions"><button className="overview-todo-action" type="button" title={`Edit ${todo.title}`} aria-label={`Edit ${todo.title}`} onClick={() => setTodoEditor(todo)}><PencilLine size={14} /></button><button className="overview-todo-action danger" type="button" title={`Remove ${todo.title}`} aria-label={`Remove ${todo.title}`} onClick={() => void removeTodo(todo)}><Trash2 size={14} /></button></span>
              </div>)}
            </div> : <div className="overview-empty-state"><span className="overview-empty-state-icon"><ListTodo size={21} /></span><span className="overview-empty-state-copy"><strong>No {todoFilter === "completed" ? "completed" : "open"} to-dos</strong><small>Try another filter to see saved tasks.</small></span></div>}
            </> : suggestedTodos.length > 0 ? <div className="overview-empty-state"><span className="overview-empty-state-icon"><ListTodo size={21} /></span><span className="overview-empty-state-copy"><strong>{suggestedTodos.length} task {suggestedTodos.length === 1 ? "suggestion" : "suggestions"} waiting</strong><small>Review a message before it becomes a to-do.</small></span></div> : <div className="overview-empty-state"><span className="overview-empty-state-icon"><ListTodo size={21} /></span><span className="overview-empty-state-copy"><strong>No to-dos yet</strong><small>Actionable messages will appear here for review.</small></span></div>}
          </section>
        </div>

        <div className="overview-command-rail">
          {relationshipBrief.length > 0 ? <section className="panel overview-private-briefing" aria-labelledby="overview-private-briefing-title">
            <div className="panel-heading overview-card-heading">
              <h2 id="overview-private-briefing-title"><Brain size={19} /> Private briefing</h2>
              <span className="attention-label clear">Current</span>
            </div>
            <div className="overview-private-briefing-list">
              {relationshipBrief.map((item) => {
                const chat = chats.find((candidate) => candidate.id === item.chatId);
                const timing = suggestedSourceTime(item.timestamp);
                const category = item.kind === "change" ? "What changed" : item.kind === "thread" ? "Open thread" : item.kind === "upcoming" ? "Coming up" : "Reconnect";
                const icon = item.kind === "change" ? <Sparkles size={16} /> : item.kind === "thread" ? <MessageCircle size={16} /> : item.kind === "upcoming" ? <CalendarCheck size={16} /> : <BellRing size={16} />;
                return <div className="overview-private-briefing-row" key={item.id}>
                  <button className="overview-private-briefing-item" type="button" onClick={() => onOpenNextBestAction(item.chatId, item.messageId)}>
                    <span className="overview-private-briefing-avatar-wrap"><ContactAvatar name={item.contactName} src={chat?.avatarUrl} className="overview-private-briefing-avatar" /><span className="overview-private-briefing-kind" aria-hidden="true">{icon}</span></span>
                    <span className="overview-private-briefing-copy">
                      <small>{category} · {contactFirstName(item.contactName)}{timing ? ` · ${timing}` : ""}</small>
                      <strong dir="auto">{item.detail}</strong>
                    </span>
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                  <button className="overview-private-briefing-dismiss" type="button" aria-label={`Dismiss ${category.toLowerCase()} about ${contactFirstName(item.contactName)}`} title="Dismiss from Private briefing" onClick={() => dismissRelationshipBrief(item)}><X size={15} /></button>
                </div>;
              })}
            </div>
          </section> : null}

          <section className="panel next-best-panel overview-suggested-actions-panel" aria-labelledby="overview-suggested-actions-title">
            <div className="panel-heading overview-card-heading"><h2 id="overview-suggested-actions-title"><Sparkles size={19} /> Suggested actions</h2><span className={focus || trackingRequests.length > 0 ? "attention-label" : "attention-label clear"}>{focus || trackingRequests.length > 0 ? "Priority" : "All clear"}</span></div>
            {focusActions.length > 0 || trackingRequests.length > 0 ? <div className="next-best-list">
              {trackingRequests.map((request) => {
                const chat = chats.find((item) => item.id === request.chatId);
                return <div className="intelligence-focus next-best-focus tracking-next-best-focus" key={`tracking:${request.chatId}`}>
                  <ContactAvatar name={request.contactName} src={chat?.avatarUrl} className="intelligence-focus-avatar" />
                  <button className="next-best-focus-copy" type="button" onClick={() => onOpenTrackingChat(request.chatId)}>
                    <small>New chat · choose whether AmirOS should learn</small>
                    <strong dir="auto">{request.contactName}</strong>
                    <p dir="auto">{request.isGroup ? "Group chat" : "Private chat"} · {request.messageCount} new {request.messageCount === 1 ? "message" : "messages"} · {request.preview}</p>
                  </button>
                  <span className="tracking-review-actions tracking-next-best-actions">
                    <button className="button compact primary" type="button" onClick={() => void onTrackingDecision(request.chatId, "enabled")}>Track</button>
                    <button className="button compact ghost" type="button" onClick={() => void onTrackingDecision(request.chatId, "snoozed")}>Not now</button>
                    <button className="text-action muted" type="button" onClick={() => void onTrackingDecision(request.chatId, "disabled")}>Never</button>
                  </span>
                </div>;
              })}
              {focusActions.map((action) => {
                const chat = chats.find((candidate) => candidate.id === action.chatId);
                const replyCopy = action.actionType === "reply" ? replyAssessmentCopy(action.replyAssessment) : undefined;
                const actionIcon = action.actionType === "reply" ? <MessageCircle size={20} /> : action.actionType === "calendar" ? <CalendarCheck size={20} /> : action.actionType === "todo" ? <ListTodo size={20} /> : <Brain size={20} />;
                return <div className="intelligence-focus next-best-focus" key={action.actionId}>
                  {chat?.avatarUrl
                    ? <ContactAvatar name={action.contactName} src={chat.avatarUrl} className="intelligence-focus-avatar" />
                    : <span className="next-best-row-icon" aria-hidden="true">{actionIcon}</span>}
                  <button className="next-best-focus-copy" type="button" onClick={() => openFocus(action)}>
                    <small>{action.kind}</small><strong dir="auto">{action.title}</strong><p dir="auto">{action.actionType === "reply" ? actionSummaries[action.actionId] || action.detail : action.detail}</p>{replyCopy ? <span className="reply-assessment-indicator">{replyCopy.text}</span> : null}
                  </button>
                  <span className="next-best-focus-actions">
                    <button className="next-best-action-control primary" type="button" title={action.actionType === "reply" ? "Write reply" : action.actionType === "calendar" ? "Review calendar event" : action.actionType === "todo" ? "Review to-do" : "Confirm detail"} aria-label={action.actionType === "reply" ? "Write reply" : action.actionType === "calendar" ? "Review calendar event" : action.actionType === "todo" ? "Review to-do" : "Confirm detail"} onClick={() => void applyFocus(action)}>
                      {action.actionType === "reply" ? <MessageCircle size={16} /> : action.actionType === "calendar" ? <CalendarCheck size={16} /> : action.actionType === "todo" ? <ListTodo size={16} /> : <Brain size={16} />}
                    </button>
                    {action.actionType === "insight" ? <button className="next-best-action-control" type="button" title="Open source message" aria-label="Open source message" onClick={() => onOpenNextBestAction(action.chatId, action.messageId)}><ExternalLink size={16} /></button> : null}
                    <button className="next-best-action-control dismiss" type="button" title="Dismiss action" aria-label="Dismiss action" onClick={() => void dismissFocus(action)}><X size={16} /></button>
                  </span>
                </div>;
              })}
            </div> : <div className="overview-empty-state overview-quiet-summary" role="status"><span className="overview-empty-state-icon"><Sparkles size={21} /></span><span className="overview-empty-state-copy"><strong>Nothing needs confirmation.</strong><small>Only useful, evidence-backed items appear here.</small></span></div>}
          </section>

        </div>
      </div>
      {todoEditor ? <TodoEditorDialog todo={todoEditor} onClose={() => setTodoEditor(undefined)} onSave={(patch) => onTodoUpdate(todoEditor.chatId, todoEditor.id, patch)} /> : null}
      {calendarEditor && calendarDraft ? <div className="event-detail-backdrop" role="presentation" onMouseDown={() => !calendarSaving && setCalendarEditor(undefined)}>
        <section className="event-detail-bubble reply-suggestion-editor" role="dialog" aria-modal="true" aria-labelledby="overview-calendar-suggestion-title" onMouseDown={(event) => event.stopPropagation()}>
          <header><span><small>Calendar suggestion</small><h2 id="overview-calendar-suggestion-title">Review event</h2></span><button className="icon-button" type="button" aria-label="Close" disabled={calendarSaving} onClick={() => setCalendarEditor(undefined)}><X size={18} /></button></header>
          <CalendarEventForm draft={calendarDraft} error={calendarError} saving={calendarSaving} regeneratingTitle={calendarRegeneratingTitle} submitLabel="Add to calendar" onChange={setCalendarDraft} onCancel={() => setCalendarEditor(undefined)} onRegenerateTitle={() => void regenerateCalendarSuggestionTitle()} onSubmit={() => void (async () => {
            const startAt = new Date(calendarDraft.startAt).getTime(); const endAt = new Date(calendarDraft.endAt).getTime();
            if (!calendarDraft.title.trim() || !Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) { setCalendarError("Add a title and a valid end time after the start."); return; }
            setCalendarSaving(true); setCalendarError("");
            try { await onCalendarStatus(calendarEditor.chatId, calendarEditor.id, { status: "confirmed", title: calendarDraft.title.trim(), startAt, endAt, allDay: false, location: calendarDraft.location.trim() || undefined }); setCalendarEditor(undefined); }
            catch (error) { setCalendarError(error instanceof Error ? error.message : "Could not save this event."); }
            finally { setCalendarSaving(false); }
          })()} />
        </section>
      </div> : null}
      {replyEditor ? <div className="event-detail-backdrop" role="presentation" onMouseDown={() => !replySending && setReplyEditor(undefined)}>
        <section className="event-detail-bubble reply-suggestion-editor reply-suggestion-editor--reply" role="dialog" aria-modal="true" aria-labelledby="overview-reply-suggestion-title" onMouseDown={(event) => event.stopPropagation()}>
          <header><ContactAvatar name={replyEditor.contactName} src={chats.find((chat) => chat.id === replyEditor.chatId)?.avatarUrl} className="reply-suggestion-avatar" /><span><small>Reply suggestion</small><h2 id="overview-reply-suggestion-title">Reply to {replyEditor.contactName}</h2></span><button className="icon-button" type="button" aria-label="Close" disabled={replySending} onClick={() => setReplyEditor(undefined)}><X size={18} /></button></header>
          <p className="reply-suggestion-context" dir="auto">{replyEditor.detail}</p>
          <label className="reply-suggestion-compose"><span>Your reply</span><textarea dir="auto" autoFocus value={replyBody} placeholder={replyLoading ? "Preparing a reply…" : "Write a reply"} disabled={replyLoading || replySending} onChange={(event) => setReplyBody(event.target.value)} /></label>
          <div className="reply-suggestion-compose-tools">
            <button className="reply-draft-clear" type="button" disabled={replyLoading || replySending || !replyBody} onClick={() => { setReplyBody(""); setReplyError(""); }}>Clear draft</button>
            {onReplySuggestionFeedback && replyEditor.messageId ? <div className="reply-suggestion-feedback-quick" aria-label="Reply suggestion feedback">
              <span className="sr-only" aria-live="polite">{replyFeedbackState === "saved" ? "Feedback saved for future drafts." : replyFeedbackState === "error" ? "Could not save feedback. Try again." : ""}</span>
              <button type="button" className={replyFeedback === "helpful" ? "selected helpful" : ""} aria-label="This sounds like me" title="This sounds like me" disabled={replyLoading || replySending || replyFeedbackState === "saving"} onClick={() => void saveHelpfulReplyFeedback()}><ThumbsUp size={15} /></button>
              <button type="button" className={replyFeedback === "needs_work" ? "selected" : ""} aria-label="This needs work" title="This needs work" disabled={replyLoading || replySending || replyFeedbackState === "saving"} onClick={() => { setReplyFeedback("needs_work"); setReplyFeedbackState("idle"); }}><ThumbsDown size={15} /></button>
            </div> : null}
          </div>
          {replyFeedbackState === "error" ? <p className="reply-feedback-error" role="alert">Couldn’t save that feedback. Please try again.</p> : null}
          {onReplySuggestionFeedback && replyEditor.messageId && replyFeedback === "needs_work" ? <section className="reply-suggestion-feedback-details" aria-label="Improve this reply">
            <div><strong>What should be better?</strong><small>Your feedback helps shape future replies in this chat.</small></div>
            <div className="reply-suggestion-feedback-reasons">{["Doesn’t sound like me", "Too formal", "Too long", "Missed the point"].map((reason) => <button type="button" className={replyFeedbackReasons.includes(reason) ? "selected" : ""} key={reason} onClick={() => setReplyFeedbackReasons((current) => current.includes(reason) ? current.filter((item) => item !== reason) : [...current, reason])}>{reason}</button>)}</div>
            <textarea className="reply-suggestion-feedback-note" dir="auto" value={replyFeedbackNote} maxLength={320} placeholder="Optional note" disabled={replyLoading || replySending} onChange={(event) => setReplyFeedbackNote(event.target.value)} />
            <button className="button compact reply-feedback-save" type="button" disabled={replyLoading || replySending || replyFeedbackState === "saving" || (replyFeedbackReasons.length === 0 && !replyFeedbackNote.trim())} onClick={() => void improveReplyFromFeedback()}>{replyFeedbackState === "saving" ? "Improving…" : "Improve reply"}</button>
          </section> : null}
          {replyError ? <p className="event-action-error">{replyError}</p> : null}
          <footer><button className="button compact" type="button" disabled={replySending} onClick={() => setReplyEditor(undefined)}>Cancel</button><button className="button primary compact" type="button" disabled={replyLoading || replySending || !replyBody.trim()} onClick={() => void (async () => { if (!replyEditor.messageId) return; setReplySending(true); setReplyError(""); try { await onReplyToMessage(replyEditor.chatId, replyEditor.messageId, replyBody.trim()); setReplyEditor(undefined); } catch (error) { setReplyError(error instanceof Error ? error.message : "Could not send this reply."); } finally { setReplySending(false); } })()}><MessageCircle size={15} />{replySending ? "Sending…" : "Send reply"}</button></footer>
        </section>
      </div> : null}
    </main>
  );
}
