import { describe, expect, it } from "vitest";
import { replyAssessmentCopy } from "../ui/src/reply-assessment-copy.js";

describe("reply assessment presentation", () => {
  it("turns deterministic reason codes into plain English", () => {
    expect(replyAssessmentCopy({
      needsReply: true, mayNeedReply: true, confidence: 97, source: "deterministic", reason: "direct_request",
    })).toEqual({ indicator: "High confidence", reason: "Explicit request", text: "High confidence · Explicit request" });
  });

  it("keeps AI results concise without exposing internal details", () => {
    expect(replyAssessmentCopy({
      needsReply: true, mayNeedReply: true, confidence: 76, source: "ai", reason: "The message includes a request for a response",
    })).toEqual({ indicator: "AI checked", reason: "Likely needs a reply", text: "AI checked · Likely needs a reply" });
  });
});
