import type { ContactInsight, IntelligenceSearchRecord } from "./amiros-state.js";

export type MemoryCorrectionOperation = "reject" | "forget" | "historical" | "replace";

export type MemoryCorrectionCandidate = Pick<
  IntelligenceSearchRecord,
  "id" | "chatId" | "content" | "status" | "knowledgeValidity"
> & {
  canonicalKey?: string;
  kind: ContactInsight["kind"];
};

export type MemoryCorrectionInterpretation = {
  operation: MemoryCorrectionOperation;
  targetIds: string[];
  replacementContent?: string;
  confidence: number;
  reason: string;
};

const CORRECTION_LANGUAGE = /(?:\b(?:that(?:['’]s| is) (?:wrong|incorrect|outdated)|you(?:['’]re| are) wrong|not true|isn(?:'t|’t) true|no longer|doesn(?:'t|’t) (?:work|live|like)|why (?:are|do) you still (?:say|saying|use)|don(?:'t|’t) use|stop using|forget (?:that|this)|remove (?:that|this)|delete (?:that|this)|used to be true|was true|(?:that|this|it) was temporary|mark (?:that|this) (?:as )?(?:historical|temporary)|correction|correct that)\b|(?:זה לא נכון|לא נכון|תשכח|תשכחי|אל תשתמש|כבר לא|פעם זה היה נכון))/iu;

export function looksLikeMemoryCorrection(value: string, hasPriorAnswer = false): boolean {
  const text = value.replace(/\s+/gu, " ").trim();
  return CORRECTION_LANGUAGE.test(text) || (hasPriorAnswer && /^(?:no[,.!]?|actually|instead|rather)\b/iu.test(text));
}

export function correctionReliesOnPriorAnswer(value: string): boolean {
  const text = value.replace(/\s+/gu, " ").trim();
  return /^(?:no[,.!]?|actually\b|instead\b|rather\b)/iu.test(text) ||
    /\b(?:that|this|it)(?:['’]s| is| was)?\b|\byou(?:['’]re| are) wrong\b|\bwhy (?:are|do) you still (?:say|saying|use)\b|(?:זה|זאת|אותו|אותה)/iu.test(text);
}

export function looksLikeCorrectionClarificationReply(
  value: string,
  candidates: MemoryCorrectionCandidate[],
): boolean {
  const text = value.replace(/\s+/gu, " ").trim().toLocaleLowerCase();
  if (!text || text.length > 240) return false;
  if (/^(?:[1-4]|first|second|third|fourth|the (?:first|second|third|fourth)(?: one)?)[.!]?$/iu.test(text)) return true;
  const ignored = new Set(["that", "this", "with", "from", "about", "what", "which", "your", "their", "there", "have", "does", "work", "works", "live", "lives", "used", "true"]);
  const words = new Set((text.match(/[\p{L}\p{N}]{4,}/gu) || []).filter((word) => !ignored.has(word)));
  const matchingCandidates = candidates.filter((candidate) => {
    const candidateWords = candidate.content.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];
    return candidateWords.some((word) => words.has(word));
  });
  return matchingCandidates.length === 1;
}

export function deterministicCorrectionOperation(value: string): Exclude<MemoryCorrectionOperation, "replace"> | undefined {
  const text = value.replace(/\s+/gu, " ").trim();
  if (/\b(?:forget|remove|delete) (?:that|this)|\bdon(?:'t|’t) use (?:that|this)|\bstop using (?:that|this)|(?:תשכח|תשכחי|אל תשתמש)/iu.test(text)) return "forget";
  if (/\b(?:used to be true|was true|(?:that|this|it) was temporary|mark (?:that|this) (?:as )?(?:historical|temporary))\b|(?:פעם זה היה נכון)/iu.test(text)) return "historical";
  if (/\b(?:that(?:['’]s| is) (?:wrong|incorrect)|you(?:['’]re| are) wrong|not true|isn(?:'t|’t) true)\b|(?:זה לא נכון|לא נכון)/iu.test(text)) return "reject";
  return undefined;
}

export function correctionConfirmation(
  operation: MemoryCorrectionOperation,
  previousContent: string,
  replacementContent?: string,
): string {
  if (operation === "replace" && replacementContent) {
    return `Got it. I’ll treat “${replacementContent}” as current, and keep “${previousContent}” only as history.`;
  }
  if (operation === "historical") {
    return `Got it. I’ll keep “${previousContent}” as historical context, not current truth.`;
  }
  if (operation === "forget") {
    return `Done. I won’t use “${previousContent}” as memory anymore.`;
  }
  return `Thanks for correcting me. I won’t treat “${previousContent}” as true.`;
}

export function correctionClarification(candidates: MemoryCorrectionCandidate[]): string {
  if (candidates.length === 1) {
    return `I found “${candidates[0]!.content}.” Should I treat it as wrong, historical, or replace it with something new?`;
  }
  const choices = candidates.slice(0, 4).map((item) => `“${item.content}”`);
  return choices.length
    ? `I found more than one memory this could mean. Which one should I change: ${choices.join(" or ")}?`
    : "I understand that you want to correct something, but I couldn’t find a canonical memory tied to that statement. Tell me the person and the fact you want changed.";
}

export type MemoryCorrectionInterpreter = (input: {
  request: string;
  candidates: MemoryCorrectionCandidate[];
  previousQuestion?: string;
  previousAnswer?: string;
}) => Promise<MemoryCorrectionInterpretation>;

export async function resolveMemoryCorrection(input: {
  request: string;
  candidates: MemoryCorrectionCandidate[];
  previousQuestion?: string;
  previousAnswer?: string;
  interpret: MemoryCorrectionInterpreter;
}): Promise<{ interpretation?: MemoryCorrectionInterpretation; needsClarification: boolean }> {
  const deterministic = deterministicCorrectionOperation(input.request);
  if (deterministic && input.candidates.length === 1) {
    return {
      interpretation: {
        operation: deterministic,
        targetIds: [input.candidates[0]!.id],
        confidence: 100,
        reason: "The owner named one supported memory and a clear correction action.",
      },
      needsClarification: false,
    };
  }
  let interpretation: MemoryCorrectionInterpretation;
  try {
    interpretation = await input.interpret({
      request: input.request,
      candidates: input.candidates,
      previousQuestion: input.previousQuestion,
      previousAnswer: input.previousAnswer,
    });
  } catch {
    // A correction must never fail open. If an ambiguous request cannot be
    // interpreted, leave canonical memory untouched and ask the owner.
    return { needsClarification: true };
  }
  const validTarget = interpretation.targetIds.length === 1 && input.candidates.some((candidate) => candidate.id === interpretation.targetIds[0]);
  const hasReplacement = interpretation.operation !== "replace" || Boolean(interpretation.replacementContent);
  return validTarget && hasReplacement && interpretation.confidence >= 85
    ? { interpretation, needsClarification: false }
    : { needsClarification: true };
}

export type AppliedMemoryCorrectionResult = {
  previous: { content: string };
  current?: { content: string };
  correction: { operation: MemoryCorrectionOperation };
};

export async function executeMemoryCorrection(input: {
  request: string;
  candidates: MemoryCorrectionCandidate[];
  previousQuestion?: string;
  previousAnswer?: string;
  interpret: MemoryCorrectionInterpreter;
  apply: (input: {
    chatId: string;
    insightId: string;
    operation: MemoryCorrectionOperation;
    replacementContent?: string;
    sourceText: string;
  }) => AppliedMemoryCorrectionResult | undefined;
}): Promise<
  | { status: "clarification"; answer: string }
  | { status: "failed"; answer: string }
  | { status: "applied"; answer: string; result: AppliedMemoryCorrectionResult }
> {
  if (!input.candidates.length) {
    return { status: "clarification", answer: correctionClarification([]) };
  }
  const resolved = await resolveMemoryCorrection({
    request: input.request,
    candidates: input.candidates,
    previousQuestion: input.previousQuestion,
    previousAnswer: input.previousAnswer,
    interpret: input.interpret,
  });
  if (!resolved.interpretation || resolved.needsClarification) {
    return { status: "clarification", answer: correctionClarification(input.candidates) };
  }
  const targetId = resolved.interpretation.targetIds[0]!;
  const target = input.candidates.find((candidate) => candidate.id === targetId)!;
  const applied = input.apply({
    chatId: target.chatId,
    insightId: target.id,
    operation: resolved.interpretation.operation,
    replacementContent: resolved.interpretation.replacementContent,
    sourceText: input.request,
  });
  if (!applied) {
    return {
      status: "failed",
      answer: "I couldn’t safely apply that memory correction. Please try again with the person and fact you mean.",
    };
  }
  return {
    status: "applied",
    answer: correctionConfirmation(
      applied.correction.operation,
      applied.previous.content,
      applied.current?.content,
    ),
    result: applied,
  };
}
