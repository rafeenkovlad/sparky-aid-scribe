// AI-powered report summary generator.
//
// Собирает ВСЕ чаты по этому отчёту (id хранятся на бэкенде ограниченное
// время) методом AiQueue.GetChatHistories, склеивает их в единый
// транскрипт и просит модель в роли автоэксперта с 30-летним стажем
// сформировать итоговое резюме + вердикт.

import { chatCompletions, aiChatIdFor, getChatHistories, type ChatHistoryItem } from "./aiApi";
import { INSPECTION_ZONES, zoneById } from "./inspectionZones";
import type { ReportDraft, Thread } from "./types";

export interface GeneratedSummary {
  /** main text — goes into resultStep.summaryInspectionNote */
  summary: string;
  /** specialist verdict line — goes into resultStep.resultSpecialistNote */
  verdict?: string;
  model: string;
  latencyMs: number;
  /** how many chat histories were fetched from backend */
  chatsUsed: number;
}

const SUMMARY_CLICHE = `Ты — независимый автоэксперт carreports с 30-летним
стажем подбора и диагностики автомобилей с пробегом. Работаешь от лица
покупателя: трезво, без рекламы продавца, без воды и без эмодзи.

Тебе дают: (1) структурированный черновик отчёта по шагам и (2) полные
транскрипты всех ИИ-чатов, которые велись во время осмотра (распознавание
фото, классификация по элементам, переформулировки заметок, нормализация
тегов и т.п.). В транскриптах могут быть служебные JSON-ответы — извлекай
из них факты (зона, элемент, теги, серьёзность, заметки), а сами JSON в
ответе НЕ цитируй.

Сформируй итоговое резюме для покупателя:
— 6–10 предложений деловым языком;
— перечисли ключевые находки по группам: кузов и ЛКП, салон, техника
  (двигатель/трансмиссия/подвеска), документы, поведение на тест-драйве;
— отдельно выдели СЕРЬЁЗНЫЕ дефекты (коррозия сквозная, перекрас, замена
  силового, ДТП, неисправности агрегатов, расхождения с ПТС/СТС);
— мелкие косметические замечания — одной строкой обобщённо;
— если каких-то данных нет — не выдумывай, просто пропусти.

В САМОМ КОНЦЕ добавь ОТДЕЛЬНОЙ строкой:
ВЕРДИКТ: <одна фраза — рекомендую к покупке / рекомендую с торгом N руб /
не рекомендую — с короткой причиной>.

Отвечай только текстом резюме на русском. Без markdown-заголовков и
без префиксов вроде «Резюме:».`;

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

  return lines.join("\n");
}

function splitVerdict(text: string): { summary: string; verdict?: string } {
  const m = text.match(/^\s*ВЕРДИКТ\s*:\s*(.+)$/im);
  if (!m) return { summary: text.trim() };
  const verdict = m[1].trim();
  const summary = text.replace(m[0], "").trim();
  return { summary, verdict };
}

const MAX_TRANSCRIPT_CHARS = 60_000;

function formatHistories(thread: Thread, histories: ChatHistoryItem[]): string {
  // обратный индекс id → ключ назначения чата (что именно этот id делал)
  const idToKey = new Map<number, string>();
  for (const [key, id] of Object.entries(thread.aiChatIds)) idToKey.set(id, key);

  const parts: string[] = [];
  let total = 0;
  for (const h of histories) {
    const purpose = idToKey.get(h.id) ?? `chat:${h.id}`;
    parts.push(`\n=== Чат ${h.id} · ${purpose} ===`);
    for (const m of h.messages ?? []) {
      const role = (m.role ?? "?").toString();
      const text = (m.content ?? m.text ?? "").toString().trim();
      if (!text) continue;
      const line = `[${role}] ${text}`;
      parts.push(line);
      total += line.length;
      if (total > MAX_TRANSCRIPT_CHARS) {
        parts.push("…(транскрипт обрезан по лимиту)");
        return parts.join("\n");
      }
    }
  }
  return parts.join("\n");
}

export async function generateSummary(thread: Thread): Promise<GeneratedSummary> {
  const ids = Object.values(thread.aiChatIds ?? {}).filter(
    (n): n is number => typeof n === "number" && n > 0,
  );

  // Подтягиваем транскрипты всех чатов отчёта. Если бэкенд их уже
  // выселил по TTL — не падаем, идём с одним черновиком.
  let histories: ChatHistoryItem[] = [];
  try {
    histories = await getChatHistories(ids);
  } catch {
    histories = [];
  }

  const draftText = summarizeDraft(thread.draft);
  const transcript = histories.length ? formatHistories(thread, histories) : "(чатов нет)";

  const userText =
    "СТРУКТУРИРОВАННЫЙ ЧЕРНОВИК ОТЧЁТА:\n" +
    draftText +
    "\n\nТРАНСКРИПТЫ ВСЕХ ИИ-ЧАТОВ ПО ЭТОМУ ОТЧЁТУ:\n" +
    transcript +
    "\n\nСформируй итоговое резюме и вердикт по правилам выше.";

  const summaryChatId = aiChatIdFor(thread, "summary");
  const r = await chatCompletions({
    id: summaryChatId,
    text: userText,
    cliche: SUMMARY_CLICHE,
  });
  const raw = (r.content ?? "").trim();
  if (!raw) throw new Error("AI вернул пустой ответ");
  const { summary, verdict } = splitVerdict(raw);
  return {
    summary,
    verdict,
    model: r.model,
    latencyMs: r.latencyMs,
    chatsUsed: histories.length,
  };
}

export { zoneById };
