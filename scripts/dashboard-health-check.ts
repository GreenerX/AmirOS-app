import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
import { AmirosState } from "../src/amiros-state.js";
import { loadConfig } from "../src/config.js";
import { startAmirosDashboard } from "../src/dashboard.js";
import type { AiService } from "../src/ai.js";
import type { Client as WhatsAppClient } from "whatsapp-web.js";

type HealthPage = {
  on: (event: "console" | "pageerror" | "request", handler: (value: unknown) => void) => void;
  setViewport: (viewport: { width: number; height: number }) => Promise<void>;
  setRequestInterception: (enabled: boolean) => Promise<void>;
  evaluateOnNewDocument: (callback: () => void) => Promise<void>;
  goto: (url: string, options: { waitUntil: "networkidle0"; timeout: number }) => Promise<unknown>;
  evaluate: <T, Arg>(callback: (argument: Arg) => T | Promise<T>, argument: Arg) => Promise<T>;
  waitForFunction: (callback: (expected: string) => boolean, options: { timeout: number }, expected: string) => Promise<unknown>;
};

type HealthBrowser = {
  newPage: () => Promise<HealthPage>;
  close: () => Promise<void>;
};

type PuppeteerModule = {
  executablePath: () => string;
  launch: (options: { headless: boolean; userDataDir: string; executablePath: string }) => Promise<HealthBrowser>;
};

const require = createRequire(import.meta.url);
const whatsappRequire = createRequire(require.resolve("whatsapp-web.js/package.json"));
const puppeteer = whatsappRequire("puppeteer") as PuppeteerModule;

function localBrowserExecutable(): string {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    puppeteer.executablePath(),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ].filter((candidate): candidate is string => Boolean(candidate));
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error("Install Google Chrome or configure PUPPETEER_EXECUTABLE_PATH before running the dashboard health check.");
  }
  return executable;
}

function safeDependency(name: string): object {
  return new Proxy({}, {
    get() {
      throw new Error(`Safe dashboard health mode attempted to use ${name}.`);
    },
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function assertScreen(page: HealthPage, label: string, expectedText: string): Promise<void> {
  try {
    await page.waitForFunction((expected) => document.body.innerText.includes(expected), { timeout: 10_000 }, expectedText);
  } catch {
    const visibleText = await page.evaluate(() => document.body.innerText.slice(0, 1_000), undefined);
    throw new Error(`${label} did not show its expected content (${expectedText}). Visible text: ${visibleText || "<blank>"}`);
  }
  const result = await page.evaluate((screenLabel) => {
    const bodyText = document.body.innerText.trim();
    const visibleErrors = Array.from(document.querySelectorAll(".error-banner, [role='alert']"))
      .map((element) => element.textContent?.trim())
      .filter(Boolean);
    return {
      bodyLength: bodyText.length,
      visibleErrors,
      hasRenderedApp: Boolean(document.querySelector(".app-shell")),
      screenLabel,
    };
  }, label);

  assert.equal(result.hasRenderedApp, true, `${label} did not render the AmirOS app shell`);
  assert.ok(result.bodyLength > 200, `${label} appears blank`);
  assert.deepEqual(result.visibleErrors, [], `${label} shows a dashboard error: ${result.visibleErrors.join(" | ")}`);
}

async function clickButtonByLabel(page: HealthPage, label: string): Promise<void> {
  const clicked = await page.evaluate((buttonLabel) => {
    const button = Array.from(document.querySelectorAll("button")).find((candidate) =>
      candidate.getAttribute("aria-label") === buttonLabel || candidate.textContent?.trim() === buttonLabel,
    );
    if (!button) return false;
    (button as HTMLButtonElement).click();
    return true;
  }, label);
  assert.equal(clicked, true, `Could not find the ${label} navigation button`);
}

async function run(): Promise<void> {
  const sandbox = mkdtempSync(join(tmpdir(), "amiros-dashboard-health-"));
  let server: Server | undefined;
  let browser: HealthBrowser | undefined;
  try {
    const state = new AmirosState(join(sandbox, "amiros-state.json"));
    const config = loadConfig({
      OPENAI_API_KEY: "",
      WEB_SEARCH_ENABLED: "false",
      // The dashboard server below receives port 0 directly, which asks the
      // operating system for an unused temporary port. The config still needs
      // a normal positive value because it validates user-facing settings.
      AMIROS_PORT: "1",
      WHATSAPP_SESSION_PATH: join(sandbox, "whatsapp-session"),
    });

    server = startAmirosDashboard({
      client: safeDependency("WhatsApp") as WhatsAppClient,
      ai: safeDependency("OpenAI") as AiService,
      config,
      state,
      calendarFeedTokenPath: join(sandbox, "calendar-feed-token"),
      port: 0,
    });
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string", "The safe dashboard server did not receive a local port");
    const origin = `http://127.0.0.1:${address.port}`;

    browser = await puppeteer.launch({
      headless: true,
      userDataDir: join(sandbox, "browser-profile"),
      executablePath: localBrowserExecutable(),
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    const pageErrors: string[] = [];
    const unexpectedRequests: string[] = [];
    page.on("console", (message) => {
      const consoleMessage = message as { type: () => string; text: () => string };
      if (consoleMessage.type() === "error") pageErrors.push(consoleMessage.text());
    });
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const browserRequest = request as {
        url: () => string;
        continue: () => void;
        abort: () => void;
        respond: (response: { status: number; contentType: string; body: string }) => void;
      };
      const url = browserRequest.url();
      if (url.startsWith(origin) || url.startsWith("data:")) {
        browserRequest.continue();
      } else if (url.startsWith("https://fonts.googleapis.com/")) {
        // Keep the test entirely offline. The dashboard falls back to its
        // system font stack when this visual-only stylesheet is unavailable.
        browserRequest.respond({ status: 200, contentType: "text/css", body: "" });
      } else {
        unexpectedRequests.push(url);
        browserRequest.abort();
      }
    });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem("amiros.onboarding.completed", "true");
      localStorage.setItem("amiros.release-notes.seen", "0.6.0");
    });
    await page.goto(`${origin}/?demo=1`, { waitUntil: "networkidle0", timeout: 20_000 });

    await assertScreen(page, "Overview", "INBOX PULSE");
    await clickButtonByLabel(page, "Inbox");
    await assertScreen(page, "Inbox", "Inbox");
    await clickButtonByLabel(page, "Intelligence");
    await assertScreen(page, "Intelligence", "Intelligence");
    await clickButtonByLabel(page, "Open AmirOS tools");
    await clickButtonByLabel(page, "Settings");
    await assertScreen(page, "Settings", "Settings");

    assert.deepEqual(unexpectedRequests, [], `Safe mode attempted an external request: ${unexpectedRequests.join(" | ")}`);
    assert.deepEqual(pageErrors, [], `The dashboard logged a browser error: ${pageErrors.join(" | ")}`);
    console.log("Dashboard health check passed: Overview, Inbox, Intelligence, and Settings all rendered safely.");
  } finally {
    await browser?.close();
    if (server) await closeServer(server);
    rmSync(sandbox, { recursive: true, force: true });
  }
}

void run().catch((error: unknown) => {
  console.error("Dashboard health check failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
