import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const watchdogPath = resolve(projectDirectory, "scripts/amiros-watchdog.mjs");
const safeServerPath = resolve(projectDirectory, "scripts/runtime-recovery-safe-server.mjs");
const testDirectory = mkdtempSync("/tmp/amiros-runtime-recovery-");
const workDirectory = resolve(testDirectory, "work");
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

async function requestDashboard(port: number): Promise<{ testServerPid: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 750);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/dashboard`, { signal: controller.signal });
    assert.equal(response.status, 200, "Dashboard should respond successfully.");
    const payload = await response.json() as { connection?: { status?: string }; runtimeRecoveryTestServerPid?: unknown };
    assert.equal(payload.connection?.status, "ready", "Safe test server should report a ready connection.");
    assert.equal(typeof payload.runtimeRecoveryTestServerPid, "number", "Dashboard should identify the safe test backend.");
    return { testServerPid: payload.runtimeRecoveryTestServerPid as number };
  } finally {
    clearTimeout(timeout);
  }
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

async function stopWatchdog(watchdog: ReturnType<typeof spawn>): Promise<void> {
  if (watchdog.exitCode !== null) return;
  watchdog.kill("SIGTERM");
  await waitFor("Watchdog shutdown", async () => watchdog.exitCode === null ? undefined : true, 5_000);
}

const port = await reservePort();
const watchdog = spawn(process.execPath, [watchdogPath], {
  cwd: projectDirectory,
  env: {
    ...process.env,
    AMIROS_PORT: String(port),
    AMIROS_WATCHDOG_SERVER_PATH: safeServerPath,
    AMIROS_WATCHDOG_WORK_DIRECTORY: workDirectory,
    // Leave enough startup time for the isolated HTTP fixture while still
    // checking recovery quickly. Production keeps its normal 15-second check.
    AMIROS_WATCHDOG_HEALTH_INTERVAL_MS: "1000",
    AMIROS_WATCHDOG_RETRY_BASE_DELAY_MS: "100",
    AMIROS_WATCHDOG_RETRY_MAX_DELAY_MS: "200",
    OPENAI_API_KEY: "",
    WHATSAPP_SESSION_PATH: resolve(testDirectory, "whatsapp-session"),
  },
  stdio: "ignore",
});

let testSucceeded = false;
try {
  const firstDashboard = await waitFor("Initial safe dashboard startup", () => requestDashboard(port));

  const stopResponse = await fetch(`http://127.0.0.1:${port}/__amiros-runtime-recovery-test__/stop`, { method: "POST" });
  assert.equal(stopResponse.status, 204, "The safe backend should accept the deliberate stop request.");

  const recoveredDashboard = await waitFor("Watchdog recovery", async () => {
    const dashboard = await requestDashboard(port);
    return dashboard.testServerPid !== firstDashboard.testServerPid ? dashboard : undefined;
  });
  assert.notEqual(recoveredDashboard.testServerPid, firstDashboard.testServerPid, "Recovery must start a fresh backend process.");

  await waitFor("Recovery logs", async () => {
    const log = readFileSync(logPath, "utf8");
    return /Backend stopped/.test(log)
      && /Restart scheduled/.test(log)
      && /Restart started/.test(log)
      && /Restart succeeded/.test(log)
      ? log
      : undefined;
  });

  console.log("Runtime recovery test passed: the safe backend was restarted and the dashboard became available again.");
  testSucceeded = true;
} finally {
  if (!testSucceeded) {
    try {
      console.error(`Runtime recovery watchdog log:\n${readFileSync(logPath, "utf8")}`);
    } catch {}
  }
  await stopWatchdog(watchdog);
  rmSync(testDirectory, { recursive: true, force: true });
}
