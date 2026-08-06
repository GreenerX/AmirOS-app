import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const safeServerPath = resolve(projectDirectory, "scripts/runtime-recovery-safe-server.mjs");
const testDirectory = mkdtempSync("/tmp/amiros-installer-");

const excludedFromZipFixture = [
  ".git",
  "node_modules",
  "dist",
  "release",
  "work",
  "ui/dist",
  ".wwebjs_auth",
  ".env",
  ".env.local",
  "output",
  "outputs",
  "coverage",
];

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveReady());
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string", "Expected a local test port.");
  await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
  return address.port;
}

function copyZipFixture(destination: string): void {
  cpSync(projectDirectory, destination, {
    recursive: true,
    filter(source) {
      const path = relative(projectDirectory, source);
      if (!path) return true;
      return !excludedFromZipFixture.some((excluded) => path === excluded || path.startsWith(`${excluded}/`));
    },
  });
  // This lets the test perform the real TypeScript and Vite builds without
  // downloading packages. The ZIP fixture itself still starts with no build
  // output, runtime data, or installed dependency directory.
  symlinkSync(resolve(projectDirectory, "node_modules"), resolve(destination, "node_modules"), "dir");
}

function createSafeNpx(directory: string): string {
  const binDirectory = resolve(directory, "test-bin");
  mkdirSync(binDirectory, { recursive: true });
  const npxPath = resolve(binDirectory, "npx");
  writeFileSync(npxPath, `#!/bin/zsh
set -eu
case "\${3:-}" in
  install)
    # Dependencies are supplied through the test-only node_modules symlink.
    exit 0
    ;;
  build)
    exec "$AMIROS_INSTALL_TEST_NODE" "$AMIROS_INSTALL_TEST_SOURCE/node_modules/typescript/bin/tsc" -p tsconfig.json
    ;;
  ui:build)
    exec "$AMIROS_INSTALL_TEST_NODE" "$AMIROS_INSTALL_TEST_SOURCE/node_modules/vite/bin/vite.js" build --config ui/vite.config.ts
    ;;
esac
echo "Unexpected test npx command: $*" >&2
exit 1
`, { encoding: "utf8", mode: 0o700 });
  chmodSync(npxPath, 0o700);
  return binDirectory;
}

async function runInstaller(project: string, port: number, testBin: string): Promise<string> {
  const installerPath = resolve(project, "Install AmirOS.command");
  const output: string[] = [];
  const child = spawn("/bin/zsh", [installerPath], {
    cwd: project,
    env: {
      ...process.env,
      PATH: `${testBin}:${process.env.PATH || ""}`,
      AMIROS_NO_OPEN: "1",
      AMIROS_PORT: String(port),
      AMIROS_WATCHDOG_SERVER_PATH: safeServerPath,
      AMIROS_INSTALL_TEST_NODE: process.execPath,
      AMIROS_INSTALL_TEST_SOURCE: projectDirectory,
      OPENAI_API_KEY: "",
      WHATSAPP_SESSION_PATH: resolve(project, ".wwebjs_auth"),
    },
  });
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  const exitCode = await new Promise<number | null>((resolveExit) => child.once("exit", resolveExit));
  assert.equal(exitCode, 0, `Installer failed:\n${output.join("")}`);
  return output.join("");
}

async function waitForDashboard(port: number, project: string): Promise<void> {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/dashboard`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  const logPath = resolve(project, "work/bot.log");
  const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "No runtime log was created.";
  throw new Error(`The safe AmirOS dashboard did not become available after installation.\n${log}`);
}

async function stopInstalledAmiros(project: string): Promise<void> {
  const pidPath = resolve(project, "work/amiros.pid");
  if (!existsSync(pidPath)) return;
  const pid = Number(readFileSync(pidPath, "utf8").trim());
  if (!Number.isInteger(pid) || pid <= 0) return;
  try { process.kill(pid, "SIGTERM"); } catch { return; }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      await new Promise((resolveWait) => setTimeout(resolveWait, 75));
    } catch {
      return;
    }
  }
  throw new Error("The test watchdog did not stop cleanly.");
}

function assertBuildAndRuntime(project: string): void {
  assert.ok(existsSync(resolve(project, "dist/src/server.js")), "Installer should build the backend before launch.");
  assert.ok(existsSync(resolve(project, "ui/dist/index.html")), "Installer should build the dashboard before launch.");
  assert.ok(existsSync(resolve(project, "work")), "Installer should create the runtime work folder.");
  assert.ok(existsSync(resolve(project, "work/amiros.pid")), "Launcher should create a watchdog PID record.");
  assert.ok(existsSync(resolve(project, "work/bot.log")), "Launcher should create a runtime log file.");
}

function assertPublishedReleaseUpdater(): void {
  const updater = readFileSync(resolve(projectDirectory, "Update AmirOS.command"), "utf8");
  assert.match(updater, /api\.github\.com\/repos\/GreenerX\/AmirOS-app\/releases\/latest/,
    "The updater must discover the latest published GitHub release.");
  assert.match(updater, /refs\/tags\/\$RELEASE_TAG/,
    "The updater must fetch and install the selected release tag.");
  assert.match(updater, /archive\/refs\/tags\/\$RELEASE_TAG\.zip/,
    "ZIP installations must download the selected release tag.");
  assert.doesNotMatch(updater, /archive\/refs\/heads\/main/,
    "The updater must not install an ordinary main-branch snapshot.");
}

let installedProjects: string[] = [];
try {
  assertPublishedReleaseUpdater();
  const testBin = createSafeNpx(testDirectory);

  const cleanProject = resolve(testDirectory, "AmirOS clean install");
  copyZipFixture(cleanProject);
  installedProjects.push(cleanProject);
  assert.ok(!existsSync(resolve(cleanProject, "dist")), "Clean ZIP fixture must not include a backend build.");
  assert.ok(!existsSync(resolve(cleanProject, "ui/dist")), "Clean ZIP fixture must not include a dashboard build.");
  const cleanPort = await reservePort();
  const cleanOutput = await runInstaller(cleanProject, cleanPort, testBin);
  assert.match(cleanOutput, /Starting AmirOS in the background/, "Installer should hand off to the production launcher.");
  await waitForDashboard(cleanPort, cleanProject);
  assertBuildAndRuntime(cleanProject);
  await stopInstalledAmiros(cleanProject);

  // This represents the older lightweight layout: private data exists, but
  // no current build output is available. The newer ZIP is placed beside it,
  // exactly like a person extracting a current GitHub download on their Mac.
  const legacyProject = resolve(testDirectory, "AmirOS v0.3.0");
  mkdirSync(resolve(legacyProject, "work/profile-avatars"), { recursive: true });
  mkdirSync(resolve(legacyProject, ".wwebjs_auth/session"), { recursive: true });
  writeFileSync(resolve(legacyProject, ".env.local"), "OPENAI_API_KEY=sk-test-private-key\n", "utf8");
  writeFileSync(resolve(legacyProject, "work/amiros-state.json"), JSON.stringify({ private: "preserved knowledge, tasks, calendar, settings" }), "utf8");
  writeFileSync(resolve(legacyProject, "work/calendar-feed-token"), "private-calendar-token", "utf8");
  writeFileSync(resolve(legacyProject, "work/profile-avatars/avatar.png"), "private-avatar", "utf8");
  writeFileSync(resolve(legacyProject, ".wwebjs_auth/session/credentials"), "private-whatsapp-session", "utf8");

  const upgradeProject = resolve(testDirectory, "AmirOS v0.6.2 new");
  copyZipFixture(upgradeProject);
  installedProjects.push(upgradeProject);
  const upgradePort = await reservePort();
  const upgradeOutput = await runInstaller(upgradeProject, upgradePort, testBin);
  assert.match(upgradeOutput, /Found private AmirOS data/, "Installer should explain that it found the prior local data.");
  assert.match(upgradeOutput, /Starting AmirOS in the background/, "Upgrade should hand off to the production launcher.");
  await waitForDashboard(upgradePort, upgradeProject);
  assertBuildAndRuntime(upgradeProject);
  assert.equal(readFileSync(resolve(upgradeProject, ".env.local"), "utf8"), "OPENAI_API_KEY=sk-test-private-key\n");
  assert.equal(readFileSync(resolve(upgradeProject, "work/amiros-state.json"), "utf8"), JSON.stringify({ private: "preserved knowledge, tasks, calendar, settings" }));
  assert.equal(readFileSync(resolve(upgradeProject, "work/calendar-feed-token"), "utf8"), "private-calendar-token");
  assert.equal(readFileSync(resolve(upgradeProject, "work/profile-avatars/avatar.png"), "utf8"), "private-avatar");
  assert.equal(readFileSync(resolve(upgradeProject, ".wwebjs_auth/session/credentials"), "utf8"), "private-whatsapp-session");
  // Migration is a copy, not a move: a failed later build never erases the
  // older installation's data.
  assert.ok(existsSync(resolve(legacyProject, "work/amiros-state.json")), "Older private state must remain intact.");
  await stopInstalledAmiros(upgradeProject);

  console.log("Installer upgrade test passed: clean install and v0.3.0-style upgrade both built and launched safely.");
} finally {
  for (const project of installedProjects) {
    await stopInstalledAmiros(project).catch(() => undefined);
  }
  rmSync(testDirectory, { recursive: true, force: true });
}
