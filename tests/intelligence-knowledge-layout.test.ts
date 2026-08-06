import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Intelligence knowledge workspace layout", () => {
  it("uses matching, bounded desktop cards while keeping the mobile single-column layout", () => {
    const css = readFileSync("ui/src/styles.css", "utf8");

    expect(css).toContain("@media (min-width: 901px)");
    expect(css).toContain("grid-auto-rows: clamp(430px, 54vh, 610px)");
    expect(css).toContain(".intel-knowledge-bubbles, .intel-contact-knowledge-list { flex: 1 1 auto; min-height: 0; overflow-y: auto;");
    expect(css).toContain(".intel-knowledge-columns { grid-template-columns: 1fr;");
  });
});
