import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureFreshBackendBuild, ensureFreshUiBuild, isBuildFreshnessError } from "./build-freshness.mjs";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configuredWorkDirectory = process.env.AMIROS_WATCHDOG_WORK_DIRECTORY;
const configuredServerPath = process.env.AMIROS_WATCHDOG_SERVER_PATH;
const workDirectory = configuredWorkDirectory
  ? resolve(configuredWorkDirectory)
  : resolve(projectDirectory, "work");
const logPath = resolve(workDirectory, "bot.log");
const pidPath = resolve(workDirectory, "amiros.pid");
const restartCommandPath = resolve(workDirectory, "backend-restart-request.json");
const restartStatusPath = resolve(workDirectory, "backend-restart-status.json");
const serverPath = configuredServerPath
  ? resolve(configuredServerPath)
  : resolve(projectDirectory, "dist/src/server.js");

function localEnvironmentValue(name) {
  const localEnvironmentPath = resolve(projectDirectory, ".env.local");
  if (!existsSync(localEnvironmentPath)) return undefined;
  try {
    for (const line of readFileSync(localEnvironmentPath, "utf8").split(/\r?\n/u)) {
      const separator = line.indexOf("=");
      if (separator < 1 || line.slice(0, separator).trim() !== name) continue;
      const value = line.slice(separator + 1).trim();
      return value.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/u, "$1$2") || undefined;
    }
  } catch {
    // The watchdog can still use the standard session folder if the local
    // settings file is unavailable while a recovery is in progress.
  }
  return undefined;
}

const configuredWhatsAppSessionPath =
  process.env.WHATSAPP_SESSION_PATH || localEnvironmentValue("WHATSAPP_SESSION_PATH");
const whatsappSessionDirectory = resolve(
  projectDirectory,
  configuredWhatsAppSessionPath || ".wwebjs_auth",
  "session",
);

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
const sessionLockGraceMs = positiveMilliseconds("AMIROS_WATCHDOG_SESSION_LOCK_GRACE_MS", 1_500);
const sessionTerminationGraceMs = positiveMilliseconds("AMIROS_WATCHDOG_SESSION_TERMINATION_GRACE_MS", 4_000);
const sessionLockPollMs = positiveMilliseconds("AMIROS_WATCHDOG_SESSION_LOCK_POLL_MS", 150);

mkdirSync(workDirectory, { recursive: true });
writeFileSync(pidPath, `${process.pid}\n`, { encoding: "utf8", mode: 0o600 });

let child;
let stopping = false;
let restartRequest;
let restartTimer;
let recoveryInProgress = false;
let failures = 0;
let whatsappUnhealthySince = 0;
let availabilityTimer;
let startingServer = false;
let sessionRecoveryInProgress = false;
let shutdownExitTimer;
let shutdownFinalizing = false;

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

function writeBackendStatus(status, extra = {}) {
  writeFileSync(restartStatusPath, `${JSON.stringify({ status, updatedAt: Date.now(), ...extra })}\n`, { encoding: "utf8", mode: 0o600 });
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function usesAmirOSWhatsAppSession(command) {
  const plainMarker = `--user-data-dir=${whatsappSessionDirectory}`;
  const quotedMarkers = [
    `--user-data-dir="${whatsappSessionDirectory}"`,
    `--user-data-dir='${whatsappSessionDirectory}'`,
  ];
  const isCompleteArgument = (marker) => {
    const index = command.indexOf(marker);
    if (index < 0) return false;
    const remainingCommand = command.slice(index + marker.length);
    return remainingCommand.length === 0 || /^\s+--/u.test(remainingCommand);
  };
  return isCompleteArgument(plainMarker) || quotedMarkers.some(isCompleteArgument);
}

function sessionBrowserProcesses() {
  try {
    const result = process.platform === "win32" ? undefined : execFileSync(
      process.platform === "darwin" ? "/bin/ps" : "ps",
      ["-ax", "-o", "pid=,ppid=,command="],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    if (!result) return [];
    return result
      .split(/\r?\n/u)
      .map((line) => {
        const match = line.match(/^\s*(\d+)\s+(\d+)\s+([\s\S]+)$/u);
        if (!match) return undefined;
        return { pid: Number(match[1]), command: match[3] };
      })
      .filter((processInfo) =>
        processInfo
        && Number.isInteger(processInfo.pid)
        && processInfo.pid !== process.pid
        && usesAmirOSWhatsAppSession(processInfo.command),
      );
  } catch (error) {
    logLine(`Unable to inspect the AmirOS WhatsApp browser session (${error instanceof Error ? error.message : String(error)}).`);
    return [];
  }
}

function terminateSessionProcesses(processes, signal) {
  for (const processInfo of processes) {
    try {
      process.kill(processInfo.pid, signal);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") continue;
      logLine(`Could not stop WhatsApp session browser PID ${processInfo.pid} (${error instanceof Error ? error.message : String(error)}).`);
    }
  }
}

async function releaseWhatsAppSessionBrowser() {
  if (sessionRecoveryInProgress) return false;
  const initialProcesses = sessionBrowserProcesses();
  if (!initialProcesses.length) return true;

  sessionRecoveryInProgress = true;
  try {
    const identifiers = initialProcesses.map((processInfo) => processInfo.pid).join(", ");
    logLine(`WhatsApp session browser lock detected for AmirOS (PID ${identifiers}). Waiting briefly for it to close.`);
    await wait(sessionLockGraceMs);

    let remainingProcesses = sessionBrowserProcesses();
    if (!remainingProcesses.length) {
      logLine("WhatsApp session browser lock released cleanly.");
      return true;
    }

    logLine(`Stopping the stale AmirOS WhatsApp browser session (PID ${remainingProcesses.map((processInfo) => processInfo.pid).join(", ")}).`);
    terminateSessionProcesses(remainingProcesses, "SIGTERM");
    await wait(sessionTerminationGraceMs);

    remainingProcesses = sessionBrowserProcesses();
    if (!remainingProcesses.length) {
      logLine("WhatsApp session browser lock released after a graceful stop.");
      return true;
    }

    logLine(`Force-stopping the stale AmirOS WhatsApp browser session (PID ${remainingProcesses.map((processInfo) => processInfo.pid).join(", ")}).`);
    terminateSessionProcesses(remainingProcesses, "SIGKILL");
    await wait(sessionLockPollMs);

    remainingProcesses = sessionBrowserProcesses();
    if (!remainingProcesses.length) {
      logLine("WhatsApp session browser lock released after forced cleanup.");
      return true;
    }

    logLine(`WhatsApp session browser lock is still present (PID ${remainingProcesses.map((processInfo) => processInfo.pid).join(", ")}). Recovery will retry without changing session data.`);
    return false;
  } finally {
    sessionRecoveryInProgress = false;
  }
}

function scheduleRestart(reason, delay, alreadyAnnounced = false) {
  if (stopping) return;
  if (restartTimer || restartRequest) {
    logLine(`Restart already pending; ignoring duplicate restart request (${reason}).`);
    return;
  }

  recoveryInProgress = true;
  writeBackendStatus("restarting");
  if (!alreadyAnnounced) {
    logLine(`Restart scheduled in ${formatDelay(delay)} (${reason}).`);
  }

  // This timer intentionally stays referenced. It is the only thing keeping
  // the watchdog alive after an unexpected backend exit and before recovery.
  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    if (stopping) return;
    void startServer(reason, true);
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

function readRestartCommand() {
  if (!existsSync(restartCommandPath)) return undefined;
  try {
    const command = JSON.parse(readFileSync(restartCommandPath, "utf8"));
    return typeof command === "object" && command ? command : undefined;
  } catch {
    return undefined;
  }
}

function processRestartCommand() {
  if (stopping || !existsSync(restartCommandPath)) return;
  const command = readRestartCommand();
  try { unlinkSync(restartCommandPath); } catch {}
  if (!command) {
    logLine("Restart request ignored because it was not valid.");
    return;
  }
  if (restartRequest || restartTimer) {
    logLine("Restart already pending; ignoring duplicate dashboard restart request.");
    return;
  }
  writeBackendStatus("restarting", {
    requestedAt: typeof command.requestedAt === "number" ? command.requestedAt : Date.now(),
    requestId: typeof command.requestId === "string" ? command.requestId : undefined,
  });
  logLine("Dashboard restart request received.");
  requestRestart("dashboard restart request", healthRestartDelayMs);
}

async function startServer(reason, isRecovery = false) {
  if (stopping || child || startingServer) return;
  startingServer = true;
  try {
    if (!configuredServerPath) {
      const build = ensureFreshBackendBuild(projectDirectory, { log: logLine });
      if (!build.rebuilt) logLine("Build preflight passed; compiled backend is current.");
      const uiBuild = ensureFreshUiBuild(projectDirectory, { log: logLine });
      if (!uiBuild.rebuilt) logLine("Build preflight passed; dashboard UI build is current.");
    } else if (!existsSync(serverPath)) {
      throw new Error(`The configured backend fixture does not exist: ${serverPath}`);
    }
    const sessionReleased = await releaseWhatsAppSessionBrowser();
    if (!sessionReleased) throw new Error("The AmirOS WhatsApp browser session is still locked");

    const log = openSync(logPath, "a", 0o600);
    try {
    logLine(isRecovery ? `Restart started (${reason}).` : `Starting service (${reason}).`);
    const serverChild = spawn(process.execPath, [serverPath], {
      cwd: projectDirectory,
      env: process.env,
      stdio: ["ignore", log, log],
    });
    child = serverChild;
    if (isRecovery) confirmRecoveryAvailability();
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
        void finishShutdown();
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
    } finally {
      closeSync(log);
    }
  } catch (error) {
    if (!stopping) {
      recoveryInProgress = false;
      if (isBuildFreshnessError(error)) {
        const detail = error instanceof Error ? error.message : String(error);
        logLine(`Backend launch blocked by build preflight: ${detail}`);
        writeBackendStatus("failed", { detail });
        stopping = true;
        clearInterval(restartCommandTimer);
        clearInterval(healthTimer);
        try { unlinkSync(pidPath); } catch {}
        process.exitCode = 1;
        return;
      }
      failures += 1;
      logLine(`Restart failed: unable to launch the backend (${error instanceof Error ? error.message : String(error)}).`);
      const wait = Math.min(retryMaximumDelayMs, retryBaseDelayMs * failures);
      scheduleRestart("automatic recovery after launch failure", wait);
    }
  } finally {
    startingServer = false;
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

function confirmRecoveryAvailability() {
  if (stopping || !recoveryInProgress || !child) return;
  void dashboardHealth().then((health) => {
    if (stopping || !recoveryInProgress) return;
    if (health.healthy) {
      recoveryInProgress = false;
      failures = 0;
      whatsappUnhealthySince = 0;
      writeBackendStatus("running");
      logLine("Restart succeeded: dashboard is available again.");
      return;
    }
    availabilityTimer = setTimeout(confirmRecoveryAvailability, 300);
  }).catch(() => {
    availabilityTimer = setTimeout(confirmRecoveryAvailability, 300);
  });
}

const healthTimer = setInterval(() => {
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
}, healthCheckIntervalMs);
healthTimer.unref();

const restartCommandTimer = setInterval(processRestartCommand, 300);
restartCommandTimer.unref();

async function finishShutdown() {
  if (shutdownFinalizing) return;
  shutdownFinalizing = true;
  if (shutdownExitTimer) clearTimeout(shutdownExitTimer);
  // The backend normally closes Puppeteer itself. This final check handles a
  // rare leftover process without touching any WhatsApp session files.
  await releaseWhatsAppSessionBrowser();
  try { unlinkSync(pidPath); } catch {}
  process.exit(0);
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  logLine("Watchdog stopped by user.");
  restartRequest = undefined;
  recoveryInProgress = false;
  // An intentional stop always wins over a queued dashboard restart. Leaving
  // this command behind would restart the next manual launch unnecessarily.
  try { unlinkSync(restartCommandPath); } catch {}
  writeBackendStatus("offline");
  if (availabilityTimer) {
    clearTimeout(availabilityTimer);
    availabilityTimer = undefined;
  }
  clearInterval(restartCommandTimer);
  clearInterval(healthTimer);
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = undefined;
  }
  if (child) {
    child.kill("SIGTERM");
    shutdownExitTimer = setTimeout(() => {
      if (child) {
        logLine("Backend did not stop cleanly in time; forcing its final shutdown.");
        child.kill("SIGKILL");
      }
      void finishShutdown();
    }, 10_000);
    return;
  }
  void finishShutdown();
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
void startServer("launcher");
