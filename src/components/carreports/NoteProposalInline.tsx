import { Loader2, RotateCcw, Sparkles } from "lucide-react";
import type { NoteProposalPayload } from "@/lib/carreports/types";

interface Props {
  payload: NoteProposalPayload;
  onPickOriginal?: () => void;
  onPickAi?: () => void;
  onDismiss?: () => void;
}

/**
 * Минималистичная inline-карточка: одна иконка-кнопка с лого ИИ.
 *  • Нажатие → заметка в драфте заменяется на AI-версию.
 *  • После замены — иконка «вернуть исходный текст».
 *  • Пока AI готовится — спиннер.
 */
export function NoteProposalInline({ payload, onPickOriginal, onPickAi }: Props) {
  const { ai, loading, picked } = payload;

  // Применили AI — показываем кнопку возврата к исходному.
  if (picked === "ai") {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-sky-200/80">
        <Sparkles className="h-3 w-3" />
        <span>AI‑версия</span>
        <button
          type="button"
          onClick={onPickOriginal}
          aria-label="Вернуть исходный текст"
          title="Вернуть исходный текст"
          className="ml-auto inline-flex items-center justify-center h-6 w-6 rounded-md text-white/55 hover:text-white/90 hover:bg-white/10 transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // Идёт генерация AI-версии.
  if (loading) {
    return (
      <div className="mt-1.5">
        <button
          type="button"
          disabled
          aria-label="Готовлю AI‑версию заметки"
          title="Готовлю AI‑версию заметки"
          className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-white/10 bg-white/[0.04] text-white/55"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        </button>
      </div>
    );
  }

  // AI-версия готова, ещё не применяли — одна иконка с лого ИИ.
  if (!ai) return null;
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={onPickAi}
        aria-label="Переформулировать через ИИ"
        title="Переформулировать через ИИ"
        className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-sky-400/30 bg-sky-400/10 hover:bg-sky-400/20 text-sky-200 transition-colors"
      >
        <Sparkles className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
