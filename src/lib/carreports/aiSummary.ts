// AI-powered report summary generator.
// Builds a Russian prompt from the current draft and calls carreports
// AiQueue.ChatCompletions to produce a concise, human-readable conclusion.

import { chatCompletions, aiChatIdFor } from "./aiApi";
import { INSPECTION_ZONES, zoneById } from "./inspectionZones";
import type { ReportDraft, Thread } from "./types";

export interface GeneratedSummary {
  /** main text — goes into resultStep.summaryInspectionNote */
  summary: string;
  /** specialist verdict line — goes into resultStep.resultSpecialistNote */
  verdict?: string;
  model: string;
  latencyMs: number;
}

const SYSTEM_PROMPT_RU = [
  "Ты — автоэксперт carreports. На основе черновых заметок осмотра",
  "сформируй короткое профессиональное резюме отчёта для покупателя.",
  "Стиль: деловой, без воды, без эмодзи. 5–9 предложений.",
  "В конце добавь ОТДЕЛЬНОЙ строкой:",
  "ВЕРДИКТ: <одна фраза — рекомендация или отказ, при необходимости с торгом>.",
].join(" ");

function summarizeDraft(d: ReportDraft): string {
  const lines: string[] = [];
  const c = d.carStep;
  const ch = d.characteristicsStep;
  const doc = d.documentReconciliationStep;

  if (ch.brandName || ch.modelCarName || ch.year) {
    lines.push(
      `Автомобиль: ${[ch.brandName, ch.modelCarName, ch.year].filter(Boolean).join(" ")}.`,
    );
  }
  if (c.vin) lines.push(`VIN: ${c.vin}.`);
  if (c.gosNumber) lines.push(`Гос. номер: ${c.gosNumber}.`);
  if (c.mileage) lines.push(`Пробег: ${c.mileage.toLocaleString("ru-RU")} км.`);
  if (c.visuallyMileageNotMatchCondition)
    lines.push("Визуально состояние не соответствует пробегу.");

  if (ch.engineType || ch.engineVolume || ch.enginePower) {
    lines.push(
      `Двигатель: ${[ch.engineType, ch.engineVolume && `${ch.engineVolume} л`, ch.enginePower && `${ch.enginePower} л.с.`].filter(Boolean).join(", ")}.`,
    );
  }
  if (ch.transmission) lines.push(`Трансмиссия: ${ch.transmission}.`);
  if (ch.driveType) lines.push(`Привод: ${ch.driveType}.`);

  if (doc.ownersCount != null) lines.push(`Владельцев по ПТС: ${doc.ownersCount}.`);
  if (doc.ownerFullNameMatchWithPTSOrSTS === false) lines.push("Текущий владелец не совпадает с ПТС.");
  if (doc.vinOnBodyMatchWithPTSOrSTS === false) lines.push("VIN на кузове не совпадает с документами.");
  if (doc.engineModelMatchWithPTSOrSTS === false) lines.push("Номер двигателя не совпадает с документами.");
  if (doc.note) lines.push(`Документы — заметка: ${doc.note}`);

  lines.push("");
  lines.push("Результаты осмотра по зонам:");
  for (const z of INSPECTION_ZONES) {
    const note = d.inspectionStep.sectionNotes[z.id]?.trim();
    const photos = d.inspectionStep.photos.filter((p) => p.section === z.id).length;
    if (!note && !photos) continue;
    lines.push(
      `— ${z.label}${photos ? ` (фото: ${photos})` : ""}: ${note || "без заметок"}`,
    );
  }

  if (d.testDriveStep.notDone) {
    lines.push("");
    lines.push("Тест-драйв не проводился.");
  } else if (d.testDriveStep.notes?.trim()) {
    lines.push("");
    lines.push(`Тест-драйв: ${d.testDriveStep.notes.trim()}`);
  }

  if (d.resultStep.summaryInspectionNote?.trim()) {
    lines.push("");
    lines.push(`Предыдущее резюме специалиста: ${d.resultStep.summaryInspectionNote.trim()}`);
  }
  if (d.resultStep.resultSpecialistNote?.trim()) {
    lines.push(`Предыдущий вердикт: ${d.resultStep.resultSpecialistNote.trim()}`);
  }

  return lines.join("\n");
}

function splitVerdict(text: string): { summary: string; verdict?: string } {
  const m = text.match(/^\s*ВЕРДИКТ\s*:\s*(.+)$/im);
  if (!m) return { summary: text.trim() };
  const verdict = m[1].trim();
  const summary = text.replace(m[0], "").trim();
  return { summary, verdict };
}

export async function generateSummary(thread: Thread): Promise<GeneratedSummary> {
  const id = aiChatIdFor(thread, "summary");
  const draftText = summarizeDraft(thread.draft);
  const userText =
    SYSTEM_PROMPT_RU +
    "\n\n---\n" +
    "Черновые данные осмотра:\n" +
    draftText +
    "\n---\nСоставь резюме и вердикт.";

  const r = await chatCompletions({
    id,
    text: userText,
    cliche: "",
  });
  const raw = (r.content ?? "").trim();
  if (!raw) throw new Error("AI вернул пустой ответ");
  const { summary, verdict } = splitVerdict(raw);
  return { summary, verdict, model: r.model, latencyMs: r.latencyMs };
}

// Note: zoneById re-exported for callers that want labels.
export { zoneById };
