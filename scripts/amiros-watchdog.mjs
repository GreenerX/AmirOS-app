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

async function dashboardHealthy() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(dashboardUrl, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

setInterval(() => {
  void (async () => {
    if (stopping || restarting || !child) return;
    if (await dashboardHealthy()) {
      failures = 0;
      return;
    }
    restarting = true;
    logLine("Dashboard health check failed; restarting the service.");
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
