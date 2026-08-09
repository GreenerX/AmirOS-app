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
  CircleDollarSign,
  ExternalLink,
  Image,
  ListTodo,
  MessageCircle,
  Mic,
  Pause,
  PencilLine,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { summarizeDashboardActionMessage } from "../api";
import { readDashboardActionSummaries, saveDashboardActionSummary } from "../dashboard-action-summary-cache";
import { compactNumber, formatDeviceClock, formatTime, timeOfDayGreeting } from "../format";
import { hideIntelligenceAction, readHiddenIntelligenceActions, replyActionId } from "../intelligence-visibility";
import { buildIntelligenceSnapshot, isKnownIntelligenceContactName } from "../intelligence-snapshot";
import { buildTodaysFocus, type TodaysFocusItem } from "../todays-focus";
import type { Activity, ChatSummary, DashboardData, IntelligenceData, KnowledgeTrackingStatus, ModelPreset, TodoTask, ViewName } from "../types";
import { WhatsAppIcon } from "./BrandIcons";
import { ContactAvatar } from "./ContactAvatar";
import { TodoEditorDialog } from "./IntelligenceView";

type OverviewProps = {
  data: DashboardData;
  chats: ChatSummary[];
  intelligence?: IntelligenceData;
  onNavigate: (view: ViewName) => void;
  onOpenUnread: () => void;
  onPreset: (preset: ModelPreset) => Promise<void>;
  onTrackingDecision: (chatId: string, status: KnowledgeTrackingStatus) => Promise<void>;
  onOpenTrackingChat: (chatId: string) => void;
  onOpenNextBestAction: (chatId: string, messageId?: string) => void;
  onOpenTodoReview: () => void;
  onTodoStatus: (chatId: string, todoId: string, status: TodoTask["status"]) => Promise<void>;
  onTodoUpdate: (chatId: string, todoId: string, patch: { title?: string; dueAt?: number | null; priority?: TodoTask["priority"] }) => Promise<void>;
  onCalendarStatus: (chatId: string, eventId: string, patch: { status?: "inferred" | "confirmed" | "dismissed" }) => Promise<void>;
  onInsightStatus: (chatId: string, insightId: string, status: "confirmed" | "outdated") => Promise<void>;
  onDismissNextBestAction: (action: NextBestAction) => Promise<void>;
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
};

type TodoFilter = "all" | "open" | "completed";

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

function activityIcon(kind: Activity["kind"]) {
  if (kind === "voice") return <Mic size={20} />;
  if (kind === "image") return <Image size={20} />;
  if (kind === "web") return <Search size={20} />;
  if (kind === "system") return <ShieldCheck size={20} />;
  return <MessageCircle size={20} />;
}

function sameLocalDay(left: number, right: Date) {
  const date = new Date(left);
  return date.getFullYear() === right.getFullYear()
    && date.getMonth() === right.getMonth()
    && date.getDate() === right.getDate();
}

function eventDateTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function eventCountdown(timestamp: number, now: Date) {
  const eventDate = new Date(timestamp);
  if (sameLocalDay(timestamp, now)) return "Today";
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (sameLocalDay(timestamp, tomorrow)) return "Tomorrow";
  const dayDifference = Math.max(1, Math.ceil((eventDate.getTime() - now.getTime()) / 86_400_000));
  return `In ${dayDifference} days`;
}

function toMilliseconds(timestamp: number) {
  return timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp;
}

function todoTimingLabel(todo: TodoTask) {
  if (typeof todo.dueAt === "number" && Number.isFinite(todo.dueAt)) {
    return `Due ${eventDateTime(toMilliseconds(todo.dueAt))}`;
  }
  return todo.status === "inferred" ? "Suggested from a message" : "No due date";
}

function compactTodoSuggestionTitle(title: string) {
  const normalized = title.replace(/\s+/g, " ").trim();
  const contextualClause = normalized.search(/\s+(?:when|if|after|before|because|so|for|at|on|כש|אחרי|לפני|אם|כי|כדי)\s+/i);
  const compact = contextualClause > 0 ? normalized.slice(0, contextualClause) : normalized;
  return compact.length > 52 ? `${compact.slice(0, 49).trimEnd()}…` : compact;
}

function compactNextBestText(value: string, maxLength = 96) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  const cut = normalized.slice(0, maxLength + 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 48 ? lastSpace : maxLength).trimEnd()}…`;
}

const HIDDEN_TODAYS_FOCUS_STORAGE_KEY = "amiros.hidden-todays-focus.v1";

function readHiddenTodaysFocus(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const stored = window.sessionStorage.getItem(HIDDEN_TODAYS_FOCUS_STORAGE_KEY);
    const entries: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(entries)
      ? new Set(entries.filter((entry): entry is string => typeof entry === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

export function Overview({ data, chats, intelligence, onNavigate, onOpenUnread, onPreset, onTrackingDecision, onOpenTrackingChat, onOpenNextBestAction, onOpenTodoReview, onTodoStatus, onTodoUpdate, onCalendarStatus, onInsightStatus, onDismissNextBestAction }: OverviewProps) {
  const [deviceTime, setDeviceTime] = useState(() => new Date());
  const [quote] = useState(chooseOverviewQuote);
  const [todoFilter, setTodoFilter] = useState<TodoFilter>("all");
  const [hiddenActionVersion, setHiddenActionVersion] = useState(0);
  const [hiddenTodaysFocus, setHiddenTodaysFocus] = useState<Set<string>>(() => readHiddenTodaysFocus());
  const [actionSummaries, setActionSummaries] = useState<Record<string, string>>(readDashboardActionSummaries);
  const pendingActionSummaries = useRef(new Set<string>());
  const [completingTodoIds, setCompletingTodoIds] = useState<Set<string>>(() => new Set());
  const [todoEditor, setTodoEditor] = useState<(TodoTask & { contactName: string }) | undefined>();
  useEffect(() => {
    const interval = window.setInterval(() => setDeviceTime(new Date()), 1_000);
    return () => window.clearInterval(interval);
  }, []);
  const modeCounts = chats.reduce(
    (counts, chat) => ({ ...counts, [chat.mode]: counts[chat.mode] + 1 }),
    { auto: 0, suggest: 0, off: 0 },
  );
  const totalModeCount = Math.max(chats.length, 1);
  const estimatedCost = data.usage.estimatedCostUsd;
  const budget = data.settings.monthlyBudgetUsd;
  const progress = Math.min(100, (estimatedCost / budget) * 100);
  const formattedCost = estimatedCost < 0.01 ? estimatedCost.toFixed(4) : estimatedCost.toFixed(2);
  const firstName = data.settings.ownerProfile.displayName.trim().split(/\s+/)[0] || "Amir";
  const unreadMessages = chats.reduce((total, chat) => total + Math.max(0, chat.unreadCount), 0);
  const unreadConversations = chats.filter((chat) => chat.unreadCount > 0).length;
  const intelligenceSnapshot = useMemo(() => buildIntelligenceSnapshot(
    intelligence,
    readHiddenIntelligenceActions(),
    deviceTime.getTime(),
  ), [intelligence, deviceTime, hiddenActionVersion]);
  const visibleNeedsReply = intelligenceSnapshot.replies;
  const needsReply = Math.max(visibleNeedsReply.length, data.drafts.length);
  const repliesToday = data.activities.filter((activity) => activity.kind === "text" && sameLocalDay(activity.timestamp, deviceTime)).length;
  const nextEvent = intelligenceSnapshot.upcomingEvents[0];
  const planSuggestions = intelligence?.events.filter((item) => item.status === "inferred" && isKnownIntelligenceContactName(item.contactName)) || [];
  const trackedTodos = useMemo(() => (intelligence?.todos || [])
    .filter((todo) => todo.status === "open" || todo.status === "done")
    .sort((left, right) => {
      const leftDone = left.status === "done" ? 1 : 0;
      const rightDone = right.status === "done" ? 1 : 0;
      if (leftDone !== rightDone) return leftDone - rightDone;
      if (leftDone) return toMilliseconds(right.completedAt || right.updatedAt) - toMilliseconds(left.completedAt || left.updatedAt);
      const leftTime = typeof left.dueAt === "number" ? toMilliseconds(left.dueAt) : toMilliseconds(left.createdAt);
      const rightTime = typeof right.dueAt === "number" ? toMilliseconds(right.dueAt) : toMilliseconds(right.createdAt);
      return leftTime - rightTime;
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
    return (intelligence?.todos || []).filter((todo) => todo.status === "inferred" && !hidden.has(todo.id));
  }, [hiddenActionVersion, intelligence]);
  const newSignals = intelligence?.changes.filter((item) => item.status === "inferred" && isKnownIntelligenceContactName(item.contactName)) || [];
  const trackingRequests = data.knowledgeTrackingRequests.filter((item) => item.status === "pending").slice(0, 3);
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
  const focus = visibleNeedsReply[0]
    ? {
        kind: "Needs reply",
        title: visibleNeedsReply[0].contactName,
        detail: visibleNeedsReply[0].lastIncoming?.content || "A recent message is waiting for you.",
        chatId: visibleNeedsReply[0].chatId,
        contactName: visibleNeedsReply[0].contactName,
        messageId: visibleNeedsReply[0].lastIncoming?.messageId,
        actionType: "reply" as const,
        actionId: replyActionId(visibleNeedsReply[0]),
      }
    : planSuggestions[0]
      ? { kind: "Calendar suggestion", title: compactNextBestText(planSuggestions[0].title, 64), detail: `From ${planSuggestions[0].contactName} · ${eventDateTime(planSuggestions[0].startAt)}`, chatId: planSuggestions[0].chatId, contactName: planSuggestions[0].contactName, messageId: planSuggestions[0].evidence.messageId, actionType: "calendar" as const, actionId: planSuggestions[0].id }
      : suggestedTodos[0]
        ? { kind: "To-do suggestion", title: compactTodoSuggestionTitle(suggestedTodos[0].title), detail: `From ${suggestedTodos[0].contactName} · ${todoTimingLabel(suggestedTodos[0])}`, chatId: suggestedTodos[0].chatId, contactName: suggestedTodos[0].contactName, messageId: suggestedTodos[0].evidence.messageId, actionType: "todo" as const, actionId: suggestedTodos[0].id }
        : newSignals[0]
          ? { kind: "New relationship detail", title: newSignals[0].contactName, detail: compactNextBestText(newSignals[0].content), chatId: newSignals[0].chatId, contactName: newSignals[0].contactName, messageId: newSignals[0].evidence.messageId, actionType: "insight" as const, actionId: newSignals[0].id }
          : undefined;
  const focusChat = focus ? chats.find((chat) => chat.id === focus.chatId) : undefined;

  useEffect(() => {
    if (!focus || focus.actionType !== "reply" || !focus.detail || actionSummaries[focus.actionId] || pendingActionSummaries.current.has(focus.actionId)) return;
    pendingActionSummaries.current.add(focus.actionId);
    void summarizeDashboardActionMessage(focus.detail)
      .then(({ summary }) => {
        const nextSummary = summary.trim();
        if (!nextSummary) return;
        setActionSummaries((current) => {
          if (current[focus.actionId]) return current;
          return saveDashboardActionSummary(focus.actionId, nextSummary);
        });
      })
      .catch(() => undefined)
      .finally(() => pendingActionSummaries.current.delete(focus.actionId));
  }, [actionSummaries, focus]);
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
  const dismissFocus = async () => {
    if (!focus) return;
    if (focus.actionType === "reply" || (focus.actionType === "todo" && focus.kind === "To-do")) {
      hideIntelligenceAction(focus.actionId);
      setHiddenActionVersion((version) => version + 1);
      return;
    }
    await onDismissNextBestAction(focus);
  };
  const applyFocus = async () => {
    if (!focus) return;
    if (focus.actionType === "calendar") {
      await onCalendarStatus(focus.chatId, focus.actionId, { status: "confirmed" });
      return;
    }
    if (focus.actionType === "insight") {
      await onInsightStatus(focus.chatId, focus.actionId, "confirmed");
      return;
    }
    if (focus.actionType === "todo" && focus.kind === "To-do suggestion") {
      await onTodoStatus(focus.chatId, focus.actionId, "open");
      hideIntelligenceAction(focus.actionId);
      setHiddenActionVersion((version) => version + 1);
      return;
    }
    onOpenNextBestAction(focus.chatId, focus.messageId);
  };
  const openTodaysFocus = (item: TodaysFocusItem) => {
    if (item.action === "calendar") {
      onNavigate("calendar");
      return;
    }
    if (item.action === "todo") {
      onOpenTodoReview();
      return;
    }
    onOpenNextBestAction(item.chatId, item.messageId);
  };

  const hideTodaysFocus = (itemId: string) => {
    setHiddenTodaysFocus((current) => {
      if (current.has(itemId)) return current;
      const next = new Set(current);
      next.add(itemId);
      try {
        window.sessionStorage.setItem(HIDDEN_TODAYS_FOCUS_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // Session storage is optional; this view still hides the item immediately.
      }
      return next;
    });
  };
  const removeTodo = async (todo: TodoTask & { contactName: string }) => {
    if (!window.confirm(`Remove “${todo.title}” from your to-do list?`)) return;
    await onTodoStatus(todo.chatId, todo.id, "dismissed");
    if (todoEditor?.id === todo.id) setTodoEditor(undefined);
  };
  return (
    <main className="main-content overview-page">
      <header className="page-header">
        <div>
          <h1>{timeOfDayGreeting(deviceTime)}, {firstName} <span aria-hidden="true">👋</span></h1>
          <figure className="overview-quote"><blockquote>“{quote.text}”</blockquote><figcaption>— {quote.author}</figcaption></figure>
        </div>
        <div className="header-actions">
          <span className={`connection-status ${data.connection.status}`}>
            <span className="connection-brand-lockup"><WhatsAppIcon size={18} /><span className="status-dot" /></span>
            {data.connection.status === "ready" ? "WhatsApp connected" : data.connection.detail}
          </span>
          <time className="overview-current-time" dateTime={deviceTime.toISOString()} aria-label={`Current device time ${formatDeviceClock(deviceTime)}`}><strong>{formatDeviceClock(deviceTime)}</strong><small>Local time</small></time>
        </div>
      </header>

      <section className="overview-reminders-panel todays-focus-panel" aria-labelledby="overview-reminders-title">
        <div className="todays-focus-heading">
          <div className="todays-focus-title-block">
            <span className="todays-focus-title-icon"><Sparkles size={19} /></span>
            <span>
              <span className="todays-focus-title-row">
                <h2 id="overview-reminders-title">Today's Focus</h2>
                {visibleTodaysFocus.length > 0 ? <span className="count-badge intelligence-count">{visibleTodaysFocus.length}</span> : null}
              </span>
              <small>What matters most today</small>
            </span>
          </div>
          {visibleTodaysFocus.length > 4 ? <button className="button compact ghost todays-focus-view-all" type="button" onClick={() => onNavigate("intelligence")}>View all <ArrowRight size={14} /></button> : null}
        </div>
        {visibleTodaysFocus.length > 0 ? <div className={`overview-reminders-list todays-focus-grid todays-focus-grid-${Math.min(visibleTodaysFocus.length, 4)}`}>
          {visibleTodaysFocus.slice(0, 4).map((item) => {
            const actionLabel = item.action === "calendar" ? "Open event" : item.action === "todo" ? "Open task" : item.action === "reply" ? "Reply now" : "Open chat";
            const category = item.priority === 0 ? "Overdue" : item.type === "calendar" ? "Happening today" : item.type === "reply" ? "Waiting for your reply" : "Due today";
            const context = item.contactName ? `${item.detail} · ${item.contactName}` : item.detail;
            const isBirthday = item.action === "calendar" && /birthday/i.test(item.title);
            const isPersonFocus = isBirthday || item.type === "commitment" || item.action === "reply";
            const chat = isPersonFocus ? chats.find((candidate) => candidate.id === item.chatId) : undefined;
            const itemIcon = isBirthday
              ? <CakeSlice size={26} />
              : item.action === "todo"
                ? <ListTodo size={26} />
                : item.action === "calendar"
                  ? <CalendarCheck size={26} />
                  : item.action === "reply"
                    ? <MessageCircle size={26} />
                    : <BellRing size={26} />;
            const openItem = () => openTodaysFocus(item);
            return <article
              className={`overview-reminder todays-focus-item todays-focus-${item.type} ${item.priority === 0 ? "is-overdue" : ""}`}
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
                  hideTodaysFocus(item.id);
                }}
              >
                ×
              </button>
              {isPersonFocus && chat?.avatarUrl
                ? <ContactAvatar name={item.contactName} src={chat.avatarUrl} className="todays-focus-item-avatar" />
                : <span className="todays-focus-item-icon" aria-hidden="true">{itemIcon}</span>}
              <div className="todays-focus-item-copy">
                <small>{category}</small>
                <span className="overview-reminder-copy">
                  <strong dir="auto">{item.title}</strong>
                  <span dir="auto">{context}</span>
                </span>
              </div>
              <button className="button compact ghost todays-focus-action" type="button" onClick={(event) => {
                event.stopPropagation();
                openItem();
              }}>
                {itemIcon}{actionLabel}
              </button>
            </article>;
          })}
        </div> : <div className="overview-agenda-empty todays-focus-empty"><CalendarClock size={28} /><span><strong>You’re all caught up for today.</strong><small>When something needs you, it’ll show up here.</small></span></div>}
      </section>

      <section className="overview-action-strip" aria-label="Today at a glance">
        <button className="overview-action-cell next-event-cell" type="button" onClick={() => onNavigate("calendar")}>
          <span className="overview-action-icon"><CalendarClock size={21} /></span>
          <span className="overview-action-copy">
            <small>Next event</small>
            <strong>{nextEvent?.title || (intelligence ? "No upcoming events" : "Checking your calendar…")}</strong>
            <span>{nextEvent ? `${eventDateTime(nextEvent.startAt)} · From ${nextEvent.contactName}` : "Confirmed plans will appear here"}</span>
          </span>
          <span className="overview-action-link">{nextEvent ? eventCountdown(nextEvent.startAt, deviceTime) : "Calendar"}<ArrowRight size={15} /></span>
        </button>

        <button className="overview-action-cell inbox-pulse-cell" type="button" onClick={onOpenUnread}>
          <span className="overview-action-icon"><MessageCircle size={21} /></span>
          <span className="overview-action-copy">
            <small>Inbox pulse</small>
            <strong>{unreadMessages} unread</strong>
            <span>{needsReply} replies · {unreadConversations} chats</span>
          </span>
          <ArrowRight className="overview-action-arrow" size={15} />
        </button>

        <div className="overview-action-cell amiros-today-cell">
          <span className="overview-action-icon"><Sparkles size={21} /></span>
          <span className="overview-action-copy">
            <small>AI usage / model</small>
            <strong>{data.models.text}</strong>
            <span>${formattedCost} today · {repliesToday} {repliesToday === 1 ? "reply" : "replies"} sent</span>
          </span>
          <select className="overview-model-preset" aria-label="Overview model preset" value={data.preset} onChange={(event) => void onPreset(event.target.value as ModelPreset)}><option value="economy">Economy</option><option value="balanced">Balanced</option><option value="quality">Quality</option></select>
        </div>
      </section>

      {trackingRequests.length > 0 ? <section className="panel tracking-review-panel" aria-labelledby="tracking-review-title">
        <div className="panel-heading">
          <h2 id="tracking-review-title"><Brain size={19} /> New chats awaiting approval <span className="count-badge intelligence-count">{trackingRequests.length}</span></h2>
          <span className="tracking-review-note">Nothing is analyzed until you choose.</span>
        </div>
        <div className="tracking-review-list">
          {trackingRequests.map((request) => {
            const chat = chats.find((item) => item.id === request.chatId);
            return <article className="tracking-review-row" key={request.chatId}>
              <button className="tracking-review-copy" type="button" onClick={() => onOpenTrackingChat(request.chatId)}>
                <ContactAvatar name={request.contactName} src={chat?.avatarUrl} className="tracking-review-avatar" />
                <span><strong dir="auto">{request.contactName}</strong><small>{request.isGroup ? "Group chat" : "Private chat"} · {request.messageCount} new {request.messageCount === 1 ? "message" : "messages"}</small><p dir="auto">{request.preview}</p></span>
                <ArrowRight size={15} />
              </button>
              <div className="tracking-review-actions">
                <button className="button compact primary" type="button" onClick={() => void onTrackingDecision(request.chatId, "enabled")}>Track this chat</button>
                <button className="button compact ghost" type="button" onClick={() => void onTrackingDecision(request.chatId, "snoozed")}>Not now</button>
                <button className="text-action muted" type="button" onClick={() => void onTrackingDecision(request.chatId, "disabled")}>Never track</button>
              </div>
            </article>;
          })}
        </div>
      </section> : null}

      <div className="overview-primary-grid">
        <div className="overview-agenda-pair">
          <section className="panel intelligence-snapshot-panel overview-today-agenda-panel" aria-labelledby="overview-agenda-title">
            <div className="panel-heading">
              <h2 id="overview-agenda-title"><CalendarCheck size={19} /> Agenda {todaysAgenda.length > 0 ? <span className="count-badge intelligence-count">{todaysAgenda.length}</span> : null}</h2>
              <span className="overview-agenda-today">Today</span>
            </div>
            {todaysAgenda.length > 0 ? <div className="overview-today-agenda">
              {todaysAgenda.map((event, index) => {
                const startAt = toMilliseconds(event.startAt);
                const details = [event.contactName, event.location].filter(Boolean).join(" · ") || "Confirmed event";
                return <button className="overview-timeline-event" type="button" key={event.id} onClick={() => onNavigate("calendar")}>
                  <time dateTime={new Date(startAt).toISOString()}>{event.allDay ? "All day" : formatTime(startAt)}</time>
                  <span className="overview-timeline-rail" aria-hidden="true"><span className={`overview-timeline-marker marker-${index % 4}`} /></span>
                  <span className="overview-timeline-copy"><strong dir="auto">{event.title}</strong><small dir="auto">{details}</small></span>
                  <ArrowRight size={15} />
                </button>;
              })}
            </div> : <div className="overview-agenda-empty overview-today-agenda-empty"><CalendarDays size={22} /><span><strong>Your day is clear.</strong><small>Nothing is scheduled for today yet.</small></span></div>}
            <footer className="overview-today-agenda-footer"><button className="text-button" type="button" onClick={() => onNavigate("calendar")}>View full agenda <ArrowRight size={15} /></button></footer>
          </section>

          <section className="panel overview-todos-panel" aria-labelledby="overview-todo-list-title">
            <div className="panel-heading">
              <h2 id="overview-todo-list-title"><ListTodo size={19} /> To-dos <span className="count-badge intelligence-count">{todoCounts.open}</span></h2>
              <button className="text-button" type="button" onClick={onOpenTodoReview}>View tasks <ArrowRight size={14} /></button>
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
            </div> : <div className="overview-agenda-empty overview-todo-filter-empty"><ListTodo size={19} /><span><strong>No {todoFilter === "completed" ? "completed" : "open"} to-dos</strong><small>Try another filter to see saved tasks.</small></span></div>}
            </> : suggestedTodos.length > 0 ? <div className="overview-agenda-empty"><ListTodo size={19} /><span><strong>{suggestedTodos.length} task {suggestedTodos.length === 1 ? "suggestion" : "suggestions"} waiting</strong><small>Review a message before it becomes a to-do.</small></span></div> : <div className="overview-agenda-empty"><ListTodo size={19} /><span><strong>No to-dos yet</strong><small>Actionable messages will appear here for review.</small></span></div>}
          </section>
        </div>

        <div className="overview-command-rail">
          <section className="panel next-best-panel">
            <div className="panel-heading"><h2>Next best action</h2><span className={focus ? "attention-label" : "attention-label clear"}>{focus ? "Priority" : "All clear"}</span></div>
            {focus ? <div className="intelligence-focus next-best-focus">
              <ContactAvatar name={focus.contactName} src={focusChat?.avatarUrl} className="intelligence-focus-avatar" />
              <button className="next-best-focus-copy" type="button" onClick={() => onOpenNextBestAction(focus.chatId, focus.messageId)}>
                <small>{focus.kind}</small><strong dir="auto">{focus.title}</strong><p dir="auto">{focus.actionType === "reply" ? actionSummaries[focus.actionId] || focus.detail : focus.detail}</p>
              </button>
              <span className="next-best-focus-actions">
                <button className="next-best-action-control primary" type="button" title={focus.actionType === "reply" ? "Reply in chat" : focus.actionType === "calendar" ? "Add to calendar" : focus.actionType === "todo" ? "Add to to-do list" : "Confirm detail"} aria-label={focus.actionType === "reply" ? "Reply in chat" : focus.actionType === "calendar" ? "Add to calendar" : focus.actionType === "todo" ? "Add to to-do list" : "Confirm detail"} onClick={() => void applyFocus()}>
                  {focus.actionType === "reply" ? <MessageCircle size={16} /> : focus.actionType === "calendar" ? <CalendarCheck size={16} /> : focus.actionType === "todo" && focus.kind === "To-do suggestion" ? <Check size={16} /> : focus.actionType === "todo" ? <ListTodo size={16} /> : <Brain size={16} />}
                </button>
                {focus.actionType !== "reply" ? <button className="next-best-action-control" type="button" title="Open source message" aria-label="Open source message" onClick={() => onOpenNextBestAction(focus.chatId, focus.messageId)}><ExternalLink size={16} /></button> : null}
                <button className="next-best-action-control dismiss" type="button" title="Dismiss action" aria-label="Dismiss action" onClick={() => void dismissFocus()}><X size={16} /></button>
              </span>
            </div> : <div className="intelligence-focus caught-up" role="status"><span className="intelligence-focus-symbol"><Sparkles size={19} /></span><span><small>Current status</small><strong>You’re caught up</strong><p>AmirOS will surface the next useful action here.</p></span></div>}
          </section>

          <section className="panel activity-panel">
            <div className="panel-heading"><h2>Recent activity</h2><small>Live</small></div>
            <div className="activity-list">
              {data.activities.slice(0, 3).map((activity) => (
                <div className="activity-row" key={activity.id}>
                  <span className="activity-symbol">{activityIcon(activity.kind)}</span>
                  <span className="activity-line" />
                  <span className="row-copy"><strong>{activity.title}</strong><small>{activity.detail}</small></span>
                  <time>{formatTime(activity.timestamp)}</time>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <div className="overview-secondary-grid">
        <section className="panel metric-panel">
          <h2>Current session</h2>
          <div className="spend-line">
            <strong>${formattedCost}</strong>
            <span>of ${budget} monthly target</span>
          </div>
          <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
          <p>{compactNumber(data.usage.inputTokens + data.usage.outputTokens)} text tokens · {data.preset} preset</p>
          <button className="text-button panel-link" onClick={() => onNavigate("usage")}>View usage details <ArrowRight size={16} /></button>
        </section>

        <section className="panel modes-panel">
          <h2>Reply modes</h2>
          {(["auto", "suggest", "off"] as const).map((mode) => (
            <div className="mode-row" key={mode}>
              <span className={`mode-icon ${mode}`}>{mode === "auto" ? <Bot size={17} /> : mode === "suggest" ? <PencilLine size={17} /> : <Pause size={17} />}</span>
              <span className="row-copy"><strong className="capitalize">{mode}</strong><small>{mode === "auto" ? "Replies sent automatically" : mode === "suggest" ? "Suggestions for review" : "Trigger-only contacts"}</small></span>
              <strong>{modeCounts[mode]}</strong>
              <span className={`mode-percent ${mode}`}>{Math.round((modeCounts[mode] / totalModeCount) * 100)}%</span>
            </div>
          ))}
          <button className="text-button panel-link" onClick={() => onNavigate("contacts")}>Manage modes <ArrowRight size={16} /></button>
        </section>

        <section className="panel quick-panel">
          <h2>Quick actions</h2>
          <button className="quick-action" onClick={() => onNavigate("automations")}><span><Plus size={21} /><span><strong>New rule</strong><small>Create an automation rule</small></span></span><ArrowRight size={18} /></button>
          <button className="quick-action" onClick={() => onNavigate("inbox")}><span><MessageCircle size={21} /><span><strong>Open inbox</strong><small>Review conversations</small></span></span><ArrowRight size={18} /></button>
          <button className="quick-action" onClick={() => onNavigate("usage")}><span><CircleDollarSign size={21} /><span><strong>Cost controls</strong><small>Review model usage</small></span></span><ArrowRight size={18} /></button>
        </section>
      </div>
      {todoEditor ? <TodoEditorDialog todo={todoEditor} onClose={() => setTodoEditor(undefined)} onSave={(patch) => onTodoUpdate(todoEditor.chatId, todoEditor.id, patch)} /> : null}
    </main>
  );
}
