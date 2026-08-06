import { closeSync, existsSync, mkdirSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configuredWorkDirectory = process.env.AMIROS_WATCHDOG_WORK_DIRECTORY;
const configuredServerPath = process.env.AMIROS_WATCHDOG_SERVER_PATH;
const workDirectory = configuredWorkDirectory
  ? resolve(configuredWorkDirectory)
  : resolve(projectDirectory, "work");
const logPath = resolve(workDirectory, "bot.log");
const pidPath = resolve(workDirectory, "amiros.pid");
const serverPath = configuredServerPath
  ? resolve(configuredServerPath)
  : resolve(projectDirectory, "dist/src/server.js");

function positiveMilliseconds(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const dashboardPort = Number(process.env.AMIROS_PORT || 3789);
const dashboardUrl = `http://127.0.0.1:${Number.isFinite(dashboardPort) ? dashboardPort : 3789}/api/dashboard`;
const healthCheckIntervalMs = positiveMilliseconds("AMIROS_WATCHDOG_HEALTH_INTERVAL_MS", 15_000);
const healthRestartDelayMs = positiveMilliseconds("AMIROS_WATCHDOG_HEALTH_RESTART_DELAY_MS", 4_000);
const retryBaseDelayMs = positiveMilliseconds("AMIROS_WATCHDOG_RETRY_BASE_DELAY_MS", 2_000);
const retryMaximumDelayMs = positiveMilliseconds("AMIROS_WATCHDOG_RETRY_MAX_DELAY_MS", 30_000);

if (!existsSync(serverPath)) throw new Error("AmirOS has not been built yet. Run npm run build, then start it again.");
mkdirSync(workDirectory, { recursive: true });
writeFileSync(pidPath, `${process.pid}\n`, { encoding: "utf8", mode: 0o600 });

let child;
let stopping = false;
let restartRequest;
let restartTimer;
let recoveryInProgress = false;
let failures = 0;
let whatsappUnhealthySince = 0;

function logLine(message) {
  const descriptor = openSync(logPath, "a", 0o600);
  try {
    writeFileSync(descriptor, `[AmirOS watchdog] ${new Date().toISOString()} ${message}\n`);
  } finally {
    closeSync(descriptor);
  }
}

function describeExit(code, signal) {
  if (signal) return `signal ${signal}`;
  if (typeof code === "number") return `code ${code}`;
  return "unknown reason";
}

function formatDelay(delay) {
  return `${Math.max(1, Math.round(delay / 1_000))}s`;
}

function scheduleRestart(reason, delay, alreadyAnnounced = false) {
  if (stopping) return;
  if (restartTimer || restartRequest) {
    logLine(`Restart already pending; ignoring duplicate restart request (${reason}).`);
    return;
  }

  recoveryInProgress = true;
  if (!alreadyAnnounced) {
    logLine(`Restart scheduled in ${formatDelay(delay)} (${reason}).`);
  }

  // This timer intentionally stays referenced. It is the only thing keeping
  // the watchdog alive after an unexpected backend exit and before recovery.
  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    if (stopping) return;
    startServer(reason, true);
  }, delay);
}

function requestRestart(reason, delay) {
  if (stopping) return;
  if (restartRequest || restartTimer) {
    logLine(`Restart already pending; ignoring duplicate restart request (${reason}).`);
    return;
  }

  if (!child) {
    scheduleRestart(reason, delay);
    return;
  }

  restartRequest = { reason, delay };
  logLine(`Restart scheduled in ${formatDelay(delay)} after backend stops (${reason}).`);
  logLine(`Stopping backend before restart (${reason}).`);
  child.kill("SIGTERM");
}

function startServer(reason, isRecovery = false) {
  if (stopping || child) return;
  const log = openSync(logPath, "a", 0o600);
  try {
    logLine(isRecovery ? `Restart started (${reason}).` : `Starting service (${reason}).`);
    const serverChild = spawn(process.execPath, [serverPath], {
      cwd: projectDirectory,
      env: process.env,
      stdio: ["ignore", log, log],
    });
    child = serverChild;
    serverChild.once("error", (error) => {
      if (!stopping && isRecovery) {
        logLine(`Restart failed: unable to start the backend (${error.message}).`);
      }
    });
    serverChild.once("exit", (code, signal) => {
      if (child === serverChild) child = undefined;
      const exitReason = describeExit(code, signal);
      if (stopping) {
        logLine(`Backend stopped during intentional shutdown (${exitReason}).`);
        return;
      }

      logLine(`Backend stopped (${exitReason}).`);
      if (recoveryInProgress) {
        recoveryInProgress = false;
        logLine(`Restart failed: backend stopped before recovery was confirmed (${exitReason}).`);
      }

      const plannedRestart = restartRequest;
      restartRequest = undefined;
      if (plannedRestart) {
        scheduleRestart(plannedRestart.reason, plannedRestart.delay, true);
        return;
      }

      failures += 1;
      const wait = Math.min(retryMaximumDelayMs, retryBaseDelayMs * failures);
      scheduleRestart("automatic recovery after backend exit", wait);
    });
  } catch (error) {
    if (!stopping) {
      recoveryInProgress = false;
      failures += 1;
      logLine(`Restart failed: unable to launch the backend (${error instanceof Error ? error.message : String(error)}).`);
      const wait = Math.min(retryMaximumDelayMs, retryBaseDelayMs * failures);
      scheduleRestart("automatic recovery after launch failure", wait);
    }
  } finally {
    closeSync(log);
  }
}

async function dashboardHealth() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(dashboardUrl, { signal: controller.signal });
    if (!response.ok) {
      return { healthy: false, kind: "dashboard", reason: `dashboard returned ${response.status}` };
    }
    const payload = await response.json();
    const connectionStatus = payload?.connection?.status;
    const connectionDetail = String(payload?.connection?.detail || "");
    if (connectionStatus === "ready") return { healthy: true, reason: "WhatsApp is ready" };
    // A QR scan and an initial authentication are user-driven states. Restarting
    // the process would only replace the same QR and make setup frustrating.
    if (connectionStatus === "qr") return { healthy: true, reason: "waiting for WhatsApp QR scan" };
    // An authentication failure needs a deliberate re-link, not an endless
    // restart loop that continually replaces the user's recovery screen.
    if (/authentication failed|re-link|relink/i.test(connectionDetail)) {
      return { healthy: true, reason: "waiting for a manual WhatsApp re-link" };
    }
    return {
      healthy: false,
      kind: "whatsapp",
      reason: `WhatsApp status is ${connectionStatus || "unknown"}${connectionDetail ? ` (${connectionDetail})` : ""}`,
    };
  } catch {
    return { healthy: false, kind: "dashboard", reason: "dashboard is unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}

setInterval(() => {
  void (async () => {
    if (stopping || restartRequest || restartTimer || !child) return;
    const health = await dashboardHealth();
    if (health.healthy) {
      if (recoveryInProgress) {
        recoveryInProgress = false;
        logLine("Restart succeeded: dashboard is available again.");
      }
      failures = 0;
      whatsappUnhealthySince = 0;
      return;
    }
    // A dead dashboard cannot recover its own in-process watchdog. Preserve
    // the original quick service restart for that separate failure mode.
    if (health.kind === "dashboard") {
      logLine(`Dashboard health check failed (${health.reason}); requesting a service restart.`);
      requestRestart("dashboard health recovery", healthRestartDelayMs);
      return;
    }
    const now = Date.now();
    if (!whatsappUnhealthySince) {
      whatsappUnhealthySince = now;
      logLine(`Recovery check noticed ${health.reason}; giving WhatsApp time to reconnect.`);
      return;
    }
    // The in-process WhatsApp watchdog normally recovers within seconds. This
    // is a last-resort restart only if a network interruption leaves it stuck.
    if (now - whatsappUnhealthySince < 120_000) return;
    logLine(`Recovery check is requesting a service restart after 2 minutes: ${health.reason}.`);
    requestRestart("health check recovery", healthRestartDelayMs);
  })();
}, healthCheckIntervalMs).unref();

function shutdown() {
  if (stopping) return;
  stopping = true;
  logLine("Watchdog stopped by user.");
  restartRequest = undefined;
  recoveryInProgress = false;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = undefined;
  }
  if (child) child.kill("SIGTERM");
  try { unlinkSync(pidPath); } catch {}
  setTimeout(() => process.exit(0), 2_500);
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
startServer("launcher");
