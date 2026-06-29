// Guarded service worker registration using workbox-window so we can react
// to "waiting" updates and prompt the user to reload into the new version.

import type { Workbox } from "workbox-window";

const SW_URL = "/sw.js";
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1h

function isRefusedContext(): boolean {
  if (typeof window === "undefined") return true;
  if (!("serviceWorker" in navigator)) return true;
  if (!import.meta.env.PROD) return true;

  try {
    if (window.top !== window.self) return true;
  } catch {
    return true;
  }

  const url = new URL(window.location.href);
  if (url.searchParams.get("sw") === "off") return true;

  const host = url.hostname;
  if (host.startsWith("id-preview--") || host.startsWith("preview--")) return true;
  if (
    host === "lovableproject.com" ||
    host.endsWith(".lovableproject.com") ||
    host === "lovableproject-dev.com" ||
    host.endsWith(".lovableproject-dev.com") ||
    host === "beta.lovable.dev" ||
    host.endsWith(".beta.lovable.dev")
  ) {
    return true;
  }

  return false;
}

export function isPWAEnvironment(): boolean {
  return !isRefusedContext();
}

async function unregisterOwnSW() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      regs
        .filter((r) => {
          const scriptURL =
            r.active?.scriptURL ?? r.installing?.scriptURL ?? r.waiting?.scriptURL ?? "";
          return scriptURL.endsWith(SW_URL);
        })
        .map((r) => r.unregister()),
    );
  } catch {
    /* ignore */
  }
}

export type UpdateReadyHandler = (activate: () => Promise<void>) => void;

let registered = false;
let updatePromptShown = false;

export async function registerServiceWorker(onUpdateReady?: UpdateReadyHandler) {
  if (isRefusedContext()) {
    await unregisterOwnSW();
    return;
  }
  if (registered) return;
  registered = true;

  try {
    const { Workbox } = await import("workbox-window");
    const wb: Workbox = new Workbox(SW_URL, { scope: "/" });

    const promptUpdate = () => {
      if (!onUpdateReady) return;
      if (updatePromptShown) return;
      updatePromptShown = true;
      onUpdateReady(async () => {
        const reload = () => window.location.reload();
        navigator.serviceWorker.addEventListener("controllerchange", reload, { once: true });
        wb.messageSkipWaiting();
      });
    };

    // New SW installed and waiting (page already controlled by an old SW).
    wb.addEventListener("waiting", promptUpdate);
    // Safety net: some browsers fire "installed" with isUpdate=true instead.
    wb.addEventListener("installed", (event) => {
      if (event.isUpdate) promptUpdate();
    });

    await wb.register();

    // Periodically check for updates so long-lived sessions notice new deploys.
    const checkForUpdate = () => {
      void wb.update().catch(() => {});
    };
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkForUpdate();
    });
    window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
  } catch (err) {
    console.warn("[pwa] SW registration failed", err);
  }
}
