import { Check, Camera } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  INSPECTION_SECTIONS,
  ZONE_TO_SECTION,
  type SectionSnake,
} from "@/lib/carreports/inspectionSections";
import type { InspectionStep } from "@/lib/carreports/types";
import { loadTagsFor, type UserTag } from "@/lib/carreports/inspectionTags";

interface Props {
  step: InspectionStep;
}


const LKP_SECTIONS: SectionSnake[] = ["body", "body_reinforcement"];

/**
 * Общий паспорт шага «Осмотр»: по каждому разделу выводит список
 * элементов с их тегами (чипами, подкрашенными по серьёзности) и общий
 * диапазон ЛКП по разделу (min «от» / max «до» среди элементов).
 */
export function InspectionFullPassport({ step }: Props) {
  const [catalogue, setCatalogue] = useState<Record<string, UserTag[]>>({});

  useEffect(() => {
    let alive = true;
    Promise.all(
      INSPECTION_SECTIONS.map((s) =>
        loadTagsFor("inspection", s.snake)
          .then((list) => [s.snake, list] as const)
          .catch(() => [s.snake, [] as UserTag[]] as const),
      ),
    ).then((pairs) => {
      if (!alive) return;
      const next: Record<string, UserTag[]> = {};
      for (const [k, v] of pairs) next[k] = v;
      setCatalogue(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  const findings = step.findings ?? {};

  const tagClass = (type: string | null): string => {
    if (type === "serious") return "bg-rose-500/10 border-rose-400/30 text-rose-100";
    if (type === "non_serious") return "bg-amber-500/10 border-amber-400/30 text-amber-100";
    return "bg-white/[0.06] border-white/10 text-white/80";
  };

  return (
    <div className="rounded-2xl rounded-tl-md bg-white/[0.04] border border-white/10 text-sm px-3 py-2.5 text-white">
      <div className="mb-2">
        <span className="text-white/70 font-medium">Паспорт осмотра</span>
      </div>

      <div className="space-y-3">
        {INSPECTION_SECTIONS.map((section) => {
          const list = catalogue[section.snake] ?? [];
          const byId = new Map<number, UserTag>();
          const byName = new Map<string, UserTag>();
          for (const t of list) {
            byId.set(t.id, t);
            byName.set(t.name.trim().toLowerCase(), t);
          }

          // Только элементы, по которым есть finding.
          const touchedEls = section.elements.filter(
            (el) => !!findings[`${section.snake}.${el.id}`],
          );

          const lkpEligible = LKP_SECTIONS.includes(section.snake);
          let lkpFrom: number | null = null;
          let lkpTo: number | null = null;
          if (lkpEligible) {
            for (const el of section.elements) {
              const f = findings[`${section.snake}.${el.id}`];
              if (!f) continue;
              if (typeof f.paintworkThicknessFrom === "number" && f.paintworkThicknessFrom > 0) {
                lkpFrom = lkpFrom === null ? f.paintworkThicknessFrom : Math.min(lkpFrom, f.paintworkThicknessFrom);
              }
              if (typeof f.paintworkThicknessTo === "number" && f.paintworkThicknessTo > 0) {
                lkpTo = lkpTo === null ? f.paintworkThicknessTo : Math.max(lkpTo, f.paintworkThicknessTo);
              }
            }
          }

          return (
            <div key={section.snake}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-white/70 font-medium text-[13px]">
                  {section.label}
                </span>
                {lkpEligible && (lkpFrom !== null || lkpTo !== null) && (
                  <span className="text-[11px] text-white/55 tabular-nums">
                    ЛКП {lkpFrom ?? "—"}–{lkpTo ?? "—"} мкм
                  </span>
                )}
              </div>
              {touchedEls.length === 0 ? (
                <div className="text-[12px] text-white/40 pl-0.5">— раздел не заполнен</div>
              ) : (
                <ul className="space-y-1.5 text-[13px] leading-tight">
                  {touchedEls.map((el) => {
                    const f = findings[`${section.snake}.${el.id}`]!;
                    const chips: Array<{ name: string; type: string | null }> = [];
                    for (const id of f.seriousDamageTagIds ?? []) {
                      const t = byId.get(id);
                      chips.push({ name: t?.name ?? `#${id}`, type: "serious" });
                    }
                    for (const id of f.noSeriousDamageTagIds ?? []) {
                      const t = byId.get(id);
                      chips.push({ name: t?.name ?? `#${id}`, type: "non_serious" });
                    }
                    for (const p of f.pendingTagNames ?? []) {
                      const t = byName.get(p.name.trim().toLowerCase());
                      chips.push({ name: p.name, type: t?.type ?? p.severity });
                    }
                    return (
                      <li key={el.id} className="min-w-0">
                        <div className="flex items-baseline gap-2 min-w-0">
                          <Check className="h-3 w-3 shrink-0 translate-y-0.5 text-emerald-400/80" />
                          <span className="shrink-0 text-white/75">{el.label}</span>
                          <span className="flex-1 border-b border-dashed border-white/5 translate-y-[-3px]" />
                          {f.noDamage && chips.length === 0 && (
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
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
