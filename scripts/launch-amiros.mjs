import { closeSync, existsSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workDirectory = resolve(projectDirectory, "work");
const logPath = resolve(workDirectory, "bot.log");
const pidPath = resolve(workDirectory, "amiros.pid");
const watchdogPath = resolve(projectDirectory, "scripts/amiros-watchdog.mjs");

if (!existsSync(watchdogPath)) throw new Error("The AmirOS watchdog is missing. Reinstall AmirOS, then try again.");

mkdirSync(workDirectory, { recursive: true });
const log = openSync(logPath, "a", 0o600);
const child = spawn(process.execPath, [watchdogPath], {
  cwd: projectDirectory,
  detached: true,
  env: process.env,
  stdio: ["ignore", log, log],
});

child.unref();
closeSync(log);
writeFileSync(pidPath, `${child.pid}\n`, { encoding: "utf8", mode: 0o600 });
