import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";

type SendJson = (response: ServerResponse, status: number, value: unknown) => void;

export type BackendServiceStatus = "running" | "restarting" | "offline";

export type BackendRestartStatus = {
  status: BackendServiceStatus;
  updatedAt: number;
  requestedAt?: number;
  requestId?: string;
};

const restartRequestFilename = "backend-restart-request.json";
const restartStatusFilename = "backend-restart-status.json";
const pendingRequestMaximumAgeMs = 2 * 60_000;

function workDirectory(): string {
  return resolve(process.env.AMIROS_WATCHDOG_WORK_DIRECTORY || "work");
}

export function backendRestartRequestPath(directory = workDirectory()): string {
  return resolve(directory, restartRequestFilename);
}

export function backendRestartStatusPath(directory = workDirectory()): string {
  return resolve(directory, restartStatusFilename);
}

function parseStatus(value: string): BackendRestartStatus | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<BackendRestartStatus>;
    if ((parsed.status === "running" || parsed.status === "restarting" || parsed.status === "offline")
      && typeof parsed.updatedAt === "number") {
      return {
        status: parsed.status,
        updatedAt: parsed.updatedAt,
        requestedAt: typeof parsed.requestedAt === "number" ? parsed.requestedAt : undefined,
        requestId: typeof parsed.requestId === "string" ? parsed.requestId : undefined,
      };
    }
  } catch {}
  return undefined;
}

export function readBackendRestartStatus(directory = workDirectory()): BackendRestartStatus {
  const path = backendRestartStatusPath(directory);
  if (!existsSync(path)) return { status: "running", updatedAt: Date.now() };
  return parseStatus(readFileSync(path, "utf8")) || { status: "offline", updatedAt: Date.now() };
}

export function writeBackendRestartStatus(status: BackendRestartStatus, directory = workDirectory()): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(backendRestartStatusPath(directory), `${JSON.stringify(status)}\n`, { encoding: "utf8", mode: 0o600 });
}

/**
 * Queues a restart for the watchdog. The backend only writes this local command
 * file; it never terminates or relaunches itself.
 */
export function requestBackendRestart(directory = workDirectory(), now = Date.now()): { accepted: boolean; status: BackendRestartStatus } {
  const existing = readBackendRestartStatus(directory);
  const requestPath = backendRestartRequestPath(directory);
  const restartAlreadyPending = existing.status === "restarting"
    && now - existing.updatedAt < pendingRequestMaximumAgeMs;
  if (restartAlreadyPending || existsSync(requestPath)) {
    return { accepted: false, status: existing.status === "restarting" ? existing : { status: "restarting", updatedAt: now } };
  }

  const status: BackendRestartStatus = {
    status: "restarting",
    updatedAt: now,
    requestedAt: now,
    requestId: `${now}-${Math.random().toString(36).slice(2, 10)}`,
  };
  mkdirSync(directory, { recursive: true });
  writeFileSync(requestPath, `${JSON.stringify(status)}\n`, { encoding: "utf8", mode: 0o600 });
  writeBackendRestartStatus(status, directory);
  return { accepted: true, status };
}

function isLocalRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress;
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

type SystemRouteOptions = {
  request: IncomingMessage;
  response: ServerResponse;
  pathname: string;
  sendJson: SendJson;
  dashboardStartedAt: number;
};

/** Handles the localhost-only backend status and watchdog restart controls. */
export async function handleSystemApiRoute(options: SystemRouteOptions): Promise<boolean> {
  const { request, response, pathname, sendJson, dashboardStartedAt } = options;
  if (pathname !== "/api/system/backend-status" && pathname !== "/api/system/backend-restart") return false;
  if (!isLocalRequest(request)) {
    sendJson(response, 403, { error: "This AmirOS control is available only on this Mac." });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/system/backend-status") {
    const status = readBackendRestartStatus();
    // The new backend owns a request created before it started. Marking it
    // ready here lets the dashboard finish its reconnect loop immediately.
    if (status.status === "restarting" && typeof status.requestedAt === "number" && status.requestedAt < dashboardStartedAt) {
      const running = { status: "running" as const, updatedAt: Date.now() };
      writeBackendRestartStatus(running);
      sendJson(response, 200, running);
      return true;
    }
    sendJson(response, 200, status);
    return true;
  }

  if (request.method === "POST" && pathname === "/api/system/backend-restart") {
    const result = requestBackendRestart();
    if (!result.accepted) {
      sendJson(response, 409, { error: "An AmirOS restart is already in progress.", status: result.status });
      return true;
    }
    sendJson(response, 202, { accepted: true, status: result.status });
    return true;
  }

  sendJson(response, 405, { error: "Method not allowed" });
  return true;
}
