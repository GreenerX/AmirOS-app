import {
  ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, Clock3, ListTodo,
  MessageCircle, Search, Sparkles, Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ChatSummary, ContactPreferences, IntelligenceChat, IntelligenceData, RelationshipCommitment, TodoTask } from "../types";
import { isKnownIntelligenceContactName } from "../intelligence-snapshot";
import { profileSummaryParagraph } from "../profile-summary";
import { ContactAvatar } from "./ContactAvatar";

type PeopleFilter = "all" | "family" | "friends" | "work" | "groups";
type TimelineItem = { id: string; label: string; content: string; timestamp: number };

type PeopleExperienceProps = {
  data?: IntelligenceData;
  chats: ChatSummary[];
  contacts: Record<string, ContactPreferences>;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onOpenChat: (chatId: string, messageId?: string) => void;
  onOpenCalendar: () => void;
};

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

function personSummary(person: IntelligenceChat) {
  const record = person.isGroup ? person.groupSummary : person.profile;
  return record?.summary ? profileSummaryParagraph(record.summary, person.contactName) : "No profile summary yet.";
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

export function PeopleExperience({ data, chats, contacts, loading, onRefresh, onOpenChat, onOpenCalendar }: PeopleExperienceProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PeopleFilter>("all");
  const [selectedChatId, setSelectedChatId] = useState<string>();
  const chatById = useMemo(() => new Map(chats.map((chat) => [chat.id, chat])), [chats]);
  const everyone = useMemo(
    () => (data?.chats || []).filter((person) => isKnownIntelligenceContactName(person.contactName)),
    [data?.chats],
  );
  const allTodos = data?.todos || [];
  const visiblePeople = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return [...everyone]
      .filter((person) => filter === "all" || categoryFor(person, contacts[person.chatId]) === filter)
      .filter((person) => !normalizedQuery || `${person.contactName} ${relationshipLabel(person, contacts[person.chatId])}`.toLocaleLowerCase().includes(normalizedQuery))
      .sort((left, right) => toMilliseconds(right.updatedAt) - toMilliseconds(left.updatedAt));
  }, [contacts, everyone, filter, query]);
  const selectedPerson = everyone.find((person) => person.chatId === selectedChatId);
  const filterCounts = useMemo(() => ({
    all: everyone.length,
    family: everyone.filter((person) => categoryFor(person, contacts[person.chatId]) === "family").length,
    friends: everyone.filter((person) => categoryFor(person, contacts[person.chatId]) === "friends").length,
    work: everyone.filter((person) => categoryFor(person, contacts[person.chatId]) === "work").length,
    groups: everyone.filter((person) => categoryFor(person, contacts[person.chatId]) === "groups").length,
  }), [contacts, everyone]);

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
        <div><span className="people-eyebrow">Contact intelligence</span><h1>{selectedPerson.contactName}</h1><p className="contact-intelligence-relationship">{relationshipLabel(selectedPerson, preferences)}</p><p className="contact-intelligence-summary" dir="auto">{personSummary(selectedPerson)}</p></div>
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

  return <main className="main-content people-experience">
    <header className="people-page-header"><div><h1>People</h1><p>Your people, summarized by AmirOS.</p></div><button className="icon-button" aria-label="Refresh people" disabled={loading} onClick={() => void onRefresh()}><Sparkles size={18} className={loading ? "spin" : ""} /></button></header>
    <section className="people-directory-tools" aria-label="Find people"><label><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people" aria-label="Search people" />{query ? <button type="button" aria-label="Clear people search" onClick={() => setQuery("")}>×</button> : null}</label><div className="people-filter-bar" aria-label="Filter people">{(["all", "family", "friends", "work", "groups"] as PeopleFilter[]).map((item) => <button key={item} type="button" className={filter === item ? "active" : ""} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item === "all" ? "All people" : item[0].toUpperCase() + item.slice(1)} <span>{filterCounts[item]}</span></button>)}</div></section>
    <section className="people-overview-stats" aria-label="People overview"><span><Users size={22} /><b>{everyone.length}</b><small>People AmirOS knows</small></span><span><CalendarDays size={22} /><b>{everyone.reduce((total, person) => total + confirmedUpcomingPlans(person).length, 0)}</b><small>Upcoming plans</small></span><span><MessageCircle size={22} /><b>{everyone.filter((person) => person.needsReply).length}</b><small>Waiting on me</small></span><span><Clock3 size={22} /><b>{everyone.reduce((total, person) => total + openCommitments(person).filter((item) => item.owner !== "me").length, 0)}</b><small>Waiting on them</small></span></section>
    <section className="people-directory" aria-label="People directory">{visiblePeople.map((person, index) => { const preferences = contacts[person.chatId]; const plans = confirmedUpcomingPlans(person); const commitments = openCommitments(person); const waitingOnMe = (person.needsReply ? 1 : 0) + commitments.filter((item) => item.owner === "me").length; const waitingOnThem = commitments.filter((item) => item.owner !== "me").length; return <article key={person.chatId} className="people-card"><button type="button" className="people-card-main" onClick={() => setSelectedChatId(person.chatId)}><ContactAvatar name={person.contactName} src={chatById.get(person.chatId)?.avatarUrl} tone={index} className="people-card-avatar" /><span><strong>{person.contactName}</strong><small>{relationshipLabel(person, preferences)}</small></span><ArrowRight size={18} /></button><p dir="auto">{personSummary(person)}</p><div className="people-card-metrics"><span><CalendarDays size={16} /><b>{plans.length}</b><small>Upcoming</small></span><span><MessageCircle size={16} /><b>{waitingOnMe}</b><small>Waiting on me</small></span><span><Clock3 size={16} /><b>{waitingOnThem}</b><small>Waiting on them</small></span></div><button type="button" className="people-card-footer" onClick={() => setSelectedChatId(person.chatId)}>Last interaction {relativeTime(person.updatedAt)} <ArrowRight size={16} /></button></article>; })}</section>
    {visiblePeople.length === 0 ? <div className="people-directory-empty"><Users size={28} /><strong>No people match that filter.</strong><p>Try a different search or relationship filter.</p></div> : null}
  </main>;
}
