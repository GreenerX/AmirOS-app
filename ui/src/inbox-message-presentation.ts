import type { ChatMessage } from "./types.js";

type CallEvent = NonNullable<ChatMessage["call"]>;

function formatCallDuration(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds)) return undefined;
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  if (minutes === 0) return `${remainder} sec`;
  if (remainder === 0) return `${minutes} min`;
  return `${minutes} min ${remainder} sec`;
}

/** Human-friendly presentation for call-log events without inventing missing WhatsApp metadata. */
export function callEventPresentation(call: CallEvent): { title: string; detail: string } {
  const medium = call.kind === "video" ? "Video call" : call.kind === "voice" ? "Voice call" : "Call";
  const direction = call.direction === "outgoing" ? "Outgoing" : "Incoming";
  const duration = formatCallDuration(call.durationSeconds);
  return {
    title: call.missed ? `Missed ${medium.toLowerCase()}` : medium,
    detail: [direction, duration].filter((value): value is string => Boolean(value)).join(" · "),
  };
}

export function mergedMessageReactions(message: ChatMessage): NonNullable<ChatMessage["reactions"]> {
  const reactions = [...(message.reactions || [])];
  if (message.localReaction && !reactions.some((reaction) => reaction.emoji === message.localReaction)) {
    reactions.push({ emoji: message.localReaction, hasReactionByMe: true, senders: [] });
  }
  return reactions;
}
