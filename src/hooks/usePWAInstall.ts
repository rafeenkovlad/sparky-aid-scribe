import { useEffect, useState, useCallback } from "react";
import { isPWAEnvironment } from "@/lib/pwa/register-sw";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS Safari
  return (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}

function detectIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream;
}

export interface PWAInstallState {
  /** SW активен в этом окружении (не превью, не iframe и т.п.) */
  available: boolean;
  /** Уже запущено как установленное PWA */
  standalone: boolean;
  /** iOS — браузер не даёт программный prompt, нужна инструкция */
  isIOS: boolean;
  /** Доступен браузерный prompt установки */
  canPrompt: boolean;
  /** Онлайн */
  online: boolean;
  /** Запустить prompt; возвращает true если принято */
  promptInstall: () => Promise<boolean>;
}

export function usePWAInstall(): PWAInstallState {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState<boolean>(() => detectStandalone());
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setStandalone(true);
    };
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    const mq = window.matchMedia?.("(display-mode: standalone)");
    const onMq = () => setStandalone(detectStandalone());
    mq?.addEventListener?.("change", onMq);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      mq?.removeEventListener?.("change", onMq);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return false;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      setDeferred(null);
      return choice.outcome === "accepted";
    } catch {
      return false;
    }
  }, [deferred]);

  return {
    available: isPWAEnvironment(),
    standalone,
    isIOS: detectIOS(),
    canPrompt: deferred !== null,
    online,
    promptInstall,
  };
}
