import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import {
  addLexEntry,
  bumpLexWeight,
  deleteLexEntry,
  updateLexEntry,
  useLexicon,
  type LexEntry,
} from "@/lib/carreports/lexicon";
import type { ChatChip, StepId } from "@/lib/carreports/types";

interface Props {
  step: StepId;
  zone?: string;
  /** values currently selected in composer */
  selectedValues: Set<string>;
  onTap: (chip: ChatChip) => void;
}

/** Long-press detector (touch + mouse). */
function useLongPress(onLongPress: () => void, ms = 500) {
  const timer = useRef<number | null>(null);
  const triggered = useRef(false);
  const start = () => {
    triggered.current = false;
    timer.current = window.setTimeout(() => {
      triggered.current = true;
      onLongPress();
    }, ms);
  };
  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    handlers: {
      onPointerDown: start,
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
    },
    wasLongPress: () => triggered.current,
  };
}

export function LexChips({ step, zone, selectedValues, onTap }: Props) {
  const entries = useLexicon(step, zone);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<LexEntry | null>(null);

  return (
    <>
      {entries.map((e) => (
        <LexButton
          key={e.id}
          entry={e}
          selected={selectedValues.has(e.value)}
          onTap={() => {
            bumpLexWeight(e.id);
            onTap({ label: e.label, value: e.value });
          }}
          onLongPress={() => setEditing(e)}
        />
      ))}
      <button
        onClick={() => setAddOpen(true)}
        className="rounded-full border border-dashed border-white/25 text-white/70 hover:border-orange-400 hover:text-white px-2.5 py-1 text-xs flex items-center gap-1"
        aria-label="Добавить клише"
      >
        <Plus className="h-3.5 w-3.5" /> Своё клише
      </button>
      {addOpen && (
        <LexEditor
          title="Новое клише"
          onClose={() => setAddOpen(false)}
          onSave={(label, value) => {
            addLexEntry(step, zone, label, value);
            setAddOpen(false);
          }}
        />
      )}
      {editing && (
        <LexEditor
          title="Редактировать клише"
          initialLabel={editing.label}
          initialValue={editing.value}
          onDelete={() => {
            deleteLexEntry(editing.id);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
          onSave={(label, value) => {
            updateLexEntry(editing.id, { label, value });
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function LexButton({
  entry,
  selected,
  onTap,
  onLongPress,
}: {
  entry: LexEntry;
  selected: boolean;
  onTap: () => void;
  onLongPress: () => void;
}) {
  const lp = useLongPress(onLongPress);
  return (
    <button
      {...lp.handlers}
      onClick={() => {
        if (lp.wasLongPress()) return;
        onTap();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onLongPress();
      }}
      className={
        "rounded-full border px-2.5 py-1 text-xs transition-colors select-none " +
        (selected
          ? "bg-orange-500 text-white border-orange-500"
          : "border-white/15 text-white/80 hover:border-orange-400/60 hover:text-white")
      }
      title="Долгое нажатие — редактировать"
    >
      {selected ? "✓ " : ""}
      {entry.label}
    </button>
  );
}

function LexEditor({
  title,
  initialLabel = "",
  initialValue = "",
  onSave,
  onDelete,
  onClose,
}: {
  title: string;
  initialLabel?: string;
  initialValue?: string;
  onSave: (label: string, value: string) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(initialLabel);
  const [value, setValue] = useState(initialValue || initialLabel);
  const labelRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    labelRef.current?.focus();
  }, []);
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-3">
      <div className="w-full max-w-sm rounded-2xl bg-zinc-900 border border-white/10 p-4 text-white space-y-3">
        <div className="flex items-center">
          <div className="text-sm font-medium">{title}</div>
          <button
            onClick={onClose}
            className="ml-auto h-7 w-7 rounded-full hover:bg-white/10 flex items-center justify-center"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2">
          <div>
            <div className="text-[11px] text-white/50 mb-1">Подпись на кнопке</div>
            <input
              ref={labelRef}
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                if (!initialValue) setValue(e.target.value);
              }}
              maxLength={60}
              placeholder="Напр. «Сколы на бампере»"
              className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-orange-400"
            />
          </div>
          <div>
            <div className="text-[11px] text-white/50 mb-1">Что вставляется в сообщение</div>
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={240}
              rows={3}
              placeholder="Полная формулировка для отчёта"
              className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-orange-400 resize-none"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          {onDelete && (
            <button
              onClick={onDelete}
              className="text-xs text-red-400 hover:text-red-300 px-2 py-1.5"
            >
              Удалить
            </button>
          )}
          <button
            onClick={onClose}
            className="ml-auto text-xs text-white/60 hover:text-white px-3 py-1.5"
          >
            Отмена
          </button>
          <button
            disabled={!label.trim() || !value.trim()}
            onClick={() => onSave(label.trim(), value.trim())}
            className="rounded-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5"
          >
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
