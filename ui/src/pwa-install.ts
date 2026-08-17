import { useCallback, useEffect, useState } from "react";

export type InstallChoice = "accepted" | "dismissed" | "unavailable";

export type DeferredInstallPrompt = {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandaloneDisplayMode(): boolean {
  if (typeof window === "undefined") return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
}

export function canOfferDockInstall(prompt: DeferredInstallPrompt | undefined, installed: boolean): boolean {
  return Boolean(prompt) && !installed;
}

export async function requestDockInstall(prompt: DeferredInstallPrompt | undefined): Promise<InstallChoice> {
  if (!prompt) return "unavailable";
  await prompt.prompt();
  const choice = await prompt.userChoice;
  return choice.outcome;
}

export function useAppInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<DeferredInstallPrompt>();
  const [installed, setInstalled] = useState(isStandaloneDisplayMode);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const refreshInstalledState = () => setInstalled(isStandaloneDisplayMode());
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as unknown as DeferredInstallPrompt);
    };
    const handleInstalled = () => {
      setDeferredPrompt(undefined);
      setInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    displayMode.addEventListener("change", refreshInstalledState);
    refreshInstalledState();
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
      displayMode.removeEventListener("change", refreshInstalledState);
    };
  }, []);

  const install = useCallback(async (): Promise<InstallChoice> => {
    if (installing) return "unavailable";
    setInstalling(true);
    try {
      const outcome = await requestDockInstall(deferredPrompt);
      // Chromium exposes each prompt only once. Do not leave a button that
      // cannot open the native install flow again until the browser reoffers it.
      setDeferredPrompt(undefined);
      if (outcome === "accepted") setInstalled(true);
      return outcome;
    } finally {
      setInstalling(false);
    }
  }, [deferredPrompt, installing]);

  return {
    canInstall: canOfferDockInstall(deferredPrompt, installed),
    installing,
    install,
  };
}
