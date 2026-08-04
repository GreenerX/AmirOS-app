import { describe, expect, it } from "vitest";
import { isLegacyProfileSummary, profileSummaryParagraph } from "../ui/src/profile-summary.js";

describe("People profile summary presentation", () => {
  it("turns legacy headed bullet profiles into one person-focused paragraph", () => {
    const legacy = [
      "Relationship",
      "- Fact: Friend; warm, informal rapport with Amir.",
      "- Interested in meeting and discussing projects.",
      "",
      "Communication style",
      "- Facts: Mostly Hebrew; short, rapid messages.",
      "",
      "Helpful response guidance",
      "- Reply warmly and concisely.",
      "",
      "Uncertainties",
      "- His broader interests are not established.",
    ].join("\n");

    expect(isLegacyProfileSummary(legacy)).toBe(true);
    const paragraph = profileSummaryParagraph(legacy, "Dan Pundak");
    expect(paragraph).toBe("Dan Pundak is a friend with warm, informal rapport with Amir. Interested in meeting and discussing projects. Mostly Hebrew; short, rapid messages.");
    expect(paragraph).not.toContain("\n");
    expect(paragraph).not.toContain("Helpful response guidance");
    expect(paragraph).not.toContain("Uncertainties");
  });

  it("uses a natural relative clause when the relationship detail starts with a verb", () => {
    const paragraph = profileSummaryParagraph("Relationship\n- Fact: Partner; uses affectionate nicknames.", "Dani Faitelson");
    expect(paragraph).toBe("Dani Faitelson is a partner who uses affectionate nicknames.");
  });

  it("leaves new narrative summaries intact", () => {
    const narrative = "Dani Faitelson is Amir's warm and expressive partner who enjoys thoughtful plans and direct communication.";
    expect(isLegacyProfileSummary(narrative)).toBe(false);
    expect(profileSummaryParagraph(narrative, "Dani Faitelson")).toBe(narrative);
  });
});
