import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AMIROS_VERSION, CURRENT_RELEASE, RELEASE_HISTORY } from "../src/release.js";

describe("AmirOS releases", () => {
  it("uses package.json as the release version source", () => {
    const packageVersion = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;
    expect(AMIROS_VERSION).toBe(packageVersion);
    expect(CURRENT_RELEASE.version).toBe(packageVersion);
  });

  it("includes customer-facing notes for the current release", () => {
    expect(CURRENT_RELEASE.notes.length).toBeGreaterThan(0);
    expect(CURRENT_RELEASE.releasedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("keeps a distinct, newest-first history for the release-notes picker", () => {
    expect(RELEASE_HISTORY[0]?.version).toBe(AMIROS_VERSION);
    expect(new Set(RELEASE_HISTORY.map((release) => release.version)).size).toBe(RELEASE_HISTORY.length);
    expect(RELEASE_HISTORY.every((release) => release.notes.length > 0)).toBe(true);
  });

  it("keeps release notes within the viewport while their body can scroll", () => {
    const styles = readFileSync("ui/src/styles.css", "utf8");
    expect(styles).toContain(".release-notes-dialog { display: flex; flex-direction: column; max-height: min(760px, calc(100dvh - 44px)); }");
    expect(styles).toContain(".release-notes-dialog .release-notes-body { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }");
  });

  it("keeps the production build scoped to runtime code", () => {
    const config = JSON.parse(readFileSync("tsconfig.json", "utf8")) as { include?: string[] };
    expect(config.include).toContain("src/**/*.ts");
    expect(config.include).toContain("scripts/**/*.ts");
    expect(config.include).not.toContain("tests/**/*.ts");
  });
});
