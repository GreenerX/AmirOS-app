import {
  ArrowRight,
  Bot,
  Brain,
  CalendarDays,
  CalendarCheck,
  CalendarClock,
  Check,
  CircleDollarSign,
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
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { compactNumber, formatDeviceClock, formatTime, timeOfDayGreeting } from "../format";
import { readHiddenIntelligenceActions } from "../intelligence-visibility";
import { buildIntelligenceSnapshot, isKnownIntelligenceContactName } from "../intelligence-snapshot";
import type { Activity, ChatSummary, DashboardData, IntelligenceData, KnowledgeTrackingStatus, ModelPreset, TodoTask, ViewName } from "../types";
import { WhatsAppIcon } from "./BrandIcons";
import { ContactAvatar } from "./ContactAvatar";

type OverviewProps = {
  data: DashboardData;
  chats: ChatSummary[];
  intelligence?: IntelligenceData;
  onNavigate: (view: ViewName) => void;
  onOpenUnread: () => void;
  onPreset: (preset: ModelPreset) => Promise<void>;
  onTrackingDecision: (chatId: string, status: KnowledgeTrackingStatus) => Promise<void>;
  onOpenTrackingChat: (chatId: string) => void;
  onOpenTodoReview: () => void;
  onTodoStatus: (chatId: string, todoId: string, status: TodoTask["status"]) => Promise<void>;
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

export function Overview({ data, chats, intelligence, onNavigate, onOpenUnread, onPreset, onTrackingDecision, onOpenTrackingChat, onOpenTodoReview, onTodoStatus }: OverviewProps) {
  const [deviceTime, setDeviceTime] = useState(() => new Date());
  const [quote] = useState(chooseOverviewQuote);
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
  ), [intelligence, deviceTime]);
  const visibleNeedsReply = intelligenceSnapshot.replies;
  const needsReply = Math.max(visibleNeedsReply.length, data.drafts.length);
  const repliesToday = data.activities.filter((activity) => activity.kind === "text" && sameLocalDay(activity.timestamp, deviceTime)).length;
  const nextEvent = intelligenceSnapshot.upcomingEvents[0];
  const planSuggestions = intelligence?.events.filter((item) => item.status === "inferred" && isKnownIntelligenceContactName(item.contactName)) || [];
  const upcomingPlans = intelligenceSnapshot.upcomingEvents;
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
  const suggestedTodos = useMemo(() => (intelligence?.todos || [])
    .filter((todo) => todo.status === "inferred"), [intelligence]);
  const newSignals = intelligence?.changes.filter((item) => item.status === "inferred" && isKnownIntelligenceContactName(item.contactName)) || [];
  const confirmedDetails = intelligenceSnapshot.details;
  const understoodRelationships = intelligenceSnapshot.relationships;
  const trackingRequests = data.knowledgeTrackingRequests.filter((item) => item.status === "pending").slice(0, 3);
  const agendaItemCount = upcomingPlans.length + trackedTodos.length + suggestedTodos.length;
  const focus = visibleNeedsReply[0]
    ? {
        kind: "Needs reply",
        title: visibleNeedsReply[0].contactName,
        detail: visibleNeedsReply[0].lastIncoming?.content || "A recent message is waiting for you.",
        chatId: visibleNeedsReply[0].chatId,
        contactName: visibleNeedsReply[0].contactName,
      }
    : planSuggestions[0]
      ? { kind: "Calendar suggestion", title: planSuggestions[0].title, detail: `From ${planSuggestions[0].contactName} · ${eventDateTime(planSuggestions[0].startAt)}`, chatId: planSuggestions[0].chatId, contactName: planSuggestions[0].contactName }
      : suggestedTodos[0]
        ? { kind: "To-do suggestion", title: suggestedTodos[0].title, detail: `From ${suggestedTodos[0].contactName} · ${todoTimingLabel(suggestedTodos[0])}`, chatId: suggestedTodos[0].chatId, contactName: suggestedTodos[0].contactName }
        : trackedTodos.find((todo) => todo.status === "open")
          ? (() => { const todo = trackedTodos.find((item) => item.status === "open")!; return { kind: "To-do", title: todo.title, detail: `From ${todo.contactName} · ${todoTimingLabel(todo)}`, chatId: todo.chatId, contactName: todo.contactName }; })()
          : newSignals[0]
            ? { kind: "New relationship detail", title: newSignals[0].contactName, detail: newSignals[0].content, chatId: newSignals[0].chatId, contactName: newSignals[0].contactName }
            : undefined;
  const focusChat = focus ? chats.find((chat) => chat.id === focus.chatId) : undefined;
  const [completingTodoIds, setCompletingTodoIds] = useState<Set<string>>(() => new Set());
  const completeTodo = async (todo: TodoTask) => {
    if (todo.status === "done") return;
    setCompletingTodoIds((current) => new Set(current).add(todo.id));
    try {
      await Promise.all([
        onTodoStatus(todo.chatId, todo.id, "done"),
        new Promise<void>((resolve) => window.setTimeout(resolve, 330)),
      ]);
    } finally {
      setCompletingTodoIds((current) => {
        const next = new Set(current);
        next.delete(todo.id);
        return next;
      });
    }
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
          <select aria-label="Overview model preset" value={data.preset} onChange={(event) => void onPreset(event.target.value as ModelPreset)}><option value="economy">Economy</option><option value="balanced">Balanced</option><option value="quality">Quality</option></select>
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
        <section className="panel intelligence-snapshot-panel">
          <div className="panel-heading">
            <h2><CalendarCheck size={19} /> Your agenda <span className="count-badge intelligence-count">{agendaItemCount}</span></h2>
            <button className="text-button" onClick={() => onNavigate("intelligence")}>Open Intelligence <ArrowRight size={16} /></button>
          </div>
          <div className="intelligence-snapshot-body">
            <div className="intelligence-snapshot-metrics" aria-label="Intelligence totals">
              <span><Users size={16} /><strong>{understoodRelationships}</strong><small>relationships understood</small></span>
              <span><Sparkles size={16} /><strong>{confirmedDetails}</strong><small>confirmed details</small></span>
              <span><MessageCircle size={16} /><strong>{visibleNeedsReply.length}</strong><small>replies due</small></span>
              <span><CalendarCheck size={16} /><strong>{upcomingPlans.length}</strong><small>upcoming events</small></span>
            </div>
            <div className="overview-agenda-columns">
              <section className="overview-agenda-column overview-agenda-events" aria-labelledby="overview-upcoming-events-title">
                <header>
                  <span><CalendarDays size={17} /><span><small>Calendar</small><h3 id="overview-upcoming-events-title">Upcoming events</h3></span></span>
                  <button className="text-button" type="button" onClick={() => onNavigate("calendar")}>View calendar <ArrowRight size={14} /></button>
                </header>
                {upcomingPlans.length > 0 ? <div className="overview-agenda-list">
                  {upcomingPlans.slice(0, 4).map((event) => <button className="overview-agenda-item" type="button" key={event.id} onClick={() => onNavigate("calendar")}>
                    <span className="overview-agenda-item-icon"><CalendarCheck size={15} /></span>
                    <span><strong dir="auto">{event.title}</strong><small>{eventDateTime(toMilliseconds(event.startAt))} · {event.contactName}</small></span>
                    <ArrowRight size={14} />
                  </button>)}
                </div> : <div className="overview-agenda-empty"><CalendarDays size={19} /><span><strong>No upcoming events</strong><small>Confirmed plans will appear here.</small></span></div>}
              </section>

              <section className="overview-agenda-column overview-agenda-todos" aria-labelledby="overview-todo-list-title">
                <header>
                  <span><ListTodo size={17} /><span><small>Tasks</small><h3 id="overview-todo-list-title">To-do list</h3></span></span>
                  <button className="text-button" type="button" onClick={onOpenTodoReview}>{suggestedTodos.length > 0 ? `Review ${suggestedTodos.length}` : "View tasks"} <ArrowRight size={14} /></button>
                </header>
                {trackedTodos.length > 0 ? <div className="overview-agenda-list">
                  {trackedTodos.map((todo) => <div className={`overview-agenda-todo-row ${todo.status === "done" ? "is-completed" : ""} ${completingTodoIds.has(todo.id) ? "is-completing" : ""}`} key={todo.id}>
                    <button className="overview-todo-check" type="button" aria-label={todo.status === "done" ? `${todo.title} is complete` : `Mark ${todo.title} as complete`} disabled={todo.status === "done"} onClick={() => void completeTodo(todo)}><Check size={16} /></button>
                    <button className="overview-agenda-item" type="button" onClick={onOpenTodoReview}>
                      <span><strong dir="auto">{todo.title}</strong><small>{todo.status === "done" ? `Completed ${eventDateTime(toMilliseconds(todo.completedAt || todo.updatedAt))}` : typeof todo.dueAt === "number" && Number.isFinite(todo.dueAt) ? todoTimingLabel(todo) : `Added ${eventDateTime(toMilliseconds(todo.createdAt))}`}</small></span>
                      <ArrowRight size={14} />
                    </button>
                  </div>)}
                </div> : suggestedTodos.length > 0 ? <div className="overview-agenda-empty"><ListTodo size={19} /><span><strong>{suggestedTodos.length} task {suggestedTodos.length === 1 ? "suggestion" : "suggestions"} waiting</strong><small>Review a message before it becomes a to-do.</small></span></div> : <div className="overview-agenda-empty"><ListTodo size={19} /><span><strong>No to-dos yet</strong><small>Actionable messages will appear here for review.</small></span></div>}
              </section>
            </div>
          </div>
        </section>

        <div className="overview-command-rail">
          <section className="panel next-best-panel">
            <div className="panel-heading"><h2>Next best action</h2><span className={focus ? "attention-label" : "attention-label clear"}>{focus ? "Priority" : "All clear"}</span></div>
            {focus ? <button className="intelligence-focus" onClick={() => onNavigate("intelligence")}>
              <ContactAvatar name={focus.contactName} src={focusChat?.avatarUrl} className="intelligence-focus-avatar" />
              <span><small>{focus.kind}</small><strong dir="auto">{focus.title}</strong><p dir="auto">{focus.detail}</p></span>
              <span className="intelligence-focus-link">Review <ArrowRight size={14} /></span>
            </button> : <button className="intelligence-focus caught-up" onClick={() => onNavigate("intelligence")}><span className="intelligence-focus-symbol"><Sparkles size={19} /></span><span><small>Current status</small><strong>You’re caught up</strong><p>AmirOS will surface the next useful action here.</p></span><ArrowRight size={15} /></button>}
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
    </main>
  );
}
