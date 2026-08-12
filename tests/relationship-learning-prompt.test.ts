import { describe, expect, it } from "vitest";
import { relationshipLearningInstructions } from "../src/prompts/relationship-learning.js";

describe("relationship-learning topic title contract", () => {
  it("asks the existing intelligence model for a semantic display projection", () => {
    const instructions = relationshipLearningInstructions("Amir Friedman");
    expect(instructions).toContain("what real-world subject");
    expect(instructions).toContain("natural 2-4 word noun phrase");
    expect(instructions).toContain("topicTitleConfidence below 0.7");
    expect(instructions).toContain("keep the complete insight in content");
    expect(instructions).toContain("stable canonicalKey");
    expect(instructions).toContain("current, historical, or temporary");
    expect(instructions).toContain("reinforce");
    expect(instructions).toContain("replace");
  });
});
