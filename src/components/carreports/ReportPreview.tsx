import { FLOW_STEPS } from "@/lib/carreports/flow";
import { isStepFilled, shortCarSummary, shortCharSummary, shortDocsSummary } from "@/lib/carreports/progress";
import { INSPECTION_ZONES } from "@/lib/carreports/inspectionZones";
import type { StepId, Thread } from "@/lib/carreports/types";
import { Check, ChevronRight, ExternalLink, Eye, FileText } from "lucide-react";
import { buildPreviewReport, openReportPreview } from "@/lib/carreports/previewReport";
import { useState } from "react";

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

function findUpload(t: Thread): { reportId?: string | number; at?: number } | null {
  const msgs = t.messages.result ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.kind === "finishComplete" && m.finishComplete) {
      return { reportId: m.finishComplete.reportId, at: m.createdAt };
    }
  }
  return null;
}

function fmtDate(ts: number): string {
  try {
    return new Date(ts).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return "";
  }
}

export function ReportPreview({ thread, onJump, onOpenFullReport }: Props) {
  const uploaded = findUpload(thread);
  const isUploaded = !!uploaded;
  const titleText = isUploaded
    ? `Отчёт${uploaded?.reportId ? ` №${uploaded.reportId}` : ""}${uploaded?.at ? ` · ${fmtDate(uploaded.at)}` : ""}`
    : "Черновик отчёта";
  return (
    <div className="flex flex-col h-full bg-zinc-950 text-white">
      <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
        <FileText className="h-4 w-4 text-orange-400" />
        <div className="text-sm font-medium truncate">{titleText}</div>
      </div>
      {onOpenFullReport && (
        <div className="px-3 pt-3">
          <button
            onClick={onOpenFullReport}
            className={
              "w-full rounded-xl text-white text-sm font-medium py-2.5 flex items-center justify-center gap-2 transition-colors " +
              (isUploaded
                ? "bg-emerald-500 hover:bg-emerald-600"
                : "bg-orange-500 hover:bg-orange-600")
            }
          >
            <Eye className="h-4 w-4" />
            {isUploaded ? "Открыть отчёт" : "Предпросмотр"}
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
