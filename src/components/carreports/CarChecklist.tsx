import { Check, Sparkles } from "lucide-react";
import type { ReportDraft } from "@/lib/carreports/types";

interface Item {
  label: string;
  filled: boolean;
  value?: string;
}

interface Props {
  draft: ReportDraft;
  /**
   * Если задано — снизу показывается кнопка «Заполнить недостающее».
   * Колбэк получает готовый шаблон вида "Пробег: \nГород осмотра: \n…",
   * содержащий только незаполненные обязательные поля.
   */
  onFillMissing?: (template: string) => void;
}

/**
 * Компактная карточка «паспорт авто» в стиле чата.
 * Поля разделены на обязательные и необязательные.
 * Незаполненные обязательные подсвечены янтарным.
 */
export function CarChecklist({ draft, onFillMissing }: Props) {
  const c = draft.carStep ?? {};
  const ch = draft.characteristicsStep ?? {};

  const required: Item[] = [
    {
      label: "VIN",
      filled: !!c.vin && c.vin.length >= 11,
      value: c.vin ? c.vin : c.unreadableVin ? "нечитаемый" : undefined,
    },
    {
      label: "Марка / модель",
      filled: !!(ch.brandName && ch.modelCarName),
      value: [ch.brandName, ch.modelCarName].filter(Boolean).join(" ") || undefined,
    },
    {
      label: "Пробег",
      filled: !!c.mileage,
      value: c.mileage ? `${c.mileage.toLocaleString("ru-RU")} км` : undefined,
    },
    { label: "Город осмотра", filled: !!c.cityInspection, value: c.cityInspection },
    { label: "Дата осмотра", filled: !!c.dateInspection, value: c.dateInspection },
    { label: "Год", filled: !!ch.year, value: ch.year ? String(ch.year) : undefined },
    { label: "Двигатель", filled: !!ch.engineType, value: ch.engineType },
    { label: "КПП", filled: !!ch.transmission, value: ch.transmission },
    { label: "Привод", filled: !!ch.driveType, value: ch.driveType },
    { label: "Цвет", filled: !!ch.color, value: ch.color },
  ];

  const optional: Item[] = [
    { label: "Госномер", filled: !!c.gosNumber, value: c.gosNumber ?? undefined },
    { label: "Ссылка", filled: !!c.uriListing, value: c.uriListing ?? undefined },
    { label: "Поколение", filled: !!ch.generationLabel, value: ch.generationLabel },
    {
      label: "Объём",
      filled: !!ch.engineVolume,
      value: ch.engineVolume ? `${ch.engineVolume} л` : undefined,
    },
    { label: "Комплектация", filled: !!ch.equipment, value: ch.equipment },
  ];

  const filledReq = required.filter((i) => i.filled).length;
  const filledOpt = optional.filter((i) => i.filled).length;
  const missingReq = required.filter((i) => !i.filled);

  function handleFill() {
    if (!onFillMissing || missingReq.length === 0) return;
    const template = missingReq.map((i) => `${i.label}: `).join("\n");
    onFillMissing(template);
  }

  return (
    <div className="text-[13px] leading-tight">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-white/70 font-medium">Паспорт авто</span>
        <span
          className={
            "text-[11px] tabular-nums " +
            (missingReq.length > 0 ? "text-amber-300/90" : "text-emerald-400/80")
          }
        >
          {filledReq}/{required.length}
        </span>
      </div>

      <SectionLabel>Обязательные</SectionLabel>
      <ul className="space-y-0.5">
        {required.map((it) => (
          <Row key={it.label} item={it} highlightMissing />
        ))}
      </ul>

      <div className="mt-2 pt-2 border-t border-white/5">
        <SectionLabel>
          Необязательные
          <span className="ml-1 text-white/30 tabular-nums">
            {filledOpt}/{optional.length}
          </span>
        </SectionLabel>
        <ul className="space-y-0.5">
          {optional.map((it) => (
            <Row key={it.label} item={it} muted />
          ))}
        </ul>
      </div>

      {onFillMissing && missingReq.length > 0 && (
        <button
          type="button"
          onClick={handleFill}
          className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/10 hover:bg-amber-400/15 text-amber-200 text-[12px] font-medium px-3 py-1.5 transition-colors"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Заполнить недостающее ({missingReq.length})
        </button>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-wide text-white/40 mb-1">
      {children}
    </div>
  );
}

function Row({
  item,
  muted,
  highlightMissing,
}: {
  item: Item;
  muted?: boolean;
  highlightMissing?: boolean;
}) {
  const missing = highlightMissing && !item.filled;
  return (
    <li className="flex items-baseline gap-2 min-w-0">
      {item.filled ? (
        <Check className="h-3 w-3 shrink-0 translate-y-0.5 text-emerald-400/80" />
      ) : (
        <span
          className={
            "h-3 w-3 shrink-0 translate-y-0.5 rounded-full border " +
            (missing ? "border-amber-400/70 bg-amber-400/15" : "border-white/15")
          }
        />
      )}
      <span
        className={
          "shrink-0 " +
          (missing
            ? "text-amber-200/90"
            : muted
              ? "text-white/40"
              : "text-white/55")
        }
      >
        {item.label}
      </span>
      <span
        className={
          "flex-1 border-b border-dashed translate-y-[-3px] " +
          (missing ? "border-amber-400/20" : "border-white/5")
        }
      />
      <span
        className={
          "text-right break-all min-w-0 " +
          (item.filled
            ? muted
              ? "text-white/65"
              : "text-white/85"
            : missing
              ? "text-amber-300/60"
              : "text-white/30")
        }
        title={item.value ?? ""}
      >
        {item.value ?? "—"}
      </span>
    </li>
  );
}
