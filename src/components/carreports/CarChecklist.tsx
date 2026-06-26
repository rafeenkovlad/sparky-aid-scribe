import { Check, Circle } from "lucide-react";
import type { ReportDraft } from "@/lib/carreports/types";

interface Item {
  label: string;
  filled: boolean;
  value?: string;
  required?: boolean;
}

interface Props {
  draft: ReportDraft;
}

/**
 * Compact "passport" checklist for step 1.
 * Shows required fields with a green check when filled,
 * dim circle when missing. Optional fields render in a muted row below.
 */
export function CarChecklist({ draft }: Props) {
  const c = draft.carStep ?? {};
  const ch = draft.characteristicsStep ?? {};

  const required: Item[] = [
    {
      label: "VIN",
      filled: !!c.vin && c.vin.length >= 11,
      value: c.vin ? `…${c.vin.slice(-6)}` : c.unreadableVin ? "нечитаемый" : undefined,
      required: true,
    },
    {
      label: "Марка / модель",
      filled: !!(ch.brandName && ch.modelCarName),
      value: [ch.brandName, ch.modelCarName].filter(Boolean).join(" ") || undefined,
      required: true,
    },
    {
      label: "Пробег",
      filled: !!c.mileage,
      value: c.mileage ? `${c.mileage.toLocaleString("ru-RU")} км` : undefined,
      required: true,
    },
    {
      label: "Город осмотра",
      filled: !!c.cityInspection,
      value: c.cityInspection,
      required: true,
    },
    {
      label: "Дата осмотра",
      filled: !!c.dateInspection,
      value: c.dateInspection,
      required: true,
    },
    {
      label: "Год выпуска",
      filled: !!ch.year,
      value: ch.year ? String(ch.year) : undefined,
      required: true,
    },
    {
      label: "Двигатель",
      filled: !!ch.engineType,
      value: ch.engineType,
      required: true,
    },
    {
      label: "КПП",
      filled: !!ch.transmission,
      value: ch.transmission,
      required: true,
    },
    {
      label: "Привод",
      filled: !!ch.driveType,
      value: ch.driveType,
      required: true,
    },
    {
      label: "Цвет",
      filled: !!ch.color,
      value: ch.color,
      required: true,
    },
  ];

  const optional: Item[] = [
    { label: "Госномер", filled: !!c.gosNumber, value: c.gosNumber ?? undefined },
    { label: "Ссылка", filled: !!c.uriListing, value: c.uriListing ? "есть" : undefined },
    { label: "Поколение", filled: !!ch.generationLabel, value: ch.generationLabel },
    {
      label: "Объём",
      filled: !!ch.engineVolume,
      value: ch.engineVolume ? `${ch.engineVolume} л` : undefined,
    },
    { label: "Комплектация", filled: !!ch.equipment, value: ch.equipment },
  ];

  const filledReq = required.filter((i) => i.filled).length;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 space-y-2">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wide">
        <span className="text-white/55">Паспорт авто</span>
        <span className="text-white/70 tabular-nums">
          {filledReq}/{required.length} обязательных
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {required.map((it) => (
          <Row key={it.label} item={it} />
        ))}
      </div>
      <div className="pt-1.5 border-t border-white/5">
        <div className="text-[10px] uppercase tracking-wide text-white/40 mb-1">
          По желанию
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {optional.map((it) => (
            <Row key={it.label} item={it} muted />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ item, muted }: { item: Item; muted?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-[12px] min-w-0">
      {item.filled ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
      ) : (
        <Circle className={"h-3 w-3 shrink-0 " + (muted ? "text-white/20" : "text-white/30")} />
      )}
      <span className={"shrink-0 " + (muted ? "text-white/45" : "text-white/65")}>
        {item.label}
      </span>
      {item.value && (
        <span
          className={
            "ml-auto truncate text-[11px] " +
            (item.filled ? "text-white/85" : "text-white/45")
          }
          title={item.value}
        >
          {item.value}
        </span>
      )}
    </div>
  );
}
