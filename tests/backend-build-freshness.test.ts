import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
// @ts-expect-error This JavaScript module is shared directly with the Node watchdog.
import {
  BuildFreshnessError,
  buildBackend,
  ensureFreshBackendBuild,
  inspectBackendBuild,
  writeBackendBuildStamp,
  inspectUiBuild,
  ensureFreshUiBuild,
  writeUiBuildStamp,
} from "../scripts/build-freshness.mjs";

const temporaryDirectories: string[] = [];

function fixture() {
  const project = mkdtempSync(resolve(tmpdir(), "amiros-build-freshness-"));
  temporaryDirectories.push(project);
  mkdirSync(resolve(project, "src"), { recursive: true });
  mkdirSync(resolve(project, "dist/src"), { recursive: true });
  writeFileSync(resolve(project, "tsconfig.json"), "{}\n");
  writeFileSync(resolve(project, "src/server.ts"), "export const version = 1;\n");
  writeFileSync(resolve(project, "dist/src/server.js"), "export const version = 1;\n");
  return project;
}

function uiFixture() {
  const project = fixture();
  mkdirSync(resolve(project, "ui/public"), { recursive: true });
  mkdirSync(resolve(project, "ui/src"), { recursive: true });
  mkdirSync(resolve(project, "ui/dist"), { recursive: true });
  writeFileSync(resolve(project, "package.json"), "{}\n");
  writeFileSync(resolve(project, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFileSync(resolve(project, "ui/index.html"), "<div id=\"root\"></div>\n");
  writeFileSync(resolve(project, "ui/tsconfig.json"), "{}\n");
  writeFileSync(resolve(project, "ui/vite.config.ts"), "export default {};\n");
  writeFileSync(resolve(project, "ui/public/manifest.webmanifest"), "{\"name\":\"AmirOS\"}\n");
  writeFileSync(resolve(project, "ui/src/main.tsx"), "export const version = 1;\n");
  writeFileSync(resolve(project, "ui/dist/index.html"), "<script src=\"/assets/index-old.js\"></script>\n");
  return project;
}

async function waitForExit(child: ReturnType<typeof spawn>, timeoutMs = 5_000): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  return await new Promise((resolveExit, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("The watchdog did not stop after its build preflight failed."));
    }, timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolveExit(code);
    });
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("build freshness preflight", () => {
  test("treats a matching stamped build as current without rebuilding", () => {
    const project = fixture();
    writeBackendBuildStamp(project);
    let builds = 0;
    const result = ensureFreshBackendBuild(project, { compile: () => { builds += 1; } });
    expect(result.fresh).toBe(true);
    expect(result.rebuilt).toBe(false);
    expect(builds).toBe(0);
  });

  test("rebuilds when TypeScript source changed after the last build", () => {
    const project = fixture();
    writeBackendBuildStamp(project);
    writeFileSync(resolve(project, "src/server.ts"), "export const version = 2;\n");
    const before = inspectBackendBuild(project);
    expect(before.fresh).toBe(false);
    expect(before.reason).toContain("source has changed");

    let builds = 0;
    const result = ensureFreshBackendBuild(project, {
      compile: () => {
        builds += 1;
        writeFileSync(resolve(project, "dist/src/server.js"), "export const version = 2;\n");
      },
    });
    expect(builds).toBe(1);
    expect(result.rebuilt).toBe(true);
    expect(inspectBackendBuild(project).fresh).toBe(true);
  });

  test("does not mark a failed rebuild as fresh", () => {
    const project = fixture();
    writeBackendBuildStamp(project);
    writeFileSync(resolve(project, "src/server.ts"), "broken source\n");
    expect(() => buildBackend(project, {
      compile: () => { throw new BuildFreshnessError("synthetic compiler failure"); },
    })).toThrow("synthetic compiler failure");
    expect(inspectBackendBuild(project).fresh).toBe(false);
    expect(readFileSync(resolve(project, "dist/src/server.js"), "utf8")).toContain("version = 1");
  });

  test("rebuilds legacy output that has no freshness stamp", () => {
    const project = fixture();
    expect(inspectBackendBuild(project).reason).toContain("stamp is missing");
    const result = ensureFreshBackendBuild(project, { compile: () => {} });
    expect(result.rebuilt).toBe(true);
    expect(result.fresh).toBe(true);
  });

  test("watchdog blocks a failed rebuild without entering a retry loop", async () => {
    const project = fixture();
    rmSync(resolve(project, "dist"), { recursive: true, force: true });
    mkdirSync(resolve(project, "scripts"), { recursive: true });
    const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    copyFileSync(resolve(repository, "scripts/amiros-watchdog.mjs"), resolve(project, "scripts/amiros-watchdog.mjs"));
    copyFileSync(resolve(repository, "scripts/build-freshness.mjs"), resolve(project, "scripts/build-freshness.mjs"));

    const child = spawn(process.execPath, [resolve(project, "scripts/amiros-watchdog.mjs")], {
      cwd: project,
      env: { ...process.env, AMIROS_PORT: "37999" },
      stdio: "ignore",
    });
    expect(await waitForExit(child)).toBe(1);
    const log = readFileSync(resolve(project, "work/bot.log"), "utf8");
    expect(log).toContain("Backend launch blocked by build preflight");
    expect(log.match(/Backend launch blocked by build preflight/gu)).toHaveLength(1);
    const status = JSON.parse(readFileSync(resolve(project, "work/backend-restart-status.json"), "utf8"));
    expect(status.status).toBe("failed");
    expect(status.detail).toContain("TypeScript compiler is unavailable");
  });

  test("treats a matching stamped dashboard build as current", () => {
    const project = uiFixture();
    writeUiBuildStamp(project);
    let builds = 0;
    const result = ensureFreshUiBuild(project, { compile: () => { builds += 1; } });
    expect(result.fresh).toBe(true);
    expect(result.rebuilt).toBe(false);
    expect(builds).toBe(0);
  });

  test("rebuilds a stale dashboard and records its current source", () => {
    const project = uiFixture();
    writeUiBuildStamp(project);
    writeFileSync(resolve(project, "ui/src/main.tsx"), "export const version = 2;\n");
    expect(inspectUiBuild(project).fresh).toBe(false);
    const result = ensureFreshUiBuild(project, {
      compile: () => writeFileSync(resolve(project, "ui/dist/index.html"), "<script src=\"/assets/index-new.js\"></script>\n"),
    });
    expect(result.rebuilt).toBe(true);
    expect(inspectUiBuild(project).fresh).toBe(true);
    expect(readFileSync(resolve(project, "ui/dist/index.html"), "utf8")).toContain("index-new.js");
  });

  test("rebuilds when a dashboard public file changes", () => {
    const project = uiFixture();
    writeUiBuildStamp(project);
    writeFileSync(resolve(project, "ui/public/manifest.webmanifest"), "{\"name\":\"Updated AmirOS\"}\n");
    expect(inspectUiBuild(project).fresh).toBe(false);
  });

  test("rebuilds a missing dashboard and never stamps a failed UI build", () => {
    const project = uiFixture();
    rmSync(resolve(project, "ui/dist"), { recursive: true, force: true });
    const missing = inspectUiBuild(project);
    expect(missing.fresh).toBe(false);
    expect(missing.reason).toContain("build is missing");
    expect(() => ensureFreshUiBuild(project, {
      compile: () => { throw new BuildFreshnessError("synthetic Vite failure"); },
    })).toThrow("synthetic Vite failure");
    expect(inspectUiBuild(project).fresh).toBe(false);
  });
});
