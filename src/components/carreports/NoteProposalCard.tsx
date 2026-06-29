import { Check, Loader2, Pencil, X } from "lucide-react";
import type { NoteProposalPayload } from "@/lib/carreports/types";

interface Props {
  payload: NoteProposalPayload;
  onPickOriginal?: () => void;
  onPickAi?: () => void;
  onDismiss?: () => void;
}

/**
 * Карточка‑предложение переформулировать заметку: оригинал vs AI‑версия.
 * Пока AI готовит вариант — показываем skeleton. После выбора кнопки
 * сворачиваются в статусную строку «Принят: исходный/AI».
 */
export function NoteProposalCard({ payload, onPickOriginal, onPickAi, onDismiss }: Props) {
  const { scopeLabel, original, ai, loading, picked } = payload;

  return (
    <div className="rounded-2xl rounded-tl-md bg-white/[0.04] border border-white/10 text-sm px-3 py-2.5 text-white">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 text-white/75 font-medium">
          <Pencil className="h-3.5 w-3.5 text-sky-300" />
          <span>Переформулировать заметку?</span>
        </div>
        {onDismiss && !picked && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Закрыть"
            className="text-white/40 hover:text-white/80"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="text-[10px] uppercase tracking-wide text-white/35 mb-1">
        {scopeLabel}
      </div>

      <div className="space-y-2">
        <Block label="Исходная" body={original} tone="muted" />
        {loading ? (
          <Block
            label="AI‑версия"
            body={
              <span className="inline-flex items-center gap-1.5 text-white/55">
                <Loader2 className="h-3 w-3 animate-spin" />
                Готовлю вариант…
              </span>
            }
            tone="ai"
          />
        ) : ai ? (
          <Block label="AI‑версия" body={ai} tone="ai" />
        ) : (
          <Block
            label="AI‑версия"
            body={<span className="text-white/40">Не удалось переформулировать.</span>}
            tone="ai"
          />
        )}
      </div>

      {!picked ? (
        <div className="mt-3 flex items-center gap-1.5">
          <button
            type="button"
            onClick={onPickOriginal}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/10 text-white/85 text-[12px] font-medium px-3 py-1.5 transition-colors"
          >
            Оставить исходную
          </button>
          <button
            type="button"
            onClick={onPickAi}
            disabled={!ai || loading}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-sky-400/40 bg-sky-400/10 hover:bg-sky-400/15 text-sky-100 text-[12px] font-medium px-3 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Check className="h-3.5 w-3.5" />
            Принять AI
          </button>
        </div>
      ) : (
        <div className="mt-3 text-[11px] text-white/55 flex items-center gap-1.5">
          <Check className="h-3 w-3 text-emerald-400" />
          {picked === "ai" ? "Принят AI‑вариант." : "Оставлена исходная."}
        </div>
      )}
    </div>
  );
}

function Block({
  label,
  body,
  tone,
}: {
  label: string;
  body: React.ReactNode;
  tone: "muted" | "ai";
}) {
  const ring =
    tone === "ai" ? "border-sky-400/20 bg-sky-400/[0.04]" : "border-white/10 bg-white/[0.03]";
  return (
    <div className={`rounded-lg border ${ring} px-2.5 py-2`}>
      <div className="text-[10px] uppercase tracking-wide text-white/40 mb-1">{label}</div>
      <div className="text-[13px] text-white/85 whitespace-pre-wrap">{body}</div>
    </div>
  );
}
