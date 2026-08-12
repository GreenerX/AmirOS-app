import type { CalendarEvent, RelationshipCommitment, TodoTask } from "./amiros-state.js";
import { extractTemporalInformation, parseExplicitClockTime } from "./temporal-classifier.js";

export type OwnerRecordKind = "todo" | "calendar" | "commitment";
export type OwnerLifecycleOperation = "complete" | "cancel" | "reschedule" | "rename" | "priority" | "note";

export type OwnerLifecycleRequest = {
  operation: OwnerLifecycleOperation;
  source: string;
  targetQuery?: string;
  targetKind?: OwnerRecordKind;
  targetDate?: number;
  newTitle?: string;
  priority?: TodoTask["priority"];
  note?: string;
  temporal?: {
    timestamp: number;
    hasDate: boolean;
    hasTime: boolean;
  };
  relativeShiftMs?: number;
};

export type OwnerLifecycleCandidate = {
  kind: OwnerRecordKind;
  chatId: string;
  id: string;
  title: string;
  status: TodoTask["status"] | CalendarEvent["status"] | RelationshipCommitment["status"];
  timestamp?: number;
  updatedAt: number;
  evidenceTimestamp?: number;
};

export type PendingOwnerLifecycleClarification = {
  request: OwnerLifecycleRequest;
  candidates: OwnerLifecycleCandidate[];
  createdAt: number;
};

export type OwnerRecordReference = {
  kind: OwnerRecordKind;
  chatId: string;
  id: string;
  title: string;
  referencedAt: number;
};

export type OwnerLifecycleResolution =
  | { status: "matched"; candidate: OwnerLifecycleCandidate }
  | { status: "ambiguous"; candidates: OwnerLifecycleCandidate[] }
  | { status: "not_found" };

const DATE_WORD = String.raw`(?:today|tonight|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday|20\d{2}-\d{1,2}-\d{1,2})`;
const TERMINAL = /[.!?]+$/u;
const GENERIC_REFERENCE = /^(?:it|that|this|that one|this one|that reminder|the reminder|my reminder)$/iu;

function compact(value: string): string {
  return value.replace(/\s+/gu, " ").replace(TERMINAL, "").trim();
}

function targetKindFromText(value: string): OwnerRecordKind | undefined {
  if (/\b(?:appointment|calendar|event|meeting|dinner|lunch|breakfast|therapy|flight|concert|movie)\b/iu.test(value)) return "calendar";
  if (/\b(?:commitment|promise)\b/iu.test(value)) return "commitment";
  if (/\b(?:to[ -]?do|task|reminder|priority|due date)\b/iu.test(value)) return "todo";
  return undefined;
}

function cleanTarget(value: string): string | undefined {
  const cleaned = compact(value)
    .replace(/^\s*(?:the|my|our)\s+/iu, "")
    .replace(new RegExp(String.raw`\b${DATE_WORD}(?:['’]s)?\b`, "giu"), " ")
    .replace(/\b(?:at\s+)?(?:noon|midnight|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return !cleaned || GENERIC_REFERENCE.test(cleaned) ? undefined : cleaned;
}

function temporalChange(value: string, now: number): OwnerLifecycleRequest["temporal"] | undefined {
  const extracted = extractTemporalInformation(value, now);
  if (!extracted) return undefined;
  return {
    timestamp: extracted.timestamp,
    hasDate: new RegExp(String.raw`\b${DATE_WORD}\b`, "iu").test(value),
    hasTime: Boolean(parseExplicitClockTime(value)),
  };
}

/** Parses only lifecycle mutations. Creation parsing remains authoritative for new records. */
export function parseOwnerLifecycleRequest(content: string, now = Date.now()): OwnerLifecycleRequest | undefined {
  const source = compact(content);
  if (!source) return undefined;
  const command = source
    .replace(/^(?:actually|wait|sorry)[,\s]+/iu, "")
    .replace(/^never\s+mind[,\s]+(?=cancel\b)/iu, "");

  let match = command.match(/^rename\s+(.+?)\s+to\s+(.+)$/iu);
  if (match) return {
    operation: "rename", source, targetQuery: cleanTarget(match[1]!), targetKind: targetKindFromText(match[1]!), newTitle: compact(match[2]!).slice(0, 240),
  };
  match = command.match(/^change\s+(?:the\s+)?title(?:\s+of\s+(.+?))?\s+to\s+(.+)$/iu);
  if (match) return {
    operation: "rename", source, targetQuery: cleanTarget(match[1] || "it"), targetKind: targetKindFromText(match[1] || ""), newTitle: compact(match[2]!).slice(0, 240),
  };

  match = command.match(/^make\s+(.+?)\s+(high|normal|low)\s+priority$/iu)
    || command.match(/^set\s+(.+?)\s+priority\s+to\s+(high|normal|low)$/iu);
  if (match) return {
    operation: "priority", source, targetQuery: cleanTarget(match[1]!), targetKind: "todo", priority: match[2]!.toLocaleLowerCase() as TodoTask["priority"],
  };

  match = command.match(/^add\s+(?:a\s+)?note(?:\s+to\s+(.+?))?\s+that\s+(.+)$/iu);
  if (match) return {
    operation: "note", source, targetQuery: cleanTarget(match[1] || "it"), targetKind: targetKindFromText(match[1] || ""), note: compact(match[2]!).slice(0, 1_000),
  };

  match = command.match(/^(?:i\s+(?:have\s+)?(?:finished|completed|did)|done\s+with)\s+(.+)$/iu)
    || command.match(/^mark\s+(.+?)\s+as\s+(?:completed|complete|done)$/iu);
  if (match) return {
    operation: "complete", source, targetQuery: cleanTarget(match[1]!), targetKind: targetKindFromText(match[1]!), targetDate: extractTemporalInformation(match[1]!, now)?.timestamp,
  };

  match = command.match(/^cancel\s+(.+)$/iu)
    || command.match(/^never\s+mind\s+(?:about\s+)?(.+)$/iu)
    || command.match(/^i\s+don['’]?t\s+need\s+(.+?)\s+anymore$/iu);
  if (match) return {
    operation: "cancel", source, targetQuery: cleanTarget(match[1]!), targetKind: targetKindFromText(match[1]!), targetDate: extractTemporalInformation(match[1]!, now)?.timestamp,
  };

  match = command.match(/^push\s+(.+?)\s+back\s+(one|a|\d+)\s+(day|week)s?$/iu);
  if (match) {
    const amount = /^(?:one|a)$/iu.test(match[2]!) ? 1 : Number(match[2]);
    return {
      operation: "reschedule", source, targetQuery: cleanTarget(match[1]!), targetKind: targetKindFromText(match[1]!),
      relativeShiftMs: amount * (/^week$/iu.test(match[3]!) ? 7 : 1) * 86_400_000,
    };
  }

  match = command.match(/^change\s+(?:the\s+)?due\s+date(?:\s+(?:of|for)\s+(.+?))?\s+to\s+(.+)$/iu);
  if (match) {
    const temporal = temporalChange(match[2]!, now);
    if (!temporal) return undefined;
    return { operation: "reschedule", source, targetQuery: cleanTarget(match[1] || "it"), targetKind: "todo", temporal };
  }

  match = command.match(/^(?:move|reschedule)\s+(.+?)\s+to\s+(.+)$/iu)
    || command.match(/^change\s+(.+?)\s+to\s+(.+)$/iu);
  if (match) {
    const temporal = temporalChange(match[2]!, now);
    if (!temporal) return undefined;
    return { operation: "reschedule", source, targetQuery: cleanTarget(match[1]!), targetKind: targetKindFromText(match[1]!), temporal };
  }

  match = command.match(/^make\s+(.+?)(?:\s+instead)?$/iu);
  if (match) {
    const temporal = temporalChange(match[1]!, now);
    if (!temporal) return undefined;
    return { operation: "reschedule", source, temporal };
  }

  return undefined;
}

function localDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

const TOKEN_ALIASES: Record<string, string> = {
  bought: "buy", buying: "buy", groceries: "grocery", shopping: "grocery", finished: "finish", completing: "complete",
};
const STOP_WORDS = new Set(["a", "an", "as", "at", "for", "i", "it", "my", "of", "on", "the", "to", "with"]);

function tokens(value: string): string[] {
  return value.toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/u)
    .filter(Boolean)
    .map((token) => TOKEN_ALIASES[token] || token.replace(/ies$/u, "y").replace(/ing$/u, "").replace(/ed$/u, "").replace(/s$/u, ""))
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function matchScore(query: string, title: string): number {
  const queryTokens = [...new Set(tokens(query))];
  const titleTokens = new Set(tokens(title));
  if (queryTokens.length === 0) return 0;
  const overlap = queryTokens.filter((token) => titleTokens.has(token)).length;
  const coverage = overlap / queryTokens.length;
  const normalizedQuery = queryTokens.join(" ");
  const normalizedTitle = [...titleTokens].join(" ");
  return Math.max(coverage, normalizedTitle.includes(normalizedQuery) || normalizedQuery.includes(normalizedTitle) ? .95 : 0);
}

function activeFor(candidate: OwnerLifecycleCandidate, operation: OwnerLifecycleOperation): boolean {
  if (operation === "complete" || operation === "cancel") {
    if (candidate.kind === "todo") return candidate.status === "open" || candidate.status === "inferred";
    if (candidate.kind === "calendar") return candidate.status === "confirmed" || candidate.status === "inferred";
    return candidate.status === "open" || candidate.status === "needs_review";
  }
  if (candidate.kind === "todo") return candidate.status === "open" || candidate.status === "inferred";
  if (candidate.kind === "calendar") return candidate.status === "confirmed" || candidate.status === "inferred";
  return candidate.status === "open" || candidate.status === "needs_review";
}

export function ownerLifecycleCandidates(input: {
  todos: Array<TodoTask & { chatId: string }>;
  events: Array<CalendarEvent & { chatId: string }>;
  commitments: Array<RelationshipCommitment & { chatId: string }>;
}): OwnerLifecycleCandidate[] {
  return [
    ...input.todos.map((item) => ({ kind: "todo" as const, chatId: item.chatId, id: item.id, title: item.title, status: item.status, timestamp: item.dueAt, updatedAt: item.updatedAt, evidenceTimestamp: item.evidence.timestamp })),
    ...input.events.map((item) => ({ kind: "calendar" as const, chatId: item.chatId, id: item.id, title: item.title, status: item.status, timestamp: item.startAt, updatedAt: item.updatedAt, evidenceTimestamp: item.evidence.timestamp })),
    ...input.commitments.map((item) => ({ kind: "commitment" as const, chatId: item.chatId, id: item.id, title: item.content, status: item.status, timestamp: item.dueAt, updatedAt: item.updatedAt, evidenceTimestamp: item.evidence.timestamp })),
  ];
}

export function resolveOwnerLifecycleTarget(
  request: OwnerLifecycleRequest,
  allCandidates: OwnerLifecycleCandidate[],
  context: { recentReferences?: OwnerRecordReference[]; now?: number } = {},
): OwnerLifecycleResolution {
  let candidates = allCandidates.filter((candidate) => activeFor(candidate, request.operation));
  if (request.targetKind) candidates = candidates.filter((candidate) => candidate.kind === request.targetKind);
  if (request.targetDate && request.operation !== "reschedule") {
    const dated = candidates.filter((candidate) => candidate.timestamp && localDayKey(candidate.timestamp) === localDayKey(request.targetDate!));
    if (dated.length > 0) candidates = dated;
  }
  if (request.targetQuery) {
    const scored = candidates
      .map((candidate) => ({ candidate, score: matchScore(request.targetQuery!, candidate.title) }))
      .filter((item) => item.score >= .5)
      .sort((left, right) => right.score - left.score || right.candidate.updatedAt - left.candidate.updatedAt);
    if (scored.length === 0) return { status: "not_found" };
    if (scored.length === 1 || scored[0]!.score - scored[1]!.score >= .2) return { status: "matched", candidate: scored[0]!.candidate };
    return { status: "ambiguous", candidates: scored.slice(0, 5).map((item) => item.candidate) };
  }
  const now = context.now ?? Date.now();
  const recentIds = new Set(
    (context.recentReferences || [])
      .filter((reference) => now - reference.referencedAt <= 30 * 60_000)
      .map((reference) => `${reference.kind}:${reference.chatId}:${reference.id}`),
  );
  const contextual = candidates
    .filter((candidate) => recentIds.has(`${candidate.kind}:${candidate.chatId}:${candidate.id}`))
    .sort((left, right) => {
      const leftAt = context.recentReferences?.find((reference) => reference.kind === left.kind && reference.chatId === left.chatId && reference.id === left.id)?.referencedAt || 0;
      const rightAt = context.recentReferences?.find((reference) => reference.kind === right.kind && reference.chatId === right.chatId && reference.id === right.id)?.referencedAt || 0;
      return rightAt - leftAt;
    });
  if (contextual.length === 1) return { status: "matched", candidate: contextual[0]! };
  if (contextual.length > 1) return { status: "ambiguous", candidates: contextual.slice(0, 5) };
  if (candidates.length === 1) return { status: "matched", candidate: candidates[0]! };
  if (candidates.length > 1) return { status: "ambiguous", candidates: candidates.slice(0, 5) };
  return { status: "not_found" };
}

export function normalizeOwnerRecordReferences(value: unknown): OwnerRecordReference[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((reference) => {
    if (!reference || typeof reference !== "object") return [];
    const item = reference as Partial<OwnerRecordReference>;
    if ((item.kind !== "todo" && item.kind !== "calendar" && item.kind !== "commitment")
      || typeof item.chatId !== "string" || typeof item.id !== "string" || typeof item.title !== "string"
      || !Number.isFinite(item.referencedAt)) return [];
    return [{
      kind: item.kind,
      chatId: item.chatId.slice(0, 240),
      id: item.id.slice(0, 120),
      title: compact(item.title).slice(0, 240),
      referencedAt: Number(item.referencedAt),
    }];
  }).slice(-12);
}

export function continueOwnerLifecycleSelection(
  pending: PendingOwnerLifecycleClarification,
  response: string,
): OwnerLifecycleCandidate | undefined {
  const value = compact(response);
  const ordinal = value.match(/^(?:number\s+)?([1-5])$/iu);
  if (ordinal) return pending.candidates[Number(ordinal[1]) - 1];
  const matches = pending.candidates.filter((candidate) => matchScore(value, candidate.title) >= .8);
  return matches.length === 1 ? matches[0] : undefined;
}

export function resolveLifecycleTimestamp(
  current: number | undefined,
  request: OwnerLifecycleRequest,
): number | undefined {
  if (request.relativeShiftMs) return current ? current + request.relativeShiftMs : undefined;
  if (!request.temporal) return undefined;
  const desired = new Date(request.temporal.timestamp);
  const existing = current ? new Date(current) : undefined;
  if (!request.temporal.hasDate && existing) {
    existing.setHours(desired.getHours(), desired.getMinutes(), 0, 0);
    return existing.getTime();
  }
  if (!request.temporal.hasTime && existing) {
    desired.setHours(existing.getHours(), existing.getMinutes(), 0, 0);
  }
  return desired.getTime();
}

export function normalizePendingOwnerLifecycleClarification(value: unknown): PendingOwnerLifecycleClarification | undefined {
  if (!value || typeof value !== "object") return undefined;
  const pending = value as Partial<PendingOwnerLifecycleClarification>;
  const request = pending.request as Partial<OwnerLifecycleRequest> | undefined;
  const operations: OwnerLifecycleOperation[] = ["complete", "cancel", "reschedule", "rename", "priority", "note"];
  if (!request || !operations.includes(request.operation as OwnerLifecycleOperation) || typeof request.source !== "string" || !Number.isFinite(pending.createdAt)) return undefined;
  const candidates = (Array.isArray(pending.candidates) ? pending.candidates : []).flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Partial<OwnerLifecycleCandidate>;
    if ((item.kind !== "todo" && item.kind !== "calendar" && item.kind !== "commitment") || typeof item.chatId !== "string" || typeof item.id !== "string" || typeof item.title !== "string") return [];
    return [{
      kind: item.kind, chatId: item.chatId.slice(0, 240), id: item.id.slice(0, 120), title: compact(item.title).slice(0, 240),
      status: String(item.status || "open") as OwnerLifecycleCandidate["status"], timestamp: Number.isFinite(item.timestamp) ? Number(item.timestamp) : undefined,
      updatedAt: Number.isFinite(item.updatedAt) ? Number(item.updatedAt) : 0,
      evidenceTimestamp: Number.isFinite(item.evidenceTimestamp) ? Number(item.evidenceTimestamp) : undefined,
    }];
  }).slice(0, 5);
  if (candidates.length < 2) return undefined;
  return {
    request: {
      ...request,
      operation: request.operation as OwnerLifecycleOperation,
      source: compact(request.source).slice(0, 600),
      targetQuery: typeof request.targetQuery === "string" ? compact(request.targetQuery).slice(0, 240) : undefined,
      newTitle: typeof request.newTitle === "string" ? compact(request.newTitle).slice(0, 240) : undefined,
      note: typeof request.note === "string" ? compact(request.note).slice(0, 1_000) : undefined,
    } as OwnerLifecycleRequest,
    candidates,
    createdAt: Number(pending.createdAt),
  };
}
