import {
  ArrowLeft, ArrowRight, CalendarDays, ChevronDown, Clock3,
  Eye, EyeOff, Heart, MessageCircle, RefreshCw, Search, Sparkles, Trash2, Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { ChatSummary, ContactInsight, ContactPreferences, IntelligenceChat, IntelligenceData, MemoryEvidence, RelationshipCommitment, TodoTask } from "../types";
import { isKnownIntelligenceContactName } from "../intelligence-snapshot";
import { profileSummaryParagraph } from "../profile-summary";
import { replyAssessmentCopy } from "../reply-assessment-copy";
import { formatDateTime } from "../format";
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
  onCalendarStatus: (chatId: string, eventId: string, status: "dismissed") => Promise<void>;
  onCommitmentStatus: (chatId: string, commitmentId: string, status: "dismissed") => Promise<void>;
  onInsightStatus: (chatId: string, insightId: string, status: "outdated") => Promise<void>;
  onTodoStatus: (chatId: string, todoId: string, status: "dismissed") => Promise<void>;
};

const RELATIONSHIP_OPTIONS = [
  "Contact", "Partner", "Family", "Friend", "Close friend", "Client", "Colleague", "Manager", "Team", "Neighbor", "Other",
];
const GROUP_RELATIONSHIP_OPTIONS = ["Group", "Friends group", "Family group", "Work group", "Community group", "Other group"];
const WEAK_TOPIC_WORDS = new Set([
  "and", "can", "dedication", "discussion", "excitement", "feeling", "feelings", "if", "inspiration", "inspiring", "it", "later", "needed", "playing", "something", "thing", "to", "topic", "update", "were", "where",
]);
const INVALID_TOPIC_STARTS = new Set(["and", "going", "has", "he", "is", "it", "she", "they", "to", "was", "where"]);

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
  return formatDateTime(toMilliseconds(value), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function relationshipLabel(person: IntelligenceChat, preferences?: ContactPreferences) {
  return preferences?.relationship?.trim() || (person.isGroup ? "Group" : "Contact");
}

function normalizedName(value: string) {
  return value.replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}

function escapeExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Profiles generated before the owner-perspective prompt may still refer to
 * the owner by name. Keep those summaries personal while regeneration replaces
 * their older prose.
 */
export function ownerPerspectiveSummary(summary: string, ownerName: string) {
  const normalizedOwner = ownerName.replace(/\s+/gu, " ").trim();
  if (!normalizedOwner) return summary;
  const aliases = [...new Set([normalizedOwner, normalizedOwner.split(" ")[0] || ""])]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  let personalized = summary;
  for (const alias of aliases) {
    const escaped = escapeExpression(alias);
    personalized = personalized.replace(new RegExp(`\\b${escaped}(?:['’]s)\\b`, "giu"), "your");
    personalized = personalized.replace(new RegExp(`\\b${escaped}\\b`, "giu"), "you");
  }
  return personalized
    .replace(/\byou is\b/giu, "you are")
    .replace(/\byou was\b/giu, "you were")
    .replace(/\byou has\b/giu, "you have")
    .replace(/\byou does\b/giu, "you do")
    .replace(/(^|[.!?]\s+)you\b/gu, "$1You");
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

function sentenceDescribesCanonicalKey(sentence: string, canonicalKey?: string) {
  if (!canonicalKey) return false;
  const normalized = canonicalKey.replace(/[_\s-]+/gu, " ").toLocaleLowerCase();
  if (/\b(?:residence|home|address|location)\b/iu.test(normalized)) return /\b(?:live|lives|lived|reside|resides|home|based in|moved)\b/iu.test(sentence);
  if (/\b(?:employer|employment|job|work|role)\b/iu.test(normalized)) return /\b(?:work|works|worked|job|employer|joined|left|started)\b/iu.test(sentence);
  if (/\b(?:diet|food preference)\b/iu.test(normalized)) return /\b(?:vegetarian|vegan|diet|eat|eats|food|meat)\b/iu.test(sentence);
  return false;
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

/** Uses derived prose only while it agrees with the latest canonical truth. */
export function personSummary(person: IntelligenceChat, ownerName: string) {
  const record = person.isGroup ? person.groupSummary : person.profile;
  const owner = normalizedName(ownerName);
  const profileIsUsable = !person.profile?.staleAt || person.isGroup;
  const sourceCandidates = record?.summary && profileIsUsable ? summarySentences(profileSummaryParagraph(
    relationshipSummarySource(record.summary),
    person.contactName,
  )).filter((sentence) => {
    const normalizedSentence = normalizedName(sentence);
    return !owner || !normalizedSentence.startsWith(owner);
  }) : [];
  const candidates = sourceCandidates.map((sentence) => ownerPerspectiveSummary(sentence, ownerName));
  const relationshipOnly = candidates.filter(isRelationshipSentence);
  const selected = relationshipOnly.length ? relationshipOnly : candidates;
  // Profiles are derived and generated on demand. Canonical facts remain the
  // source of truth whenever that prose has become stale.
  const liveCurrentFact = (person.insights || [])
    .filter((item) => item.status === "confirmed" && (item.validity || "current") === "current")
    .filter((item) => !record || !profileIsUsable || toMilliseconds(item.updatedAt) > toMilliseconds(record.updatedAt))
    .sort((left, right) => toMilliseconds(right.updatedAt) - toMilliseconds(left.updatedAt))[0];
  const liveSentence = liveCurrentFact && !normalizedName(record?.summary || "").includes(normalizedName(liveCurrentFact.content))
    ? sentenceEnding(liveCurrentFact.content)
    : undefined;
  const compatibleSummary = liveCurrentFact
    ? selected.filter((sentence) => !sentenceDescribesCanonicalKey(sentence, liveCurrentFact.canonicalKey))
    : selected;
  const summary = compactSentences(liveSentence ? [liveSentence, ...compatibleSummary] : compatibleSummary);
  return summary.join(" ") || "No relationship summary yet.";
}

function interactionTimestamp(person: IntelligenceChat) {
  const timestamp = person.lastInteraction?.timestamp;
  return timestamp ? toMilliseconds(timestamp) : undefined;
}

export function relationshipItemTemporalText(item: Pick<RelationshipCommitment, "evidence" | "dueAt">) {
  const sourceTimestamp = item.evidence?.timestamp;
  const source = sourceTimestamp ? `from ${shortDate(sourceTimestamp)}` : undefined;
  const due = item.dueAt ? `due ${shortDate(item.dueAt)}` : undefined;
  return [source, due].filter((value): value is string => Boolean(value)).join(" · ");
}

function sentenceEnding(value: string) {
  const cleaned = value
    .replace(/,\s+(?=(?:at|for|from|in|on|with)\b)/giu, " ")
    .replace(/\.{2,}$/u, ".")
    .trim();
  return /[.!?]$/u.test(cleaned) ? cleaned : `${cleaned}.`;
}

export function compactRelationshipItemTitle(value: string, maxLength = 96) {
  const normalized = value.replace(/\s+/gu, " ").replace(/\s+([,.;!?])/gu, "$1").trim();
  if (normalized.length <= maxLength) return normalized;
  const candidate = normalized.slice(0, maxLength - 1);
  const wordBoundary = candidate.lastIndexOf(" ");
  return `${candidate.slice(0, wordBoundary > maxLength * .58 ? wordBoundary : candidate.length).trimEnd()}…`;
}

export function commitmentPresentation(content: string) {
  const normalized = content.replace(/\s+/gu, " ").trim();
  if (/^Last login:.*(?:default interactive shell|Updating AmirOS|terminal)/iu.test(normalized)) {
    return { title: "Review shared terminal output", detail: "A terminal log was shared in this conversation." };
  }
  const contextual = normalized.match(/^(.+?)\s+(when|while|after|before|once|upon returning|on returning)\s+(.+)$/iu);
  if (contextual) {
    const title = contextual[1]!.replace(/[,;:–—-]+$/u, "").trim();
    const detail = sentenceEnding(`${contextual[2]![0]!.toLocaleUpperCase()}${contextual[2]!.slice(1)} ${contextual[3]!}`);
    return { title, detail };
  }
  const clause = normalized.match(/^(.{18,90}?)[;–—]\s+(.+)$/u);
  if (clause) return {
    title: clause[1]!.replace(/[,;:–—-]+$/u, "").trim(),
    detail: sentenceEnding(clause[2]!),
  };
  return { title: normalized.replace(/[.!?]+$/u, ""), detail: undefined };
}

function evidenceRecords(primary: MemoryEvidence, history?: MemoryEvidence[]) {
  const records = new Map<string, MemoryEvidence>();
  for (const evidence of [primary, ...(history || [])]) {
    const key = evidence.messageId || `${evidence.timestamp}:${evidence.excerpt}`;
    if (!records.has(key)) records.set(key, evidence);
  }
  return [...records.values()].sort((left, right) => toMilliseconds(right.timestamp) - toMilliseconds(left.timestamp));
}

function summaryRecordFor(person: IntelligenceChat) {
  return person.isGroup ? person.groupSummary : person.profile;
}

function summaryNeedsRefresh(person: IntelligenceChat) {
  const summary = summaryRecordFor(person);
  return !summary?.summary.trim() || Boolean(person.profile?.staleAt) || toMilliseconds(person.updatedAt) > toMilliseconds(summary.updatedAt) + 1_000;
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

export function isRelationshipCommitmentNoise(item: Pick<RelationshipCommitment, "content" | "evidence">) {
  const content = `${item.content} ${item.evidence?.excerpt || ""}`.replace(/\s+/gu, " ").trim();
  return /^(?:Last login:|The default interactive shell)/iu.test(content)
    || /\bdefault interactive shell is now zsh\b/iu.test(content)
    || /(?:\/node_modules\/|puppeteer-core|ChromeLauncher\.launch)/u.test(content);
}

function openCommitments(person: IntelligenceChat) {
  return person.commitments
    .filter((item) => !isRelationshipCommitmentNoise(item))
    .filter((item) => item.status === "open" || item.status === "needs_review")
    .sort((left, right) => Number(left.status === "needs_review") - Number(right.status === "needs_review"));
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
  return commitment.owner === "me" ? "Follow-up for you" : "Follow-up from them";
}

function titleCaseTopic(value: string) {
  return value.split(/\s+/u).map((word, index) =>
    index > 0 && /^(?:a|an|and|at|for|in|of|on|the|to)$/iu.test(word)
      ? word.toLocaleLowerCase()
      : word.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase()),
  ).join(" ").replace(/\bimax\b/giu, "IMAX").replace(/\bnyc\b/giu, "NYC");
}

export function normalizeTopicTitle(value: string) {
  const cleaned = value.replace(/\s+/gu, " ").trim().replace(/[.!?,;:]+$/gu, "");
  const words = cleaned.split(/\s+/u).filter(Boolean);
  if (words.length < 2 || words.length > 4 || cleaned.length > 56) return "";
  const first = words[0]?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "") || "";
  if (INVALID_TOPIC_STARTS.has(first)) return "";
  if (!words.some((word) => /[\p{L}\p{N}]/u.test(word))) return "";
  return titleCaseTopic(cleaned);
}

/** Backward-compatible semantic projection for insights saved before topicTitle existed. */
export function conciseTopicLabel(content: string) {
  const source = content.replace(/\s+/gu, " ").trim().split(/(?<=[.!?])\s+/u)[0]?.replace(/[.!?]+$/u, "") || "";
  if (!source || /\b(?:affectionately )?reassured\b|\bcould read it later\b|\bnot so bad\b/iu.test(source)) return "";
  if (/\b(?:difficult|hard|rough|tough)\s+(?:few\s+)?(?:days|weeks|months)\b/iu.test(source)) return "Personal Check-in";
  if (/\b(?:sit|get|meet)\s+together\b/iu.test(source)) return /\bthis week\b/iu.test(source) ? "Meeting This Week" : "Meeting Plans";
  if (/\bflamenco\b/iu.test(source)) return "Flamenco Night";
  if (/\bpupp(?:y|ies)\b/iu.test(source) && /\b(?:visit|play|meet)\b/iu.test(source)) return "Puppy Visit";
  const venue = source.match(/\b(?:at|to)\s+(?:the\s+)?([\p{Lu}][\p{L}\p{N}'’.-]*(?:\s+[\p{Lu}][\p{L}\p{N}'’.-]*)?)(?:\s+(?:restaurant|cafe|bar))?\b/u)?.[1];
  if (/\bburrito\b/iu.test(source) && venue) return normalizeTopicTitle(`Burrito at ${venue}`);
  if (/\bnot been to\b/iu.test(source) && venue) return normalizeTopicTitle(`${venue} Restaurant`);
  if (/\bsecurity camera\b/iu.test(source)) return "Security Camera";
  const trip = source.match(/\b(?:trip|travel|vacation)\b.*?\bto\s+([\p{L}\p{N}'’.-]+(?:\s+[\p{L}\p{N}'’.-]+){0,1})/iu);
  if (trip?.[1]) return normalizeTopicTitle(`Trip to ${trip[1]}`);
  const ticketSubject = source.match(/\b(?:tickets?|booking|reservation)\s+(?:for|to)\s+(?:the\s+)?(.+?)$/iu);
  if (ticketSubject?.[1]) return normalizeTopicTitle(ticketSubject[1]);
  const project = source.match(/\b((?:new|work|creative|personal)\s+project)\b/iu);
  if (project?.[1]) return normalizeTopicTitle(project[1]);
  const scooter = source.match(/\b(scooter(?:\s+(?:booking|purchase|reservation))?)\b/iu);
  if (scooter?.[1]) return normalizeTopicTitle(scooter[1]);
  if (/\btherapy\b/iu.test(source)) return "Therapy Sessions";
  const broughtPerson = source.match(/\b(?:bring|bringing)\s+([\p{Lu}][\p{L}'’.-]*(?:\s+[\p{Lu}][\p{L}'’.-]*){0,2})$/u);
  if (broughtPerson?.[1]) return normalizeTopicTitle(`${broughtPerson[1]} Visit`);
  const animal = source.match(/\b(poodles?|dogs?|cats?)\b/iu);
  const location = source.match(/\b(?:at|in)\s+([\p{Lu}\p{N}][\p{L}\p{N}'’.-]*)/u);
  if (animal?.[1] && location?.[1]) return normalizeTopicTitle(`${animal[1]} at ${location[1]}`);
  return "";
}

export function topicTitleForInsight(item: Pick<ContactInsight, "content" | "topicTitle" | "topicTitleConfidence">) {
  if (item.topicTitle !== undefined) {
    if ((item.topicTitleConfidence || 0) < 0.7) return "";
    return normalizeTopicTitle(item.topicTitle);
  }
  return conciseTopicLabel(item.content);
}

export function topicLabelQuality(label: string) {
  if (!normalizeTopicTitle(label)) return 0;
  const words = label.toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);
  const meaningful = words.filter((word) => word.length > 1 && !WEAK_TOPIC_WORDS.has(word));
  if (meaningful.length === 0) return 0;
  return Math.min(1, 0.55 + meaningful.length * 0.15);
}

export function commitmentCoversReply(commitments: RelationshipCommitment[], replyContent?: string) {
  if (!replyContent) return false;
  const meaningfulTokens = (value: string) => new Set(value
    .toLocaleLowerCase()
    .replace(/\b(?:sent|sending)\b/gu, "send")
    .replace(/\b(?:called|calling)\b/gu, "call")
    .replace(/\b(?:booked|booking)\b/gu, "book")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/u)
    .map((token) => token.replace(/(?:ing|ed|s)$/u, ""))
    .filter((token) => token.length >= 3 && !new Set([
      "can", "could", "would", "please", "you", "your", "that", "this", "with", "from", "have", "need", "reply",
    ]).has(token)));
  const replyTokens = meaningfulTokens(replyContent);
  return commitments.some((item) => {
    const commitmentTokens = meaningfulTokens(item.content);
    const shared = [...replyTokens].filter((token) => commitmentTokens.has(token)).length;
    return shared >= 1 && shared / Math.min(replyTokens.size || 1, commitmentTokens.size || 1) >= 0.8;
  });
}

function SectionEmpty({ children }: { children: string }) {
  return <p className="people-section-empty">{children}</p>;
}

function EvidenceHistory({
  primary,
  history,
}: {
  primary: MemoryEvidence;
  history?: MemoryEvidence[];
}) {
  const records = evidenceRecords(primary, history);
  return <section className="relationship-evidence" aria-label="Supporting evidence">
    <h4>Supporting {records.length === 1 ? "message" : `messages (${records.length})`}</h4>
    <div>{records.map((evidence) => <blockquote key={evidence.messageId || `${evidence.timestamp}:${evidence.excerpt}`}>
      <p dir="auto">{evidence.excerpt}</p>
      <time>{shortDate(evidence.timestamp)}{evidence.senderName ? ` · ${evidence.senderName}` : ""}</time>
    </blockquote>)}</div>
  </section>;
}

function MemoryExplanationPanel({ explanation }: { explanation?: ContactInsight["explanation"] }) {
  if (!explanation) return null;
  return <section className="memory-explanation" aria-label="How AmirOS knows this">
    <header>
      <span><Sparkles size={13} />How AmirOS knows this</span>
      <em>{explanation.confidenceLabel}</em>
    </header>
    <p>{explanation.summary}</p>
    <div className="memory-explanation-pills">
      <span>{explanation.statusLabel}</span>
      <span>Supported by {explanation.evidenceCount} {explanation.evidenceCount === 1 ? "message" : "messages"}</span>
      {explanation.reinforcedCount > 0 ? <span>Confirmed again in {explanation.reinforcedCount} later {explanation.reinforcedCount === 1 ? "conversation" : "conversations"}</span> : null}
      {explanation.freshnessLabel !== "Current" ? <span>{explanation.freshnessLabel}</span> : null}
    </div>
    {explanation.replaced?.length ? <div className="memory-explanation-change">
      <strong>Previously</strong>
      {explanation.replaced.map((item) => <span key={item}>{item}</span>)}
    </div> : null}
    {explanation.replacedBy ? <div className="memory-explanation-change">
      <strong>Now superseded by</strong>
      <span>{explanation.replacedBy}</span>
    </div> : null}
  </section>;
}

function RemoveItemButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return <button className="contact-item-remove" type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}><Trash2 size={14} /></button>;
}

function RelationshipCommitmentItem({
  item,
  meta,
  removing,
  onRemove,
}: {
  item: RelationshipCommitment;
  meta: string;
  removing: boolean;
  onRemove: () => void;
}) {
  const presentation = commitmentPresentation(item.content);
  const title = compactRelationshipItemTitle(presentation.title);
  const needsReview = item.status === "needs_review";
  return <article className={`relationship-commitment-item ${needsReview ? "needs-review" : "current"}`}>
    <details className="relationship-item-disclosure">
      <summary>
        <span className="relationship-item-copy">
          <span className="relationship-item-heading">
            <strong dir="auto">{title}</strong>
            <em className={`relationship-status-badge ${needsReview ? "review" : "current"}`}>{needsReview ? "Needs review" : "Current"}</em>
          </span>
          {presentation.detail ? <span className="relationship-item-support" dir="auto">{presentation.detail}</span> : null}
          <small>{meta}</small>
        </span>
        <ChevronDown className="relationship-disclosure-chevron" size={15} aria-hidden="true" />
      </summary>
      <div className="relationship-item-expanded">
        <p dir="auto">{item.content}</p>
        <EvidenceHistory primary={item.evidence} history={item.evidenceHistory} />
      </div>
    </details>
    <RemoveItemButton label={`Remove ${title}`} disabled={removing} onClick={onRemove} />
  </article>;
}

function TopicItem({
  item,
  removing,
  onRemove,
  historical = false,
}: {
  item: ContactInsight;
  removing: boolean;
  onRemove: () => void;
  historical?: boolean;
}) {
  const label = topicTitleForInsight(item);
  const explanation = item.explanation;
  const meta = historical
    ? explanation?.replacedBy ? "Earlier context · replaced by newer information" : "Earlier relationship context"
    : `${explanation?.confidenceLabel || "Confirmed"} · updated ${relativeTime(item.updatedAt)}`;
  return <article className={`contact-topic-item ${historical ? "historical" : "current"}`}>
    <details className="relationship-item-disclosure">
      <summary>
        <span className="relationship-item-copy"><strong dir="auto">{label}</strong><span className="relationship-item-support">{meta}</span></span>
        <ChevronDown className="relationship-disclosure-chevron" size={15} aria-hidden="true" />
      </summary>
      <div className="relationship-item-expanded"><p className="relationship-memory-fact" dir="auto">{item.content}</p><MemoryExplanationPanel explanation={explanation} /><EvidenceHistory primary={item.evidence} history={item.evidenceHistory} /></div>
    </details>
    <RemoveItemButton label={`Remove ${label}`} disabled={removing} onClick={onRemove} />
  </article>;
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

export function PeopleExperience({ data, chats, contacts, ownerName, loading, onRefresh, onOpenChat, onOpenCalendar, onContactChange, onGenerateSummary, onCalendarStatus, onCommitmentStatus, onInsightStatus, onTodoStatus }: PeopleExperienceProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PeopleFilter>("all");
  const [selectedChatId, setSelectedChatId] = useState<string>();
  const [summaryBusyChatId, setSummaryBusyChatId] = useState<string>();
  const [removingItemKey, setRemovingItemKey] = useState<string>();
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
    () => [...activePeople].sort((left, right) => (interactionTimestamp(right) || 0) - (interactionTimestamp(left) || 0)),
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
        || (filter === "recent" && (interactionTimestamp(person) || 0) >= Date.now() - 30 * 24 * 60 * 60 * 1_000)
        || categoryFor(person, contacts[person.chatId]) === filter
            )
      ))
      .filter((person) => !normalizedQuery || `${person.contactName} ${relationshipLabel(person, contacts[person.chatId])}`.toLocaleLowerCase().includes(normalizedQuery))
      .sort((left, right) => {
        const pinDifference = Number(Boolean(contacts[right.chatId]?.pinned)) - Number(Boolean(contacts[left.chatId]?.pinned));
        return pinDifference || (interactionTimestamp(right) || 0) - (interactionTimestamp(left) || 0);
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

  const removeItem = async (key: string, action: () => Promise<void>) => {
    setRemovingItemKey(key);
    try {
      await action();
    } finally {
      setRemovingItemKey(undefined);
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
    const replyCoveredByCommitment = commitmentCoversReply(waitingOnMe, selectedPerson.lastIncoming?.content);
    const replyCopy = replyAssessmentCopy(selectedPerson.replyAssessment);
    const lastInteraction = selectedPerson.lastInteraction;
    const currentMemory = selectedPerson.insights
      .filter((item) => item.status === "confirmed" && (item.validity || "current") !== "historical")
      .filter((item) => item.freshness !== "stale")
      .filter((item) => topicLabelQuality(topicTitleForInsight(item)) >= 0.7)
      .sort((left, right) => toMilliseconds(right.updatedAt) - toMilliseconds(left.updatedAt));
    const historicalMemory = selectedPerson.insights
      .filter((item) => item.status === "confirmed" && item.validity === "historical")
      .filter((item) => topicLabelQuality(topicTitleForInsight(item)) >= 0.7)
      .sort((left, right) => toMilliseconds(right.supersededAt || right.updatedAt) - toMilliseconds(left.supersededAt || left.updatedAt));
    const attentionCommitments = commitments.filter((item) => item.owner === "me");
    const timeline: TimelineItem[] = [
      selectedPerson.lastInteraction ? { id: `interaction:${selectedPerson.lastInteraction.messageId || selectedPerson.lastInteraction.timestamp}`, label: "Recent interaction", content: selectedPerson.lastInteraction.content || "Message", timestamp: selectedPerson.lastInteraction.timestamp } : undefined,
      ...plans.map((item) => ({ id: `event:${item.id}`, label: "Upcoming plan", content: item.title, timestamp: item.startAt })),
      ...commitments.map((item) => ({ id: `commitment:${item.id}`, label: commitmentOwnerLabel(item), content: item.content, timestamp: item.updatedAt })),
      ...currentMemory.map((item) => ({ id: `topic:${item.id}`, label: "Important context", content: item.content, timestamp: item.updatedAt })),
    ].filter((item): item is TimelineItem => Boolean(item)).sort((left, right) => toMilliseconds(right.timestamp) - toMilliseconds(left.timestamp)).slice(0, 7);

    return <main className="main-content people-experience contact-intelligence-page">
      <header className="people-detail-topbar">
        <button className="people-back" type="button" onClick={() => setSelectedChatId(undefined)}><ArrowLeft size={18} />People</button>
        <button className="button compact" type="button" onClick={() => onOpenChat(selectedPerson.chatId)}><MessageCircle size={16} />Open conversation</button>
      </header>
      <section className="contact-intelligence-hero">
          <ContactAvatar name={selectedPerson.contactName} src={chat?.avatarUrl} className="contact-intelligence-avatar" />
          <div className="contact-intelligence-profile"><span className="people-eyebrow">Your relationship with</span><div className="contact-intelligence-name-row"><h1>{selectedPerson.contactName}</h1><p className="contact-intelligence-relationship">{relationshipLabel(selectedPerson, preferences)}</p></div><p className="contact-intelligence-summary" dir="auto">{personSummary(selectedPerson, ownerName)}</p></div>
          <article className="contact-last-interaction"><span>Last interaction</span><strong>{lastInteraction ? relativeTime(lastInteraction.timestamp) : "No interaction saved"}</strong><p dir="auto">{lastInteraction?.content || "No human message is available."}</p><button type="button" onClick={() => onOpenChat(selectedPerson.chatId, lastInteraction?.messageId)}>View conversation <ArrowRight size={14} /></button></article>
      </section>
      <section className="contact-intelligence-priority-grid" aria-label="What matters now">
        <section className="contact-intelligence-section attention"><header><span><Sparkles size={19} /><div><h2>What needs your attention</h2><p>Open follow-ups, commitments, and to-dos involving {selectedPerson.contactName}.</p></div></span></header>{(selectedPerson.needsReply && !replyCoveredByCommitment) || attentionCommitments.length || todos.length ? <div className="contact-item-list">{selectedPerson.needsReply && !replyCoveredByCommitment ? <button type="button" onClick={() => onOpenChat(selectedPerson.chatId, selectedPerson.lastIncoming?.messageId)}><span><strong>May need your reply</strong><small>{replyCopy ? `${replyCopy.text} · ${relativeTime(selectedPerson.lastIncoming?.timestamp || selectedPerson.updatedAt)}` : relativeTime(selectedPerson.lastIncoming?.timestamp || selectedPerson.updatedAt)}</small></span><ArrowRight size={14} /></button> : null}{attentionCommitments.map((item) => <RelationshipCommitmentItem key={item.id} item={item} meta={relationshipItemTemporalText(item) || `Open ${relativeTime(item.updatedAt)}`} removing={removingItemKey === `commitment:${item.id}`} onRemove={() => void removeItem(`commitment:${item.id}`, () => onCommitmentStatus(selectedPerson.chatId, item.id, "dismissed"))} />)}{todos.map((item) => <article className="contact-removable-item" key={item.id}><span><strong dir="auto">{compactRelationshipItemTitle(item.title)}</strong><small>{item.dueAt ? `Due ${shortDate(item.dueAt)}` : "Open to-do"}</small></span><RemoveItemButton label={`Remove ${item.title}`} disabled={removingItemKey === `todo:${item.id}`} onClick={() => void removeItem(`todo:${item.id}`, () => onTodoStatus(selectedPerson.chatId, item.id, "dismissed"))} /></article>)}</div> : <SectionEmpty>Nothing needs your attention right now.</SectionEmpty>}</section>
        <section className="contact-intelligence-section plans"><header><span><CalendarDays size={19} /><div><h2>Coming up together</h2><p>Confirmed plans and important dates.</p></div></span><button type="button" onClick={onOpenCalendar}>Calendar <ArrowRight size={14} /></button></header>{plans.length ? <div className="contact-item-list">{plans.map((item) => <article className="contact-removable-item" key={item.id}><button className="contact-item-open" type="button" onClick={onOpenCalendar}><span className="contact-item-date">{shortDate(item.startAt)}</span><span><strong dir="auto">{compactRelationshipItemTitle(item.title)}</strong><small>{item.location || "Confirmed plan"}</small></span><ArrowRight size={14} /></button><RemoveItemButton label={`Remove ${item.title}`} disabled={removingItemKey === `event:${item.id}`} onClick={() => void removeItem(`event:${item.id}`, () => onCalendarStatus(selectedPerson.chatId, item.id, "dismissed"))} /></article>)}</div> : <SectionEmpty>No upcoming confirmed plans.</SectionEmpty>}</section>
        <section className="contact-intelligence-section waiting-on-them"><header><span><Clock3 size={19} /><div><h2>They’re following up</h2><p>Things {selectedPerson.contactName} said they would do.</p></div></span></header>{waitingOnThem.length ? <div className="contact-item-list">{waitingOnThem.map((item) => <RelationshipCommitmentItem key={item.id} item={item} meta={relationshipItemTemporalText(item) || `Open ${relativeTime(item.updatedAt)}`} removing={removingItemKey === `commitment:${item.id}`} onRemove={() => void removeItem(`commitment:${item.id}`, () => onCommitmentStatus(selectedPerson.chatId, item.id, "dismissed"))} />)}</div> : <SectionEmpty>No follow-ups from them.</SectionEmpty>}</section>
      </section>
      <section className="contact-intelligence-section memory"><header><span><Sparkles size={19} /><div><h2>What AmirOS knows now</h2><p>Important current context about {selectedPerson.contactName}.</p></div></span></header>{currentMemory.length ? <div className="contact-topic-list">{currentMemory.map((item) => <TopicItem key={item.id} item={item} removing={removingItemKey === `insight:${item.id}`} onRemove={() => void removeItem(`insight:${item.id}`, () => onInsightStatus(selectedPerson.chatId, item.id, "outdated"))} />)}</div> : <SectionEmpty>No confirmed relationship context yet.</SectionEmpty>}</section>
      {historicalMemory.length ? <details className="contact-memory-history"><summary><span><Clock3 size={17} />Earlier context</span><small>{historicalMemory.length} {historicalMemory.length === 1 ? "memory" : "memories"} preserved</small><ChevronDown size={16} /></summary><div className="contact-topic-list">{historicalMemory.map((item) => <TopicItem key={item.id} item={item} historical removing={removingItemKey === `insight:${item.id}`} onRemove={() => void removeItem(`insight:${item.id}`, () => onInsightStatus(selectedPerson.chatId, item.id, "outdated"))} />)}</div></details> : null}
      <section className="contact-timeline"><header><span><Clock3 size={19} /><div><h2>Conversation timeline</h2><p>Recent events and confirmed relationship context.</p></div></span></header>{timeline.length ? <div>{timeline.map((item) => <button type="button" key={item.id} onClick={() => onOpenChat(selectedPerson.chatId)}><time>{shortDate(item.timestamp)}</time><span><small>{item.label}</small><strong dir="auto">{compactRelationshipItemTitle(commitmentPresentation(item.content).title)}</strong></span><ArrowRight size={14} /></button>)}</div> : <SectionEmpty>No relationship activity has been saved yet.</SectionEmpty>}</section>
    </main>;
  }

  return <main className="main-content secondary-page people-experience">
    <header className="people-page-header"><div><h1>People</h1><p>Your people, summarized by AmirOS.</p></div><button className="icon-button" aria-label="Refresh people" disabled={loading} onClick={() => void onRefresh()}><Sparkles size={18} className={loading ? "spin" : ""} /></button></header>
    <section className="people-directory-tools" aria-label="Find people"><label><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people" aria-label="Search people" />{query ? <button type="button" aria-label="Clear people search" onClick={() => setQuery("")}>×</button> : null}</label><div className="people-filter-bar" aria-label="Filter people">{(["all", "favorites", "family", "friends", "work", "groups", "hidden"] as PeopleFilter[]).map((item) => <button key={item} type="button" className={filter === item ? "active" : ""} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item === "all" ? "All people" : item === "waiting" ? "Follow-ups" : item[0].toUpperCase() + item.slice(1)} <span>{filterCounts[item]}</span></button>)}</div></section>
    <section className="people-quick-views" aria-label="Quick view collections">
      <QuickViewCard icon={Heart} label="Favorites" description="People you want close" people={favoritePeople} chats={chatById} active={filter === "favorites"} onClick={() => setFilter("favorites")} />
      <QuickViewCard icon={MessageCircle} label="Follow-ups" description="Replies and commitments to review" people={waitingPeople} chats={chatById} active={filter === "waiting"} onClick={() => setFilter("waiting")} />
      <QuickViewCard icon={CalendarDays} label="Upcoming" description="Plans and important dates" people={upcomingPeople} chats={chatById} active={filter === "upcoming"} onClick={() => setFilter("upcoming")} />
      <QuickViewCard icon={Clock3} label="Recently active" description="Your latest conversations" people={recentlyActivePeople} chats={chatById} active={filter === "recent"} onClick={() => setFilter("recent")} />
    </section>
    <section className="people-directory" aria-label="People directory">{visiblePeople.map((person, index) => {
      const preferences = contacts[person.chatId];
      const relationship = relationshipLabel(person, preferences);
      const plans = confirmedUpcomingPlans(person);
      const commitments = openCommitments(person);
      const replyCoveredByCommitment = commitmentCoversReply(commitments.filter((item) => item.owner === "me"), person.lastIncoming?.content);
      const waitingOnMe = (person.needsReply && !replyCoveredByCommitment ? 1 : 0) + commitments.filter((item) => item.owner === "me").length;
      const waitingOnThem = commitments.filter((item) => item.owner !== "me").length;
      const interactedAt = interactionTimestamp(person);
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
        <div className="people-card-metrics"><span><CalendarDays size={16} /><b>{plans.length}</b><small>Upcoming</small></span><span><MessageCircle size={16} /><b>{waitingOnMe}</b><small>For you</small></span><span><Clock3 size={16} /><b>{waitingOnThem}</b><small>From them</small></span></div>
        <button type="button" className="people-card-footer" onClick={() => setSelectedChatId(person.chatId)}>Last interaction {interactedAt ? relativeTime(interactedAt) : "not available"} <ArrowRight size={16} /></button>
      </article>;
    })}</section>
    {visiblePeople.length === 0 ? <div className="people-directory-empty"><Users size={28} /><strong>{filter === "hidden" ? "No hidden people." : "No people match that filter."}</strong><p>{filter === "hidden" ? "Hidden people will appear here so you can show them again." : "Try a different search or relationship filter."}</p></div> : null}
  </main>;
}
