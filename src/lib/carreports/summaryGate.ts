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

  // Осмотр: обязательны разделы кузов / салон / подкапотное / остекление.
  const ins = d.inspectionStep;
  for (const req of REQUIRED_INSPECTION_SECTIONS) {
    const sec = INSPECTION_SECTIONS.find((x) => x.snake === req.snake);
    if (!sec) continue;
    const p = sectionProgress(ins, sec);
    if (p.filled === 0) {
      out.push({
        label: `Осмотр · ${req.label} — нет ни одной записи`,
        step: "inspection",
        sectionSnake: req.snake,
      });
    }
  }

  return out;
}
