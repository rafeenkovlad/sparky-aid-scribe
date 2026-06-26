import { Check } from "lucide-react";
import type { ReportDraft } from "@/lib/carreports/types";

interface Item {
  label: string;
  filled: boolean;
  value?: string;
}

interface Props {
  draft: ReportDraft;
}

/**
 * Compact, restrained "passport" checklist that reads as part of the chat
 * thread rather than a separate card. No heavy borders or backgrounds —
 * just a header line and a tight key/value list.
 */
export function CarChecklist({ draft }: Props) {
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
    { label: "Год выпуска", filled: !!ch.year, value: ch.year ? String(ch.year) : undefined },
    { label: "Тип двигателя", filled: !!ch.engineType, value: ch.engineType },
    { label: "Коробка передач", filled: !!ch.transmission, value: ch.transmission },
    { label: "Тип привода", filled: !!ch.driveType, value: ch.driveType },
    { label: "Цвет кузова", filled: !!ch.color, value: ch.color },
  ];

  const optional: Item[] = [
    { label: "Госномер", filled: !!c.gosNumber, value: c.gosNumber ?? undefined },
    { label: "Ссылка на объявление", filled: !!c.uriListing, value: c.uriListing ?? undefined },
    { label: "Поколение", filled: !!ch.generationLabel, value: ch.generationLabel },
    {
      label: "Объём",
      filled: !!ch.engineVolume,
      value: ch.engineVolume ? `${ch.engineVolume} л` : undefined,
    },
    { label: "Комплектация", filled: !!ch.equipment, value: ch.equipment },
  ];

  const filledReq = required.filter((i) => i.filled).length;
  const filledOpt = optional.filter((i) => i.filled);

  return (
    <div className="text-[13px] leading-tight">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-white/70 font-medium">Паспорт авто</span>
        <span className="text-[11px] text-white/40 tabular-nums">
          {filledReq}/{required.length}
        </span>
      </div>
      <ul className="space-y-0.5">
        {required.map((it) => (
          <Row key={it.label} item={it} />
        ))}
      </ul>
      {filledOpt.length > 0 && (
        <ul className="mt-2 space-y-0.5 pt-2 border-t border-white/5">
          {filledOpt.map((it) => (
            <Row key={it.label} item={it} muted />
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ item, muted }: { item: Item; muted?: boolean }) {
  return (
    <li className="flex items-baseline gap-2 min-w-0">
      {item.filled ? (
        <Check className="h-3 w-3 shrink-0 translate-y-0.5 text-emerald-400/80" />
      ) : (
        <span className="h-3 w-3 shrink-0 translate-y-0.5 rounded-full border border-white/15" />
      )}
      <span className={muted ? "text-white/40" : "text-white/55"}>{item.label}</span>
      <span className="flex-1 border-b border-dashed border-white/5 translate-y-[-3px]" />
      <span
        className={
          "text-right tabular-nums " +
          (item.filled
            ? muted
              ? "text-white/65"
              : "text-white/85"
            : "text-white/30")
        }
        title={item.value ?? ""}
      >
        {item.value ?? "—"}
      </span>
    </li>
  );
}
