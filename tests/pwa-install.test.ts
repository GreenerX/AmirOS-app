import { describe, expect, it } from "vitest";
import { canOfferDockInstall, requestDockInstall, type DeferredInstallPrompt } from "../ui/src/pwa-install.js";

function deferredPrompt(outcome: "accepted" | "dismissed"): DeferredInstallPrompt & { promptCalls: number } {
  return {
    promptCalls: 0,
    async prompt() {
      this.promptCalls += 1;
    },
    userChoice: Promise.resolve({ outcome }),
  };
}

describe("dashboard Dock installation", () => {
  it("offers the action only while Chromium has an unused install prompt", () => {
    expect(canOfferDockInstall(undefined, false)).toBe(false);
    expect(canOfferDockInstall(deferredPrompt("accepted"), false)).toBe(true);
    expect(canOfferDockInstall(deferredPrompt("accepted"), true)).toBe(false);
  });

  it("uses the native browser prompt and reports its actual result", async () => {
    const accepted = deferredPrompt("accepted");
    const dismissed = deferredPrompt("dismissed");
    await expect(requestDockInstall(accepted)).resolves.toBe("accepted");
    await expect(requestDockInstall(dismissed)).resolves.toBe("dismissed");
    await expect(requestDockInstall(undefined)).resolves.toBe("unavailable");
    expect(accepted.promptCalls).toBe(1);
    expect(dismissed.promptCalls).toBe(1);
  });
});
