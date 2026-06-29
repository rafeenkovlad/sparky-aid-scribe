import { Check, ChevronRight, Pencil, Plus, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type { NoteProposalPayload, NoteRef, ReportDraft, StepId } from "@/lib/carreports/types";
import { stepById } from "@/lib/carreports/flow";
import { INSPECTION_SECTIONS } from "@/lib/carreports/inspectionSections";
import { sectionProgress } from "@/lib/carreports/inspectionState";
import { loadTagsFor, type UserTag } from "@/lib/carreports/inspectionTags";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CarChecklist } from "./CarChecklist";
import { DocsChecklist } from "./DocsChecklist";
import { NoteProposalInline } from "./NoteProposalInline";

type TestDriveTagCatKey =
  | "testDriveEngineTags"
  | "testDriveTransmissionTags"
  | "testDriveSteeringWheelTags"
  | "testDriveSuspensionInDriveTags"
  | "testDriveBrakesInDriveTags";

const TD_CAT_SECTION: Record<TestDriveTagCatKey, string> = {
  testDriveEngineTags: "engine",
  testDriveTransmissionTags: "transmission",
  testDriveSteeringWheelTags: "steering_wheel",
  testDriveSuspensionInDriveTags: "suspension_in_drive",
  testDriveBrakesInDriveTags: "brakes_in_drive",
};


interface Props {
  step: StepId;
  draft: ReportDraft;
  onEdit?: (template: string) => void;
  onConfirm?: () => void;
  onDocsAllMatch?: () => void;
  onTestDriveAllOk?: () => void;
  /** Добавить тег (по имени) в указанную категорию тест-драйва. */
  onTestDriveAddTag?: (catKey: TestDriveTagCatKey, name: string) => void;
  /** Активные предложения переформулировать заметку, относящиеся к этому шагу. */
  noteProposals?: Array<{
    payload: NoteProposalPayload;
    onPickOriginal: () => void;
    onPickAi: () => void;
    onDismiss: () => void;
  }>;
}

/**
 * Универсальная карточка-«паспорт заполненности» шага.
 * Показывается при входе в шаг, который уже был заполнен ранее.
 */
export function StepPassport({
  step,
  draft,
  onEdit,
  onConfirm,
  onDocsAllMatch,
  onTestDriveAllOk,
  onTestDriveAddTag,
  noteProposals,
}: Props) {
  const hideConfirm = step === "legalMaterials" || step === "testDrive";
  return (
    <div className="rounded-2xl rounded-tl-md bg-white/[0.04] border border-white/10 text-sm px-3 py-2.5 text-white">
      <div className="mb-2">
        <span className="text-white/70 font-medium">{stepById(step).label}</span>
      </div>

      <div className="-mx-0.5">
        <StepBody
          step={step}
          draft={draft}
          onEdit={onEdit}
          onDocsAllMatch={onDocsAllMatch}
          onTestDriveAllOk={onTestDriveAllOk}
          onTestDriveAddTag={onTestDriveAddTag}
          noteProposals={noteProposals}
        />
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

function findProposal(
  noteProposals: Props["noteProposals"],
  match: (ref: NoteRef) => boolean,
) {
  return noteProposals?.find((p) => match(p.payload.ref));
}

function StepBody({
  step,
  draft,
  onEdit,
  onDocsAllMatch,
  onTestDriveAllOk,
  onTestDriveAddTag,
  noteProposals,
}: {
  step: StepId;
  draft: ReportDraft;
  onEdit?: (t: string) => void;
  onDocsAllMatch?: () => void;
  onTestDriveAllOk?: () => void;
  onTestDriveAddTag?: (catKey: TestDriveTagCatKey, name: string) => void;
  noteProposals?: Props["noteProposals"];

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
      const flags: Array<[string, boolean | undefined, string[] | undefined, TestDriveTagCatKey]> = [
        ["Двигатель", td.testDriveEngineIsWorkingProperly, td.testDriveEngineTags, "testDriveEngineTags"],
        ["КПП", td.testDriveTransmissionIsWorkingProperly, td.testDriveTransmissionTags, "testDriveTransmissionTags"],
        ["Руль", td.testDriveSteeringWheelIsWorkingProperly, td.testDriveSteeringWheelTags, "testDriveSteeringWheelTags"],
        ["Подвеска", td.testDriveSuspensionInDriveIsWorkingProperly, td.testDriveSuspensionInDriveTags, "testDriveSuspensionInDriveTags"],
        ["Тормоза", td.testDriveBrakesInDriveIsWorkingProperly, td.testDriveBrakesInDriveTags, "testDriveBrakesInDriveTags"],
      ];
      const cleanTags = (arr?: string[]) =>
        Array.isArray(arr)
          ? arr
              .filter((x): x is string => typeof x === "string" && !!x.trim())
              .map((x) => x.trim())
              // не показываем «голые» числовые id — только человекочитаемые названия
              .filter((x) => !/^\d+$/.test(x))
          : [];
      return (
        <div className="space-y-2 text-[13px] leading-tight">
          <ul className="space-y-1">
            {flags.map(([label, val, tagArr, catKey]) => {
              const tags = cleanTags(tagArr);
              return (
                <li key={label} className="min-w-0">
                  <div className="flex items-baseline gap-2 min-w-0">
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
                  </div>
                  {(tags.length > 0 || onTestDriveAddTag) && (
                    <div className="pl-5 mt-1 flex flex-wrap items-center gap-1">
                      {tags.map((t, i) => (
                        <span
                          key={`${t}-${i}`}
                          className="inline-flex items-center rounded-md bg-white/[0.06] border border-white/10 text-white/80 text-[11px] px-1.5 py-0.5"
                        >
                          {t}
                        </span>
                      ))}
                      {onTestDriveAddTag && (
                        <TestDriveTagPicker
                          catKey={catKey}
                          selectedNames={tags}
                          onAdd={(name) => onTestDriveAddTag(catKey, name)}
                        />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>


          {(td.notes || td.testDriveNote) && (
            <div className="pt-2 border-t border-white/5">
              <div className="text-white/70 whitespace-pre-wrap">
                {td.notes ?? td.testDriveNote}
              </div>
              {(() => {
                const p = findProposal(noteProposals, (r) => r.kind === "testDrive");
                return p ? (
                  <NoteProposalInline
                    payload={p.payload}
                    onPickOriginal={p.onPickOriginal}
                    onPickAi={p.onPickAi}
                    onDismiss={p.onDismiss}
                  />
                ) : null;
              })()}
            </div>
          )}
          {(onTestDriveAllOk || onEdit) && (
            <div className="pt-2 flex items-center gap-1.5">
              {onTestDriveAllOk && (
                <button
                  type="button"
                  onClick={onTestDriveAllOk}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-400/10 hover:bg-emerald-400/15 text-emerald-200 text-[12px] font-medium px-3 py-1.5 transition-colors"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Нареканий нет
                </button>
              )}
              {onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(buildTestDriveEditTemplate(td))}
                  aria-label="Редактировать"
                  title="Редактировать"
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/10 text-white/80 text-[12px] font-medium px-3 py-1.5 transition-colors"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Редактировать
                </button>
              )}
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
              {(() => {
                const p = findProposal(noteProposals, (r2) => r2.kind === "resultSummary");
                return p ? (
                  <NoteProposalInline
                    payload={p.payload}
                    onPickOriginal={p.onPickOriginal}
                    onPickAi={p.onPickAi}
                    onDismiss={p.onDismiss}
                  />
                ) : null;
              })()}
            </div>
          )}
          {r.resultSpecialistNote && (
            <div className="pt-2 border-t border-white/5">
              <div className="text-[10px] uppercase tracking-wide text-white/40 mb-1">Вердикт</div>
              <div className="text-white/85 whitespace-pre-wrap">{r.resultSpecialistNote}</div>
              {(() => {
                const p = findProposal(noteProposals, (r2) => r2.kind === "resultVerdict");
                return p ? (
                  <NoteProposalInline
                    payload={p.payload}
                    onPickOriginal={p.onPickOriginal}
                    onPickAi={p.onPickAi}
                    onDismiss={p.onDismiss}
                  />
                ) : null;
              })()}
            </div>
          )}
        </div>
      );
    }
    default:
      return null;
  }
}

/** Префилл композера для правки тест‑драйва: заметка + теги по 5 категориям. */
export function buildTestDriveEditTemplate(td: ReportDraft["testDriveStep"]): string {
  const t = td ?? {};
  const note = (t.testDriveNote ?? t.notes ?? "").trim();
  const join = (arr?: string[]) =>
    Array.isArray(arr) ? arr.filter((x) => typeof x === "string" && x.trim()).join(", ") : "";
  return [
    "Тест-драйв (правка):",
    `Двигатель: ${join(t.testDriveEngineTags)}`,
    `КПП: ${join(t.testDriveTransmissionTags)}`,
    `Руль: ${join(t.testDriveSteeringWheelTags)}`,
    `Подвеска: ${join(t.testDriveSuspensionInDriveTags)}`,
    `Тормоза: ${join(t.testDriveBrakesInDriveTags)}`,
    "",
    `Заметка: ${note}`,
  ].join("\n");

}
