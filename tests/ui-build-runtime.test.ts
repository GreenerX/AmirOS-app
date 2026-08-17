import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { currentUiSourceHash, uiAssetCacheControl, uiBuildFingerprint, uiBuildIsCurrent } from "../src/ui-build-runtime.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("dashboard UI runtime metadata", () => {
  test("reads only a valid stamped UI source fingerprint", () => {
    const root = mkdtempSync(resolve(tmpdir(), "amiros-ui-runtime-"));
    temporaryDirectories.push(root);
    writeFileSync(resolve(root, ".amiros-ui-build.json"), JSON.stringify({ sourceHash: "a".repeat(64) }));
    expect(uiBuildFingerprint(root)).toBe("a".repeat(64));
    writeFileSync(resolve(root, ".amiros-ui-build.json"), JSON.stringify({ sourceHash: "invalid" }));
    expect(uiBuildFingerprint(root)).toBeUndefined();
  });

  test("prevents stale entry documents while caching hashed Vite assets immutably", () => {
    const root = resolve("/tmp/amiros-ui-dist");
    expect(uiAssetCacheControl(root, resolve(root, "index.html"))).toContain("no-store");
    expect(uiAssetCacheControl(root, resolve(root, "assets/index-d6rXIuXq.css"))).toContain("immutable");
    expect(uiAssetCacheControl(root, resolve(root, "favicon.svg"))).toContain("must-revalidate");
  });

  test("detects source changes while the backend is already running", () => {
    const project = mkdtempSync(resolve(tmpdir(), "amiros-ui-live-freshness-"));
    temporaryDirectories.push(project);
    const root = resolve(project, "ui/dist");
    mkdirSync(resolve(project, "ui/public"), { recursive: true });
    mkdirSync(resolve(project, "ui/src"), { recursive: true });
    mkdirSync(root, { recursive: true });
    writeFileSync(resolve(project, "package.json"), "{}\n");
    writeFileSync(resolve(project, "ui/index.html"), "<div id=\"root\"></div>\n");
    writeFileSync(resolve(project, "ui/public/manifest.webmanifest"), "{\"name\":\"AmirOS\"}\n");
    writeFileSync(resolve(project, "ui/src/main.tsx"), "export const version = 1;\n");
    writeFileSync(resolve(root, ".amiros-ui-build.json"), JSON.stringify({ sourceHash: currentUiSourceHash(project) }));
    expect(uiBuildIsCurrent(root, project)).toBe(true);
    writeFileSync(resolve(project, "ui/src/main.tsx"), "export const version = 2;\n");
    expect(uiBuildIsCurrent(root, project)).toBe(false);
  });

  test("detects changed public install files while the backend is running", () => {
    const project = mkdtempSync(resolve(tmpdir(), "amiros-ui-public-freshness-"));
    temporaryDirectories.push(project);
    const root = resolve(project, "ui/dist");
    mkdirSync(resolve(project, "ui/public"), { recursive: true });
    mkdirSync(resolve(project, "ui/src"), { recursive: true });
    mkdirSync(root, { recursive: true });
    writeFileSync(resolve(project, "package.json"), "{}\n");
    writeFileSync(resolve(project, "ui/index.html"), "<div id=\"root\"></div>\n");
    writeFileSync(resolve(project, "ui/src/main.tsx"), "export const version = 1;\n");
    writeFileSync(resolve(project, "ui/public/manifest.webmanifest"), "{\"name\":\"AmirOS\"}\n");
    writeFileSync(resolve(root, ".amiros-ui-build.json"), JSON.stringify({ sourceHash: currentUiSourceHash(project) }));
    expect(uiBuildIsCurrent(root, project)).toBe(true);
    writeFileSync(resolve(project, "ui/public/manifest.webmanifest"), "{\"name\":\"Updated AmirOS\"}\n");
    expect(uiBuildIsCurrent(root, project)).toBe(false);
  });
});
