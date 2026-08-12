import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildUi } from "./build-freshness.mjs";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

try {
  buildUi(projectDirectory);
  console.log("Dashboard UI build complete. Freshness stamp recorded.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
