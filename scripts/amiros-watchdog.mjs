import { closeSync, existsSync, mkdirSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workDirectory = resolve(projectDirectory, "work");
const logPath = resolve(workDirectory, "bot.log");
const pidPath = resolve(workDirectory, "amiros.pid");
const serverPath = resolve(projectDirectory, "dist/src/server.js");
const dashboardPort = Number(process.env.AMIROS_PORT || 3789);
const dashboardUrl = `http://127.0.0.1:${Number.isFinite(dashboardPort) ? dashboardPort : 3789}/api/dashboard`;

if (!existsSync(serverPath)) throw new Error("AmirOS has not been built yet. Run npm run build, then start it again.");
mkdirSync(workDirectory, { recursive: true });
writeFileSync(pidPath, `${process.pid}\n`, { encoding: "utf8", mode: 0o600 });

let child;
let stopping = false;
let restarting = false;
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

function startServer(reason) {
  if (stopping || child) return;
  const log = openSync(logPath, "a", 0o600);
  logLine(`Starting service (${reason}).`);
  child = spawn(process.execPath, [serverPath], {
    cwd: projectDirectory,
    env: process.env,
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  child.once("exit", (code, signal) => {
    child = undefined;
    if (stopping) return;
    failures += 1;
    const wait = Math.min(30_000, 2_000 * failures);
    logLine(`Service exited (${signal || code || "unknown"}); retrying in ${Math.round(wait / 1000)}s.`);
    setTimeout(() => startServer("automatic recovery"), wait).unref();
  });
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
    if (stopping || restarting || !child) return;
    const health = await dashboardHealth();
    if (health.healthy) {
      failures = 0;
      whatsappUnhealthySince = 0;
      return;
    }
    // A dead dashboard cannot recover its own in-process watchdog. Preserve
    // the original quick service restart for that separate failure mode.
    if (health.kind === "dashboard") {
      restarting = true;
      logLine(`Dashboard health check failed (${health.reason}); restarting the service.`);
      child.kill("SIGTERM");
      setTimeout(() => {
        restarting = false;
        startServer("dashboard health recovery");
      }, 4_000).unref();
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
    restarting = true;
    logLine(`Recovery check is restarting the service after 2 minutes: ${health.reason}.`);
    child.kill("SIGTERM");
    setTimeout(() => {
      restarting = false;
      startServer("health check recovery");
    }, 4_000).unref();
  })();
}, 15_000).unref();

function shutdown() {
  stopping = true;
  logLine("Watchdog stopped by user.");
  if (child) child.kill("SIGTERM");
  try { unlinkSync(pidPath); } catch {}
  setTimeout(() => process.exit(0), 2_500).unref();
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
startServer("launcher");
