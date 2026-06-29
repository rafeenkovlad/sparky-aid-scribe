import { Check, Loader2, Sparkles } from "lucide-react";
import type { NoteProposalPayload } from "@/lib/carreports/types";

interface Props {
  payload: NoteProposalPayload;
  onPickOriginal?: () => void;
  onPickAi?: () => void;
  onDismiss?: () => void;
}

/**
 * Компактная inline-карточка предложения AI-версии заметки.
 * Рисуется прямо под исходной заметкой в паспорте шага.
 */
export function NoteProposalInline({ payload, onPickOriginal, onPickAi, onDismiss }: Props) {
  const { ai, loading, picked } = payload;

  return (
    <div className="mt-2 rounded-lg border border-sky-400/25 bg-sky-400/[0.05] px-2.5 py-2 text-[12px] text-white/85">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-sky-200/80 mb-1">
        <Sparkles className="h-3 w-3" />
        AI‑версия
      </div>
      <div className="whitespace-pre-wrap text-white/85 leading-snug">
        {loading ? (
          <span className="inline-flex items-center gap-1.5 text-white/55">
            <Loader2 className="h-3 w-3 animate-spin" />
            Готовлю вариант…
          </span>
        ) : ai ? (
          ai
        ) : (
          <span className="text-white/40">Не удалось переформулировать.</span>
        )}
      </div>

      {!picked ? (
        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={onPickAi}
            disabled={!ai || loading}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-sky-400/40 bg-sky-400/15 hover:bg-sky-400/25 text-sky-100 text-[11.5px] font-medium px-2.5 py-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Check className="h-3 w-3" />
            Принять AI
          </button>
          <button
            type="button"
            onClick={onPickOriginal}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-white/15 bg-white/[0.04] hover:bg-white/10 text-white/80 text-[11.5px] font-medium px-2.5 py-1 transition-colors"
          >
            Оставить исходную
          </button>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Скрыть"
              className="text-white/40 hover:text-white/80 text-[11.5px] px-1.5 py-1"
            >
              ✕
            </button>
          )}
        </div>
      ) : (
        <div className="mt-2 text-[11px] text-white/55 flex items-center gap-1.5">
          <Check className="h-3 w-3 text-emerald-400" />
          {picked === "ai" ? "Принят AI‑вариант." : "Оставлена исходная."}
        </div>
      )}
    </div>
  );
}
