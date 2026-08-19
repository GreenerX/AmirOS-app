import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const launchAgentLabel = "com.amiros.app";
export const intentionalStopFileName = "amiros-intentional-stop.json";
const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function launchAgentPath(homeDirectory = homedir()) {
  return resolve(homeDirectory, "Library", "LaunchAgents", `${launchAgentLabel}.plist`);
}

export function intentionalStopPath(workDirectory) {
  return resolve(workDirectory, intentionalStopFileName);
}

export function createLaunchAgentPlist({ nodePath, projectPath, pathEnvironment = process.env.PATH || "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" }) {
  const workDirectory = resolve(projectPath, "work");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${xml(launchAgentLabel)}</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>${xml(resolve(projectPath, "scripts", "launch-agent-runner.sh"))}</string></array>
  <key>WorkingDirectory</key><string>${xml(projectPath)}</string>
  <key>EnvironmentVariables</key><dict>
    <key>AMIROS_LAUNCH_AGENT_MANAGED</key><string>1</string>
    <key>AMIROS_NODE_PATH</key><string>${xml(nodePath)}</string>
    <key>HOME</key><string>${xml(homedir())}</string>
    <key>PATH</key><string>${xml(pathEnvironment)}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>${xml(resolve(workDirectory, "bot.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(resolve(workDirectory, "bot.log"))}</string>
</dict></plist>
`;
}

export function writeIntentionalStopMarker(workDirectory, reason = "user-requested stop") {
  mkdirSync(workDirectory, { recursive: true });
  const target = intentionalStopPath(workDirectory);
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ reason, requestedAt: new Date().toISOString() })}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, target);
  chmodSync(target, 0o600);
  return target;
}

export function consumeIntentionalStopMarker(workDirectory) {
  const target = intentionalStopPath(workDirectory);
  if (!existsSync(target)) return undefined;
  try {
    const payload = JSON.parse(readFileSync(target, "utf8"));
    return typeof payload?.reason === "string" ? payload.reason : "intentional stop";
  } catch {
    return "intentional stop";
  } finally {
    try { unlinkSync(target); } catch {}
  }
}

function runLaunchctl(argumentsList) {
  try {
    execFileSync("/bin/launchctl", argumentsList, { stdio: "ignore", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

function guiDomain() { return `gui/${process.getuid()}`; }
function serviceTarget() { return `${guiDomain()}/${launchAgentLabel}`; }

function stopExistingWatchdog(projectPath) {
  const pidPath = resolve(projectPath, "work", "amiros.pid");
  if (!existsSync(pidPath)) return;
  const pid = Number(readFileSync(pidPath, "utf8").trim());
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return;
  try {
    const command = execFileSync("/bin/ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    });
    if (!command.includes(resolve(projectPath, "scripts", "amiros-watchdog.mjs"))) return;
    process.kill(pid, "SIGTERM");
  } catch {
    // A stale PID file or a process that already exited is safe to ignore.
  }
}

function projectWatchdogIsRunning(projectPath) {
  const pidPath = resolve(projectPath, "work", "amiros.pid");
  if (!existsSync(pidPath)) return false;
  const pid = Number(readFileSync(pidPath, "utf8").trim());
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return false;
  try {
    const command = execFileSync("/bin/ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    });
    return command.includes(resolve(projectPath, "scripts", "amiros-watchdog.mjs"));
  } catch {
    return false;
  }
}

function waitForProjectWatchdog(projectPath, timeoutMs = 7_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (projectWatchdogIsRunning(projectPath)) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  return projectWatchdogIsRunning(projectPath);
}

export function stopLaunchAgent({ projectPath = projectDirectory, reason = "user-requested stop" } = {}) {
  if (process.platform !== "darwin") return false;
  writeIntentionalStopMarker(resolve(projectPath, "work"), reason);
  return runLaunchctl(["bootout", serviceTarget()]);
}

export function startLaunchAgent({ projectPath = projectDirectory, nodePath = process.execPath } = {}) {
  if (process.platform !== "darwin") return false;
  const workDirectory = resolve(projectPath, "work");
  mkdirSync(workDirectory, { recursive: true });
  try { unlinkSync(intentionalStopPath(workDirectory)); } catch {}
  const plistPath = launchAgentPath();
  mkdirSync(dirname(plistPath), { recursive: true });
  // An update may have moved AmirOS. Stop both the stable label and the last
  // known watchdog before registering it again so two copies never compete
  // for the dashboard port.
  writeIntentionalStopMarker(workDirectory, "Replacing AmirOS recovery service.");
  runLaunchctl(["bootout", serviceTarget()]);
  stopExistingWatchdog(projectPath);
  try { unlinkSync(intentionalStopPath(workDirectory)); } catch {}
  writeFileSync(plistPath, createLaunchAgentPlist({ nodePath, projectPath }), { encoding: "utf8", mode: 0o644 });
  chmodSync(plistPath, 0o644);
  if (!runLaunchctl(["bootstrap", guiDomain(), plistPath])) {
    throw new Error("macOS could not register AmirOS for background recovery.");
  }
  // Some macOS privacy/security configurations accept a LaunchAgent but do
  // not allow it to start from this folder. Never report that as success: the
  // caller will fall back to the regular watchdog and keep AmirOS usable.
  if (!waitForProjectWatchdog(projectPath)) {
    stopLaunchAgent({ projectPath, reason: "Background recovery could not start." });
    return false;
  }
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  try {
    if (command === "--print") process.stdout.write(createLaunchAgentPlist({ nodePath: process.execPath, projectPath: projectDirectory }));
    else if (command === "--mark-intentional-stop") writeIntentionalStopMarker(resolve(projectDirectory, "work"));
    else if (command === "--stop") stopLaunchAgent({ reason: "AmirOS was stopped intentionally." });
    else if (command === "--start") { if (!startLaunchAgent()) process.exitCode = 2; }
    else { console.error("Usage: node scripts/launch-agent.mjs --start | --stop | --mark-intentional-stop | --print"); process.exitCode = 2; }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
