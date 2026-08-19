import {
  ArrowLeft, ArrowRight, BookmarkPlus, BriefcaseBusiness, CalendarDays, CalendarPlus, Check, ChevronDown,
  CircleDollarSign, Clock3, Copy, Handshake, HeartPulse, House, Lightbulb, ListChecks, LockKeyhole,
  MapPin, MessageCircle, MessageSquarePlus, Music2, PartyPopper, Pin, Plane, Plus, Search, Send,
  SlidersHorizontal, Sparkles, Square, ThumbsDown, ThumbsUp, UsersRound, Wifi, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { chooseAssistantHandleCenter } from "../assistant-docking";
import {
  ASSISTANT_DISCOVERY_ROTATION_MS,
  buildAssistantSuggestionCards,
  rotateAssistantSuggestions,
  type AssistantSuggestionCard,
  type AssistantSuggestionIcon,
} from "../assistant-suggestions";
import { parseAssistantAnswer } from "../assistant-format";
import { formatDateTime } from "../format";
import type {
  AnswerPointIcon, AssistantSuggestionContext, ChatSummary, IntelligenceAnswerFeedbackInput,
  IntelligenceAnswerFeedbackReason, IntelligenceAnswerFeedbackSummary, IntelligenceData, IntelligenceSearchResult,
} from "../types";
import { ContactAvatar } from "./ContactAvatar";

const PINNED_ANSWERS_KEY = "amiros-pinned-answers";
const DRAWER_TRANSITION_MS = 820;
const feedbackReasonLabels: Array<{ id: IntelligenceAnswerFeedbackReason; label: string }> = [
  { id: "outdated_or_incorrect", label: "Outdated or incorrect" },
  { id: "wrong_person", label: "Wrong person" },
  { id: "missed_context", label: "Missed context" },
  { id: "irrelevant", label: "Not relevant" },
  { id: "unclear", label: "Unclear" },
  { id: "too_long", label: "Too long" },
];

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

const suggestionIcons = {
  communication: MessageCircle,
  connection: Handshake,
  people: UsersRound,
  work: BriefcaseBusiness,
} satisfies Record<AssistantSuggestionIcon, typeof Sparkles>;

function AskInsightPreview({
  suggestion,
  index,
  hero = false,
  onSelect,
}: {
  suggestion: AssistantSuggestionCard;
  index: number;
  hero?: boolean;
  onSelect: () => void;
}) {
  const Icon = suggestionIcons[suggestion.icon];
  if (hero) return <button className="ask-drawer-discovery-hero" onClick={onSelect}>
    <span className="ask-drawer-discovery-hero-media" aria-hidden="true">
      <ContactAvatar name={suggestion.contactName} src={suggestion.avatarUrl} tone={index} className="ask-drawer-discovery-hero-avatar" />
      <span className="ask-drawer-discovery-hero-icon"><Icon size={25} strokeWidth={1.8} /></span>
    </span>
    <span className="ask-drawer-discovery-hero-copy">
      <b>{suggestion.contactName}</b>
      <strong>{suggestion.title}</strong>
      <small>{suggestion.preview}</small>
      <em>{suggestion.detail}</em>
      <span>See what changed <ArrowRight size={18} strokeWidth={1.9} /></span>
    </span>
  </button>;

  return <button className="ask-drawer-discovery-row" onClick={onSelect}>
    <span className="ask-drawer-discovery-row-media" aria-hidden="true">
      <ContactAvatar name={suggestion.contactName} src={suggestion.avatarUrl} tone={index} className="ask-drawer-discovery-row-avatar" />
      <span className="ask-drawer-discovery-row-icon"><Icon size={15} strokeWidth={1.9} /></span>
    </span>
    <span className="ask-drawer-discovery-row-copy">
      <b>{suggestion.contactName}</b>
      <strong>{suggestion.title}</strong>
      <small>{suggestion.preview}</small>
      <em>{suggestion.detail}</em>
    </span>
    <ArrowRight size={20} strokeWidth={1.8} aria-hidden="true" />
  </button>;
}

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
  suggestionContext?: AssistantSuggestionContext;
  improvement?: { answerId: string; reasons?: IntelligenceAnswerFeedbackReason[]; note?: string };
  signal?: AbortSignal;
};

type FloatingAssistantProps = {
  data?: IntelligenceData;
  chats: ChatSummary[];
  ownerProfile: { displayName: string; avatarUrl: string };
  loading: boolean;
  onRefresh: () => Promise<void>;
  onAsk: (query: string, options?: AskOptions) => Promise<IntelligenceSearchResult>;
  onAnswerFeedback: (answerId: string, input: IntelligenceAnswerFeedbackInput) => Promise<IntelligenceAnswerFeedbackSummary>;
  onOpenChat: (chatId: string) => void;
  onOpenCalendar: () => void;
  onSaveKnowledge: (chatId: string, content: string) => Promise<void>;
  onInsertReply: (chatId: string, body: string) => void;
};

export function FloatingAssistant({
  data, chats, ownerProfile, loading, onRefresh, onAsk, onAnswerFeedback, onOpenChat, onOpenCalendar, onSaveKnowledge, onInsertReply,
}: FloatingAssistantProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  const [selectedContactId, setSelectedContactId] = useState<string>();
  const [pendingSuggestionContext, setPendingSuggestionContext] = useState<AssistantSuggestionContext>();
  const [activeSuggestionContext, setActiveSuggestionContext] = useState<AssistantSuggestionContext>();
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
  const [answerStack, setAnswerStack] = useState<Array<{
    answer: IntelligenceSearchResult;
    question: string;
    selectedContactId?: string;
    suggestionContext?: AssistantSuggestionContext;
  }>>([]);
  const [answerOrigin, setAnswerOrigin] = useState<"start" | "history">("start");
  const [feedback, setFeedback] = useState<IntelligenceAnswerFeedbackSummary>();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackReasons, setFeedbackReasons] = useState<Set<IntelligenceAnswerFeedbackReason>>(new Set());
  const [feedbackNote, setFeedbackNote] = useState("");
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [drawerMotion, setDrawerMotion] = useState<"idle" | "opening" | "closing">("idle");
  const [handleCenterY, setHandleCenterY] = useState<number>();
  const [discoveryCycle, setDiscoveryCycle] = useState(0);
  const scope = { knowledge: true, calendar: true };
  const [pinned, setPinned] = useState<Set<string>>(readPinnedAnswers);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const motionTimerRef = useRef<number | undefined>(undefined);
  const openFrameRef = useRef<number | undefined>(undefined);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLElement>(null);
  const queryInputRef = useRef<HTMLInputElement>(null);
  const startScrollTopRef = useRef(0);
  const assistantSuggestions = useMemo(
    () => buildAssistantSuggestionCards(data, chats, Date.now(), ownerProfile),
    [chats, data, ownerProfile],
  );
  const visibleSuggestions = useMemo(
    () => rotateAssistantSuggestions(assistantSuggestions, discoveryCycle),
    [assistantSuggestions, discoveryCycle],
  );
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

  useEffect(() => {
    if (!open || assistantSuggestions.length <= 4) return;
    const timer = window.setInterval(() => setDiscoveryCycle((current) => current + 1), ASSISTANT_DISCOVERY_ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [assistantSuggestions.length, open]);

  const show = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    if (motionTimerRef.current) window.clearTimeout(motionTimerRef.current);
    if (openFrameRef.current) window.cancelAnimationFrame(openFrameRef.current);
    setMounted(true);
    setDrawerMotion("opening");
    openFrameRef.current = window.requestAnimationFrame(() => {
      openFrameRef.current = window.requestAnimationFrame(() => setOpen(true));
    });
    motionTimerRef.current = window.setTimeout(() => setDrawerMotion("idle"), DRAWER_TRANSITION_MS);
    if (!data && !loading) void onRefresh();
  };

  const close = () => {
    abortRef.current?.abort();
    if (motionTimerRef.current) window.clearTimeout(motionTimerRef.current);
    setDrawerMotion("closing");
    setOpen(false);
    closeTimerRef.current = window.setTimeout(() => {
      setMounted(false);
      setDrawerMotion("idle");
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
    if (motionTimerRef.current) window.clearTimeout(motionTimerRef.current);
    if (openFrameRef.current) window.cancelAnimationFrame(openFrameRef.current);
  }, []);

  useEffect(() => {
    if (mounted || window.innerWidth <= 720) {
      if (window.innerWidth <= 720) setHandleCenterY(undefined);
      return;
    }
    let frame = 0;
    const updateDockPosition = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const trigger = triggerRef.current?.getBoundingClientRect();
        if (!trigger) return;
        const controls = [...document.querySelectorAll<HTMLElement>(
          'button, a, input, select, textarea, [role="button"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"]',
        )].filter((element) => {
          if (element.closest(".floating-assistant")) return false;
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight
            && style.display !== "none" && style.visibility !== "hidden";
        }).map((element) => {
          const rect = element.getBoundingClientRect();
          return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left };
        });
        const nextCenter = chooseAssistantHandleCenter({
          viewportHeight: window.innerHeight,
          handleLeft: trigger.left,
          handleRight: trigger.right,
          controls,
        });
        setHandleCenterY((current) => current !== undefined && Math.abs(current - nextCenter) < 1 ? current : nextCenter);
      });
    };
    updateDockPosition();
    const observer = new MutationObserver(updateDockPosition);
    observer.observe(document.querySelector(".app-body") || document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "open", "hidden", "aria-expanded"],
    });
    window.addEventListener("resize", updateDockPosition);
    document.addEventListener("scroll", updateDockPosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", updateDockPosition);
      document.removeEventListener("scroll", updateDockPosition, true);
    };
  }, [mounted]);

  const resetFeedbackComposer = (summary?: IntelligenceAnswerFeedbackSummary) => {
    setFeedback(summary);
    setFeedbackOpen(false);
    setFeedbackReasons(new Set(summary?.reasons || []));
    setFeedbackNote(summary?.note || "");
    setFeedbackSaving(false);
  };

  const ask = async (
    suggestion?: string,
    contactId?: string,
    suggestionContext?: AssistantSuggestionContext,
    improvement?: { answerId: string; reasons?: IntelligenceAnswerFeedbackReason[]; note?: string },
  ) => {
    const question = (suggestion || query).trim();
    if (!question || searching || (!scope.knowledge && !scope.calendar)) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const currentSuggestionContext = suggestionContext || (contactId ? pendingSuggestionContext : activeSuggestionContext);
    const previousAnswer = answer;
    const previousQuestion = lastQuestion;
    const previousContactId = selectedContactId;
    const previousSuggestionContext = activeSuggestionContext || pendingSuggestionContext;
    if (!previousAnswer) startScrollTopRef.current = bodyRef.current?.scrollTop || 0;
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
        suggestionContext: currentSuggestionContext,
        improvement,
        signal: controller.signal,
      });
      if (previousAnswer) {
        setAnswerStack((current) => [...current, {
          answer: previousAnswer,
          question: previousQuestion,
          selectedContactId: previousContactId,
          suggestionContext: previousSuggestionContext,
        }]);
      } else {
        setAnswerStack([]);
        setAnswerOrigin("start");
      }
      setAnswer(result);
      setQuery("");
      setSelectedContactId(result.disambiguation?.length
        ? undefined
        : result.resolvedContactId || contactId || result.sources[0]?.chatId);
      if (!result.disambiguation?.length) {
        setActiveSuggestionContext(currentSuggestionContext);
        setPendingSuggestionContext(undefined);
      }
      resetFeedbackComposer();
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
    setActiveSuggestionContext(undefined);
    setAnswerStack([]);
    setCopied(false);
    setSaved(false);
    setEvidenceOpen(false);
    resetFeedbackComposer();
  };

  const startNewQuestion = () => {
    abortRef.current?.abort();
    setSearching(false);
    setResolvingContactId(undefined);
    setHistoryOpen(false);
    setError(undefined);
    setQuery("");
    clearAnswer();
    window.requestAnimationFrame(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; });
  };

  const goBack = () => {
    abortRef.current?.abort();
    setSearching(false);
    setResolvingContactId(undefined);
    const previous = answerStack.at(-1);
    if (previous) {
      setAnswerStack((current) => current.slice(0, -1));
      setAnswer(previous.answer);
      setLastQuestion(previous.question);
      setSelectedContactId(previous.selectedContactId);
      setActiveSuggestionContext(previous.suggestionContext);
      setPendingSuggestionContext(previous.answer.disambiguation?.length ? previous.suggestionContext : undefined);
      setQuery("");
      setEvidenceOpen(false);
      resetFeedbackComposer();
      window.requestAnimationFrame(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; });
      return;
    }
    const returnToHistory = answerOrigin === "history";
    clearAnswer();
    setHistoryOpen(returnToHistory);
    window.requestAnimationFrame(() => {
      if (bodyRef.current && !returnToHistory) bodyRef.current.scrollTop = startScrollTopRef.current;
      if (!returnToHistory) queryInputRef.current?.focus();
    });
  };

  const toggleFeedbackReason = (reason: IntelligenceAnswerFeedbackReason) => {
    setFeedbackReasons((current) => {
      const next = new Set(current);
      if (next.has(reason)) next.delete(reason); else next.add(reason);
      return next;
    });
  };

  const submitAnswerFeedback = async (rating: "helpful" | "needs_work") => {
    if (!answer?.answerId || feedbackSaving) return;
    if (rating === "needs_work" && !feedbackOpen) {
      setFeedbackOpen(true);
      return;
    }
    setFeedbackSaving(true);
    try {
      const savedFeedback = await onAnswerFeedback(answer.answerId, {
        rating,
        reasons: rating === "needs_work" ? [...feedbackReasons] : [],
        note: rating === "needs_work" ? feedbackNote : undefined,
        suggestionContext: activeSuggestionContext,
      });
      setFeedback(savedFeedback);
      setFeedbackOpen(false);
    } catch (feedbackError) {
      setError(feedbackError instanceof Error ? feedbackError.message : "Could not save feedback");
    } finally {
      setFeedbackSaving(false);
    }
  };

  const improveAnswer = async () => {
    if (!answer?.answerId) return;
    await submitAnswerFeedback("needs_work");
    if (!feedbackReasons.size && !feedbackNote.trim()) return;
    await ask(lastQuestion, undefined, undefined, {
      answerId: answer.answerId,
      reasons: [...feedbackReasons],
      note: feedbackNote.trim() || undefined,
    });
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
    setAnswer({ answerId: item.id, answer: item.answer, evidenceIds: item.sources.map((source) => source.id), sources: item.sources });
    setAnswerStack([]);
    setAnswerOrigin("history");
    setActiveSuggestionContext(undefined);
    resetFeedbackComposer(item.feedback);
    setHistoryOpen(false);
  };

  return <div className={`floating-assistant ${open ? "open" : ""} ${mounted ? "mounted" : ""} ${drawerMotion !== "idle" ? `motion-${drawerMotion}` : ""}`} style={handleCenterY === undefined ? undefined : { "--ask-handle-y": `${handleCenterY}px` } as CSSProperties}>
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
        <main ref={bodyRef} className="ask-drawer-body" aria-live="polite">
          {searching ? <div className="ask-drawer-loading"><Sparkles size={18} /><span><strong>{progress}</strong><small>Only the sources you enabled are being checked.</small></span><button onClick={stopSearch}>Stop</button></div> : null}
          {error ? <div className="inline-error">{error}</div> : null}

          {!answer && !searching ? <section className="ask-drawer-empty ask-drawer-proactive">
            <div className="floating-ai-search ask-drawer-empty-composer"><input ref={queryInputRef} autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void ask(); }} placeholder="Ask about a person, plan, or conversation…" />
              <button className="floating-ai-send" disabled={!query.trim()} aria-label="Ask" onClick={() => void ask()}><Send size={16} /></button>
            </div>

            {visibleSuggestions.length ? <section key={discoveryCycle} className="ask-drawer-discoveries" aria-label="Relationship insights">
              <p className="ask-drawer-discoveries-eyebrow"><Sparkles size={15} />Ask noticed</p>
              <AskInsightPreview
                suggestion={visibleSuggestions[0]!}
                index={0}
                hero
                onSelect={() => void ask(
                  visibleSuggestions[0]!.question,
                  visibleSuggestions[0]!.suggestionContext.chatId,
                  visibleSuggestions[0]!.suggestionContext,
                )}
              />
              {visibleSuggestions.length > 1 ? <section className="ask-drawer-discoveries-more">
                <h3>Also worth knowing</h3>
                <div>{visibleSuggestions.slice(1).map((suggestion, index) => <AskInsightPreview
                  key={suggestion.id}
                  suggestion={suggestion}
                  index={index + 1}
                  onSelect={() => void ask(suggestion.question, suggestion.suggestionContext.chatId, suggestion.suggestionContext)}
                />)}</div>
              </section> : null}
            </section> : <p className="ask-drawer-proactive-empty">Ask anything above. Ask only surfaces timely, grounded context when there is something genuinely useful to know.</p>}

            <footer><span><Sparkles size={14} />Only timely, grounded context appears here.</span><button onClick={() => setHistoryOpen(true)}>Answer history</button></footer>
          </section> : null}

          {answer ? <>
            <section className="ask-drawer-question">
              <div className="ask-drawer-question-copy">
                <div className="ask-drawer-question-topline">
                  <button className="ask-drawer-back" onClick={goBack}><ArrowLeft size={14} />Back</button>
                  <small>You asked</small>
                </div>
                <p dir="auto">{lastQuestion}</p>
              </div>
            </section>

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
              {activeChat ? <button className="ask-drawer-person" onClick={() => { onOpenChat(activeChat.id); close(); }}><ContactAvatar name={activeChat.name} src={activeChat.avatarUrl} className="ask-drawer-person-avatar" /><span dir="auto"><strong>{activeChat.name}</strong><small>Selected person</small></span><ArrowRight size={15} /></button> : null}
              <FormattedAnswer text={answer.answer} listIcons={answer.listIcons} />

              {evidenceSources.length ? <section className="ask-drawer-grounding"><button onClick={() => setEvidenceOpen((value) => !value)} aria-expanded={evidenceOpen}><span><Sparkles size={14} />Grounded in {sourceChats.length} conversation{sourceChats.length === 1 ? "" : "s"} and {evidenceSources.length} source{evidenceSources.length === 1 ? "" : "s"}</span><ChevronDown size={15} className={evidenceOpen ? "open" : ""} /></button>{evidenceOpen ? <div>{evidenceSources.map((source) => <article key={source.id}><span><strong>{source.contactName}</strong><small>{source.senderName ? `Sent by ${source.senderName}` : source.kind.replaceAll("_", " ")}</small></span><p dir="auto">{source.content.replace(/^\[Chat: [^\]]+\]\s*/u, "")}</p><button onClick={() => { onOpenChat(source.chatId); close(); }}>Open source<ArrowRight size={12} /></button></article>)}</div> : null}</section> : <p className="ask-drawer-no-sources">No supporting sources were returned for this answer.</p>}

              {answer.answerId ? <section className={`ask-answer-feedback ${feedbackOpen ? "open" : ""}`} aria-label="Answer feedback">
                <div className="ask-answer-feedback-prompt">
                  <span>{feedback ? "Thanks — your feedback was saved." : "Was this useful?"}</span>
                  <span>
                    <button className={feedback?.rating === "helpful" ? "selected" : ""} disabled={feedbackSaving} aria-label="Helpful answer" title="Helpful" onClick={() => void submitAnswerFeedback("helpful")}><ThumbsUp size={15} /></button>
                    <button className={feedback?.rating === "needs_work" ? "selected" : ""} disabled={feedbackSaving} aria-label="Answer needs work" title="Needs work" onClick={() => void submitAnswerFeedback("needs_work")}><ThumbsDown size={15} /></button>
                  </span>
                </div>
                {feedbackOpen ? <div className="ask-answer-feedback-details">
                  <strong>What should improve?</strong>
                  <div className="ask-answer-feedback-reasons">{feedbackReasonLabels.map((reason) => <button key={reason.id} className={feedbackReasons.has(reason.id) ? "selected" : ""} aria-pressed={feedbackReasons.has(reason.id)} onClick={() => toggleFeedbackReason(reason.id)}>{reason.label}</button>)}</div>
                  <label><span>Optional note</span><textarea value={feedbackNote} maxLength={320} onChange={(event) => setFeedbackNote(event.target.value)} placeholder="Tell AmirOS what would make this answer better." /></label>
                  <footer>
                    {feedbackReasons.has("outdated_or_incorrect") ? <button className="review" disabled={feedbackSaving} onClick={() => void (async () => { await submitAnswerFeedback("needs_work"); await ask("Which saved knowledge supports this answer, and what should I review?"); })()}>Review knowledge</button> : <span />}
                    <button className="improve" disabled={feedbackSaving || (!feedbackReasons.size && !feedbackNote.trim())} onClick={() => void improveAnswer()}>{feedbackSaving ? "Saving…" : "Improve answer"}</button>
                  </footer>
                </div> : null}
              </section> : null}

              <div className="floating-ai-search ask-drawer-followup"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void ask(); }} placeholder="Ask a follow-up…" />{searching ? <button className="floating-ai-stop" aria-label="Stop search" title="Stop search" onClick={stopSearch}><Square size={13} /></button> : <button className="floating-ai-send" disabled={!query.trim()} aria-label="Ask follow-up" onClick={() => void ask()}><Send size={16} /></button>}</div>

              <footer className="ask-drawer-answer-actions">
                <button onClick={() => void copyAnswer()}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy"}</button>
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
    <button ref={triggerRef} className="floating-assistant-trigger" aria-label={open ? "Close Ask AmirOS" : "Open Ask AmirOS"} aria-expanded={open} aria-controls="ask-amiros-drawer" title={open ? "Close Ask AmirOS" : "Open Ask AmirOS"} onClick={open ? close : show}><Sparkles size={20} /><span>Ask AmirOS</span></button>
  </div>;
}
