import {
  ArrowRight, BookmarkPlus, CalendarPlus, Check, ChevronDown, Copy, History,
  MessageSquarePlus, Pin, Search, Send, Sparkles, Square, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseAssistantAnswer } from "../assistant-format";
import { formatDateTime } from "../format";
import type { IntelligenceData, IntelligenceSearchResult } from "../types";

const PINNED_ANSWERS_KEY = "amiros-pinned-answers";

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

function FormattedAnswer({ text }: { text: string }) {
  return <div className="floating-ai-answer-content" dir="auto">{parseAssistantAnswer(text).map((block, index) => block.type === "list"
    ? <ul key={`list-${index}`}>{block.items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}><RichText text={item} emphasizeLabel /></li>)}</ul>
    : <p key={`paragraph-${index}`}><RichText text={block.text} /></p>)}</div>;
}

type FloatingAssistantProps = {
  data?: IntelligenceData;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onAsk: (query: string, options?: {
    followUp?: { question: string; answer: string };
    scope?: { knowledge: boolean; calendar: boolean };
    signal?: AbortSignal;
  }) => Promise<IntelligenceSearchResult>;
  onOpenChat: (chatId: string) => void;
  onOpenCalendar: () => void;
  onSaveKnowledge: (chatId: string, content: string) => Promise<void>;
  onInsertReply: (chatId: string, body: string) => void;
};

export function FloatingAssistant({
  data, loading, onRefresh, onAsk, onOpenChat, onOpenCalendar, onSaveKnowledge, onInsertReply,
}: FloatingAssistantProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState("Searching saved knowledge…");
  const [answer, setAnswer] = useState<IntelligenceSearchResult>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [scope, setScope] = useState({ knowledge: true, calendar: true });
  const [pinned, setPinned] = useState<Set<string>>(readPinnedAnswers);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const suggestions = (data?.suggestedQuestions || ["What’s on my schedule this week?", "Who should I reply to?"]).slice(0, 3);
  const evidenceSources = answer ? [...new Map(answer.sources.map((source) => [source.id, source])).values()] : [];
  const sourceChats = answer ? [...new Map(answer.sources.map((source) => [source.chatId, source])).values()] : [];
  const firstSource = sourceChats[0];
  const hasCalendar = answer?.sources.some((source) => source.kind === "calendar_event");
  const scopeKinds = answer ? new Set(answer.sources.map((source) => source.kind)) : new Set<string>();
  const history = useMemo(() => (data?.questionHistory || []).filter((item) => {
    const search = historySearch.trim().toLocaleLowerCase();
    return !search || `${item.question} ${item.answer}`.toLocaleLowerCase().includes(search);
  }), [data?.questionHistory, historySearch]);

  useEffect(() => {
    if (!searching) return;
    const steps = ["Searching saved knowledge…", "Checking contacts and chats…", "Reviewing calendar context…", "Writing a grounded answer…"];
    let index = 0;
    const timer = window.setInterval(() => { index = Math.min(index + 1, steps.length - 1); setProgress(steps[index]!); }, 900);
    return () => window.clearInterval(timer);
  }, [searching]);

  const show = () => {
    setOpen(true);
    if (!data && !loading) void onRefresh();
  };
  const ask = async (suggestion?: string) => {
    const question = (suggestion || query).trim();
    if (!question || searching || (!scope.knowledge && !scope.calendar)) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setQuery(question); setLastQuestion(question); setSearching(true); setProgress("Searching saved knowledge…"); setError(undefined); setCopied(false); setSaved(false); setEvidenceOpen(false);
    try {
      const followUp = answer && lastQuestion ? { question: lastQuestion, answer: answer.answer } : undefined;
      setAnswer(await onAsk(question, { followUp, scope, signal: controller.signal }));
    } catch (searchError) {
      if ((searchError as Error)?.name !== "AbortError") setError(searchError instanceof Error ? searchError.message : "Could not search your saved conversations");
    } finally {
      if (abortRef.current === controller) abortRef.current = undefined;
      setSearching(false);
    }
  };
  const stopSearch = () => { abortRef.current?.abort(); setSearching(false); setProgress("Search stopped"); };
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
  const clearAnswer = () => { setAnswer(undefined); setLastQuestion(""); setCopied(false); setSaved(false); setEvidenceOpen(false); };
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

  return <div className={`floating-assistant ${open ? "open" : ""}`}>
    {open ? <section className="floating-assistant-panel" aria-label="Ask AmirOS">
      <header><span><span className="floating-ai-mark"><Sparkles size={18} /></span><span><strong>Ask AmirOS</strong><small>Private relationship intelligence</small></span></span><button aria-label="Close Ask AmirOS" onClick={() => setOpen(false)}><X size={17} /></button></header>
      <div className="floating-ai-search"><Search size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void ask(); }} placeholder={answer ? "Ask a follow-up…" : "Ask about people, plans, or tasks…"} />{query ? <button aria-label="Clear question" onClick={() => setQuery("")}><X size={14} /></button> : null}{searching ? <button className="floating-ai-stop" aria-label="Stop search" title="Stop search" onClick={stopSearch}><Square size={13} /></button> : <button className="floating-ai-send" disabled={!query.trim() || (!scope.knowledge && !scope.calendar)} aria-label="Ask" onClick={() => void ask()}><Send size={16} /></button>}</div>
      <div className="floating-ai-suggestions">{suggestions.map((suggestion) => <button key={suggestion} disabled={searching} onClick={() => void ask(suggestion)}>{suggestion}</button>)}</div>
      <div className="floating-ai-scope"><span><Search size={12} />Search scope</span><button className={scope.knowledge ? "active" : ""} aria-pressed={scope.knowledge} onClick={() => setScope((current) => ({ ...current, knowledge: !current.knowledge }))}>Contacts & chats</button><button className={scope.calendar ? "active" : ""} aria-pressed={scope.calendar} onClick={() => setScope((current) => ({ ...current, calendar: !current.calendar }))}>Calendar</button>{answer ? <small>{sourceChats.length} chat{sourceChats.length === 1 ? "" : "s"} · {scopeKinds.size} source type{scopeKinds.size === 1 ? "" : "s"}</small> : <small>{!scope.knowledge && !scope.calendar ? "Choose at least one" : "Private local index"}</small>}</div>
      {searching ? <div className="floating-ai-loading"><Sparkles size={16} />{progress}<button onClick={stopSearch}>Stop</button></div> : null}
      {error ? <div className="inline-error">{error}</div> : null}
      {answer ? <article className="floating-ai-answer">
        <header className="floating-ai-answer-header"><span><small>{lastQuestion || "Answer"}</small><strong>AmirOS</strong></span><span className="floating-ai-answer-actions"><button aria-label="Pin answer" title="Pin answer" className={pinned.has(lastQuestion) ? "active" : ""} onClick={togglePin}><Pin size={14} /><span>{pinned.has(lastQuestion) ? "Pinned" : "Pin"}</span></button><button aria-label="Copy last answer" title="Copy answer" onClick={() => void copyAnswer()}>{copied ? <Check size={14} /> : <Copy size={14} />}<span>{copied ? "Copied" : "Copy"}</span></button><button aria-label="Clear last answer" title="Dismiss answer" onClick={clearAnswer}><X size={15} /></button></span></header>
        <FormattedAnswer text={answer.answer} />
        <div className="floating-ai-context-actions">
          {hasCalendar ? <button onClick={() => { onOpenCalendar(); setOpen(false); }}><CalendarPlus size={13} />Open in calendar</button> : null}
          {firstSource ? <button onClick={() => { onOpenChat(firstSource.chatId); setOpen(false); }}><ArrowRight size={13} />Open contact</button> : null}
          {firstSource ? <button onClick={() => void saveKnowledge()}><BookmarkPlus size={13} />{saved ? "Saved" : "Save as knowledge"}</button> : null}
          {firstSource ? <button onClick={() => { onInsertReply(firstSource.chatId, answer.answer); setOpen(false); }}><MessageSquarePlus size={13} />Insert reply</button> : null}
        </div>
        {evidenceSources.length ? <footer className="floating-ai-evidence-drawer"><button className="floating-ai-evidence-toggle" onClick={() => setEvidenceOpen((value) => !value)}><span>{evidenceSources.length} supporting message{evidenceSources.length === 1 ? "" : "s"}</span><ChevronDown size={14} className={evidenceOpen ? "open" : ""} /></button>{evidenceOpen ? <div className="floating-ai-evidence-list">{evidenceSources.map((source) => <article key={source.id}><span><strong>{source.contactName}</strong><small>{source.senderName ? `Sent by ${source.senderName}` : source.kind.replaceAll("_", " ")}</small></span><p dir="auto">{source.content.replace(/^\[Chat: [^\]]+\]\s*/u, "")}</p><button onClick={() => { onOpenChat(source.chatId); setOpen(false); }}>Open<ArrowRight size={11} /></button></article>)}</div> : null}</footer> : null}
      </article> : null}
      <section className="floating-ai-history"><button onClick={() => setHistoryOpen((value) => !value)}><span><History size={14} />Answer history</span><small>{data?.questionHistory.length || 0}</small><ChevronDown size={14} className={historyOpen ? "open" : ""} /></button>{historyOpen ? <div className="floating-ai-history-body"><label><Search size={13} /><input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Search answers" /></label>{history.slice(0, 8).map((item) => <button key={item.id} onClick={() => { setLastQuestion(item.question); setQuery(""); setAnswer({ answer: item.answer, evidenceIds: item.sources.map((source) => source.id), sources: item.sources }); }}><span><strong>{item.question}</strong><small>{formatDateTime(item.createdAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small></span>{pinned.has(item.question) ? <Pin size={12} /> : <ArrowRight size={12} />}</button>)}{history.length === 0 ? <p>No matching answers yet.</p> : null}</div> : null}</section>
    </section> : null}
    <button className="floating-assistant-trigger" aria-label={open ? "Close Ask AmirOS" : "Ask AmirOS"} onClick={() => open ? setOpen(false) : show()}><Sparkles size={21} /><span>Ask AmirOS</span></button>
  </div>;
}
