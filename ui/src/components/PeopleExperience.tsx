import {
  ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, Clock3, ListTodo,
  Eye, EyeOff, Heart, MessageCircle, RefreshCw, Search, Sparkles, Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { ChatSummary, ContactPreferences, IntelligenceChat, IntelligenceData, RelationshipCommitment, TodoTask } from "../types";
import { isKnownIntelligenceContactName } from "../intelligence-snapshot";
import { profileSummaryParagraph } from "../profile-summary";
import { ContactAvatar } from "./ContactAvatar";

type PeopleFilter = "all" | "favorites" | "waiting" | "upcoming" | "recent" | "hidden" | "family" | "friends" | "work" | "groups";
type TimelineItem = { id: string; label: string; content: string; timestamp: number };

type PeopleExperienceProps = {
  data?: IntelligenceData;
  chats: ChatSummary[];
  contacts: Record<string, ContactPreferences>;
  ownerName: string;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onOpenChat: (chatId: string, messageId?: string) => void;
  onOpenCalendar: () => void;
  onContactChange: (chatId: string, patch: Partial<ContactPreferences>) => Promise<boolean>;
  onGenerateSummary: (chatId: string, isGroup: boolean) => Promise<void>;
};

const RELATIONSHIP_OPTIONS = [
  "Contact", "Partner", "Family", "Friend", "Close friend", "Client", "Colleague", "Manager", "Team", "Neighbor", "Other",
];
const GROUP_RELATIONSHIP_OPTIONS = ["Group", "Friends group", "Family group", "Work group", "Community group", "Other group"];

function toMilliseconds(value: number) {
  return value < 10_000_000_000 ? value * 1_000 : value;
}

function relativeTime(value: number) {
  const delta = Date.now() - toMilliseconds(value);
  const minutes = Math.max(1, Math.round(Math.abs(delta) / 60_000));
  if (minutes < 60) return `${minutes}m ${delta >= 0 ? "ago" : "from now"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ${delta >= 0 ? "ago" : "from now"}`;
  return `${Math.round(hours / 24)}d ${delta >= 0 ? "ago" : "from now"}`;
}

function shortDate(value: number) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(toMilliseconds(value)));
}

function relationshipLabel(person: IntelligenceChat, preferences?: ContactPreferences) {
  return preferences?.relationship?.trim() || (person.isGroup ? "Group" : "Contact");
}

function normalizedName(value: string) {
  return value.replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}

export function isOwnerContact(person: IntelligenceChat, ownerName: string) {
  const owner = normalizedName(ownerName);
  return Boolean(owner && normalizedName(person.contactName) === owner);
}

function relationshipSummarySource(summary: string) {
  const lines = summary.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const relationshipStart = lines.findIndex((line) => /^(?:relationship|group purpose (?:&|and) relationship):?$/iu.test(line));
  if (relationshipStart < 0) return summary;
  const section = lines.slice(relationshipStart + 1);
  const nextHeading = section.findIndex((line) => /^(?:communication|personality|preferences|decisions|helpful|uncertainties)\b/iu.test(line));
  return section.slice(0, nextHeading < 0 ? undefined : nextHeading).join("\n");
}

function summarySentences(summary: string) {
  return (summary.match(/[^.!?]+(?:[.!?]+|$)/gu) || [])
    .map((sentence) => sentence.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
}

function isRelationshipSentence(sentence: string) {
  return /\b(?:relationship|friend|family|partner|spouse|husband|wife|parent|mother|father|brother|sister|cousin|aunt|uncle|colleague|coworker|client|manager|team|group|work|talk|connect|coordinate|support|share|close|know)\b/iu.test(sentence);
}

function compactSentences(sentences: string[]) {
  const selected: string[] = [];
  for (const sentence of sentences) {
    if (selected.length === 3) break;
    const next = [...selected, sentence].join(" ");
    if (selected.length && next.length > 180) break;
    selected.push(sentence);
  }
  return selected;
}

/** Uses existing relationship knowledge only; profile preferences do not fill People cards. */
export function personSummary(person: IntelligenceChat, ownerName: string) {
  const record = person.isGroup ? person.groupSummary : person.profile;
  if (!record?.summary) return "No relationship summary yet.";

  const owner = normalizedName(ownerName);
  const candidates = summarySentences(profileSummaryParagraph(
    relationshipSummarySource(record.summary),
    person.contactName,
  )).filter((sentence) => {
    const normalizedSentence = normalizedName(sentence);
    return !owner || !normalizedSentence.startsWith(owner);
  });
  const relationshipOnly = candidates.filter(isRelationshipSentence);
  const selected = compactSentences(relationshipOnly.length ? relationshipOnly : candidates);
  return selected.join(" ") || "No relationship summary yet.";
}

function interactionTimestamp(person: IntelligenceChat, chat?: ChatSummary) {
  return toMilliseconds(chat?.timestamp || person.lastIncoming?.timestamp || person.updatedAt);
}

function summaryRecordFor(person: IntelligenceChat) {
  return person.isGroup ? person.groupSummary : person.profile;
}

function summaryNeedsRefresh(person: IntelligenceChat) {
  const summary = summaryRecordFor(person);
  return !summary?.summary.trim() || toMilliseconds(person.updatedAt) > toMilliseconds(summary.updatedAt) + 1_000;
}

function relationshipOptions(person: IntelligenceChat, current: string) {
  const base = person.isGroup ? GROUP_RELATIONSHIP_OPTIONS : RELATIONSHIP_OPTIONS;
  return base.includes(current) ? base : [current, ...base];
}

function categoryFor(person: IntelligenceChat, preferences?: ContactPreferences): PeopleFilter {
  if (person.isGroup) return "groups";
  const relationship = relationshipLabel(person, preferences).toLocaleLowerCase();
  if (/family|parent|mother|father|mom|dad|sister|brother|cousin|aunt|uncle/.test(relationship)) return "family";
  if (/work|colleague|coworker|client|manager|team/.test(relationship)) return "work";
  return "friends";
}

function openCommitments(person: IntelligenceChat) {
  return person.commitments.filter((item) => item.status === "open");
}

function hasWaiting(person: IntelligenceChat) {
  return person.needsReply || openCommitments(person).length > 0;
}

function confirmedUpcomingPlans(person: IntelligenceChat) {
  const now = Date.now();
  return person.events
    .filter((item) => item.status === "confirmed" && toMilliseconds(item.startAt) >= now)
    .sort((left, right) => toMilliseconds(left.startAt) - toMilliseconds(right.startAt));
}

function openTodos(person: IntelligenceChat, todos: TodoTask[]) {
  return todos
    .filter((item) => item.chatId === person.chatId && item.status === "open")
    .sort((left, right) => toMilliseconds(left.dueAt || left.updatedAt) - toMilliseconds(right.dueAt || right.updatedAt));
}

function commitmentOwnerLabel(commitment: RelationshipCommitment) {
  return commitment.owner === "me" ? "Waiting on you" : "Waiting on them";
}

function SectionEmpty({ children }: { children: string }) {
  return <p className="people-section-empty">{children}</p>;
}

function QuickViewCard({
  icon: Icon,
  label,
  description,
  people,
  chats,
  active = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  description: string;
  people: IntelligenceChat[];
  chats: Map<string, ChatSummary>;
  active?: boolean;
  onClick: () => void;
}) {
  return <button type="button" className={`people-quick-view ${active ? "active" : ""}`} aria-pressed={active} onClick={onClick}>
    <span className="people-quick-view-icon"><Icon size={21} /></span>
    <span className="people-quick-view-copy"><strong>{label}</strong><small>{description}</small></span>
    <span className="people-quick-view-preview">{people.length ? people.slice(0, 3).map((person, index) => <span key={person.chatId}><ContactAvatar name={person.contactName} src={chats.get(person.chatId)?.avatarUrl} tone={index} /><small>{person.contactName.split(/\s+/u)[0]}</small></span>) : <small>No people yet</small>}</span>
  </button>;
}

export function PeopleExperience({ data, chats, contacts, ownerName, loading, onRefresh, onOpenChat, onOpenCalendar, onContactChange, onGenerateSummary }: PeopleExperienceProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PeopleFilter>("all");
  const [selectedChatId, setSelectedChatId] = useState<string>();
  const [summaryBusyChatId, setSummaryBusyChatId] = useState<string>();
  const chatById = useMemo(() => new Map(chats.map((chat) => [chat.id, chat])), [chats]);
  const everyone = useMemo(
    () => (data?.chats || []).filter((person) => (
      isKnownIntelligenceContactName(person.contactName) && !isOwnerContact(person, ownerName)
    )),
    [data?.chats, ownerName],
  );
  const allTodos = data?.todos || [];
  const activePeople = useMemo(
    () => everyone.filter((person) => !contacts[person.chatId]?.hidden),
    [contacts, everyone],
  );
  const favoritePeople = useMemo(
    () => activePeople.filter((person) => contacts[person.chatId]?.pinned),
    [activePeople, contacts],
  );
  const waitingPeople = useMemo(
    () => activePeople.filter(hasWaiting),
    [activePeople],
  );
  const upcomingPeople = useMemo(
    () => activePeople.filter((person) => confirmedUpcomingPlans(person).length > 0)
      .sort((left, right) => toMilliseconds(confirmedUpcomingPlans(left)[0].startAt) - toMilliseconds(confirmedUpcomingPlans(right)[0].startAt)),
    [activePeople],
  );
  const recentlyActivePeople = useMemo(
    () => [...activePeople].sort((left, right) => interactionTimestamp(right, chatById.get(right.chatId)) - interactionTimestamp(left, chatById.get(left.chatId))),
    [activePeople, chatById],
  );
  const hiddenPeople = useMemo(
    () => everyone.filter((person) => contacts[person.chatId]?.hidden),
    [contacts, everyone],
  );
  const visiblePeople = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return [...everyone]
      .filter((person) => (
        filter === "hidden"
          ? Boolean(contacts[person.chatId]?.hidden)
          : !contacts[person.chatId]?.hidden
            && (filter === "all"
        || (filter === "favorites" && Boolean(contacts[person.chatId]?.pinned))
        || (filter === "waiting" && hasWaiting(person))
        || (filter === "upcoming" && confirmedUpcomingPlans(person).length > 0)
        || (filter === "recent" && interactionTimestamp(person, chatById.get(person.chatId)) >= Date.now() - 30 * 24 * 60 * 60 * 1_000)
        || categoryFor(person, contacts[person.chatId]) === filter
            )
      ))
      .filter((person) => !normalizedQuery || `${person.contactName} ${relationshipLabel(person, contacts[person.chatId])}`.toLocaleLowerCase().includes(normalizedQuery))
      .sort((left, right) => {
        const pinDifference = Number(Boolean(contacts[right.chatId]?.pinned)) - Number(Boolean(contacts[left.chatId]?.pinned));
        return pinDifference || interactionTimestamp(right, chatById.get(right.chatId)) - interactionTimestamp(left, chatById.get(left.chatId));
      });
  }, [chatById, contacts, everyone, filter, query]);
  const selectedPerson = everyone.find((person) => person.chatId === selectedChatId);
  const filterCounts = useMemo(() => ({
    all: activePeople.length,
    favorites: favoritePeople.length,
    waiting: waitingPeople.length,
    upcoming: upcomingPeople.length,
    recent: recentlyActivePeople.length,
    hidden: hiddenPeople.length,
    family: activePeople.filter((person) => categoryFor(person, contacts[person.chatId]) === "family").length,
    friends: activePeople.filter((person) => categoryFor(person, contacts[person.chatId]) === "friends").length,
    work: activePeople.filter((person) => categoryFor(person, contacts[person.chatId]) === "work").length,
    groups: activePeople.filter((person) => categoryFor(person, contacts[person.chatId]) === "groups").length,
  }), [activePeople, contacts, favoritePeople.length, hiddenPeople.length, recentlyActivePeople.length, upcomingPeople.length, waitingPeople.length]);

  const generatePersonSummary = async (person: IntelligenceChat) => {
    setSummaryBusyChatId(person.chatId);
    try {
      await onGenerateSummary(person.chatId, person.isGroup);
      await onRefresh();
    } finally {
      setSummaryBusyChatId(undefined);
    }
  };

  if (selectedPerson) {
    const preferences = contacts[selectedPerson.chatId];
    const chat = chatById.get(selectedPerson.chatId);
    const plans = confirmedUpcomingPlans(selectedPerson);
    const commitments = openCommitments(selectedPerson);
    const todos = openTodos(selectedPerson, allTodos);
    const waitingOnMe = commitments.filter((item) => item.owner === "me");
    const waitingOnThem = commitments.filter((item) => item.owner !== "me");
    const topics = selectedPerson.insights.filter((item) => item.status === "confirmed")
      .sort((left, right) => toMilliseconds(right.updatedAt) - toMilliseconds(left.updatedAt));
    const timeline: TimelineItem[] = [
      selectedPerson.lastIncoming ? { id: `message:${selectedPerson.lastIncoming.messageId || selectedPerson.lastIncoming.timestamp}`, label: "Recent message", content: selectedPerson.lastIncoming.content || "Message received", timestamp: selectedPerson.lastIncoming.timestamp } : undefined,
      ...plans.map((item) => ({ id: `event:${item.id}`, label: "Upcoming plan", content: item.title, timestamp: item.startAt })),
      ...commitments.map((item) => ({ id: `commitment:${item.id}`, label: commitmentOwnerLabel(item), content: item.content, timestamp: item.updatedAt })),
      ...topics.map((item) => ({ id: `topic:${item.id}`, label: "Important topic", content: item.content, timestamp: item.updatedAt })),
    ].filter((item): item is TimelineItem => Boolean(item)).sort((left, right) => toMilliseconds(right.timestamp) - toMilliseconds(left.timestamp)).slice(0, 7);

    return <main className="main-content people-experience contact-intelligence-page">
      <header className="people-detail-topbar">
        <button className="people-back" type="button" onClick={() => setSelectedChatId(undefined)}><ArrowLeft size={18} />People</button>
        <button className="button compact" type="button" onClick={() => onOpenChat(selectedPerson.chatId)}><MessageCircle size={16} />Open conversation</button>
      </header>
      <section className="contact-intelligence-hero">
        <ContactAvatar name={selectedPerson.contactName} src={chat?.avatarUrl} className="contact-intelligence-avatar" />
        <div><span className="people-eyebrow">Contact intelligence</span><h1>{selectedPerson.contactName}</h1><p className="contact-intelligence-relationship">{relationshipLabel(selectedPerson, preferences)}</p><p className="contact-intelligence-summary" dir="auto">{personSummary(selectedPerson, ownerName)}</p></div>
        <article className="contact-last-interaction"><span>Last interaction</span><strong>{relativeTime(selectedPerson.lastIncoming?.timestamp || selectedPerson.updatedAt)}</strong><p dir="auto">{selectedPerson.lastIncoming?.content || "No recent message is available."}</p><button type="button" onClick={() => onOpenChat(selectedPerson.chatId, selectedPerson.lastIncoming?.messageId)}>View conversation <ArrowRight size={14} /></button></article>
      </section>
      <div className="contact-intelligence-grid">
        <section className="contact-intelligence-section plans"><header><span><CalendarDays size={19} /><h2>Upcoming plans</h2></span><button type="button" onClick={onOpenCalendar}>View calendar <ArrowRight size={14} /></button></header>{plans.length ? <div className="contact-item-list">{plans.slice(0, 3).map((item) => <button type="button" key={item.id} onClick={onOpenCalendar}><span className="contact-item-date">{shortDate(item.startAt)}</span><span><strong dir="auto">{item.title}</strong><small>{item.location || "Confirmed plan"}</small></span><ArrowRight size={14} /></button>)}</div> : <SectionEmpty>No upcoming confirmed plans.</SectionEmpty>}</section>
        <section className="contact-intelligence-section commitments"><header><span><CheckCircle2 size={19} /><h2>Open commitments</h2></span></header>{commitments.length ? <div className="contact-item-list">{commitments.slice(0, 3).map((item) => <article key={item.id}><span><strong dir="auto">{item.content}</strong><small>{commitmentOwnerLabel(item)}{item.dueAt ? ` · due ${shortDate(item.dueAt)}` : ""}</small></span></article>)}</div> : <SectionEmpty>No open commitments.</SectionEmpty>}</section>
        <section className="contact-intelligence-section todos"><header><span><ListTodo size={19} /><h2>Open to-dos</h2></span></header>{todos.length ? <div className="contact-item-list">{todos.slice(0, 3).map((item) => <article key={item.id}><span><strong dir="auto">{item.title}</strong><small>{item.dueAt ? `Due ${shortDate(item.dueAt)}` : "Open to-do"}</small></span></article>)}</div> : <SectionEmpty>{`No open to-dos involving ${selectedPerson.contactName}.`}</SectionEmpty>}</section>
        <section className="contact-intelligence-section waiting-on-them"><header><span><Clock3 size={19} /><h2>Waiting on them</h2></span></header>{waitingOnThem.length ? <div className="contact-item-list">{waitingOnThem.slice(0, 3).map((item) => <article key={item.id}><span><strong dir="auto">{item.content}</strong><small>Open {relativeTime(item.updatedAt)}</small></span></article>)}</div> : <SectionEmpty>Nothing is waiting on them.</SectionEmpty>}</section>
        <section className="contact-intelligence-section waiting-on-me"><header><span><MessageCircle size={19} /><h2>Waiting on me</h2></span></header>{selectedPerson.needsReply || waitingOnMe.length ? <div className="contact-item-list">{selectedPerson.needsReply ? <button type="button" onClick={() => onOpenChat(selectedPerson.chatId, selectedPerson.lastIncoming?.messageId)}><span><strong>Reply to their recent message</strong><small>{relativeTime(selectedPerson.lastIncoming?.timestamp || selectedPerson.updatedAt)}</small></span><ArrowRight size={14} /></button> : null}{waitingOnMe.slice(0, 2).map((item) => <article key={item.id}><span><strong dir="auto">{item.content}</strong><small>Open {relativeTime(item.updatedAt)}</small></span></article>)}</div> : <SectionEmpty>Nothing is waiting on you.</SectionEmpty>}</section>
        <section className="contact-intelligence-section topics"><header><span><Sparkles size={19} /><h2>Recent important topics</h2></span></header>{topics.length ? <div className="contact-topic-list">{topics.slice(0, 6).map((item) => <span key={item.id} dir="auto">{item.content}</span>)}</div> : <SectionEmpty>No confirmed important topics yet.</SectionEmpty>}</section>
      </div>
      <section className="contact-timeline"><header><span><Clock3 size={19} /><div><h2>Conversation timeline</h2><p>Recent events and confirmed relationship context.</p></div></span></header>{timeline.length ? <div>{timeline.map((item) => <button type="button" key={item.id} onClick={() => onOpenChat(selectedPerson.chatId)}><time>{shortDate(item.timestamp)}</time><span><small>{item.label}</small><strong dir="auto">{item.content}</strong></span><ArrowRight size={14} /></button>)}</div> : <SectionEmpty>No relationship activity has been saved yet.</SectionEmpty>}</section>
    </main>;
  }

  return <main className="main-content secondary-page people-experience">
    <header className="people-page-header"><div><h1>People</h1><p>Your people, summarized by AmirOS.</p></div><button className="icon-button" aria-label="Refresh people" disabled={loading} onClick={() => void onRefresh()}><Sparkles size={18} className={loading ? "spin" : ""} /></button></header>
    <section className="people-directory-tools" aria-label="Find people"><label><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people" aria-label="Search people" />{query ? <button type="button" aria-label="Clear people search" onClick={() => setQuery("")}>×</button> : null}</label><div className="people-filter-bar" aria-label="Filter people">{(["all", "favorites", "family", "friends", "work", "groups", "hidden"] as PeopleFilter[]).map((item) => <button key={item} type="button" className={filter === item ? "active" : ""} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item === "all" ? "All people" : item[0].toUpperCase() + item.slice(1)} <span>{filterCounts[item]}</span></button>)}</div></section>
    <section className="people-quick-views" aria-label="Quick view collections">
      <QuickViewCard icon={Heart} label="Favorites" description="People you want close" people={favoritePeople} chats={chatById} active={filter === "favorites"} onClick={() => setFilter("favorites")} />
      <QuickViewCard icon={MessageCircle} label="Waiting" description="Open replies and commitments" people={waitingPeople} chats={chatById} active={filter === "waiting"} onClick={() => setFilter("waiting")} />
      <QuickViewCard icon={CalendarDays} label="Upcoming" description="Plans and important dates" people={upcomingPeople} chats={chatById} active={filter === "upcoming"} onClick={() => setFilter("upcoming")} />
      <QuickViewCard icon={Clock3} label="Recently active" description="Your latest conversations" people={recentlyActivePeople} chats={chatById} active={filter === "recent"} onClick={() => setFilter("recent")} />
    </section>
    <section className="people-directory" aria-label="People directory">{visiblePeople.map((person, index) => {
      const preferences = contacts[person.chatId];
      const relationship = relationshipLabel(person, preferences);
      const plans = confirmedUpcomingPlans(person);
      const commitments = openCommitments(person);
      const waitingOnMe = (person.needsReply ? 1 : 0) + commitments.filter((item) => item.owner === "me").length;
      const waitingOnThem = commitments.filter((item) => item.owner !== "me").length;
      const interactedAt = interactionTimestamp(person, chatById.get(person.chatId));
      const needsSummary = summaryNeedsRefresh(person);
      const summaryBusy = summaryBusyChatId === person.chatId;
      const hasSummary = Boolean(summaryRecordFor(person)?.summary.trim());
      const hidden = Boolean(preferences?.hidden);
      const favorite = Boolean(preferences?.pinned);
      return <article key={person.chatId} className="people-card">
        <div className="people-card-heading">
          <button type="button" className="people-card-main" onClick={() => setSelectedChatId(person.chatId)}><ContactAvatar name={person.contactName} src={chatById.get(person.chatId)?.avatarUrl} tone={index} className="people-card-avatar" /><span><strong>{person.contactName}</strong></span></button>
          <span className="people-card-actions">
            <button type="button" className={`people-card-favorite ${favorite ? "is-favorite" : ""}`} aria-pressed={favorite} aria-label={`${favorite ? "Remove" : "Add"} ${person.contactName} ${favorite ? "from" : "to"} Favorites`} title={favorite ? "Remove from Favorites" : "Add to Favorites"} onClick={() => void onContactChange(person.chatId, { pinned: !favorite })}><Heart size={16} /></button>
            <button type="button" className="people-card-visibility" aria-label={`${hidden ? "Show" : "Hide"} ${person.contactName}`} title={hidden ? "Show in People" : "Hide from People"} onClick={() => void onContactChange(person.chatId, { hidden: !hidden })}>{hidden ? <Eye size={16} /> : <EyeOff size={16} />}</button>
          </span>
        </div>
        <label className="people-relationship-picker"><span>Relationship</span><select value={relationship} aria-label={`Relationship with ${person.contactName}`} onChange={(event) => void onContactChange(person.chatId, { relationship: event.currentTarget.value })}>{relationshipOptions(person, relationship).map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
        <div className="people-card-summary"><p dir="auto">{personSummary(person, ownerName)}</p>{needsSummary ? <button type="button" className="people-summary-action" disabled={summaryBusy} onClick={() => void generatePersonSummary(person)}>{summaryBusy ? <RefreshCw size={13} className="spin" /> : <Sparkles size={13} />}{summaryBusy ? "Updating summary…" : hasSummary ? "Regenerate summary" : "Generate summary"}{hasSummary && !summaryBusy ? <em>New information</em> : null}</button> : null}</div>
        <div className="people-card-metrics"><span><CalendarDays size={16} /><b>{plans.length}</b><small>Upcoming</small></span><span><MessageCircle size={16} /><b>{waitingOnMe}</b><small>Waiting on me</small></span><span><Clock3 size={16} /><b>{waitingOnThem}</b><small>Waiting on them</small></span></div>
        <button type="button" className="people-card-footer" onClick={() => setSelectedChatId(person.chatId)}>Last interaction {relativeTime(interactedAt)} <ArrowRight size={16} /></button>
      </article>;
    })}</section>
    {visiblePeople.length === 0 ? <div className="people-directory-empty"><Users size={28} /><strong>{filter === "hidden" ? "No hidden people." : "No people match that filter."}</strong><p>{filter === "hidden" ? "Hidden people will appear here so you can show them again." : "Try a different search or relationship filter."}</p></div> : null}
  </main>;
}
