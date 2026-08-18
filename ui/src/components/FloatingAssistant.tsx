import {
  ArrowLeft, ArrowRight, BookmarkPlus, BriefcaseBusiness, CalendarDays, CalendarPlus, Check, ChevronDown,
  CircleDollarSign, Clock3, Copy, Handshake, HeartPulse, House, Lightbulb, ListChecks, LockKeyhole,
  MapPin, MessageCircle, MessageSquarePlus, Music2, PartyPopper, Pin, Plane, Plus, Search, Send,
  SlidersHorizontal, Sparkles, Square, UsersRound, Wifi, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseAssistantAnswer } from "../assistant-format";
import { formatDateTime } from "../format";
import type { AnswerPointIcon, ChatSummary, IntelligenceData, IntelligenceSearchResult } from "../types";
import { ContactAvatar } from "./ContactAvatar";

const PINNED_ANSWERS_KEY = "amiros-pinned-answers";
const DRAWER_TRANSITION_MS = 820;

function formatSuggestionTime(timestamp?: number) {
  if (!timestamp) return "Coming up";
  const date = new Date(timestamp);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const sameDay = (left: Date, right: Date) => left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay(date, today)) return `Today, ${time}`;
  if (sameDay(date, tomorrow)) return `Tomorrow, ${time}`;
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function cleanSuggestionTitle(title: string) {
  return title.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "").replace(/\s{2,}/gu, " ").trim();
}

function formatKnowledgeUpdated(timestamp: number) {
  const updated = new Date(timestamp);
  const today = new Date();
  const sameDay = (left: Date, right: Date) => left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
  if (sameDay(updated, today)) return "Updated today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(updated, yesterday)) return "Updated yesterday";
  return `Updated ${updated.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: updated.getFullYear() === today.getFullYear() ? undefined : "numeric",
  })}`;
}

function readPinnedAnswers(): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(PINNED_ANSWERS_KEY) || "[]") as unknown;
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function RichText({ text, emphasizeLabel = false }: { text: string; emphasizeLabel?: boolean }) {
  if (emphasizeLabel && !text.includes("*")) {
    const labeledItem = text.match(/^([^:]{1,48}:)\s*(.+)$/u);
    if (labeledItem) return <><strong>{labeledItem[1]}</strong><span> {labeledItem[2]}</span></>;
  }
  const parts = text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g).filter(Boolean);
  return <>{parts.map((part, index) => {
    const strong = part.match(/^\*\*([^*]+)\*\*$/)?.[1] || part.match(/^\*([^*]+)\*$/)?.[1];
    return strong ? <strong key={`${strong}-${index}`}>{strong}</strong> : <span key={`${part}-${index}`}>{part}</span>;
  })}</>;
}

const answerPointIcons = {
  calendar: CalendarDays,
  collaboration: Handshake,
  communication: MessageCircle,
  connection: Wifi,
  event: PartyPopper,
  home: House,
  idea: Lightbulb,
  location: MapPin,
  money: CircleDollarSign,
  music: Music2,
  people: UsersRound,
  preference: SlidersHorizontal,
  task: ListChecks,
  time: Clock3,
  travel: Plane,
  wellbeing: HeartPulse,
  work: BriefcaseBusiness,
} satisfies Record<AnswerPointIcon, typeof Sparkles>;

function inferAnswerPointIcon(text: string): AnswerPointIcon {
  const value = text.replace(/[*_]/gu, "").toLocaleLowerCase();
  if (/internet|wifi|online|connection|connectivity/u.test(value)) return "connection";
  if (/party|invite|invited|event|celebrat/u.test(value)) return "event";
  if (/love|misses|affection|babe|relationship/u.test(value)) return "people";
  if (/music|dj|song|played|concert/u.test(value)) return "music";
  if (/film|hollywood|career|job|work|product|sales|customer/u.test(value)) return "work";
  if (/calendar|schedule|meeting|appointment/u.test(value)) return "calendar";
  if (/today|tomorrow|hour|time|deadline|due/u.test(value)) return "time";
  if (/home|house|rent/u.test(value)) return "home";
  if (/money|payment|paid|price|cost/u.test(value)) return "money";
  if (/travel|flight|trip|abroad/u.test(value)) return "travel";
  if (/health|sick|well|energy|doctor/u.test(value)) return "wellbeing";
  if (/where|location|based|city|country/u.test(value)) return "location";
  if (/prefer|likes|wants|flexible/u.test(value)) return "preference";
  if (/need|todo|to-do|send|follow up|promise/u.test(value)) return "task";
  if (/together|collaborat|partner|team/u.test(value)) return "collaboration";
  if (/message|said|asked|reply|contacted/u.test(value)) return "communication";
  if (/person|people|friend|family/u.test(value)) return "people";
  return "idea";
}

function FormattedAnswer({ text, listIcons = [] }: { text: string; listIcons?: AnswerPointIcon[] }) {
  const blocks = parseAssistantAnswer(text);
  let listItemOffset = 0;
  return <div className="floating-ai-answer-content" dir="auto">{blocks.map((block, index) => {
    if (block.type !== "list") return <p key={`paragraph-${index}`}><RichText text={block.text} /></p>;
    const currentOffset = listItemOffset;
    listItemOffset += block.items.length;
    return <ul className="answer-icon-list" key={`list-${index}`}>{block.items.map((item, itemIndex) => {
      const Icon = answerPointIcons[listIcons[currentOffset + itemIndex] || inferAnswerPointIcon(item)];
      return <li className="answer-icon-item" key={`${item}-${itemIndex}`}>
        <span className="answer-point-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.8} /></span>
        <span><RichText text={item} emphasizeLabel /></span>
      </li>;
    })}</ul>;
  })}</div>;
}

type AskOptions = {
  followUp?: { question: string; answer: string; sourceRefs?: Array<{ id: string; chatId: string; kind: "insight" }> };
  scope?: { knowledge: boolean; calendar: boolean };
  selectedContactId?: string;
  suggestionContext?: { chatId: string; sourceIds: string[] };
  signal?: AbortSignal;
};

type FloatingAssistantProps = {
  data?: IntelligenceData;
  chats: ChatSummary[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onAsk: (query: string, options?: AskOptions) => Promise<IntelligenceSearchResult>;
  onOpenChat: (chatId: string) => void;
  onOpenCalendar: () => void;
  onSaveKnowledge: (chatId: string, content: string) => Promise<void>;
  onInsertReply: (chatId: string, body: string) => void;
};

export function FloatingAssistant({
  data, chats, loading, onRefresh, onAsk, onOpenChat, onOpenCalendar, onSaveKnowledge, onInsertReply,
}: FloatingAssistantProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  const [selectedContactId, setSelectedContactId] = useState<string>();
  const [pendingSuggestionContext, setPendingSuggestionContext] = useState<{ chatId: string; sourceIds: string[] }>();
  const [resolvingContactId, setResolvingContactId] = useState<string>();
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState("Searching your private index…");
  const [answer, setAnswer] = useState<IntelligenceSearchResult>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const scope = { knowledge: true, calendar: true };
  const [pinned, setPinned] = useState<Set<string>>(readPinnedAnswers);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const openFrameRef = useRef<number | undefined>(undefined);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const proactiveSuggestions = useMemo(() => {
    const trusted = [...(data?.proactive || [])]
      .filter((item) => item.sourceIds.length > 0)
      .filter((item) => !item.aiAssessment || item.aiAssessment.confidence >= 85)
      .filter((item) => item.kind === "upcoming_context" || item.kind === "commitment" || item.kind === "todo")
      .filter((item) => item.kind !== "upcoming_context" || item.sourceIds.length >= 2)
      .sort((left, right) => left.priority - right.priority || left.timestamp - right.timestamp)
      .slice(0, 2);
    const knowledge = [...(data?.proactive || [])]
      .filter((item) => item.kind === "meaningful_change" && item.sourceIds.length > 0)
      .filter((item) => !item.aiAssessment || item.aiAssessment.confidence >= 85)
      .sort((left, right) => left.priority - right.priority || right.timestamp - left.timestamp)[0];
    const upcoming = trusted.map((item) => ({
      id: item.id,
      title: cleanSuggestionTitle(item.title),
      detail: item.detail,
      badge: formatSuggestionTime(item.timestamp),
      question: item.kind === "upcoming_context"
        ? `What should I know ${item.title.replace(/^Before\s+/iu, "before ")}?`
        : item.kind === "commitment"
          ? `What did I promise ${item.contactName}, and when is it due?`
          : `What do I need to do for ${item.contactName}, and what context matters?`,
      kind: item.kind === "upcoming_context" ? "calendar" as const : "message" as const,
      suggestionContext: { chatId: item.chatId, sourceIds: item.sourceIds },
    }));
    const knowledgeChat = knowledge ? chats.find((chat) => chat.id === knowledge.chatId) : undefined;
    return {
      upcoming,
      knowledge: knowledge ? {
        id: knowledge.id,
        contactName: knowledge.contactName,
        avatarUrl: knowledgeChat?.avatarUrl,
        content: knowledge.detail,
        question: `What should I remember about ${knowledge.contactName}?`,
        freshnessLabel: formatKnowledgeUpdated(knowledge.sourceTimestamp || knowledge.timestamp),
        suggestionContext: { chatId: knowledge.chatId, sourceIds: knowledge.sourceIds },
      } : undefined,
    };
  }, [chats, data?.proactive]);
  const evidenceSources = answer ? [...new Map(answer.sources.map((source) => [source.id, source])).values()] : [];
  const sourceChats = answer ? [...new Map(answer.sources.map((source) => [source.chatId, source])).values()] : [];
  const firstSource = sourceChats[0];
  const activeContactId = selectedContactId || firstSource?.chatId;
  const activeChat = chats.find((chat) => chat.id === activeContactId);
  const hasCalendar = answer?.sources.some((source) => source.kind === "calendar_event");
  const history = useMemo(() => (data?.questionHistory || []).filter((item) => {
    const search = historySearch.trim().toLocaleLowerCase();
    return !search || `${item.question} ${item.answer}`.toLocaleLowerCase().includes(search);
  }), [data?.questionHistory, historySearch]);

  useEffect(() => {
    if (!searching) return;
    const steps = ["Searching your private index…", "Checking conversations and contacts…", "Writing a grounded answer…"];
    let index = 0;
    const timer = window.setInterval(() => { index = Math.min(index + 1, steps.length - 1); setProgress(steps[index]!); }, 900);
    return () => window.clearInterval(timer);
  }, [searching]);

  const show = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    if (openFrameRef.current) window.cancelAnimationFrame(openFrameRef.current);
    setMounted(true);
    openFrameRef.current = window.requestAnimationFrame(() => {
      openFrameRef.current = window.requestAnimationFrame(() => setOpen(true));
    });
    if (!data && !loading) void onRefresh();
  };

  const close = () => {
    abortRef.current?.abort();
    setOpen(false);
    closeTimerRef.current = window.setTimeout(() => {
      setMounted(false);
      triggerRef.current?.focus();
    }, DRAWER_TRANSITION_MS);
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    if (openFrameRef.current) window.cancelAnimationFrame(openFrameRef.current);
  }, []);

  const ask = async (
    suggestion?: string,
    contactId?: string,
    suggestionContext?: { chatId: string; sourceIds: string[] },
  ) => {
    const question = (suggestion || query).trim();
    if (!question || searching || (!scope.knowledge && !scope.calendar)) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const activeSuggestionContext = suggestionContext || (contactId ? pendingSuggestionContext : undefined);
    if (suggestionContext) setPendingSuggestionContext(suggestionContext);
    setLastQuestion(question);
    setSearching(true);
    setResolvingContactId(contactId);
    setProgress(contactId ? "Continuing with this person…" : "Searching your private index…");
    setError(undefined);
    setCopied(false);
    setSaved(false);
    setEvidenceOpen(false);
    const followUp = answer && lastQuestion && !answer.disambiguation?.length && !contactId ? {
      question: lastQuestion,
      answer: answer.answer,
      sourceRefs: answer.sources
        .filter((source) => source.kind === "insight")
        .map((source) => ({ id: source.id, chatId: source.chatId, kind: "insight" as const })),
    } : undefined;
    try {
      const result = await onAsk(question, {
        followUp,
        scope,
        selectedContactId: contactId,
        suggestionContext: activeSuggestionContext,
        signal: controller.signal,
      });
      setAnswer(result);
      setQuery("");
      setSelectedContactId(result.disambiguation?.length
        ? undefined
        : result.resolvedContactId || contactId || result.sources[0]?.chatId);
      if (!result.disambiguation?.length) setPendingSuggestionContext(undefined);
    } catch (searchError) {
      if ((searchError as Error)?.name !== "AbortError") setError(searchError instanceof Error ? searchError.message : "Could not search your private index");
    } finally {
      if (abortRef.current === controller) abortRef.current = undefined;
      setSearching(false);
      setResolvingContactId(undefined);
    }
  };

  const stopSearch = () => {
    abortRef.current?.abort();
    setSearching(false);
    setResolvingContactId(undefined);
    setProgress("Search stopped");
  };

  const copyAnswer = async () => {
    if (!answer) return;
    try {
      await navigator.clipboard.writeText(answer.answer);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_800);
    } catch {
      setError("Could not copy this answer");
    }
  };

  const clearAnswer = () => {
    setAnswer(undefined);
    setLastQuestion("");
    setSelectedContactId(undefined);
    setPendingSuggestionContext(undefined);
    setCopied(false);
    setSaved(false);
    setEvidenceOpen(false);
  };

  const startNewQuestion = () => {
    abortRef.current?.abort();
    setSearching(false);
    setResolvingContactId(undefined);
    setHistoryOpen(false);
    setError(undefined);
    setQuery("");
    clearAnswer();
  };

  const togglePin = () => {
    if (!lastQuestion) return;
    setPinned((current) => {
      const next = new Set(current);
      if (next.has(lastQuestion)) next.delete(lastQuestion); else next.add(lastQuestion);
      localStorage.setItem(PINNED_ANSWERS_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const saveKnowledge = async () => {
    if (!firstSource || !answer) return;
    try {
      await onSaveKnowledge(firstSource.chatId, answer.answer);
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save this answer as knowledge");
    }
  };

  const selectHistoryItem = (item: IntelligenceData["questionHistory"][number]) => {
    setLastQuestion(item.question);
    setQuery("");
    setSelectedContactId(item.sources[0]?.chatId);
    setAnswer({ answer: item.answer, evidenceIds: item.sources.map((source) => source.id), sources: item.sources });
    setHistoryOpen(false);
  };

  return <div className={`floating-assistant ${open ? "open" : ""} ${mounted ? "mounted" : ""}`}>
    {mounted ? <div className="ask-drawer-depth" aria-hidden="true" /> : null}
    {mounted ? <section id="ask-amiros-drawer" className="floating-assistant-panel ask-drawer" role="dialog" aria-modal="false" aria-label="Ask AmirOS">
      <header className="ask-drawer-header">
        <span><span className="floating-ai-mark"><Sparkles size={18} /></span><span><strong>Ask AmirOS</strong><small>Private relationship intelligence</small></span></span>
        <span className="ask-drawer-header-actions">
          <button className="ask-drawer-new-question" onClick={startNewQuestion}><Plus size={17} /><span>New question</span></button>
        </span>
      </header>

      {historyOpen ? <section className="ask-drawer-history" aria-label="Answer history">
        <header><button onClick={() => setHistoryOpen(false)}><ArrowLeft size={15} />Back</button><strong>Answer history</strong></header>
        <label><Search size={15} /><input autoFocus value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Search previous answers" /></label>
        <div>{history.slice(0, 12).map((item) => <button key={item.id} onClick={() => selectHistoryItem(item)}><span><strong>{item.question}</strong><small>{formatDateTime(item.createdAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small></span>{pinned.has(item.question) ? <Pin size={13} /> : <ArrowRight size={13} />}</button>)}{history.length === 0 ? <p>No matching answers yet.</p> : null}</div>
      </section> : <>
        <main className="ask-drawer-body" aria-live="polite">
          {searching ? <div className="ask-drawer-loading"><Sparkles size={18} /><span><strong>{progress}</strong><small>Only the sources you enabled are being checked.</small></span><button onClick={stopSearch}>Stop</button></div> : null}
          {error ? <div className="inline-error">{error}</div> : null}

          {!answer && !searching ? <section className="ask-drawer-empty ask-drawer-proactive">
            <h2>What can I help with?</h2>
            <div className="floating-ai-search ask-drawer-empty-composer"><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void ask(); }} placeholder="Ask about a person, plan, or conversation…" />
              <button className="floating-ai-send" disabled={!query.trim()} aria-label="Ask" onClick={() => void ask()}><Send size={16} /></button>
            </div>

            {proactiveSuggestions.upcoming.length ? <section className="ask-drawer-proactive-group">
              <h3>Coming up</h3>
              <div className="ask-drawer-proactive-list">{proactiveSuggestions.upcoming.map((suggestion) => <button key={suggestion.id} onClick={() => void ask(suggestion.question, undefined, suggestion.suggestionContext)}>
                <span className="ask-drawer-proactive-icon">{suggestion.kind === "calendar" ? <CalendarDays size={17} /> : <MessageCircle size={17} />}</span>
                <span><strong>{suggestion.title}</strong><small>{suggestion.detail}</small></span>
                <span><small>{suggestion.badge}</small><ArrowRight size={15} /></span>
              </button>)}</div>
            </section> : null}

            {proactiveSuggestions.knowledge ? <section className="ask-drawer-proactive-group ask-drawer-remember">
              <h3>Worth remembering</h3>
              <button onClick={() => void ask(
                proactiveSuggestions.knowledge?.question,
                undefined,
                proactiveSuggestions.knowledge?.suggestionContext,
              )}>
                <ContactAvatar name={proactiveSuggestions.knowledge.contactName} src={proactiveSuggestions.knowledge.avatarUrl} className="ask-drawer-remember-avatar" />
                <span><strong>{proactiveSuggestions.knowledge.content}</strong><small>Relationship knowledge · {proactiveSuggestions.knowledge.freshnessLabel}</small></span>
                <ArrowRight size={15} />
              </button>
            </section> : null}

            {!proactiveSuggestions.upcoming.length && !proactiveSuggestions.knowledge
              ? <p className="ask-drawer-proactive-empty">No high-confidence suggestions yet. Ask anything above and AmirOS will stay within what it can support.</p>
              : null}

            <footer><span>Suggestions update as plans and knowledge change.</span><button onClick={() => setHistoryOpen(true)}>Answer history</button></footer>
          </section> : null}

          {answer ? <>
            <section className="ask-drawer-question"><small>You asked</small><p dir="auto">{lastQuestion}</p></section>

            {answer.disambiguation?.length ? <section className="ask-drawer-disambiguation">
              <header><h2>Which {answer.disambiguation[0]?.contactName.split(/\s+/u)[0] || "person"} do you mean?</h2><p>We found more than one match.</p></header>
              <div className="ask-drawer-candidates">{answer.disambiguation.map((candidate, index) => {
                const chat = chats.find((item) => item.id === candidate.chatId);
                const context = candidate.detail?.trim() || chat?.preview?.trim() || (chat?.isGroup ? "Group conversation" : "Private chat");
                const [primaryContext, secondaryContext] = context.split(/\s+·\s+/u, 2);
                const lastInteractionAt = candidate.lastInteractionAt || chat?.timestamp;
                return <button key={candidate.chatId} disabled={searching} className={resolvingContactId === candidate.chatId ? "resolving" : ""} aria-label={`Choose ${candidate.contactName}${context ? `, ${context}` : ""}`} onClick={() => void ask(lastQuestion, candidate.chatId)}>
                  <ContactAvatar name={candidate.contactName} src={candidate.avatarUrl || chat?.avatarUrl} tone={index} className="ask-drawer-candidate-avatar" />
                  <span><strong>{candidate.contactName}</strong><small>{primaryContext}</small>{secondaryContext ? <small>{secondaryContext}</small> : null}</span>
                  <span><small>Last interaction</small><time>{lastInteractionAt ? formatDateTime(lastInteractionAt, { month: "short", day: "numeric", year: "numeric" }) : "Unknown"}</time></span>
                  <ArrowRight size={17} />
                </button>;
              })}</div>
              <p className="ask-drawer-continue-note"><LockKeyhole size={14} />Your question will continue after you choose.</p>
              <button className="ask-drawer-type-fallback" onClick={() => { clearAnswer(); setQuery(lastQuestion); }}>Can’t find the right person? <strong>Type a name instead</strong></button>
            </section> : <article className="ask-drawer-answer">
              {activeChat ? <button className="ask-drawer-person" onClick={() => { onOpenChat(activeChat.id); close(); }}><ContactAvatar name={activeChat.name} src={activeChat.avatarUrl} className="ask-drawer-person-avatar" /><span><strong>{activeChat.name}</strong><small>Selected person</small></span><ArrowRight size={15} /></button> : null}
              <FormattedAnswer text={answer.answer} listIcons={answer.listIcons} />

              {evidenceSources.length ? <section className="ask-drawer-grounding"><button onClick={() => setEvidenceOpen((value) => !value)} aria-expanded={evidenceOpen}><span><Sparkles size={14} />Grounded in {sourceChats.length} conversation{sourceChats.length === 1 ? "" : "s"} and {evidenceSources.length} source{evidenceSources.length === 1 ? "" : "s"}</span><ChevronDown size={15} className={evidenceOpen ? "open" : ""} /></button>{evidenceOpen ? <div>{evidenceSources.map((source) => <article key={source.id}><span><strong>{source.contactName}</strong><small>{source.senderName ? `Sent by ${source.senderName}` : source.kind.replaceAll("_", " ")}</small></span><p dir="auto">{source.content.replace(/^\[Chat: [^\]]+\]\s*/u, "")}</p><button onClick={() => { onOpenChat(source.chatId); close(); }}>Open source<ArrowRight size={12} /></button></article>)}</div> : null}</section> : <p className="ask-drawer-no-sources">No supporting sources were returned for this answer.</p>}

              <div className="floating-ai-search ask-drawer-followup"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void ask(); }} placeholder="Ask a follow-up…" />{searching ? <button className="floating-ai-stop" aria-label="Stop search" title="Stop search" onClick={stopSearch}><Square size={13} /></button> : <button className="floating-ai-send" disabled={!query.trim()} aria-label="Ask follow-up" onClick={() => void ask()}><Send size={16} /></button>}</div>

              <footer className="ask-drawer-answer-actions">
                <button onClick={() => void copyAnswer()}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy"}</button>
                {activeContactId ? <button className="primary" onClick={() => { onOpenChat(activeContactId); close(); }}><ArrowRight size={15} />Open contact</button> : null}
              </footer>

              <details className="ask-drawer-more-actions"><summary>More actions<ChevronDown size={14} /></summary><div>
                <button className={pinned.has(lastQuestion) ? "active" : ""} onClick={togglePin}><Pin size={14} />{pinned.has(lastQuestion) ? "Pinned" : "Pin answer"}</button>
                {hasCalendar ? <button onClick={() => { onOpenCalendar(); close(); }}><CalendarPlus size={14} />Open calendar</button> : null}
                {firstSource ? <button onClick={() => void saveKnowledge()}><BookmarkPlus size={14} />{saved ? "Saved" : "Save as knowledge"}</button> : null}
                {firstSource ? <button onClick={() => { onInsertReply(firstSource.chatId, answer.answer); close(); }}><MessageSquarePlus size={14} />Insert reply</button> : null}
                <button onClick={clearAnswer}><X size={14} />Clear answer</button>
              </div></details>
            </article>}
          </> : null}
        </main>
      </>}
    </section> : null}
    <button ref={triggerRef} className="floating-assistant-trigger" aria-label={open ? "Close Ask AmirOS" : "Open Ask AmirOS"} aria-expanded={open} aria-controls="ask-amiros-drawer" title={open ? "Close Ask AmirOS" : "Open Ask AmirOS"} onClick={open ? close : show}><Sparkles size={21} /><span>Ask AmirOS</span></button>
  </div>;
}
