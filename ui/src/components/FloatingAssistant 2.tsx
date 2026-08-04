import { ArrowRight, Check, Copy, Search, Send, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { parseAssistantAnswer } from "../assistant-format";
import type { IntelligenceData, IntelligenceSearchResult } from "../types";

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
  onAsk: (query: string) => Promise<IntelligenceSearchResult>;
  onOpenChat: (chatId: string) => void;
};

export function FloatingAssistant({ data, loading, onRefresh, onAsk, onOpenChat }: FloatingAssistantProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [answer, setAnswer] = useState<IntelligenceSearchResult>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const suggestions = (data?.suggestedQuestions || ["What’s on my schedule this week?", "Who should I reply to?"]).slice(0, 3);
  const evidenceSources = answer ? [...new Map(answer.sources.map((source) => [source.chatId, source])).values()] : [];

  const show = () => {
    setOpen(true);
    if (!data && !loading) void onRefresh();
  };
  const ask = async (suggestion?: string) => {
    const question = (suggestion || query).trim();
    if (!question || searching) return;
    setQuery(question); setSearching(true); setError(undefined); setCopied(false);
    try { setAnswer(await onAsk(question)); }
    catch (searchError) { setError(searchError instanceof Error ? searchError.message : "Could not search your saved conversations"); }
    finally { setSearching(false); }
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
  const clearAnswer = () => { setAnswer(undefined); setCopied(false); };

  return <div className={`floating-assistant ${open ? "open" : ""}`}>
    {open ? <section className="floating-assistant-panel" aria-label="Ask AmirOS">
      <header><span><span className="floating-ai-mark"><Sparkles size={18} /></span><span><strong>Ask AmirOS</strong><small>Private relationship intelligence</small></span></span><button aria-label="Close Ask AmirOS" onClick={() => setOpen(false)}><X size={17} /></button></header>
      <div className="floating-ai-search"><Search size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void ask(); }} placeholder="Ask about people, plans, or promises…" />{query ? <button aria-label="Clear question" onClick={() => setQuery("")}><X size={14} /></button> : null}<button className="floating-ai-send" disabled={!query.trim() || searching} aria-label="Ask" onClick={() => void ask()}><Send size={16} /></button></div>
      <div className="floating-ai-suggestions">{suggestions.map((suggestion) => <button key={suggestion} disabled={searching} onClick={() => void ask(suggestion)}>{suggestion}</button>)}</div>
      {searching ? <div className="floating-ai-loading"><Sparkles size={16} />Searching local memory…</div> : null}
      {error ? <div className="inline-error">{error}</div> : null}
      {answer ? <article className="floating-ai-answer">
        <header className="floating-ai-answer-header"><span><small>Answer</small><strong>AmirOS</strong></span><span className="floating-ai-answer-actions"><button aria-label="Copy last answer" title="Copy answer" onClick={() => void copyAnswer()}>{copied ? <Check size={14} /> : <Copy size={14} />}<span>{copied ? "Copied" : "Copy"}</span></button><button aria-label="Clear last answer" title="Dismiss answer" onClick={clearAnswer}><X size={15} /></button></span></header>
        <FormattedAnswer text={answer.answer} />
        {evidenceSources.length ? <footer className="floating-ai-evidence"><small>{evidenceSources.length} evidence {evidenceSources.length === 1 ? "source" : "sources"}</small><div>{evidenceSources.slice(0, 3).map((source) => <button key={source.chatId} aria-label={`Open evidence source ${source.contactName}`} onClick={() => { onOpenChat(source.chatId); setOpen(false); }}>{source.contactName}<ArrowRight size={12} /></button>)}{evidenceSources.length > 3 ? <span>+{evidenceSources.length - 3}</span> : null}</div></footer> : null}
      </article> : null}
    </section> : null}
    <button className="floating-assistant-trigger" aria-label={open ? "Close Ask AmirOS" : "Ask AmirOS"} onClick={() => open ? setOpen(false) : show()}><Sparkles size={21} /><span>Ask AmirOS</span></button>
  </div>;
}
