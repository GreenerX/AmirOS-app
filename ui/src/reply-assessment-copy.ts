import type { IntelligenceChat } from "./types.js";

type ReplyAssessment = NonNullable<IntelligenceChat["replyAssessment"]>;

export type ReplyAssessmentCopy = {
  indicator: "High confidence" | "Medium confidence" | "AI checked";
  reason: string;
  text: string;
};

const DETERMINISTIC_REASONS: Record<string, string> = {
  direct_question: "Direct question",
  direct_request: "Explicit request",
  mentioned_in_group: "You were mentioned in a group",
  acknowledgement: "Conversation appears complete",
  conversation_ended: "Conversation appears complete",
  owner_replied: "You already replied",
  stale: "Message is no longer recent",
  informational: "No clear reply needed",
  ambiguous: "Conversation may still be open",
  no_message: "No message to review",
};

/** Converts internal assessment data into calm, user-facing language. */
export function replyAssessmentCopy(assessment?: ReplyAssessment): ReplyAssessmentCopy | undefined {
  if (!assessment) return undefined;

  const indicator = assessment.source === "ai"
    ? "AI checked"
    : assessment.confidence >= 95
      ? "High confidence"
      : "Medium confidence";
  const reason = assessment.source === "ai"
    ? assessment.needsReply
      ? "Likely needs a reply"
      : assessment.mayNeedReply
        ? "Conversation may still be open"
        : "No reply likely"
    : DETERMINISTIC_REASONS[assessment.reason] || "Conversation may still be open";

  return { indicator, reason, text: `${indicator} · ${reason}` };
}
