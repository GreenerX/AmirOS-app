import { createServer } from "node:http";

const port = Number(process.env.AMIROS_PORT);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("AMIROS_PORT must be set for the runtime recovery test server.");
}

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url || "/", `http://127.0.0.1:${port}`);

  if (request.method === "GET" && requestUrl.pathname === "/api/dashboard") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      connection: { status: "ready", detail: "Safe runtime recovery test" },
      runtimeRecoveryTestServerPid: process.pid,
    }));
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/__amiros-runtime-recovery-test__/stop") {
    response.writeHead(204);
    response.end();
    server.close(() => process.exit(0));
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "Not found" }));
});

function stopSafely() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_000).unref();
}

process.once("SIGTERM", stopSafely);
process.once("SIGINT", stopSafely);
server.listen(port, "127.0.0.1");
