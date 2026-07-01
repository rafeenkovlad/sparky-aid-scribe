// Required-field gate for the AI summary in the "Итог" step.
//
// Перед генерацией резюме мы проверяем, что у пользователя заполнены
// обязательные поля каждого шага. Если что-то пропущено — резюме
// не запускается, вместо этого в чат уходит сообщение со списком
// кнопок, ведущих на нужный шаг (и сразу на нужный раздел осмотра).

import { INSPECTION_SECTIONS } from "./inspectionSections";
import { sectionProgress } from "./inspectionState";
import { isStepFilled, nextMissingPrompt } from "./progress";
import type { ReportDraft, StepId } from "./types";

export interface MissingSummaryItem {
  /** короткая подпись для кнопки в чате */
  label: string;
  /** шаг, на который ведёт кнопка */
  step: StepId;
  /** snake-id раздела осмотра, если нужно подсветить конкретный раздел */
  sectionSnake?: string;
}

/** Обязательные разделы осмотра. */
const REQUIRED_INSPECTION_SECTIONS: { snake: string; label: string }[] = [
  { snake: "body", label: "Кузов" },
  { snake: "interior", label: "Салон" },
  { snake: "under_hood", label: "Подкапотное" },
  { snake: "glass", label: "Остекление" },
];

/** Шаги (кроме осмотра), без которых резюме готовить нельзя. */
const REQUIRED_STEPS: { id: StepId; label: string }[] = [
  { id: "car", label: "Автомобиль" },
  { id: "docs", label: "Документы" },
  { id: "testDrive", label: "Тест-драйв" },
  { id: "result", label: "Итог" },
];

function shortHint(s: string | null, fallback: string): string {
  const t = (s ?? fallback).replace(/^➡️\s*/, "").trim();
  return t.length > 90 ? t.slice(0, 87) + "…" : t;
}

/** Тест-драйв считается пропущенным, если явно отмечено «не проводился»
 *  ЛЮБЫМ способом: флаг notDone, testDriveIsIncluded === false, или текст
 *  заметки содержит «не проводил…». В этом случае шаг считаем заполненным. */
function isTestDriveSkipped(td: Record<string, unknown>): boolean {
  if (td.notDone === true) return true;
  if (td.testDriveIsIncluded === false) return true;
  const noteRe = /не\s+проводил/i;
  const notes = typeof td.notes === "string" ? td.notes : "";
  const tdNote = typeof td.testDriveNote === "string" ? td.testDriveNote : "";
  return noteRe.test(notes) || noteRe.test(tdNote);
}

export function collectMissingForSummary(
  d: ReportDraft,
  opts: { includeResult?: boolean } = {},
): MissingSummaryItem[] {
  const out: MissingSummaryItem[] = [];
  const td = (d.testDriveStep ?? {}) as Record<string, unknown>;
  const tdSkipped = isTestDriveSkipped(td);

  for (const s of REQUIRED_STEPS) {
    // Шаг «Итог» (резюме/вердикт) проверяем только при финальной выгрузке,
    // а не при генерации самого резюме — иначе получится замкнутый круг.
    if (s.id === "result" && !opts.includeResult) continue;
    // Тест-драйв, отмеченный как «не проводился», считаем заполненным.
    if (s.id === "testDrive" && tdSkipped) continue;
    if (!isStepFilled(s.id, d)) {
      out.push({
        label: `${s.label}: ${shortHint(nextMissingPrompt(s.id, d), "заполните обязательные поля")}`,
        step: s.id,
      });
    }
  }

  // Тест-драйв: если какой-то узел отмечен как неисправный (false), но к нему
  // не выбрано ни одного тега — бэкенд вернёт ошибку «необходимо указать теги».
  // Подсказываем это сразу, до отправки.
  if (!tdSkipped) {
    const subsystems: Array<{ okKey: string; tagsKey: string; label: string }> = [
      { okKey: "testDriveEngineIsWorkingProperly", tagsKey: "testDriveEngineTags", label: "двигатель" },
      { okKey: "testDriveTransmissionIsWorkingProperly", tagsKey: "testDriveTransmissionTags", label: "трансмиссия" },
      { okKey: "testDriveSteeringWheelIsWorkingProperly", tagsKey: "testDriveSteeringWheelTags", label: "руль" },
      { okKey: "testDriveSuspensionInDriveIsWorkingProperly", tagsKey: "testDriveSuspensionInDriveTags", label: "подвеска" },
      { okKey: "testDriveBrakesInDriveIsWorkingProperly", tagsKey: "testDriveBrakesInDriveTags", label: "тормоза" },
    ];
    for (const s of subsystems) {
      const tags = td[s.tagsKey];
      const tagsLen = Array.isArray(tags) ? tags.length : 0;
      if (td[s.okKey] === false && tagsLen === 0) {
        out.push({
          label: `Тест-драйв: укажите теги для «${s.label}» (отмечено как неисправно)`,
          step: "testDrive",
        });
      }
    }
  }

  // Осмотр: в обязательных разделах должны быть медиафайлы (хотя бы 1 фото/видео).
  // Записи (теги, заметки) не обязательны — пустой раздел трактуется как «без повреждений».
  const ins = d.inspectionStep;
  for (const s of REQUIRED_INSPECTION_SECTIONS) {
    const hasMedia = (ins?.photos ?? []).some((p) => p.section === s.snake);
    if (!hasMedia) {
      out.push({
        label: `Осмотр: добавьте фото/видео в раздел «${s.label}»`,
        step: "inspection",
        sectionSnake: s.snake,
      });
    }
  }

  return out;
}

/**
 * Полный список обязательных областей — используется как fallback,
 * когда бэкенд вернул общую ошибку про незаполненные поля, но по тексту
 * невозможно определить конкретный узел. Пользователь всё равно видит,
 * что именно надо проверить, а не расплывчатое «во всех вкладках».
 */
export function listAllRequiredForSummary(): MissingSummaryItem[] {
  const out: MissingSummaryItem[] = [
    { label: "Автомобиль: марка, модель, VIN, пробег, госномер, город, дата осмотра", step: "car" },
    { label: "Документы: ПТС, СТС, собственник", step: "docs" },
    { label: "Тест-драйв: двигатель, трансмиссия, руль, подвеска, тормоза (или «не проводился»)", step: "testDrive" },
    { label: "Итог: резюме и вердикт", step: "result" },
  ];
  for (const s of REQUIRED_INSPECTION_SECTIONS) {
    out.push({
      label: `Осмотр: раздел «${s.label}» (фото/видео + отметки)`,
      step: "inspection",
      sectionSnake: s.snake,
    });
  }
  return out;
}



