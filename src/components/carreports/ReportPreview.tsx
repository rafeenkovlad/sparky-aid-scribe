import { FLOW_STEPS } from "@/lib/carreports/flow";
import { filledCount, isStepFilled, shortCarSummary, shortCharSummary, shortDocsSummary } from "@/lib/carreports/progress";
import { INSPECTION_ZONES } from "@/lib/carreports/inspectionZones";
import type { StepId, Thread } from "@/lib/carreports/types";
import { Check, ChevronRight, Eye, FileText } from "lucide-react";

interface Props {
  thread: Thread;
  onJump: (step: StepId) => void;
  onOpenFullReport?: () => void;
}

function summaryFor(step: StepId, t: Thread): string {
  switch (step) {
    case "car": {
      const carPart = shortCarSummary(t.draft);
      const charPart = shortCharSummary(t.draft);
      const bits = [carPart, charPart].filter((s) => s && s !== "—");
      return bits.length ? bits.join(" · ") : "—";
    }
    case "characteristics":
      return shortCharSummary(t.draft);
    case "docs":
      return shortDocsSummary(t.draft);
    case "inspection": {
      const ins = t.draft.inspectionStep;
      const zones = INSPECTION_ZONES.filter(
        (z) => ins.sectionNotes[z.id] || ins.photos.some((p) => p.section === z.id),
      );
      if (zones.length === 0) return "—";
      return `${zones.length}/${INSPECTION_ZONES.length} зон · ${ins.photos.length} фото`;
    }
    case "legalMaterials": {
      const files = t.draft.legalReviewStep?.otherMaterials ?? [];
      if (!files.length) return "—";
      return `${files.length} файл(ов)`;
    }
    case "testDrive": {
      const td = t.draft.testDriveStep ?? {};
      if (td.notDone) return "Не проводился";
      return td.notes ? td.notes.split("\n")[0] : "—";
    }

    case "result": {
      const r = t.draft.resultStep ?? {};
      const bits = [r.summaryInspectionNote, r.resultSpecialistNote].filter(Boolean);
      return bits.join(" · ") || "—";
    }
    default:
      return "Доступно позже";
  }
}

export function ReportPreview({ thread, onJump, onOpenFullReport }: Props) {
  const filled = filledCount(thread.draft);
  return (
    <div className="flex flex-col h-full bg-zinc-950 text-white">
      <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
        <FileText className="h-4 w-4 text-orange-400" />
        <div className="text-sm font-medium">Черновик отчёта</div>
        <div className="ml-auto text-xs text-white/60">{filled}/{FLOW_STEPS.length - 1} заполнено</div>
      </div>
      {onOpenFullReport && (
        <div className="px-3 pt-3">
          <button
            onClick={onOpenFullReport}
            className="w-full rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium py-2.5 flex items-center justify-center gap-2 transition-colors"
          >
            <Eye className="h-4 w-4" />
            Открыть полный отчёт
          </button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {FLOW_STEPS.map((step, idx) => {
          const done = isStepFilled(step.id, thread.draft);
          const isCurrent = idx === thread.stepIndex;
          return (
            <button
              key={step.id}
              onClick={() => onJump(step.id)}
              className={
                "w-full text-left rounded-xl border p-3 transition-colors " +
                (isCurrent
                  ? "border-orange-400/60 bg-orange-500/10"
                  : "border-white/10 hover:border-white/20 bg-white/[0.02]")
              }
            >
              <div className="flex items-center gap-2">
                <div
                  className={
                    "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold " +
                    (done
                      ? "bg-emerald-500 text-white"
                      : isCurrent
                        ? "bg-orange-500 text-white"
                        : "bg-white/10 text-white/60")
                  }
                >
                  {done ? <Check className="h-3 w-3" /> : idx + 1}
                </div>
                <div className="text-sm font-medium">{step.label}</div>
                <ChevronRight className="h-4 w-4 text-white/40 ml-auto" />
              </div>
                <div className="text-xs text-white/60 mt-1 line-clamp-2">{summaryFor(step.id, thread)}</div>
              </button>
            );
          })}
        </div>
      </div>
  );
}

