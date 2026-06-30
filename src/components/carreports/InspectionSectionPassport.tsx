import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { INSPECTION_SECTIONS, type SectionSnake } from "@/lib/carreports/inspectionSections";
import type { InspectionStep } from "@/lib/carreports/types";
import { loadTagsFor, type UserTag } from "@/lib/carreports/inspectionTags";

interface Props {
  step: InspectionStep;
  sectionSnake: SectionSnake;
}

const LKP_SECTIONS: SectionSnake[] = ["body", "body_reinforcement"];

/**
 * Паспорт раздела осмотра: перечисляет элементы с их тегами (чипами,
 * подкрашенными по серьёзности) и общим диапазоном ЛКП по разделу
 * (min «от» / max «до» по всем элементам, у которых заполнены значения).
 */
export function InspectionSectionPassport({ step, sectionSnake }: Props) {
  const section = INSPECTION_SECTIONS.find((s) => s.snake === sectionSnake);
  const [catalogue, setCatalogue] = useState<UserTag[] | null>(null);

  useEffect(() => {
    let alive = true;
    loadTagsFor("inspection", sectionSnake)
      .then((list) => alive && setCatalogue(list))
      .catch(() => alive && setCatalogue([]));
    return () => {
      alive = false;
    };
  }, [sectionSnake]);

  if (!section) return null;

  const byId = new Map<number, UserTag>();
  const byName = new Map<string, UserTag>();
  for (const t of catalogue ?? []) {
    byId.set(t.id, t);
    byName.set(t.name.trim().toLowerCase(), t);
  }

  const findings = step.findings ?? {};
  const lkpEligible = LKP_SECTIONS.includes(sectionSnake);

  // Диапазон ЛКП по разделу: min(from) / max(to) среди элементов с данными.
  let lkpFrom: number | null = null;
  let lkpTo: number | null = null;
  if (lkpEligible) {
    for (const el of section.elements) {
      const f = findings[`${sectionSnake}.${el.id}`];
      if (!f) continue;
      if (typeof f.paintworkThicknessFrom === "number" && f.paintworkThicknessFrom > 0) {
        lkpFrom = lkpFrom === null ? f.paintworkThicknessFrom : Math.min(lkpFrom, f.paintworkThicknessFrom);
      }
      if (typeof f.paintworkThicknessTo === "number" && f.paintworkThicknessTo > 0) {
        lkpTo = lkpTo === null ? f.paintworkThicknessTo : Math.max(lkpTo, f.paintworkThicknessTo);
      }
    }
  }

  type Chip = { name: string; type: string | null };
  const resolveChips = (
    serious?: number[],
    nonSerious?: number[],
    pending?: { name: string; severity: "serious" | "non_serious" }[],
  ): Chip[] => {
    const chips: Chip[] = [];
    for (const id of serious ?? []) {
      const t = byId.get(id);
      chips.push({ name: t?.name ?? `#${id}`, type: "serious" });
    }
    for (const id of nonSerious ?? []) {
      const t = byId.get(id);
      chips.push({ name: t?.name ?? `#${id}`, type: "non_serious" });
    }
    for (const p of pending ?? []) {
      const t = byName.get(p.name.trim().toLowerCase());
      chips.push({ name: p.name, type: t?.type ?? p.severity });
    }
    return chips;
  };

  const tagClass = (type: string | null): string => {
    if (type === "serious") return "bg-rose-500/10 border-rose-400/30 text-rose-100";
    if (type === "non_serious") return "bg-amber-500/10 border-amber-400/30 text-amber-100";
    return "bg-white/[0.06] border-white/10 text-white/80";
  };

  return (
    <div className="rounded-2xl rounded-tl-md bg-white/[0.04] border border-white/10 text-sm px-3 py-2.5 text-white">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-white/70 font-medium">Раздел: {section.label}</span>
        {lkpEligible && (lkpFrom !== null || lkpTo !== null) && (
          <span className="text-[11px] text-white/55 tabular-nums">
            ЛКП {lkpFrom ?? "—"}–{lkpTo ?? "—"} мкм
          </span>
        )}
      </div>

      <ul className="space-y-1.5 text-[13px] leading-tight">
        {section.elements.map((el) => {
          const f = findings[`${sectionSnake}.${el.id}`];
          const chips = f
            ? resolveChips(f.seriousDamageTagIds, f.noSeriousDamageTagIds, f.pendingTagNames)
            : [];
          const filled = !!f && (f.noDamage || chips.length > 0);
          return (
            <li key={el.id} className="min-w-0">
              <div className="flex items-baseline gap-2 min-w-0">
                {filled ? (
                  <Check className="h-3 w-3 shrink-0 translate-y-0.5 text-emerald-400/80" />
                ) : (
                  <span className="h-3 w-3 shrink-0 translate-y-0.5 rounded-full border border-white/15" />
                )}
                <span className="shrink-0 text-white/75">{el.label}</span>
                <span className="flex-1 border-b border-dashed border-white/5 translate-y-[-3px]" />
                {f?.noDamage && chips.length === 0 && (
                  <span className="text-[11px] text-emerald-300/80">норма</span>
                )}
              </div>
              {chips.length > 0 && (
                <div className="mt-1 ml-5 flex flex-wrap gap-1">
                  {chips.map((c, i) => (
                    <span
                      key={`${c.name}-${i}`}
                      className={
                        "inline-flex items-center rounded-md border px-1.5 py-[1px] text-[11px] " +
                        tagClass(c.type)
                      }
                    >
                      {c.name}
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
