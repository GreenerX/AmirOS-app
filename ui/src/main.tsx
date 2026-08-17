import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { TimeFormatProvider } from "./TimeFormatProvider";
import "./styles.css";

// AmirOS intentionally never caches its dashboard shell. The worker exists
// only to make the local dashboard installable; every request stays network-first
// so an updated AmirOS cannot open an older interface from a cache.
if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/service-worker.js", { updateViaCache: "none" }).catch(() => {
      // Installation is an optional convenience. The dashboard remains fully
      // usable if a browser does not support service workers.
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TimeFormatProvider><App /></TimeFormatProvider>
  </StrictMode>,
);
