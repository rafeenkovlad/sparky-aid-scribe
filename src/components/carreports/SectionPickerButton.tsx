// Bottom-sheet выбора активного раздела осмотра. Открывается из композера.

import { useState } from "react";
import { Layers } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  INSPECTION_SECTIONS,
  type SectionSnake,
} from "@/lib/carreports/inspectionSections";
import { sectionProgress } from "@/lib/carreports/inspectionState";
import type { InspectionStep } from "@/lib/carreports/types";

export function SectionPickerButton(props: {
  ins: InspectionStep;
  currentSection: SectionSnake;
  onPick: (s: SectionSnake) => void;
}) {
  const { ins, currentSection, onPick } = props;
  const [open, setOpen] = useState(false);
  const current = INSPECTION_SECTIONS.find((s) => s.snake === currentSection);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Выбрать раздел осмотра"
          title="Раздел осмотра"
          className="h-8 rounded-full bg-white/5 hover:bg-white/10 text-white/85 flex items-center gap-1.5 px-2.5"
        >
          <Layers className="h-4 w-4 text-orange-400" />
          <span className="text-xs truncate max-w-[120px]">
            {current?.label ?? "Раздел"}
          </span>
          <span className="text-[10px] text-white/45">▾</span>
        </button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="bg-zinc-950 border-white/10 text-white max-h-[80dvh]"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="text-white">Раздел осмотра</SheetTitle>
        </SheetHeader>
        <div className="mt-3 grid grid-cols-1 gap-1.5 pb-6">
          {INSPECTION_SECTIONS.map((s) => {
            const sel = s.snake === currentSection;
            const prog = sectionProgress(ins, s);
            return (
              <button
                key={s.snake}
                onClick={() => {
                  onPick(s.snake);
                  setOpen(false);
                }}
                className={
                  "flex items-center justify-between rounded-xl px-3 py-2.5 text-sm " +
                  (sel
                    ? "bg-orange-500/20 border border-orange-500/60"
                    : "bg-white/[0.04] border border-white/10 hover:bg-white/[0.08]")
                }
              >
                <span className="text-white">{s.label}</span>
                <span
                  className={
                    "text-[11px] tabular-nums " +
                    (prog.filled === 0
                      ? "text-white/45"
                      : prog.filled >= prog.total
                        ? "text-emerald-300"
                        : "text-orange-300")
                  }
                >
                  {prog.filled}/{prog.total}
                </span>
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
