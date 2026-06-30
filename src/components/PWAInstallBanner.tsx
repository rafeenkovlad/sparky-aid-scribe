import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { toast } from "sonner";

const DISMISS_KEY = "pwa-install-banner-dismissed-at";
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 дней

/**
 * Полноширинный баннер «Установить приложение» под хедером.
 * Скрыт, если приложение уже установлено, если пользователь закрыл баннер
 * (на 7 дней), либо если PWA недоступно в этом окружении (preview/iframe).
 */
export function PWAInstallBanner() {
  const { available, standalone, isIOS, canPrompt, promptInstall } = usePWAInstall();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) {
      setDismissed(false);
      return;
    }
    const ts = Number(raw);
    if (!Number.isFinite(ts) || Date.now() - ts > DISMISS_TTL_MS) {
      setDismissed(false);
    }
  }, []);

  if (standalone || !available || dismissed) return null;
  // На не-iOS показываем только когда браузер реально предложил установку
  if (!isIOS && !canPrompt) return null;

  const handleInstall = async () => {
    if (isIOS) {
      toast("Установка на iOS", {
        description: "Нажмите «Поделиться» в Safari → «На экран „Домой“».",
        duration: 7000,
      });
      return;
    }
    const ok = await promptInstall();
    if (ok) {
      toast.success("Приложение установлено");
      setDismissed(true);
    }
  };

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <div className="shrink-0 border-b border-white/10 bg-gradient-to-r from-orange-500/15 via-orange-500/10 to-amber-500/15">
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={handleInstall}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/5 active:bg-white/10 transition-colors"
        >
          <Download className="h-4 w-4 text-orange-400" />
          <span>Установить приложение на главный экран</span>
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Скрыть"
          className="px-3 text-white/50 hover:text-white hover:bg-white/5 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
