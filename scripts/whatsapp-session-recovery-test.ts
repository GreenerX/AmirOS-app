import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const watchdogPath = resolve(projectDirectory, "scripts/amiros-watchdog.mjs");
const safeServerPath = resolve(projectDirectory, "scripts/runtime-recovery-safe-server.mjs");
const safeSessionLockPath = resolve(projectDirectory, "scripts/whatsapp-session-lock-safe-process.mjs");
const testDirectory = mkdtempSync("/tmp/amiros-whatsapp-session-recovery-");
const workDirectory = resolve(testDirectory, "work");
const sessionRoot = resolve(testDirectory, "whatsapp-session");
const sessionDirectory = resolve(sessionRoot, "session");
const logPath = resolve(workDirectory, "bot.log");

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

async function waitFor<T>(description: string, action: () => Promise<T | undefined>, timeoutMs = 12_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const result = await action();
      if (result !== undefined) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 75));
  }
  throw new Error(`${description} did not happen in time.${lastError instanceof Error ? ` Last error: ${lastError.message}` : ""}`);
}

async function dashboardIsReady(port: number): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 750);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/dashboard`, { signal: controller.signal });
    const payload = await response.json() as { connection?: { status?: string }; runtimeRecoveryTestServerPid?: unknown };
    return response.ok
      && payload.connection?.status === "ready"
      && typeof payload.runtimeRecoveryTestServerPid === "number";
  } finally {
    clearTimeout(timeout);
  }
}

async function stopProcess(processToStop: ReturnType<typeof spawn>, label: string): Promise<void> {
  if (processToStop.exitCode !== null) return;
  processToStop.kill("SIGTERM");
  await waitFor(`${label} shutdown`, async () => processToStop.exitCode === null ? undefined : true, 5_000);
}

mkdirSync(sessionDirectory, { recursive: true });
const port = await reservePort();
const fakeSessionBrowser = spawn(process.execPath, [safeSessionLockPath, `--user-data-dir=${sessionDirectory}`], {
  cwd: projectDirectory,
  stdio: "ignore",
});
const unrelatedBrowser = spawn(process.execPath, [safeSessionLockPath, `--user-data-dir=${sessionDirectory}-unrelated`], {
  cwd: projectDirectory,
  stdio: "ignore",
});
const watchdog = spawn(process.execPath, [watchdogPath], {
  cwd: projectDirectory,
  env: {
    ...process.env,
    AMIROS_PORT: String(port),
    AMIROS_WATCHDOG_SERVER_PATH: safeServerPath,
    AMIROS_WATCHDOG_WORK_DIRECTORY: workDirectory,
    AMIROS_WATCHDOG_HEALTH_INTERVAL_MS: "1000",
    AMIROS_WATCHDOG_RETRY_BASE_DELAY_MS: "100",
    AMIROS_WATCHDOG_RETRY_MAX_DELAY_MS: "200",
    AMIROS_WATCHDOG_SESSION_LOCK_GRACE_MS: "50",
    AMIROS_WATCHDOG_SESSION_TERMINATION_GRACE_MS: "250",
    AMIROS_WATCHDOG_SESSION_LOCK_POLL_MS: "30",
    OPENAI_API_KEY: "",
    WHATSAPP_SESSION_PATH: sessionRoot,
  },
  stdio: "ignore",
});

let testSucceeded = false;
try {
  await waitFor("The fake locked browser to be closed", async () =>
    fakeSessionBrowser.exitCode === null ? undefined : true,
  );
  await waitFor("Safe dashboard startup after session cleanup", async () =>
    await dashboardIsReady(port) ? true : undefined,
  );
  assert.equal(existsSync(sessionDirectory), true, "The saved WhatsApp session folder should not be deleted.");
  assert.equal(unrelatedBrowser.exitCode, null, "An unrelated browser profile should not be stopped.");
  await waitFor("Session-recovery logs", async () => {
    const log = readFileSync(logPath, "utf8");
    return /WhatsApp session browser lock detected/.test(log)
      && /Stopping the stale AmirOS WhatsApp browser session/.test(log)
      && /WhatsApp session browser lock released after a graceful stop/.test(log)
      && /Starting service/.test(log)
      ? true
      : undefined;
  });

  console.log("WhatsApp session recovery test passed: an isolated fake browser lock was safely released before AmirOS started.");
  testSucceeded = true;
} finally {
  if (!testSucceeded) {
    try { console.error(`WhatsApp session recovery watchdog log:\n${readFileSync(logPath, "utf8")}`); } catch {}
  }
  await stopProcess(watchdog, "Watchdog");
  await stopProcess(fakeSessionBrowser, "Safe session-lock fixture");
  await stopProcess(unrelatedBrowser, "Unrelated safe browser fixture");
  rmSync(testDirectory, { recursive: true, force: true });
}
