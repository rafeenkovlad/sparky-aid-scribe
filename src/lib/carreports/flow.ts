import type { StepId } from "./types";

export interface StepDef {
  id: StepId;
  label: string;
  short: string;
}

export const FLOW_STEPS: readonly StepDef[] = [
  { id: "car", label: "Автомобиль", short: "Авто" },
  { id: "docs", label: "Сверка документов", short: "Документы" },
  { id: "inspection", label: "Осмотр", short: "Осмотр" },
  { id: "legalMaterials", label: "Дополнительные материалы", short: "Материалы" },
  { id: "testDrive", label: "Тест-драйв", short: "Тест" },
  { id: "result", label: "Итог", short: "Итог" },
  { id: "submit", label: "Отправка", short: "Отправка" },
] as const;


export function stepIndex(id: StepId): number {
  return FLOW_STEPS.findIndex((s) => s.id === id);
}

export function stepById(id: StepId): StepDef {
  return FLOW_STEPS.find((s) => s.id === id) ?? FLOW_STEPS[0];
}

/** Regex over normalised text to detect "advance" / "all good" intents. */
export function isConfirmAdvance(raw: string): boolean {
  const s = raw
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return false;
  return /(^|\s)(все\s+верно(\s+далее)?|далее|следующий\s+шаг|готово|пропустить|skip|next)(\s|$)/.test(
    s,
  );
}
