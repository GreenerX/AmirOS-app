const sessionArgument = process.argv.find((argument) => argument.startsWith("--user-data-dir="));

if (!sessionArgument) {
  throw new Error("The safe session-lock fixture needs a user-data-dir argument.");
}

const keepAlive = setInterval(() => undefined, 1_000);

function stopSafely() {
  clearInterval(keepAlive);
  process.exit(0);
}

process.once("SIGTERM", stopSafely);
process.once("SIGINT", stopSafely);
