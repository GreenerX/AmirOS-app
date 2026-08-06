import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handleSystemApiRoute, readBackendRestartStatus } from "../src/dashboard/system-routes.js";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const watchdogPath = resolve(projectDirectory, "scripts/amiros-watchdog.mjs");
const safeServerPath = resolve(projectDirectory, "scripts/runtime-recovery-safe-server.mjs");
const testDirectory = mkdtempSync("/tmp/amiros-backend-restart-");
const workDirectory = resolve(testDirectory, "work");
const logPath = resolve(workDirectory, "bot.log");

// The tiny HTTP fixture below uses the same dashboard route helper as AmirOS.
// Point it at this test's private work folder before it receives any request.
process.env.AMIROS_WATCHDOG_WORK_DIRECTORY = workDirectory;

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

async function dashboard(port: number): Promise<{ pid: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/dashboard`, { signal: controller.signal });
    assert.equal(response.status, 200, "The safe dashboard should be available.");
    const payload = await response.json() as { runtimeRecoveryTestServerPid?: unknown; connection?: { status?: string } };
    assert.equal(payload.connection?.status, "ready", "The safe backend must never connect to WhatsApp.");
    assert.equal(typeof payload.runtimeRecoveryTestServerPid, "number", "Expected a fake local backend PID.");
    return { pid: payload.runtimeRecoveryTestServerPid as number };
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

async function startLocalRestartApi(port: number) {
  const startedAt = Date.now();
  const server = createHttpServer((request, response) => {
    const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
    void handleSystemApiRoute({
      request,
      response,
      pathname: url.pathname,
      dashboardStartedAt: startedAt,
      sendJson: (target, status, value) => {
        target.writeHead(status, { "content-type": "application/json" });
        target.end(JSON.stringify(value));
      },
    }).then((handled) => {
      if (!handled) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "Not found" }));
      }
    });
  });
  await new Promise<void>((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolveReady());
  });
  return server;
}

const port = await reservePort();
const restartApiPort = await reservePort();
const watchdog = spawn(process.execPath, [watchdogPath], {
  cwd: projectDirectory,
  env: {
    ...process.env,
    AMIROS_PORT: String(port),
    AMIROS_WATCHDOG_SERVER_PATH: safeServerPath,
    AMIROS_WATCHDOG_WORK_DIRECTORY: workDirectory,
    AMIROS_WATCHDOG_HEALTH_INTERVAL_MS: "1000",
    AMIROS_WATCHDOG_HEALTH_RESTART_DELAY_MS: "100",
    AMIROS_WATCHDOG_RETRY_BASE_DELAY_MS: "100",
    AMIROS_WATCHDOG_RETRY_MAX_DELAY_MS: "200",
    OPENAI_API_KEY: "",
    WHATSAPP_SESSION_PATH: resolve(testDirectory, "whatsapp-session"),
  },
  stdio: "ignore",
});

let testSucceeded = false;
try {
  const initialDashboard = await waitFor("Initial safe dashboard startup", () => dashboard(port));
  const restartApi = await startLocalRestartApi(restartApiPort);
  try {
    const firstRequest = await fetch(`http://127.0.0.1:${restartApiPort}/api/system/backend-restart`, { method: "POST" });
    assert.equal(firstRequest.status, 202, "The local dashboard restart request should be accepted.");
    const firstPayload = await firstRequest.json() as { accepted?: unknown; status?: { status?: string } };
    assert.equal(firstPayload.accepted, true, "The endpoint should report an accepted restart request.");
    assert.equal(firstPayload.status?.status, "restarting", "The accepted request should mark the backend as restarting.");

    const duplicateRequest = await fetch(`http://127.0.0.1:${restartApiPort}/api/system/backend-restart`, { method: "POST" });
    assert.equal(duplicateRequest.status, 409, "A duplicate restart request should be safely ignored.");
  } finally {
    await new Promise<void>((resolveClosed) => restartApi.close(() => resolveClosed()));
  }

  const recoveredDashboard = await waitFor("Watchdog backend restart", async () => {
    const current = await dashboard(port);
    return current.pid !== initialDashboard.pid ? current : undefined;
  });
  assert.notEqual(recoveredDashboard.pid, initialDashboard.pid, "Restart should create a fresh safe backend process.");

  await waitFor("Watchdog restart success", async () => readBackendRestartStatus(workDirectory).status === "running" ? true : undefined);
  await waitFor("Watchdog restart logs", async () => {
    const log = readFileSync(logPath, "utf8");
    return /Dashboard restart request received/.test(log)
      && /Stopping backend before restart/.test(log)
      && /Restart scheduled/.test(log)
      && /Restart started/.test(log)
      && /Restart succeeded/.test(log)
      ? true
      : undefined;
  });

  console.log("Backend restart test passed: the watchdog restarted an isolated local service and ignored a duplicate request.");
  testSucceeded = true;
} finally {
  if (!testSucceeded) {
    try { console.error(`Backend restart watchdog log:\n${readFileSync(logPath, "utf8")}`); } catch {}
  }
  await stopWatchdog(watchdog);
  rmSync(testDirectory, { recursive: true, force: true });
}
