import { Loader2, RotateCcw, Sparkles } from "lucide-react";
import type { NoteProposalPayload } from "@/lib/carreports/types";

interface Props {
  payload: NoteProposalPayload;
  onPickOriginal?: () => void;
  onPickAi?: () => void;
  onDismiss?: () => void;
}

/**
 * Минималистичная inline-карточка: одна иконка-кнопка с лого ИИ справа.
 *  • Нажатие → заметка в драфте заменяется на AI-версию.
 *  • После замены — иконка «вернуть исходный текст» на том же месте.
 *  • Пока AI готовится — спиннер.
 */
export function NoteProposalInline({ payload, onPickOriginal, onPickAi }: Props) {
  const { ai, loading, picked } = payload;

  // Применили AI — справа кнопка возврата к исходному.
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

  // Идёт генерация AI-версии — слева пометка «AI‑версия», справа спиннер на месте кнопки возврата.
  if (loading) {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-sky-200/80">
        <Sparkles className="h-3 w-3" />
        <span>AI‑версия</span>
        <button
          type="button"
          disabled
          aria-label="Готовлю AI‑версию заметки"
          title="Готовлю AI‑версию заметки"
          className="ml-auto inline-flex items-center justify-center h-6 w-6 rounded-md text-white/55"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        </button>
      </div>
    );
  }


  // AI-версия готова, ещё не применяли — иконка с лого ИИ справа.
  if (!ai) return null;
  return (
    <div className="mt-1.5 flex items-center justify-end">
      <button
        type="button"
        onClick={onPickAi}
        aria-label="Переформулировать через ИИ"
        title="Переформулировать через ИИ"
        className="inline-flex items-center justify-center h-6 w-6 rounded-md text-sky-200 hover:text-sky-100 hover:bg-white/10 transition-colors"
      >
        <Sparkles className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
