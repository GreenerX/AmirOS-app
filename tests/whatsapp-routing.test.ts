import { describe, expect, it } from "vitest";
import {
  allowsMessageDirection,
  resolveAutomationMode,
  resolveConversationId,
} from "../src/processor.js";
import { inspectWhatsAppSession, isSelfChatMessage, resetWhatsAppSession } from "../src/whatsapp.js";

describe("WhatsApp self-chat routing", () => {
  const ownIds = new Set(["15551234567@c.us", "987654321@lid"]);

  it("accepts both phone-number and linked-ID self-chat targets", () => {
    expect(
      isSelfChatMessage(
        { fromMe: true, from: "15551234567@c.us", to: "15551234567@c.us" },
        ownIds,
      ),
    ).toBe(true);
    expect(
      isSelfChatMessage(
        { fromMe: true, from: "15551234567@c.us", to: "987654321@lid" },
        ownIds,
      ),
    ).toBe(true);
  });

  it("ignores outgoing messages sent to other contacts", () => {
    expect(
      isSelfChatMessage(
        { fromMe: true, from: "15551234567@c.us", to: "15557654321@c.us" },
        ownIds,
      ),
    ).toBe(false);
  });

  it("never treats incoming messages as self-chat", () => {
    expect(
      isSelfChatMessage(
        { fromMe: false, from: "15557654321@c.us", to: "15551234567@c.us" },
        ownIds,
      ),
    ).toBe(false);
  });
});

describe("WhatsApp command direction routing", () => {
  it("always accepts incoming contact messages for trigger parsing", () => {
    expect(allowsMessageDirection(false, false, true)).toBe(true);
    expect(allowsMessageDirection(false, false, false)).toBe(true);
  });

  it("accepts outgoing contact messages when outgoing triggers are enabled", () => {
    expect(allowsMessageDirection(true, false, true)).toBe(true);
    expect(allowsMessageDirection(true, false, false)).toBe(false);
  });

  it("keeps self-chat messages eligible for self-chat routing", () => {
    expect(allowsMessageDirection(true, true, false)).toBe(true);
  });
});

describe("WhatsApp automatic reply modes", () => {
  it("uses a group's saved Auto or Suggest mode when groups are enabled", () => {
    expect(resolveAutomationMode(false, false, true, true, "auto")).toBe("auto");
    expect(resolveAutomationMode(false, false, true, true, "suggest")).toBe("suggest");
  });

  it("forces group automation off when the global group switch is disabled", () => {
    expect(resolveAutomationMode(false, false, true, false, "auto")).toBe("off");
  });

  it("keeps outgoing and self-chat messages outside contact automation", () => {
    expect(resolveAutomationMode(true, false, true, true, "auto")).toBe("off");
    expect(resolveAutomationMode(true, true, false, true, "auto")).toBe("off");
  });

  it("preserves the saved mode for incoming contact messages", () => {
    expect(resolveAutomationMode(false, false, false, true, "suggest")).toBe("suggest");
  });
});

describe("WhatsApp conversation identity", () => {
  it("keeps group messages attached to the group when from contains a participant", async () => {
    const chatId = await resolveConversationId({
      fromMe: false,
      from: "participant@lid",
      to: "owner@c.us",
      id: { remote: { _serialized: "family@g.us" } },
      getChat: async () => ({ id: { _serialized: "participant@lid" } }),
    } as never);
    expect(chatId).toBe("family@g.us");
  });

  it("prefers a group returned by getChat over a participant-like from address", async () => {
    const chatId = await resolveConversationId({
      fromMe: false,
      from: "participant@lid",
      to: "owner@c.us",
      id: {},
      getChat: async () => ({ id: { _serialized: "friends@g.us" } }),
    } as never);
    expect(chatId).toBe("friends@g.us");
  });
});

describe("WhatsApp linked-device reset", () => {
  it("logs out and starts a fresh client session", async () => {
    const calls: string[] = [];
    await resetWhatsAppSession({
      logout: async () => { calls.push("logout"); },
      destroy: async () => { calls.push("destroy"); },
      initialize: async () => { calls.push("initialize"); },
    }, () => calls.push("beforeInitialize"));

    expect(calls).toEqual(["logout", "beforeInitialize", "initialize"]);
  });

  it("clears LocalAuth data when WhatsApp logout is unavailable", async () => {
    const calls: string[] = [];
    const originalWarn = console.warn;
    console.warn = () => undefined;
    try {
      await resetWhatsAppSession({
        logout: async () => { calls.push("logout"); throw new Error("offline"); },
        destroy: async () => { calls.push("destroy"); },
        initialize: async () => { calls.push("initialize"); },
        authStrategy: { logout: async () => { calls.push("authLogout"); } },
      }, () => calls.push("beforeInitialize"));
    } finally {
      console.warn = originalWarn;
    }

    expect(calls).toEqual([
      "logout",
      "destroy",
      "authLogout",
      "beforeInitialize",
      "initialize",
    ]);
  });
});

describe("WhatsApp connection health", () => {
  it("recognizes a connected WhatsApp browser session", async () => {
    const health = await inspectWhatsAppSession({
      isClosed: () => false,
      evaluate: async <T>() => JSON.stringify({ connected: true, hasRuntime: true, socketState: "CONNECTED" }) as T,
    });
    expect(health).toEqual({ healthy: true, detail: "WhatsApp Web is connected" });
  });

  it("flags a detached or unavailable browser session for automatic recovery", async () => {
    const closed = await inspectWhatsAppSession({
      isClosed: () => true,
      evaluate: async <T>() => "{}" as T,
    });
    const offline = await inspectWhatsAppSession({
      isClosed: () => false,
      evaluate: async <T>() => JSON.stringify({ connected: false, hasRuntime: true, socketState: "DISCONNECTED" }) as T,
    });

    expect(closed).toEqual({ healthy: false, detail: "WhatsApp browser page is closed" });
    expect(offline).toEqual({ healthy: false, detail: "WhatsApp socket is DISCONNECTED" });
  });
});
