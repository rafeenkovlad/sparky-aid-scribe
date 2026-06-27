// Guarded service worker registration using workbox-window so we can react
// to "waiting" updates and prompt the user to reload into the new version.

import type { Workbox } from "workbox-window";

const SW_URL = "/sw.js";

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
      onUpdateReady(async () => {
        // Reload once the new SW takes control.
        const reload = () => window.location.reload();
        navigator.serviceWorker.addEventListener("controllerchange", reload, { once: true });
        wb.messageSkipWaiting();
      });
    };

    // Fired when a new SW has installed and is waiting (we already control the page).
    wb.addEventListener("waiting", promptUpdate);
    // Also fired in newer workbox versions for the same situation.
    wb.addEventListener("externalwaiting", promptUpdate);

    await wb.register();
  } catch (err) {
    console.warn("[pwa] SW registration failed", err);
  }
}
