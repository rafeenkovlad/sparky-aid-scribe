import { useState } from "react";
import { Download, Smartphone, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { toast } from "sonner";

interface Props {
  onAction?: () => void;
}

/**
 * Кнопка установки PWA + индикация статуса.
 * Скрывается полностью, если приложение уже запущено как PWA.
 * В preview/dev окружении показывает подсказку, что PWA доступно только
 * в опубликованной версии.
 */
export function PWAInstallButton({ onAction }: Props) {
  const { available, standalone, isIOS, canPrompt, online, promptInstall } = usePWAInstall();
  const [iosHintOpen, setIosHintOpen] = useState(false);

  if (standalone) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-white/50">
        <Smartphone className="h-3.5 w-3.5" />
        Установлено как приложение
        {!online && (
          <span className="ml-auto flex items-center gap-1 text-amber-400">
            <WifiOff className="h-3 w-3" /> офлайн
          </span>
        )}
      </div>
    );
  }

  const handleClick = async () => {
    onAction?.();
    if (!available) {
      toast("Установка доступна в опубликованной версии", {
        description: "Откройте muse-machine-x.lovable.app в браузере телефона.",
      });
      return;
    }
    if (isIOS) {
      setIosHintOpen(true);
      toast("Установка на iOS", {
        description: "Поделиться → На экран «Домой»",
        duration: 6000,
      });
      return;
    }
    if (!canPrompt) {
      toast("Установка пока недоступна", {
        description: "Попробуйте через минуту или используйте меню браузера.",
      });
      return;
    }
    const ok = await promptInstall();
    if (ok) toast.success("Приложение установлено");
  };

  return (
    <>
      <Button
        variant="ghost"
        onClick={handleClick}
        className="w-full justify-start text-white hover:bg-white/10"
      >
        <Download className="h-4 w-4 mr-2" />
        Установить приложение
        {!online && <WifiOff className="h-3.5 w-3.5 ml-auto text-amber-400" />}
      </Button>
      {iosHintOpen && (
        <div className="px-3 pb-2 text-xs text-white/60">
          На iPhone: нажмите кнопку «Поделиться» в Safari, затем «На экран „Домой"».
        </div>
      )}
    </>
  );
}
