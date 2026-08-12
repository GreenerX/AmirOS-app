import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { ensureFreshBackendBuild, ensureFreshUiBuild } from "./build-freshness.mjs";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

try {
  const result = ensureFreshBackendBuild(projectDirectory, { log: (message) => console.log(message) });
  if (!result.rebuilt) console.log("Build preflight passed; compiled backend is current.");
  const uiResult = ensureFreshUiBuild(projectDirectory, { log: (message) => console.log(message) });
  if (!uiResult.rebuilt) console.log("Build preflight passed; dashboard UI build is current.");
  await import(pathToFileURL(result.outputPath).href);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
