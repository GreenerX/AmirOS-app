import { describe, expect, it } from "vitest";
import { parseAssistantAnswer } from "../ui/src/assistant-format.js";

describe("Ask AmirOS answer formatting", () => {
  it("turns a schedule response into paragraphs and a proper list", () => {
    expect(parseAssistantAnswer([
      "Your confirmed schedule for this week:",
      "",
      "- **Sun, Aug 2:**Therapy at 5:00 PM; sunset swim at 7:15 PM.",
      "- **Mon, Aug 3:** Shopping at 3:00 PM.",
      "",
      "The Monday items overlap.",
    ].join("\n"))).toEqual([
      { type: "paragraph", text: "Your confirmed schedule for this week:" },
      {
        type: "list",
        items: [
          "**Sun, Aug 2:** Therapy at 5:00 PM; sunset swim at 7:15 PM.",
          "**Mon, Aug 3:** Shopping at 3:00 PM.",
        ],
      },
      { type: "paragraph", text: "The Monday items overlap." },
    ]);
  });

  it("keeps single emphasis intact while normalizing missing spacing", () => {
    expect(parseAssistantAnswer("1. *Today:*Dinner\n2. **Tomorrow:**Movie")).toEqual([
      { type: "list", items: ["*Today:* Dinner", "**Tomorrow:** Movie"] },
    ]);
  });
});
