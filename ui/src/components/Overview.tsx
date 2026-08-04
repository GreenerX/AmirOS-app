import {
  ArrowRight,
  Bot,
  Brain,
  CalendarCheck,
  CalendarClock,
  CircleDollarSign,
  Image,
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
import type { Activity, ChatSummary, DashboardData, IntelligenceData, ModelPreset, ViewName } from "../types";
import { WhatsAppIcon } from "./BrandIcons";
import { ContactAvatar } from "./ContactAvatar";

type OverviewProps = {
  data: DashboardData;
  chats: ChatSummary[];
  intelligence?: IntelligenceData;
  onNavigate: (view: ViewName) => void;
  onOpenUnread: () => void;
  onPreset: (preset: ModelPreset) => Promise<void>;
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

export function Overview({ data, chats, intelligence, onNavigate, onOpenUnread, onPreset }: OverviewProps) {
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
  const openPromises = intelligence?.commitments.filter((item) => item.status === "open" && isKnownIntelligenceContactName(item.contactName)) || [];
  const planSuggestions = intelligence?.events.filter((item) => item.status === "inferred" && isKnownIntelligenceContactName(item.contactName)) || [];
  const upcomingPlans = intelligenceSnapshot.upcomingEvents;
  const newSignals = intelligence?.changes.filter((item) => item.status === "inferred" && isKnownIntelligenceContactName(item.contactName)) || [];
  const confirmedDetails = intelligenceSnapshot.details;
  const understoodRelationships = intelligenceSnapshot.relationships;
  const confirmedKnowledgeHighlights = intelligenceSnapshot.confirmedKnowledge.slice(0, 3);
  const intelligenceAttention = visibleNeedsReply.length + openPromises.length + planSuggestions.length + newSignals.length;
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
      : openPromises[0]
        ? { kind: "Open promise", title: openPromises[0].contactName, detail: openPromises[0].content, chatId: openPromises[0].chatId, contactName: openPromises[0].contactName }
        : newSignals[0]
          ? { kind: "New relationship detail", title: newSignals[0].contactName, detail: newSignals[0].content, chatId: newSignals[0].chatId, contactName: newSignals[0].contactName }
          : undefined;
  const focusChat = focus ? chats.find((chat) => chat.id === focus.chatId) : undefined;

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

      <div className="overview-primary-grid">
        <section className="panel intelligence-snapshot-panel">
          <div className="panel-heading">
            <h2><Brain size={19} /> Intelligence snapshot <span className="count-badge intelligence-count">{intelligenceAttention}</span></h2>
            <button className="text-button" onClick={() => onNavigate("intelligence")}>Open Intelligence <ArrowRight size={16} /></button>
          </div>
          <div className="intelligence-snapshot-body">
            <div className="intelligence-snapshot-metrics" aria-label="Intelligence totals">
              <span><Users size={16} /><strong>{understoodRelationships}</strong><small>relationships understood</small></span>
              <span><Sparkles size={16} /><strong>{confirmedDetails}</strong><small>confirmed details</small></span>
              <span><MessageCircle size={16} /><strong>{visibleNeedsReply.length}</strong><small>replies due</small></span>
              <span><CalendarCheck size={16} /><strong>{upcomingPlans.length}</strong><small>upcoming events</small></span>
            </div>
            <div className="intelligence-knowledge-highlights">
              {confirmedKnowledgeHighlights.map((detail, index) => <button className="intelligence-confirmed-detail" key={detail.id} onClick={() => onNavigate("intelligence")}>
                <span className="intelligence-confirmed-icon"><Sparkles size={16} /></span>
                <span><small>{index === 0 ? "Latest confirmed knowledge" : "Confirmed knowledge"}</small><strong dir="auto">{detail.contactName}</strong><p dir="auto">{detail.content}</p></span>
                <ArrowRight size={14} />
              </button>)}
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
