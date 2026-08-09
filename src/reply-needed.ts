import { createHash } from "node:crypto";

/** Increment this when a rule or the AI prompt changes, so older judgments are never reused. */
export const REPLY_DETECTION_VERSION = "reply-needed-v1";
export const REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
/** Only an explicitly ambiguous assessment below this band may spend an AI call. */
export const REPLY_AI_FALLBACK_CONFIDENCE_THRESHOLD = 90;

export type ReplyDecisionSource = "deterministic" | "ai";
export type ReplyDecisionReason =
  | "direct_question"
  | "direct_request"
  | "mentioned_in_group"
  | "owner_replied"
  | "acknowledgement"
  | "conversation_ended"
  | "stale"
  | "informational"
  | "ambiguous"
  | "no_message";

export type ReplyAssessment = {
  /** A sufficiently supported reason to surface the conversation as needing a reply. */
  needsReply: boolean;
  /** The conversation is uncertain enough that a later UI may describe it as a possible reply. */
  mayNeedReply: boolean;
  /** A 0–100 confidence value; deterministic and AI values use the same scale. */
  confidence: number;
  source: ReplyDecisionSource;
  reason: ReplyDecisionReason | string;
};

export type DeterministicReplyAssessment = ReplyAssessment & {
  requiresAi: boolean;
};

export type ReplyAssessmentContextEntry = {
  role: "user" | "assistant";
  author?: "owner" | "contact" | "group_member" | "assistant";
  content: string;
  senderName?: string;
  ownerMentioned?: boolean;
  timestamp: number;
  messageId?: string;
};

export type CachedReplyAssessment = ReplyAssessment & {
  contextKey: string;
  createdAt: number;
};

export type ReplyAssessmentCache = {
  getReplyAssessment(chatId: string, contextKey: string): CachedReplyAssessment | undefined;
  setReplyAssessment(chatId: string, assessment: CachedReplyAssessment): void;
};

export type ReplyAssessmentAi = {
  isConfigured(): boolean;
  assessReplyNeed(input: {
    chatId: string;
    ownerName: string;
    contactName: string;
    isGroup: boolean;
    messages: ReplyAssessmentContextEntry[];
  }): Promise<{ needsReply: boolean; confidence: number; reason: string }>;
};

export type ReplyAssessmentInput = {
  chatId: string;
  content?: string;
  latestMessageIsIncoming: boolean;
  lastIncomingAt?: number;
  ownerName?: string;
  ownerMentioned?: boolean;
  now?: number;
};

const QUESTION_MARK_PATTERN = /[?？]\s*$/u;
const DIRECT_QUESTION_START_PATTERN = /^(?:\s*(?:hey|hi)\b[\s,–—-]*)?(?:who|what|when|where|why|how|can|could|would|will|do|does|did|are|is|should)\b|^\s*(?:מי|מה|מתי|איפה|היכן|למה|איך|האם)(?=\s|$|[?？])/iu;
const DIRECT_REQUEST_PATTERN = /\b(?:please|pls|can you|could you|would you|will you|send me|tell me|let me know|remind me|don['’]t forget|need you to)\b|(?:^|\s)(?:בבקשה|תוכל|תוכלי|תשלח|תשלחי|תגיד|תגידי|תעדכן|תעדכני|תזכיר|תזכירי|אל תשכח|אל תשכחי)(?:\s|$)/iu;
const GROUP_UNADDRESSED_REQUEST_PATTERN = /^\s*(?:(?:hey|hi)\b[\s,–—-]*)?(?:can you|could you|would you|will you|please\s+(?:send|tell)|(?:תוכל|תוכלי|תשלח|תשלחי|תגיד|תגידי|תעדכן|תעדכני|תזכיר|תזכירי))(?:\s|$)/iu;
const ACKNOWLEDGEMENT_PATTERN = /^(?:ok(?:ay)?|k|thanks(?:\s+again)?|thank\s+you|got it|sounds good|all good|perfect|great|no worries|understood|👍|🙏|❤️|\+1|סבבה|תודה(?: רבה)?|הבנתי|מעולה|אחלה|בסדר)[.!…\s]*$/iu;
const CONVERSATION_ENDING_PATTERN = /^(?:(?:talk|speak|catch up)\s+(?:to you )?later|have a (?:good|great) (?:day|night|weekend)|good ?night|bye(?: for now)?|נדבר(?: אחר כך)?|לילה טוב|יום טוב)[.!…\s]*$/iu;
const AMBIGUOUS_REPLY_CUE_PATTERN = /\b(?:wondering|thoughts|your take|when you get a chance|would love to|are you around|maybe we could|not sure if)\b|(?:מעניין אם|מה דעתך|כשתוכל|כשיתאפשר|אולי אפשר)/iu;

function toMilliseconds(value: number | undefined) {
  if (!value) return undefined;
  return value < 10_000_000_000 ? value * 1_000 : value;
}

function normalizedText(value: string | undefined) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function normalizedOwnerTokens(ownerName?: string) {
  return normalizedText(ownerName)
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/u)
    .filter((token) => token.length >= 3);
}

function ownerIsMentioned(message: string, ownerName?: string) {
  const lower = message.toLocaleLowerCase();
  return normalizedOwnerTokens(ownerName).some((token) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}])`, "iu").test(lower));
}

function decision(
  needsReply: boolean,
  mayNeedReply: boolean,
  confidence: number,
  reason: ReplyDecisionReason,
  ambiguous = false,
): DeterministicReplyAssessment {
  return {
    needsReply,
    mayNeedReply,
    confidence,
    source: "deterministic",
    reason,
    requiresAi: ambiguous && mayNeedReply && confidence < REPLY_AI_FALLBACK_CONFIDENCE_THRESHOLD,
  };
}

/**
 * Fast, conservative first pass. Ambiguous cases deliberately retain their
 * uncertainty instead of pretending that every incoming message needs action.
 */
export function assessDeterministicReplyNeed(input: ReplyAssessmentInput): DeterministicReplyAssessment {
  if (!input.latestMessageIsIncoming) return decision(false, false, 100, "owner_replied");

  const message = normalizedText(input.content);
  if (!message || message === "Media message" || message.length > 1_200) {
    return decision(false, false, 100, "no_message");
  }

  const lastIncomingAt = toMilliseconds(input.lastIncomingAt);
  const now = input.now || Date.now();
  if (lastIncomingAt && now - lastIncomingAt > REPLY_WINDOW_MS) {
    return decision(false, false, 96, "stale");
  }

  if (ACKNOWLEDGEMENT_PATTERN.test(message)) return decision(false, false, 97, "acknowledgement");
  if (CONVERSATION_ENDING_PATTERN.test(message)) return decision(false, false, 95, "conversation_ended");

  const isGroup = input.chatId.endsWith("@g.us");
  const isQuestion = QUESTION_MARK_PATTERN.test(message) || DIRECT_QUESTION_START_PATTERN.test(message);
  const isRequest = DIRECT_REQUEST_PATTERN.test(message);

  if (!isGroup) {
    if (isRequest) return decision(true, true, 97, "direct_request");
    if (isQuestion) return decision(true, true, QUESTION_MARK_PATTERN.test(message) ? 96 : 92, "direct_question");
    if (AMBIGUOUS_REPLY_CUE_PATTERN.test(message)) return decision(false, true, 52, "ambiguous", true);
    return decision(false, false, 88, "informational");
  }

  const addressedToOwner = input.ownerMentioned === true || ownerIsMentioned(message, input.ownerName);
  if (addressedToOwner && (isQuestion || isRequest)) return decision(true, true, 98, "mentioned_in_group");
  if (GROUP_UNADDRESSED_REQUEST_PATTERN.test(message)) return decision(false, true, 54, "ambiguous", true);
  if (addressedToOwner && AMBIGUOUS_REPLY_CUE_PATTERN.test(message)) return decision(false, true, 50, "ambiguous", true);
  return decision(false, false, 90, "informational");
}

/** The cache fingerprint contains only the chat's recent local context and a rule version. */
export function replyAssessmentContextKey(chatId: string, messages: ReplyAssessmentContextEntry[]) {
  const relevant = messages.slice(-8).map((entry) => ({
    id: entry.messageId || undefined,
    author: entry.author || entry.role,
    mentioned: entry.ownerMentioned === true,
    at: toMilliseconds(entry.timestamp),
    content: normalizedText(entry.content).slice(0, 600),
  }));
  return createHash("sha256")
    .update(JSON.stringify({ version: REPLY_DETECTION_VERSION, chatId, messages: relevant }))
    .digest("hex");
}

function publicDecision(decisionWithMetadata: DeterministicReplyAssessment): ReplyAssessment {
  const { requiresAi: _requiresAi, ...assessment } = decisionWithMetadata;
  return assessment;
}

function sanitizeAiReason(reason: string) {
  return normalizedText(reason).replace(/[^\p{L}\p{N}\s_.,:;!?'’-]/gu, "").slice(0, 160) || "ambiguous_context";
}

/**
 * Uses an injected existing AI service only after the deterministic assessment
 * says that the latest message is genuinely ambiguous. The caller can cap AI
 * work per request with `allowAi` without altering the final cache contract.
 */
export async function resolveReplyAssessment(input: ReplyAssessmentInput & {
  contactName: string;
  context: ReplyAssessmentContextEntry[];
  cache?: ReplyAssessmentCache;
  ai?: ReplyAssessmentAi;
  allowAi?: boolean;
}): Promise<ReplyAssessment> {
  const deterministic = assessDeterministicReplyNeed(input);
  if (!deterministic.requiresAi) return publicDecision(deterministic);

  const contextKey = replyAssessmentContextKey(input.chatId, input.context);
  const cached = input.cache?.getReplyAssessment(input.chatId, contextKey);
  if (cached) {
    return {
      needsReply: cached.needsReply,
      mayNeedReply: cached.mayNeedReply,
      confidence: cached.confidence,
      source: "ai",
      reason: cached.reason,
    };
  }

  if (input.allowAi === false || !input.ai?.isConfigured()) return publicDecision(deterministic);

  try {
    const result = await input.ai.assessReplyNeed({
      chatId: input.chatId,
      ownerName: normalizedText(input.ownerName) || "the owner",
      contactName: input.contactName,
      isGroup: input.chatId.endsWith("@g.us"),
      messages: input.context.slice(-8),
    });
    const confidence = Math.max(0, Math.min(100, Math.round(Number(result.confidence) || 0)));
    const assessment: CachedReplyAssessment = {
      needsReply: result.needsReply === true,
      mayNeedReply: result.needsReply === true || confidence < 80,
      confidence,
      source: "ai",
      reason: sanitizeAiReason(result.reason),
      contextKey,
      createdAt: input.now || Date.now(),
    };
    input.cache?.setReplyAssessment(input.chatId, assessment);
    return publicDecision({ ...assessment, requiresAi: false });
  } catch (error) {
    console.warn("Ambiguous reply assessment fell back to deterministic rules", {
      chatId: input.chatId,
      error: error instanceof Error ? error.message : String(error),
    });
    return publicDecision(deterministic);
  }
}
