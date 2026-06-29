import { Check, ChevronRight } from "lucide-react";
import type { ReportDraft, StepId } from "@/lib/carreports/types";
import { stepById } from "@/lib/carreports/flow";
import { INSPECTION_SECTIONS } from "@/lib/carreports/inspectionSections";
import { sectionProgress } from "@/lib/carreports/inspectionState";
import { CarChecklist } from "./CarChecklist";
import { DocsChecklist } from "./DocsChecklist";

interface Props {
  step: StepId;
  draft: ReportDraft;
  onEdit?: (template: string) => void;
  onConfirm?: () => void;
  onDocsAllMatch?: () => void;
}

/**
 * Универсальная карточка-«паспорт заполненности» шага.
 * Показывается при входе в шаг, который уже был заполнен ранее.
 */
export function StepPassport({ step, draft, onEdit, onConfirm, onDocsAllMatch }: Props) {
  const hideConfirm = step === "legalMaterials";
  return (
    <div className="rounded-2xl rounded-tl-md bg-white/[0.04] border border-white/10 text-sm px-3 py-2.5 text-white">
      <div className="mb-2">
        <span className="text-white/70 font-medium">
          {stepById(step).label} · уже заполнено
        </span>
      </div>

      <div className="-mx-0.5">
        <StepBody step={step} draft={draft} onEdit={onEdit} onDocsAllMatch={onDocsAllMatch} />
      </div>

      {onConfirm && !hideConfirm && (
        <div className="mt-3 pt-2 border-t border-white/5 flex items-center justify-end gap-2">
          <button
            onClick={onConfirm}
            className="rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-[12px] font-medium px-3 py-1.5 flex items-center gap-1.5 transition-colors"
          >
            Всё верно, далее <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function StepBody({
  step,
  draft,
  onEdit,
  onDocsAllMatch,
}: {
  step: StepId;
  draft: ReportDraft;
  onEdit?: (t: string) => void;
  onDocsAllMatch?: () => void;
}) {
  switch (step) {
    case "car":
    case "characteristics":
      return <CarChecklist draft={draft} onFillMissing={onEdit} />;
    case "docs":
      return <DocsChecklist draft={draft} onEdit={onEdit} onAllMatch={onDocsAllMatch} />;
    case "inspection": {
      const ins = draft.inspectionStep;
      return (
        <ul className="space-y-0.5 text-[13px] leading-tight">
          {INSPECTION_SECTIONS.map((s) => {
            const p = sectionProgress(ins, s);
            const photos = ins.photos.filter((ph) => ph.section === s.snake).length;
            const done = p.filled > 0;
            return (
              <li key={s.snake} className="flex items-baseline gap-2 min-w-0">
                {done ? (
                  <Check className="h-3 w-3 shrink-0 translate-y-0.5 text-emerald-400/80" />
                ) : (
                  <span className="h-3 w-3 shrink-0 translate-y-0.5 rounded-full border border-white/15" />
                )}
                <span className="shrink-0 text-white/55">{s.label}</span>
                <span className="flex-1 border-b border-dashed border-white/5 translate-y-[-3px]" />
                <span className="text-right text-white/75 tabular-nums">
                  {p.filled}/{p.total}
                  {photos ? ` · ${photos} фото` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      );
    }
    case "legalMaterials": {
      const files = draft.legalReviewStep?.otherMaterials ?? [];
      if (!files.length) return <div className="text-white/50 text-[13px]">Файлы не прикреплены.</div>;
      return (
        <ul className="space-y-0.5 text-[13px] leading-tight">
          {files.map((f, i) => (
            <li key={`${f.filename}-${i}`} className="flex items-baseline gap-2 min-w-0">
              <Check className="h-3 w-3 shrink-0 translate-y-0.5 text-emerald-400/80" />
              <span className="text-white/85 truncate" title={f.filename}>
                {f.filename}
              </span>
              <span className="flex-1 border-b border-dashed border-white/5 translate-y-[-3px]" />
              <span className="text-white/40 tabular-nums">
                {f.size ? `${Math.round(f.size / 1024)} КБ` : f.type}
              </span>
            </li>
          ))}
        </ul>
      );
    }
    case "testDrive": {
      const td = draft.testDriveStep ?? {};
      if (td.notDone) return <div className="text-white/70 text-[13px]">Тест-драйв не проводился.</div>;
      const flags: Array<[string, boolean | undefined]> = [
        ["Двигатель", td.testDriveEngineIsWorkingProperly],
        ["КПП", td.testDriveTransmissionIsWorkingProperly],
        ["Руль", td.testDriveSteeringWheelIsWorkingProperly],
        ["Подвеска", td.testDriveSuspensionInDriveIsWorkingProperly],
        ["Тормоза", td.testDriveBrakesInDriveIsWorkingProperly],
      ];
      return (
        <div className="space-y-2 text-[13px] leading-tight">
          <ul className="space-y-0.5">
            {flags.map(([label, val]) => (
              <li key={label} className="flex items-baseline gap-2 min-w-0">
                {val === true ? (
                  <Check className="h-3 w-3 shrink-0 translate-y-0.5 text-emerald-400/80" />
                ) : val === false ? (
                  <span className="h-3 w-3 shrink-0 translate-y-0.5 rounded-full bg-rose-400/80" />
                ) : (
                  <span className="h-3 w-3 shrink-0 translate-y-0.5 rounded-full border border-white/15" />
                )}
                <span className="shrink-0 text-white/55">{label}</span>
                <span className="flex-1 border-b border-dashed border-white/5 translate-y-[-3px]" />
                <span className="text-white/65">
                  {val === true ? "ок" : val === false ? "замечания" : "—"}
                </span>
              </li>
            ))}
          </ul>
          {(td.notes || td.testDriveNote) && (
            <div className="pt-2 border-t border-white/5 text-white/70 whitespace-pre-wrap">
              {td.notes ?? td.testDriveNote}
            </div>
          )}
        </div>
      );
    }
    case "result": {
      const r = draft.resultStep ?? {};
      return (
        <div className="space-y-2 text-[13px] leading-tight">
          {r.summaryInspectionNote && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-white/40 mb-1">Резюме</div>
              <div className="text-white/85 whitespace-pre-wrap">{r.summaryInspectionNote}</div>
            </div>
          )}
          {r.resultSpecialistNote && (
            <div className="pt-2 border-t border-white/5">
              <div className="text-[10px] uppercase tracking-wide text-white/40 mb-1">Вердикт</div>
              <div className="text-white/85 whitespace-pre-wrap">{r.resultSpecialistNote}</div>
            </div>
          )}
        </div>
      );
    }
    default:
      return null;
  }
}
