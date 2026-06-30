import { Check, ChevronRight, Pencil, Plus, ShieldCheck, Sparkles, X } from "lucide-react";
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
  onTestDriveAddTag?: (catKey: TestDriveTagCatKey, tag: UserTag) => void;
  /** Активные предложения переформулировать заметку, относящиеся к этому шагу. */
  noteProposals?: Array<{
    payload: NoteProposalPayload;
    onPickOriginal: () => void;
    onPickAi: () => void;
    onDismiss: () => void;
  }>;
  /** Запустить ИИ-переформулировку для шага «Итог» (резюме/вердикт). */
  onReformulateResultNote?: (kind: "resultSummary" | "resultVerdict") => void;
  /** Удалить файл доп. материалов (шаг legalMaterials). */
  onDeleteLegalMaterial?: (idx: number) => void;
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
  onReformulateResultNote,
  onDeleteLegalMaterial,
}: Props) {

  const hideConfirm =
    step === "legalMaterials" ||
    step === "testDrive" ||
    step === "result" ||
    step === "car" ||
    step === "characteristics";

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
          onReformulateResultNote={onReformulateResultNote}
          onDeleteLegalMaterial={onDeleteLegalMaterial}
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
  onReformulateResultNote,
}: {
  step: StepId;
  draft: ReportDraft;
  onEdit?: (t: string) => void;
  onDocsAllMatch?: () => void;
  onTestDriveAllOk?: () => void;
  onTestDriveAddTag?: (catKey: TestDriveTagCatKey, tag: UserTag) => void;
  noteProposals?: Props["noteProposals"];
  onReformulateResultNote?: (kind: "resultSummary" | "resultVerdict") => void;

}) {

  switch (step) {
    case "car":
    case "characteristics":
      return (
        <div className="space-y-2">
          <CarChecklist draft={draft} />
          {onEdit && (
            <div className="pt-2 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onEdit(buildCarEditTemplate(draft, step))}
                aria-label="Редактировать"
                title="Редактировать"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/10 text-white/80 text-[12px] font-medium px-3 py-1.5 transition-colors"
              >
                <Pencil className="h-3.5 w-3.5" />
                Редактировать
              </button>
            </div>
          )}
        </div>
      );

    case "docs":
      return (
        <DocsChecklist
          draft={draft}
          onEdit={onEdit}
          onAllMatch={onDocsAllMatch}
          noteProposal={findProposal(noteProposals, (r) => r.kind === "docs")}
        />
      );
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
      // Передаём сырой массив (имена и/или numeric id) — TestDriveCategoryRow
      // сам подгрузит каталог и развернёт id → имя.
      const rawTags = (arr?: string[]): string[] =>
        Array.isArray(arr)
          ? arr.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim())
          : [];
      const tagTypes = td.testDriveTagTypes ?? {};
      return (
        <div className="space-y-2 text-[13px] leading-tight">
          <ul className="space-y-1">
            {flags.map(([label, val, tagArr, catKey]) => (
              <TestDriveCategoryRow
                key={label}
                label={label}
                val={val}
                rawTags={rawTags(tagArr)}
                catKey={catKey}
                tagTypes={tagTypes}
                onAddTag={onTestDriveAddTag}
              />
            ))}
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
      const renderResultNote = (
        kind: "resultSummary" | "resultVerdict",
        label: string,
        text: string,
      ) => {
        const p = findProposal(noteProposals, (r2) => r2.kind === kind);
        return (
          <div className={kind === "resultVerdict" ? "pt-2 border-t border-white/5" : undefined}>
            <div className="text-[10px] uppercase tracking-wide text-white/40 mb-1">{label}</div>
            <div className="text-white/85 whitespace-pre-wrap">{text}</div>
            {p ? (
              <NoteProposalInline
                payload={p.payload}
                onPickOriginal={p.onPickOriginal}
                onPickAi={p.onPickAi}
                onDismiss={p.onDismiss}
              />
            ) : (
              onReformulateResultNote && (
                <div className="mt-1.5 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => onReformulateResultNote(kind)}
                    aria-label="Переформулировать через ИИ"
                    title="Переформулировать через ИИ"
                    className="inline-flex items-center justify-center h-6 w-6 rounded-md text-sky-200 hover:text-sky-100 hover:bg-white/10 transition-colors"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            )}
          </div>

        );
      };
      return (
        <div className="space-y-2 text-[13px] leading-tight">
          {r.summaryInspectionNote && renderResultNote("resultSummary", "Резюме", r.summaryInspectionNote)}
          {r.resultSpecialistNote && renderResultNote("resultVerdict", "Вердикт", r.resultSpecialistNote)}

          {onEdit && (r.summaryInspectionNote || r.resultSpecialistNote) && (
            <div className="pt-2 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onEdit(buildResultEditTemplate(r))}
                aria-label="Редактировать"
                title="Редактировать"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/10 text-white/80 text-[12px] font-medium px-3 py-1.5 transition-colors"
              >
                <Pencil className="h-3.5 w-3.5" />
                Редактировать
              </button>
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

/** Префилл композера для правки шага «Итог»: резюме и вердикт двумя секциями. */
export function buildResultEditTemplate(r: ReportDraft["resultStep"]): string {
  const summary = (r?.summaryInspectionNote ?? "").trim();
  const verdict = (r?.resultSpecialistNote ?? "").trim();
  return [
    "Итог (правка):",
    "Резюме:",
    summary,
    "",
    "Вердикт:",
    verdict,
  ].join("\n");
}

/** Префилл композера для правки шага «Автомобиль/Характеристики». */
export function buildCarEditTemplate(draft: ReportDraft, step: StepId): string {
  const c = draft.carStep ?? {};
  const ch = draft.characteristicsStep ?? {};
  const lines: string[] = [
    step === "characteristics" ? "Характеристики (правка):" : "Автомобиль (правка):",
  ];
  const fmt = (value: string | number | undefined | null): string => {
    if (value === undefined || value === null || value === "") return "—";
    return String(value);
  };
  const push = (label: string, value: string | number | undefined | null) => {
    lines.push(`${label}: ${fmt(value)}`);
  };
  push("Дата осмотра", c.dateInspection ?? "");
  push("VIN", c.vin ?? (c.unreadableVin ? "нечитаемый" : ""));
  push("Госномер", c.gosNumber ?? "");
  push("Пробег", c.mileage ? `${c.mileage} км` : "");
  push("Город осмотра", c.cityInspection ?? "");
  push("Ссылка", c.uriListing ?? "");
  push("Марка", ch.brandName ?? "");
  push("Модель", ch.modelCarName ?? "");
  push("Поколение", ch.generationLabel ?? "");
  push("Год", ch.year ?? "");
  push("Двигатель", ch.engineType ?? "");
  push("Объём", ch.engineVolume ? `${ch.engineVolume} л` : "");
  push("КПП", ch.transmission ?? "");
  push("Привод", ch.driveType ?? "");
  push("Цвет", ch.color ?? "");
  push("Комплектация", ch.equipment ?? "");
  return lines.join("\n");
}





/** Строка категории тест-драйва: чипы (только issue-теги) + дропдаун. */
function TestDriveCategoryRow({
  label,
  val,
  rawTags,
  catKey,
  tagTypes,
  onAddTag,
}: {
  label: string;
  val: boolean | undefined;
  rawTags: string[];
  catKey: TestDriveTagCatKey;
  tagTypes: Record<string, "serious" | "non_serious">;
  onAddTag?: (catKey: TestDriveTagCatKey, tag: UserTag) => void;
}) {
  const [catalogue, setCatalogue] = useState<UserTag[] | null>(null);
  useEffect(() => {
    let alive = true;
    loadTagsFor("test_drive", null)
      .then((list) => alive && setCatalogue(list))
      .catch(() => alive && setCatalogue([]));
    return () => {
      alive = false;
    };
  }, []);

  const byId = new Map<number, UserTag>();
  const byName = new Map<string, UserTag>();
  for (const t of catalogue ?? []) {
    byId.set(t.id, t);
    byName.set(t.name.trim().toLowerCase(), t);
  }

  // Раскрываем numeric id → name из каталога. Показываем ВСЕ выбранные
  // теги (тип может быть null у свежесозданных user-тегов) — цветом лишь
  // подсвечиваем серьёзные/несерьёзные.
  const visibleTags: Array<{ name: string; type: string | null }> = [];
  const selectedIds: number[] = [];
  for (const raw of rawTags) {
    const asNum = Number(raw);
    if (Number.isInteger(asNum) && asNum > 0) {
      selectedIds.push(asNum);
      const t = byId.get(asNum);
      if (t) visibleTags.push({ name: t.name, type: t.type });
      // если каталог ещё не загрузился — id появится как имя после загрузки
      continue;
    }
    const key = raw.trim().toLowerCase();
    const inCat = byName.get(key);
    const typed = tagTypes[key] ?? inCat?.type ?? null;
    if (inCat) selectedIds.push(inCat.id);
    visibleTags.push({ name: raw, type: typed });
  }

  const tagClass = (type: string | null): string => {
    if (type === "serious")
      return "bg-rose-500/10 border-rose-400/30 text-rose-100";
    if (type === "non_serious")
      return "bg-amber-500/10 border-amber-400/30 text-amber-100";
    return "bg-white/[0.06] border-white/10 text-white/80";
  };

  return (
    <li className="min-w-0">
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
          {val === true ? "норма" : val === false ? "замечания" : "—"}
        </span>
      </div>

      {(visibleTags.length > 0 || onAddTag) && (
        <div className="pl-5 mt-1 flex flex-wrap items-center gap-1">
          {visibleTags.map((t, i) => (
            <span
              key={`${t.name}-${i}`}
              className={`inline-flex items-center rounded-md border text-[11px] px-1.5 py-0.5 ${tagClass(t.type)}`}
            >
              {t.name}
            </span>
          ))}
          {onAddTag && (
            <TestDriveTagPicker
              catKey={catKey}
              selectedNames={visibleTags.map((t) => t.name)}
              selectedTagIds={selectedIds}
              onAdd={(tag) => onAddTag(catKey, tag)}
            />
          )}
        </div>
      )}
    </li>
  );
}




/** Дропдаун-подсказка из GetUserTags: только теги с типом serious/non_serious. */
function TestDriveTagPicker({
  catKey,
  selectedNames,
  selectedTagIds,
  onAdd,
}: {
  catKey: TestDriveTagCatKey;
  selectedNames: string[];
  selectedTagIds: number[];
  onAdd: (tag: UserTag) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<UserTag[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Стабильный ключ выбранных id — чтобы перезагрузить теги, когда
  // пользователь добавил/убрал тег.
  const selectedKey = selectedTagIds.slice().sort((a, b) => a - b).join(",");

  // Перезагружаем список каждый раз, когда:
  //  - popover открывается;
  //  - меняется набор выбранных тегов (после клика — selectedKey).
  // Сервер вернёт релевантный список с учётом selectedTagIds.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setTags(null);
    const ids = selectedKey ? selectedKey.split(",").map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
    loadTagsFor("test_drive", null, ids)
      .then((list) => {
        if (alive) setTags(list);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "Не удалось загрузить теги");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, selectedKey]);


  const selectedSet = new Set(selectedNames.map((s) => s.trim().toLowerCase()));
  // Только теги, описывающие неполадку: type = serious / non_serious.
  // По section не фильтруем — сервер возвращает общий список тегов шага
  // test_drive, и у части из них section может быть null или относиться к
  // другой категории. Категория уточняется в момент сохранения тега.
  const suggestions = (tags ?? []).filter(
    (t) =>
      (t.type === "serious" || t.type === "non_serious") &&
      !selectedSet.has(t.name.trim().toLowerCase()),
  );
  void catKey;


  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Добавить тег"
          title="Добавить тег"
          className="inline-flex items-center justify-center rounded-md border border-dashed border-white/15 text-white/60 hover:text-white hover:border-white/30 h-[22px] w-[22px]"
        >
          <Plus className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-64 max-h-72 overflow-auto p-1 bg-neutral-900 border border-white/10 text-white"
      >
        {loading && <div className="px-2 py-1.5 text-[12px] text-white/60">Загрузка…</div>}
        {error && <div className="px-2 py-1.5 text-[12px] text-rose-300">{error}</div>}
        {!loading && !error && suggestions.length === 0 && (
          <div className="px-2 py-1.5 text-[12px] text-white/50">Нет подходящих тегов</div>
        )}
        {!loading && !error && suggestions.length > 0 && (
          <ul className="space-y-0.5">
            {suggestions.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => {
                    onAdd(t);
                    // Не закрываем дропдаун: сбрасываем список и заново
                    // запрашиваем теги с учётом обновлённого selectedTagIds.
                    setTags(null);
                  }}
                  className="w-full text-left px-2 py-1 rounded text-[12px] hover:bg-white/10 flex items-center gap-2"
                >
                  <span className="flex-1 truncate">{t.name}</span>
                  <span
                    className={
                      t.type === "serious"
                        ? "text-[10px] text-rose-300"
                        : "text-[10px] text-amber-300"
                    }
                  >
                    {t.type === "serious" ? "серьёзный" : "несерьёзный"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

