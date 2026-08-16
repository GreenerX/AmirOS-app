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
    exec "$AMIROS_INSTALL_TEST_NODE" scripts/build-backend.mjs
    ;;
  ui:build)
    exec "$AMIROS_INSTALL_TEST_NODE" scripts/build-ui.mjs
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
      // The release installer intentionally stops old AmirOS copies from any
      // folder. Scope that production-safe rule to this fixture so a local
      // developer's real AmirOS process is never touched by the test.
      AMIROS_INSTALL_TEST_WATCHDOG_ROOT: testDirectory,
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

async function startStaleAmiros(project: string, port: number): Promise<void> {
  const watchdogPath = resolve(project, "scripts/amiros-watchdog.mjs");
  const child = spawn(process.execPath, [watchdogPath], {
    cwd: project,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      AMIROS_NO_OPEN: "1",
      AMIROS_PORT: String(port),
      AMIROS_WATCHDOG_SERVER_PATH: safeServerPath,
      WHATSAPP_SESSION_PATH: resolve(project, ".wwebjs_auth"),
    },
  });
  child.unref();
  await waitForDashboard(port, project);
}

async function startOrphanedDashboard(project: string, port: number): Promise<number> {
  const child = spawn(process.execPath, [safeServerPath], {
    cwd: project,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      AMIROS_PORT: String(port),
    },
  });
  child.unref();
  await waitForDashboard(port, project);
  return child.pid ?? 0;
}

function assertStopped(project: string): void {
  const pidPath = resolve(project, "work/amiros.pid");
  assert.ok(!existsSync(pidPath), "The earlier AmirOS watchdog record should be removed after installation.");
}

function assertBuildAndRuntime(project: string): void {
  assert.ok(existsSync(resolve(project, "dist/src/server.js")), "Installer should build the backend before launch.");
  assert.ok(existsSync(resolve(project, "dist/.amiros-backend-build.json")), "Installer should record a backend freshness stamp.");
  assert.ok(existsSync(resolve(project, "ui/dist/index.html")), "Installer should build the dashboard before launch.");
  assert.ok(existsSync(resolve(project, "ui/dist/.amiros-ui-build.json")), "Installer should record a dashboard UI freshness stamp.");
  assert.ok(existsSync(resolve(project, "work")), "Installer should create the runtime work folder.");
  assert.ok(existsSync(resolve(project, "work/amiros.pid")), "Launcher should create a watchdog PID record.");
  assert.ok(existsSync(resolve(project, "work/bot.log")), "Launcher should create a runtime log file.");
}

function assertPublishedReleaseUpdater(): void {
  const updater = readFileSync(resolve(projectDirectory, "Update AmirOS.command"), "utf8");
  assert.match(updater, /api\.github\.com\/repos\/GreenerX\/AmirOS-app\/releases\/latest/,
    "The updater must discover the latest published GitHub release.");
  assert.match(updater, /refs\/tags\/\$\{RELEASE_TAG\}:refs\/tags\/\$\{RELEASE_TAG\}/,
    "The updater must fetch the selected release tag without treating its version as a shell modifier.");
  assert.match(updater, /archive\/refs\/tags\/\$\{RELEASE_TAG\}\.zip/,
    "ZIP installations must download the selected release tag.");
  assert.doesNotMatch(updater, /refs\/tags\/\$RELEASE_TAG:refs/,
    "The updater must delimit the release tag before the Git ref separator.");
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

  // A tester can extract the newer ZIP in Documents while an older copy is
  // still running from Desktop. The installer must stop that existing AmirOS
  // watchdog before opening the freshly built dashboard; otherwise the port
  // makes the launcher open the stale copy and falsely report success.
  const staleProject = resolve(testDirectory, "Desktop", "AmirOS older copy");
  copyZipFixture(staleProject);
  const freshProject = resolve(testDirectory, "Documents", "AmirOS new copy");
  copyZipFixture(freshProject);
  installedProjects.push(freshProject);
  const sharedPort = await reservePort();
  await startStaleAmiros(staleProject, sharedPort);
  const staleOutput = await runInstaller(freshProject, sharedPort, testBin);
  assert.match(staleOutput, /Stopping a running AmirOS copy before installing the update/, "Installer should stop a stale AmirOS copy from another folder.");
  await waitForDashboard(sharedPort, freshProject);
  assertBuildAndRuntime(freshProject);
  assertStopped(staleProject);
  await stopInstalledAmiros(freshProject);

  // The old watchdog can be gone while its backend is still listening. This
  // is the production failure that would otherwise make the new launcher
  // refuse to open and leave a tester without a dashboard.
  const orphanedProject = resolve(testDirectory, "Desktop", "AmirOS orphaned backend");
  copyZipFixture(orphanedProject);
  const repairedProject = resolve(testDirectory, "Documents", "AmirOS repaired install");
  copyZipFixture(repairedProject);
  installedProjects.push(repairedProject);
  const orphanedPort = await reservePort();
  const orphanedPid = await startOrphanedDashboard(orphanedProject, orphanedPort);
  const orphanedOutput = await runInstaller(repairedProject, orphanedPort, testBin);
  assert.match(orphanedOutput, /Stopping an earlier AmirOS dashboard service/, "Installer should stop a verified orphaned AmirOS backend.");
  await waitForDashboard(orphanedPort, repairedProject);
  assertBuildAndRuntime(repairedProject);
  assert.throws(() => process.kill(orphanedPid, 0), { code: "ESRCH" }, "The orphaned backend should be stopped before the new dashboard starts.");
  await stopInstalledAmiros(repairedProject);

  console.log("Installer upgrade test passed: clean install, prior-data upgrade, stale watchdog, and orphaned dashboard recovery all launched safely.");
} finally {
  for (const project of installedProjects) {
    await stopInstalledAmiros(project).catch(() => undefined);
  }
  rmSync(testDirectory, { recursive: true, force: true });
}
