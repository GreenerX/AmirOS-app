import { mkdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import QRCode from "qrcode";
import qrcode from "qrcode-terminal";
import whatsappWeb from "whatsapp-web.js";
import type { Client as WhatsAppClient, Message } from "whatsapp-web.js";
import type { AmirosState } from "./amiros-state.js";
import type { AppConfig } from "./config.js";

const { Client, LocalAuth } = whatsappWeb;
const qrImagePath = resolve("work/whatsapp-qr.png");
const relinkControllers = new WeakMap<WhatsAppClient, () => Promise<void>>();

type RelinkableWhatsAppClient = Pick<
  WhatsAppClient,
  "logout" | "destroy" | "initialize"
> & {
  authStrategy?: { logout?: () => Promise<void> };
};

type WhatsAppPage = {
  isClosed?: () => boolean;
  evaluate<T>(expression: string): Promise<T>;
};

export type WhatsAppSessionHealth = {
  healthy: boolean;
  detail: string;
};

/**
 * WhatsApp Web can occasionally leave Chromium running after a network or
 * power interruption while its page is no longer usable. The dashboard still
 * answers HTTP requests in that state, so we inspect the actual Web session
 * rather than treating a running server as proof that the bot can reply.
 */
export async function inspectWhatsAppSession(
  page?: WhatsAppPage | null,
): Promise<WhatsAppSessionHealth> {
  if (!page) return { healthy: false, detail: "WhatsApp browser page is unavailable" };
  if (page.isClosed?.()) return { healthy: false, detail: "WhatsApp browser page is closed" };

  try {
    const serialized = await page.evaluate<string>(
      `JSON.stringify((() => {
        try {
          const socket = window.require("WAWebSocketModel")?.Socket;
          return {
            connected: socket?.state === "CONNECTED",
            hasRuntime: typeof window.WWebJS !== "undefined",
            socketState: String(socket?.state || "unknown")
          };
        } catch (error) {
          return { connected: false, hasRuntime: false, socketState: "unavailable" };
        }
      })())`,
    );
    const status = JSON.parse(serialized) as {
      connected?: boolean;
      hasRuntime?: boolean;
      socketState?: string;
    };
    if (status.connected && status.hasRuntime) {
      return { healthy: true, detail: "WhatsApp Web is connected" };
    }
    return {
      healthy: false,
      detail: status.hasRuntime
        ? `WhatsApp socket is ${status.socketState || "unavailable"}`
        : "WhatsApp Web is still loading",
    };
  } catch (error) {
    return {
      healthy: false,
      detail: `WhatsApp browser check failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function resetWhatsAppSession(
  client: RelinkableWhatsAppClient,
  beforeInitialize?: () => void,
): Promise<void> {
  try {
    await client.logout();
  } catch (logoutError) {
    console.warn(
      "WhatsApp logout was unavailable; clearing the local linked-device session instead:",
      logoutError instanceof Error ? logoutError.message : String(logoutError),
    );
    await client.destroy().catch(() => undefined);
    await client.authStrategy?.logout?.();
  }
  beforeInitialize?.();
  await client.initialize();
}

export function requestWhatsAppRelink(client: WhatsAppClient): Promise<void> {
  const relink = relinkControllers.get(client);
  if (!relink) throw new Error("WhatsApp re-linking is not available");
  return relink();
}

export function isSelfChatMessage(
  message: { fromMe: boolean; from: string; to: string },
  ownIds: ReadonlySet<string>,
): boolean {
  if (!message.fromMe) return false;
  return ownIds.has(message.to) || message.from === message.to;
}

async function loadOwnWhatsAppIds(
  client: WhatsAppClient,
  ownIds: Set<string>,
  recoveredPrimaryId?: string,
): Promise<void> {
  const primaryId = recoveredPrimaryId || client.info?.wid?._serialized;
  if (!primaryId) return;
  ownIds.add(primaryId);

  try {
    const mappings = await client.getContactLidAndPhone([primaryId]);
    for (const mapping of mappings) {
      if (mapping.pn) ownIds.add(mapping.pn);
      if (mapping.lid) ownIds.add(mapping.lid);
    }
  } catch (error) {
    console.warn("Could not resolve both WhatsApp identity formats:", error);
  }
}

async function saveQrImage(qr: string): Promise<void> {
  await mkdir(resolve("work"), { recursive: true });
  await QRCode.toFile(qrImagePath, qr, {
    width: 720,
    margin: 3,
    errorCorrectionLevel: "M",
  });
  console.log(`QR image saved to ${qrImagePath}`);
}

export type WhatsAppMessageHandler = (
  message: Message,
  isSelfChat: boolean,
) => Promise<void>;

export type WhatsAppMessageRevokeHandler = (message: Message, original?: Message) => Promise<void>;
export type WhatsAppViewOnceMessageHandler = (message: Message) => Promise<void>;

function isViewOnceMessage(message: Message): boolean {
  const raw = message as unknown as { isViewOnce?: boolean; _data?: { isViewOnce?: boolean; isViewOnceV2?: boolean } };
  return raw.isViewOnce === true || raw._data?.isViewOnce === true || raw._data?.isViewOnceV2 === true;
}

export function createWhatsAppClient(
  config: AppConfig,
  onMessage: WhatsAppMessageHandler,
  amiros?: AmirosState,
  onMessageRevoked?: WhatsAppMessageRevokeHandler,
  onViewOnceMessage?: WhatsAppViewOnceMessageHandler,
): WhatsAppClient {
  const ownIds = new Set<string>();
  let isReady = false;
  let readinessRecoveryScheduled = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempts = 0;
  let listenerWatchdog: ReturnType<typeof setInterval> | undefined;
  let connectionWatchdog: ReturnType<typeof setInterval> | undefined;
  let connectionHealthFailures = 0;
  let connectionHealthCheckRunning = false;
  let lastWatchdogWarningAt = 0;
  const browserArgs = config.puppeteerNoSandbox
    ? ["--no-sandbox", "--disable-setuid-sandbox"]
    : [];

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: config.whatsappSessionPath }),
    puppeteer: {
      headless: true,
      ...(config.puppeteerExecutablePath
        ? { executablePath: config.puppeteerExecutablePath }
        : {}),
      args: browserArgs,
    },
  });
  const scheduleReconnect = (reason: string) => {
    if (reconnectTimer || relinkOperation) return;
    isReady = false;
    readinessRecoveryScheduled = false;
    ownIds.clear();
    const delay = Math.min(60_000, 3_000 * Math.max(1, reconnectAttempts + 1));
    reconnectAttempts += 1;
    amiros?.setConnection("disconnected", `Reconnecting WhatsApp in ${Math.round(delay / 1_000)} seconds`);
    console.warn(`WhatsApp disconnected (${reason}); reconnecting automatically in ${Math.round(delay / 1_000)}s.`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void (async () => {
        try {
          await client.destroy().catch(() => undefined);
          await client.initialize();
        } catch (error) {
          console.warn("Automatic WhatsApp reconnect attempt failed:", error instanceof Error ? error.message : String(error));
          scheduleReconnect("reconnect attempt failed");
        }
      })();
    }, delay);
  };
  let relinkOperation: Promise<void> | undefined;
  relinkControllers.set(client, () => {
    if (relinkOperation) return relinkOperation;
    relinkOperation = (async () => {
      amiros?.setConnection("starting", "Preparing a new WhatsApp QR code");
      isReady = false;
      readinessRecoveryScheduled = false;
      ownIds.clear();
      await unlink(qrImagePath).catch(() => undefined);
      await resetWhatsAppSession(client, () => {
        amiros?.setConnection("starting", "Starting a fresh WhatsApp link session");
      });
    })()
      .catch((error) => {
        amiros?.setConnection("disconnected", "Could not regenerate the WhatsApp QR code");
        throw error;
      })
      .finally(() => {
        relinkOperation = undefined;
      });
    return relinkOperation;
  });

  const ensureAmirosMessageBridge = async (): Promise<"installed" | "present" | "unavailable"> => {
    const page = (client as WhatsAppClient & {
      pupPage?: { evaluate: <T>(expression: string) => Promise<T> };
    }).pupPage;
    if (!page) return "unavailable";
    const serialized = await page.evaluate<string>(
      `JSON.stringify((() => {
        try {
          const Msg = window.require("WAWebCollections").Msg;
          if (!Msg || typeof Msg.on !== "function" || !window.WWebJS || typeof window.onAddMessageEvent !== "function") {
            return { status: "unavailable" };
          }
          if (Msg.__amirosMessageBridge) return { status: "present" };
          Msg.__amirosMessageBridge = true;
          Msg.on("add", (msg) => {
            if (!msg?.isNewMsg) return;
            const forward = (candidate) => {
              if (!candidate || candidate.type === "revoked" || candidate.type === "ciphertext") return;
              try { window.onAddMessageEvent(window.WWebJS.getMessageModel(candidate)); }
              catch (error) { console.warn("AmirOS message bridge could not forward a message", error); }
            };
            if (msg.type === "ciphertext" && typeof msg.once === "function") {
              msg.once("change:type", forward);
              return;
            }
            forward(msg);
          });
          return { status: "installed" };
        } catch {
          return { status: "unavailable" };
        }
      })())`,
    );
    const result = JSON.parse(serialized) as { status?: "installed" | "present" | "unavailable" };
    if (result.status === "installed") {
      console.log("AmirOS WhatsApp message bridge installed.");
      return "installed";
    }
    return result.status || "unavailable";
  };

  const startListenerWatchdog = () => {
    if (listenerWatchdog) return;
    listenerWatchdog = setInterval(() => {
      if (!isReady) return;
      void ensureAmirosMessageBridge().catch((error) => {
        const now = Date.now();
        if (now - lastWatchdogWarningAt < 5 * 60_000) return;
        lastWatchdogWarningAt = now;
        console.warn(
          "WhatsApp message-listener watchdog could not inspect the page:",
          error instanceof Error ? error.message : String(error),
        );
      });
    }, 15_000);
  };

  const startConnectionWatchdog = () => {
    if (connectionWatchdog) return;
    connectionWatchdog = setInterval(() => {
      if (!isReady || relinkOperation || connectionHealthCheckRunning) return;
      connectionHealthCheckRunning = true;
      void (async () => {
        const page = (client as WhatsAppClient & { pupPage?: WhatsAppPage }).pupPage;
        const session = await inspectWhatsAppSession(page);
        let healthy = session.healthy;
        let detail = session.detail;

        if (healthy) {
          try {
            const bridge = await ensureAmirosMessageBridge();
            if (bridge === "unavailable") {
              healthy = false;
              detail = "WhatsApp message listener is unavailable";
            }
          } catch (error) {
            healthy = false;
            detail = `WhatsApp message listener check failed: ${error instanceof Error ? error.message : String(error)}`;
          }
        }

        if (healthy) {
          connectionHealthFailures = 0;
          return;
        }

        connectionHealthFailures += 1;
        // A brief socket transition is normal after Wi-Fi returns. Require two
        // failed checks before rebuilding the browser session.
        if (connectionHealthFailures < 2) {
          console.warn(`WhatsApp health check is waiting for recovery: ${detail}`);
          return;
        }
        connectionHealthFailures = 0;
        console.warn(`WhatsApp health check is restarting the connection: ${detail}`);
        scheduleReconnect(`health check: ${detail}`);
      })()
        .catch((error) => console.warn("WhatsApp health watchdog failed:", error))
        .finally(() => { connectionHealthCheckRunning = false; });
    }, 20_000);
  };

  const finishReadySetup = (recoveredPrimaryId?: string) => {
    if (isReady) return;
    isReady = true;
    reconnectAttempts = 0;
    connectionHealthFailures = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
    const primaryId = recoveredPrimaryId || client.info?.wid?._serialized;
    if (primaryId) ownIds.add(primaryId);
    console.log(
      recoveredPrimaryId
        ? "WhatsApp bot is ready (listener recovery applied)."
        : "WhatsApp bot is ready.",
    );
    amiros?.setConnection("ready", "Listening for WhatsApp messages");
    void unlink(qrImagePath).catch(() => undefined);
    void client
      .setAutoDownloadAudio(true)
      .then(() => console.log("WhatsApp voice auto-download enabled."))
      .catch((error) =>
        console.warn("Could not enable voice auto-download:", error),
      );
    void loadOwnWhatsAppIds(client, ownIds, recoveredPrimaryId);
    void ensureAmirosMessageBridge().catch((error) =>
      console.warn(
        "Could not install the AmirOS WhatsApp message bridge:",
        error instanceof Error ? error.message : String(error),
      ),
    );
    startListenerWatchdog();
    startConnectionWatchdog();
  };

  const recoverMissingMessageListener = async () => {
    if (isReady) return;
    const internalClient = client as WhatsAppClient & {
      pupPage?: {
        evaluate: <T>(expression: string) => Promise<T>;
      };
      attachEventListeners?: () => Promise<void>;
    };
    if (!internalClient.pupPage || !internalClient.attachEventListeners) return;

    const serialized = await internalClient.pupPage.evaluate<string>(
      `JSON.stringify({
        connected: (() => {
          try { return window.require("WAWebSocketModel").Socket.state === "CONNECTED"; }
          catch { return false; }
        })(),
        hasRuntime: typeof window.WWebJS !== "undefined",
        hasMessageHook: typeof window.onAddMessageEvent === "function",
        ownId: (() => {
          try {
            const prefs = window.require("WAWebUserPrefsMeUser");
            const id = prefs.getMaybeMePnUser() || prefs.getMaybeMeLidUser();
            return id?._serialized || id?.toString?.() || "";
          } catch { return ""; }
        })()
      })`,
    );
    const status = JSON.parse(serialized) as {
      connected: boolean;
      hasRuntime: boolean;
      hasMessageHook: boolean;
      ownId: string;
    };
    if (!status.connected || !status.hasRuntime) {
      console.warn(
        "WhatsApp authenticated but is still syncing; listener recovery deferred.",
      );
      return;
    }
    if (!status.hasMessageHook) {
      console.warn(
        "WhatsApp ready event stalled; installing the message listener recovery.",
      );
      await internalClient.attachEventListeners();
    }
    finishReadySetup(status.ownId || undefined);
  };

  client.on("qr", (qr) => {
    isReady = false;
    amiros?.setConnection("qr", "Scan the QR code to link WhatsApp");
    console.log("\nScan this QR code in WhatsApp → Settings → Linked Devices:\n");
    qrcode.generate(qr, { small: true });
    void saveQrImage(qr).catch((error) =>
      console.error("Could not save QR image:", error),
    );
  });
  client.on("authenticated", () => {
    amiros?.setConnection("authenticated", "WhatsApp linked; syncing messages");
    console.log("WhatsApp device authenticated; syncing message listener...");
    if (readinessRecoveryScheduled) return;
    readinessRecoveryScheduled = true;
    setTimeout(() => {
      void recoverMissingMessageListener().catch((error) =>
        console.error("WhatsApp listener recovery failed:", error),
      );
    }, 30_000);
  });
  client.on("ready", () => finishReadySetup());
  client.on("auth_failure", (message) =>
    {
      isReady = false;
      readinessRecoveryScheduled = false;
      amiros?.setConnection("disconnected", "WhatsApp authentication failed");
      console.error("WhatsApp authentication failed; re-linking is required:", message);
    },
  );
  client.on("disconnected", (reason) => {
    isReady = false;
    readinessRecoveryScheduled = false;
    ownIds.clear();
    amiros?.setConnection("disconnected", String(reason));
    console.warn("WhatsApp device disconnected:", reason);
    // A normal connection drop should never require the user to run stop/start.
    // An auth failure is handled above and intentionally requires a QR scan.
    scheduleReconnect(String(reason));
  });
  client.on("message_create", (message) => {
    const isSelfChat = isSelfChatMessage(message, ownIds);
    if (isViewOnceMessage(message)) {
      void onViewOnceMessage?.(message).catch((error) =>
        console.warn("Could not archive one-time WhatsApp media:", error instanceof Error ? error.message : String(error)),
      );
    }
    void onMessage(message, isSelfChat).catch((error) =>
      console.error("Unhandled WhatsApp message error:", error),
    );
  });
  client.on("message_revoke_everyone", (message, original) => {
    void onMessageRevoked?.(message, original ?? undefined).catch((error) =>
      console.warn("Could not archive a deleted WhatsApp message:", error instanceof Error ? error.message : String(error)),
    );
  });

  return client;
}
