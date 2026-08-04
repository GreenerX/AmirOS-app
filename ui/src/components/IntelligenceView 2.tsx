import {
  ArrowRight,
  BrainCircuit,
  Check,
  CheckCircle2,
  Clock3,
  MessageCircleQuestion,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import { useState } from "react";
import { formatTime } from "../format";
import type {
  IntelligenceData,
  IntelligenceSearchResult,
  RelationshipCommitment,
} from "../types";

type IntelligenceViewProps = {
  data?: IntelligenceData;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onAsk: (query: string) => Promise<IntelligenceSearchResult>;
  onOpenChat: (chatId: string) => void;
  onCommitmentStatus: (
    chatId: string,
    commitmentId: string,
    status: RelationshipCommitment["status"],
  ) => Promise<void>;
};

export function IntelligenceView({
  data,
  loading,
  onRefresh,
  onAsk,
  onOpenChat,
  onCommitmentStatus,
}: IntelligenceViewProps) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<IntelligenceSearchResult>();
  const [error, setError] = useState<string>();

  const ask = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setError(undefined);
    try {
      setResult(await onAsk(query.trim()));
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Could not search relationship memory");
    } finally {
      setSearching(false);
    }
  };

  const openCommitments = data?.commitments.filter((item) => item.status === "open") || [];
  const needsReply = data?.needsReply || [];
  const changes = data?.changes || [];

  return (
    <main className="main-content intelligence-page">
      <header className="page-header intelligence-header">
        <div>
          <span className="eyebrow"><BrainCircuit size={15} /> Private relationship intelligence</span>
          <h1>Relationship Radar</h1>
          <p>A calm briefing built from evidence in your locally saved chats.</p>
        </div>
        <button className="button secondary" disabled={loading} onClick={() => void onRefresh()}>
          <RefreshCw size={17} className={loading ? "spin" : ""} /> Refresh radar
        </button>
      </header>

      <section className="ask-amiros panel">
        <span className="ask-icon"><Sparkles size={21} /></span>
        <div className="ask-copy">
          <strong>Ask AmirOS across your relationships</strong>
          <small>Local prefilter first; relevant excerpts use your active OpenAI model only when you press Ask.</small>
        </div>
        <div className="ask-input">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void ask(); }} placeholder="Search people, facts, promises and conversations…" />
          <button className="button primary compact" disabled={searching || !query.trim()} onClick={() => void ask()}>{searching ? "Thinking…" : "Ask"}</button>
        </div>
      </section>

      {error ? <div className="inline-error">{error}</div> : null}
      {result ? (
        <section className="panel intelligence-answer">
          <div className="panel-heading"><h2><Sparkles size={19} /> AmirOS answer</h2><button className="text-button" onClick={() => setResult(undefined)}>Clear</button></div>
          <p>{result.answer}</p>
          {result.sources.length > 0 ? <div className="evidence-list">
            {result.sources.map((source) => <button key={`${source.chatId}-${source.id}`} className="evidence-source" onClick={() => onOpenChat(source.chatId)}>
              <span><strong>{source.contactName}</strong><small>{source.senderName ? `${source.senderName} · ` : ""}{source.kind} · {formatTime(source.timestamp)}</small></span>
              <span>{source.content}</span><ArrowRight size={16} />
            </button>)}
          </div> : <small>No direct source was strong enough to cite.</small>}
        </section>
      ) : null}

      <section className="radar-metrics">
        <div className="radar-metric"><span><MessageCircleQuestion size={20} /></span><strong>{needsReply.length}</strong><small>Chats may need a reply</small></div>
        <div className="radar-metric"><span><Clock3 size={20} /></span><strong>{openCommitments.length}</strong><small>Open commitments</small></div>
        <div className="radar-metric"><span><TrendingUp size={20} /></span><strong>{changes.length}</strong><small>Recent relationship signals</small></div>
        <div className="radar-metric"><span><UsersRound size={20} /></span><strong>{data?.chats.length || 0}</strong><small>Chats with local memory</small></div>
      </section>

      <div className="radar-grid">
        <section className="panel radar-section">
          <div className="panel-heading"><h2>Needs a reply</h2><span className="count-badge">{needsReply.length}</span></div>
          <div className="radar-list">
            {needsReply.slice(0, 8).map((chat) => <button key={chat.chatId} className="radar-row" onClick={() => onOpenChat(chat.chatId)}>
              <span className="radar-row-icon"><MessageCircleQuestion size={17} /></span>
              <span><strong>{chat.contactName}</strong><small>{chat.lastIncoming?.senderName ? `${chat.lastIncoming.senderName}: ` : ""}{chat.lastIncoming?.content || "Recent incoming message"}</small></span>
              <time>{formatTime(chat.lastIncoming?.timestamp || chat.updatedAt)}</time><ArrowRight size={16} />
            </button>)}
            {needsReply.length === 0 ? <div className="radar-empty"><CheckCircle2 size={20} /><span><strong>Inbox is balanced</strong><small>No saved chat currently ends on an incoming message.</small></span></div> : null}
          </div>
        </section>

        <section className="panel radar-section">
          <div className="panel-heading"><h2>Open commitments</h2><span className="count-badge">{openCommitments.length}</span></div>
          <div className="radar-list">
            {openCommitments.slice(0, 8).map((item) => <div key={item.id} className="radar-row commitment-row">
              <button className="commitment-check" aria-label="Mark commitment done" onClick={() => void onCommitmentStatus(item.chatId, item.id, "done")}><Check size={15} /></button>
              <button className="commitment-copy" onClick={() => onOpenChat(item.chatId)}><strong>{item.contactName}</strong><small>{item.content}</small></button>
              <span className={`owner-pill ${item.owner}`}>{item.owner === "me" ? "Mine" : item.assigneeName || "Theirs"}</span>
            </div>)}
            {openCommitments.length === 0 ? <div className="radar-empty"><CheckCircle2 size={20} /><span><strong>No loose ends</strong><small>Requests and promises detected in new messages will appear here.</small></span></div> : null}
          </div>
        </section>

        <section className="panel radar-section radar-wide">
          <div className="panel-heading"><h2>Relationship changes &amp; learned details</h2><small>Confirm useful inferences inside each contact.</small></div>
          <div className="signal-grid">
            {changes.slice(0, 12).map((item) => <button key={item.id} className="signal-card" onClick={() => onOpenChat(item.chatId)}>
              <span className={`signal-kind ${item.kind}`}>{item.kind.replace("_", " ")}</span>
              <strong>{item.contactName}</strong><p>{item.content}</p>
              <small>{Math.round(item.confidence * 100)}% confidence · {item.status}</small>
            </button>)}
            {changes.length === 0 ? <div className="radar-empty"><BrainCircuit size={20} /><span><strong>Signals will build over time</strong><small>AmirOS tracks explicit preferences, facts, requests and promises from incoming messages.</small></span></div> : null}
          </div>
        </section>
      </div>
    </main>
  );
}
