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
];

function shortHint(s: string | null, fallback: string): string {
  const t = (s ?? fallback).replace(/^➡️\s*/, "").trim();
  return t.length > 90 ? t.slice(0, 87) + "…" : t;
}

export function collectMissingForSummary(d: ReportDraft): MissingSummaryItem[] {
  const out: MissingSummaryItem[] = [];

  for (const s of REQUIRED_STEPS) {
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
  const td = (d.testDriveStep ?? {}) as Record<string, unknown>;
  const tdSkipped = td.notDone === true || td.testDriveIsIncluded === false;
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

  // Осмотр: записи не требуются. Если раздел не заполнен записями —
  // по умолчанию считаем его «без повреждений», подтверждения не нужны.

  return out;
}
