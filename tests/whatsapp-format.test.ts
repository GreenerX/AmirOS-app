import { describe, expect, it } from "vitest";
import { cleanSourceUrl, formatWhatsAppText } from "../src/whatsapp-format.js";

describe("WhatsApp formatting", () => {
  it("converts Markdown bold, headings, bullets, and citation links", () => {
    const formatted = formatWhatsAppText(
      [
        "## Latest update",
        "",
        "- **Talks have resumed**, with more details. ([news.example](https://news.example/story?utm_source=openai))",
      ].join("\n"),
      { emojiFallback: "📰", removeParenthesizedLinks: true },
    );

    expect(formatted).toBe(
      [
        "*Latest update*",
        "",
        "• *Talks have resumed*, with more details. 📰",
      ].join("\n"),
    );
    expect(formatted).not.toContain("**");
    expect(formatted).not.toContain("https://");
  });

  it("moves a leading emoji to the end instead of adding another", () => {
    expect(formatWhatsAppText("🌤️ Good morning")).toBe("Good morning 🌤️");
  });

  it("keeps an existing trailing emoji without adding another", () => {
    expect(formatWhatsAppText("Good morning 🌤️")).toBe("Good morning 🌤️");
  });

  it("turns ordinary Markdown links into compact labels", () => {
    expect(
      formatWhatsAppText("Read [the guide](https://example.com/guide)", {
        ensureEmoji: false,
      }),
    ).toBe("Read the guide");
  });

  it("removes source tracking parameters", () => {
    expect(
      cleanSourceUrl(
        "https://example.com/story?id=7&utm_source=openai&utm_campaign=test",
      ),
    ).toBe("https://example.com/story?id=7");
  });
});
