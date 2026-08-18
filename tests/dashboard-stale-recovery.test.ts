import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("dashboard stale-asset recovery", () => {
  it("offers a safe, understandable local recovery screen", () => {
    const dashboard = readFileSync(resolve(process.cwd(), "src/dashboard.ts"), "utf8");

    expect(dashboard).toContain("AmirOS needs a quick refresh");
    expect(dashboard).toContain("Your WhatsApp connection, settings, and private data are safe on this Mac.");
    expect(dashboard).toContain("/api/system/backend-restart");
    expect(dashboard).toContain("close AmirOS and open it again");
  });
});
