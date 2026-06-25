// Turns free-text into structured updates by calling AI clichés.

import { aiChatIdFor, chatCompletions } from "./aiApi";
import {
  CLICHE_CAR,
  CLICHE_CHARACTERISTICS,
  CLICHE_DOCS,
  CLICHE_INSPECTION,
  CLICHE_RESULT,
  CLICHE_TEST_DRIVE,
  DRIVE_TYPES,
  ENGINE_TYPES,
  TRANSMISSIONS,
  parseJsonResponse,
  pickEnum,
} from "./cliche";
import { decodeVin } from "./storageApi";
import { zoneById } from "./inspectionZones";
import type {
  CarStep,
  CharacteristicsStep,
  DocumentReconciliationStep,
  StepId,
  TestDriveStep,
  Thread,
} from "./types";

function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dd}`;
}

/** Run extraction for a step and return the patch + a short assistant reply. */
export async function extractForStep(
  step: StepId,
  text: string,
  thread: Thread,
): Promise<{ patch: Partial<Thread["draft"]>; reply: string }> {
  // Inspection step: AI cleans the dictated note for the current zone.
  if (step === "inspection") {
    const ins = thread.draft.inspectionStep;
    const zone = ins.currentZone ?? "body";
    const zoneLabel = zoneById(zone)?.label ?? zone;

    let cleaned = text;
    let hasIssues = false;
    try {
      const id = aiChatIdFor(thread, `extract:inspection:${zone}`);
      const res = await chatCompletions({ id, text, cliche: CLICHE_INSPECTION(zoneLabel) });
      const raw = parseJsonResponse<{ note?: string; hasIssues?: boolean }>(res.content);
      if (raw?.note && typeof raw.note === "string") cleaned = raw.note.trim();
      if (raw?.hasIssues === true) hasIssues = true;
    } catch {
      // fall through: keep raw text
    }

    const prev = ins.sectionNotes[zone] ?? "";
    const merged = prev ? `${prev}\n${cleaned}` : cleaned;
    const nextNotes = { ...ins.sectionNotes, [zone]: merged };
    return {
      patch: {
        inspectionStep: {
          ...ins,
          sectionNotes: nextNotes,
          touched: true,
          currentZone: zone,
        },
      },
      reply:
        `Записал по зоне «${zoneLabel}»${hasIssues ? " — замечания зафиксированы" : ""}:\n${cleaned}\n\n` +
        `Продолжайте по этой зоне, выберите другую кнопкой ниже, или нажмите «Всё верно, далее».`,
    };
  }

  // Test-drive: AI extracts per-system flags + tags + note.
  if (step === "testDrive") {
    const prev = thread.draft.testDriveStep ?? {};
    try {
      const id = aiChatIdFor(thread, "extract:testDrive");
      const res = await chatCompletions({ id, text, cliche: CLICHE_TEST_DRIVE });
      const raw = parseJsonResponse<Record<string, unknown>>(res.content) ?? {};
      const merged: Record<string, unknown> = { ...prev };
      const bool = (k: string) => {
        if (typeof raw[k] === "boolean") merged[k] = raw[k];
      };
      const tags = (k: string) => {
        if (Array.isArray(raw[k])) merged[k] = (raw[k] as unknown[]).filter((x) => typeof x === "string");
      };
      bool("testDriveIsIncluded");
      bool("testDriveEngineIsWorkingProperly");
      bool("testDriveTransmissionIsWorkingProperly");
      bool("testDriveSteeringWheelIsWorkingProperly");
      bool("testDriveSuspensionInDriveIsWorkingProperly");
      bool("testDriveBrakesInDriveIsWorkingProperly");
      tags("testDriveEngineTags");
      tags("testDriveTransmissionTags");
      tags("testDriveSteeringWheelTags");
      tags("testDriveSuspensionInDriveTags");
      tags("testDriveBrakesInDriveTags");
      if (typeof raw.testDriveNote === "string") {
        merged.testDriveNote = prev.notes
          ? `${prev.notes}\n${raw.testDriveNote}`
          : raw.testDriveNote;
      }
      // mirror legacy local fields for UI/preview compatibility
      merged.notDone = merged.testDriveIsIncluded === false ? true : prev.notDone;
      merged.notes =
        typeof merged.testDriveNote === "string"
          ? merged.testDriveNote
          : prev.notes
            ? `${prev.notes}\n${text}`
            : text;
      return {
        patch: { testDriveStep: merged },
        reply: summarizeTestDrive(merged),
      };
    } catch {
      const notDone = /не\s+проводил/i.test(text) ? true : prev.notDone;
      const notes = prev.notes ? `${prev.notes}\n${text}` : text;
      return {
        patch: { testDriveStep: { ...prev, notDone, notes } },
        reply: notDone
          ? "Отметил: тест-драйв не проводился. Можно идти к итогу."
          : "Записал заметки по тест-драйву. Дополните, либо «Всё верно, далее».",
      };
    }
  }

  // Result: AI splits text into summary vs verdict.
  if (step === "result") {
    const prev = thread.draft.resultStep ?? {};
    try {
      const id = aiChatIdFor(thread, "extract:result");
      const res = await chatCompletions({ id, text, cliche: CLICHE_RESULT });
      const raw = parseJsonResponse<{
        summaryInspectionNote?: string;
        resultSpecialistNote?: string;
      }>(res.content) ?? {};
      const merged = { ...prev };
      if (typeof raw.summaryInspectionNote === "string" && raw.summaryInspectionNote.trim()) {
        merged.summaryInspectionNote = prev.summaryInspectionNote
          ? `${prev.summaryInspectionNote}\n${raw.summaryInspectionNote.trim()}`
          : raw.summaryInspectionNote.trim();
      }
      if (typeof raw.resultSpecialistNote === "string" && raw.resultSpecialistNote.trim()) {
        merged.resultSpecialistNote = prev.resultSpecialistNote
          ? `${prev.resultSpecialistNote}\n${raw.resultSpecialistNote.trim()}`
          : raw.resultSpecialistNote.trim();
      }
      const bits: string[] = [];
      if (raw.summaryInspectionNote) bits.push(`📝 Резюме:\n${raw.summaryInspectionNote.trim()}`);
      if (raw.resultSpecialistNote) bits.push(`✅ Вердикт:\n${raw.resultSpecialistNote.trim()}`);
      return {
        patch: { resultStep: merged },
        reply: bits.length
          ? `${bits.join("\n\n")}\n\nДополните или нажмите «Всё верно, далее».`
          : "Зафиксировал. Дополните или нажмите «Всё верно, далее».",
      };
    } catch {
      const isRec = /рекоменд/i.test(text);
      const merged = isRec
        ? { ...prev, resultSpecialistNote: prev.resultSpecialistNote ? `${prev.resultSpecialistNote}\n${text}` : text }
        : { ...prev, summaryInspectionNote: prev.summaryInspectionNote ? `${prev.summaryInspectionNote}\n${text}` : text };
      return { patch: { resultStep: merged }, reply: "Зафиксировал. Дополните или нажмите «Всё верно, далее»." };
    }
  }



  const cliche =
    step === "car"
      ? CLICHE_CAR
      : step === "characteristics"
        ? CLICHE_CHARACTERISTICS
        : step === "docs"
          ? CLICHE_DOCS
          : null;
  if (!cliche) return { patch: {}, reply: "" };

  const id = aiChatIdFor(thread, `extract:${step}`);
  const res = await chatCompletions({ id, text, cliche });
  const raw = parseJsonResponse<Record<string, unknown>>(res.content);
  const data = raw ?? {};

  switch (step) {
    case "car": {
      const carStep: CarStep = {};
      if (typeof data.vin === "string") carStep.vin = data.vin.toUpperCase().replace(/\s+/g, "");
      if (typeof data.gosNumber === "string") carStep.gosNumber = data.gosNumber;
      if (typeof data.uriListing === "string") carStep.uriListing = data.uriListing;
      if (typeof data.mileage === "number") carStep.mileage = data.mileage;
      else if (typeof data.mileage === "string" && /^\d+$/.test(data.mileage))
        carStep.mileage = Number(data.mileage);
      if (typeof data.cityInspection === "string") carStep.cityInspection = data.cityInspection;
      if (typeof data.dateInspection === "string") carStep.dateInspection = data.dateInspection;
      if (data.unreadableVin === true) carStep.unreadableVin = true;
      if (data.visuallyMileageNotMatchCondition === true)
        carStep.visuallyMileageNotMatchCondition = true;

      // ensure a date — default today
      const existing = thread.draft.carStep.dateInspection;
      if (!carStep.dateInspection && !existing) carStep.dateInspection = todayIso();

      const reply = summarizeCar({ ...thread.draft.carStep, ...carStep });
      return { patch: { carStep: { ...thread.draft.carStep, ...carStep } }, reply };
    }
    case "characteristics": {
      const c: CharacteristicsStep = {};
      if (typeof data.brandName === "string") c.brandName = data.brandName;
      if (typeof data.modelCarName === "string") c.modelCarName = data.modelCarName;
      if (typeof data.year === "number") c.year = data.year;
      if (typeof data.engineVolume === "number") c.engineVolume = data.engineVolume;
      if (typeof data.enginePower === "number") c.enginePower = data.enginePower;
      c.engineType = pickEnum(data.engineType, ENGINE_TYPES) ?? thread.draft.characteristicsStep.engineType;
      c.transmission =
        pickEnum(data.transmission, TRANSMISSIONS) ?? thread.draft.characteristicsStep.transmission;
      c.driveType = pickEnum(data.driveType, DRIVE_TYPES) ?? thread.draft.characteristicsStep.driveType;
      if (typeof data.color === "string") c.color = data.color;
      if (typeof data.equipment === "string") c.equipment = data.equipment;
      const merged = { ...thread.draft.characteristicsStep, ...c };
      return { patch: { characteristicsStep: merged }, reply: summarizeChar(merged) };
    }
    case "docs": {
      const c: DocumentReconciliationStep = {};
      if (typeof data.ownersCount === "number") c.ownersCount = data.ownersCount;
      else if (typeof data.ownersCount === "string" && /^\d+$/.test(data.ownersCount))
        c.ownersCount = Number(data.ownersCount);
      if (typeof data.ownerFullNameMatchWithPTSOrSTS === "boolean") c.ownerFullNameMatchWithPTSOrSTS = data.ownerFullNameMatchWithPTSOrSTS;
      if (typeof data.vinOnBodyMatchWithPTSOrSTS === "boolean") c.vinOnBodyMatchWithPTSOrSTS = data.vinOnBodyMatchWithPTSOrSTS;
      if (typeof data.engineModelMatchWithPTSOrSTS === "boolean")
        c.engineModelMatchWithPTSOrSTS = data.engineModelMatchWithPTSOrSTS;
      if (typeof data.note === "string") c.note = data.note;
      const merged = { ...thread.draft.documentReconciliationStep, ...c };
      return { patch: { documentReconciliationStep: merged }, reply: summarizeDocs(merged) };
    }
    default:
      return { patch: {}, reply: "" };
  }
}

function summarizeCar(c: CarStep): string {
  const parts: string[] = ["Зафиксировал по автомобилю:"];
  if (c.vin) parts.push(`• VIN ${c.vin}`);
  if (c.unreadableVin) parts.push("• VIN нечитаемый");
  if (c.gosNumber) parts.push(`• Госномер ${c.gosNumber}`);
  if (typeof c.mileage === "number") parts.push(`• Пробег ${c.mileage.toLocaleString("ru-RU")} км`);
  if (c.cityInspection) parts.push(`• Город осмотра: ${c.cityInspection}`);
  if (c.dateInspection) parts.push(`• Дата осмотра: ${c.dateInspection}`);
  if (c.uriListing) parts.push(`• Объявление: ${c.uriListing}`);
  if (c.visuallyMileageNotMatchCondition) parts.push("• Пробег не соответствует состоянию");
  parts.push("\nЕсли всё верно — нажмите стрелку, перейдём к характеристикам.");
  return parts.join("\n");
}

function summarizeChar(c: CharacteristicsStep): string {
  const parts: string[] = ["Зафиксировал характеристики:"];
  if (c.brandName || c.modelCarName) parts.push(`• Модель: ${[c.brandName, c.modelCarName].filter(Boolean).join(" ")}`);
  if (c.year) parts.push(`• Год: ${c.year}`);
  if (c.engineVolume) parts.push(`• Объём: ${c.engineVolume} л`);
  if (c.engineType) parts.push(`• Тип двигателя: ${c.engineType}`);
  if (c.transmission) parts.push(`• КПП: ${c.transmission}`);
  if (c.driveType) parts.push(`• Привод: ${c.driveType}`);
  if (c.color) parts.push(`• Цвет: ${c.color}`);
  if (c.equipment) parts.push(`• Комплектация: ${c.equipment}`);
  parts.push("\nЕсли всё верно — стрелка дальше, к документам.");
  return parts.join("\n");
}

function summarizeTestDrive(td: Record<string, unknown> & Partial<TestDriveStep>): string {
  if (td.testDriveIsIncluded === false || td.notDone) {
    return "Отметил: тест-драйв не проводился. Можно идти к итогу.";
  }
  const parts: string[] = ["Тест-драйв зафиксирован:"];
  const sys: Array<[string, string, string]> = [
    ["testDriveEngineIsWorkingProperly", "testDriveEngineTags", "Двигатель"],
    ["testDriveTransmissionIsWorkingProperly", "testDriveTransmissionTags", "КПП"],
    ["testDriveSteeringWheelIsWorkingProperly", "testDriveSteeringWheelTags", "Рулевое"],
    ["testDriveSuspensionInDriveIsWorkingProperly", "testDriveSuspensionInDriveTags", "Подвеска"],
    ["testDriveBrakesInDriveIsWorkingProperly", "testDriveBrakesInDriveTags", "Тормоза"],
  ];
  for (const [okKey, tagsKey, label] of sys) {
    const ok = td[okKey];
    const tags = Array.isArray(td[tagsKey]) ? (td[tagsKey] as string[]) : [];
    if (ok === undefined && tags.length === 0) continue;
    const mark = ok === true ? "✅" : ok === false ? "⚠️" : "•";
    const t = tags.length ? ` — ${tags.join(", ")}` : "";
    parts.push(`${mark} ${label}${t}`);
  }
  if (typeof td.testDriveNote === "string" && td.testDriveNote) {
    parts.push(`📝 ${td.testDriveNote}`);
  }
  parts.push("\nДополните или нажмите «Всё верно, далее».");
  return parts.join("\n");
}



function summarizeDocs(c: DocumentReconciliationStep): string {
  const parts: string[] = ["Зафиксировал сверку документов:"];
  if (typeof c.ownersCount === "number") parts.push(`• Владельцев по ПТС: ${c.ownersCount}`);
  if (c.ownerFullNameMatchWithPTSOrSTS === true) parts.push("• Собственник совпадает");
  if (c.ownerFullNameMatchWithPTSOrSTS === false) parts.push("• Собственник НЕ совпадает");
  if (c.vinOnBodyMatchWithPTSOrSTS === true) parts.push("• VIN на кузове совпадает");
  if (c.vinOnBodyMatchWithPTSOrSTS === false) parts.push("• VIN на кузове НЕ совпадает");
  if (c.engineModelMatchWithPTSOrSTS === true) parts.push("• Номер двигателя совпадает");
  if (c.engineModelMatchWithPTSOrSTS === false) parts.push("• Номер двигателя НЕ совпадает");
  if (c.note) parts.push(`• Заметка: ${c.note}`);
  parts.push("\nДалее — осмотр. (доступен на следующем этапе)");
  return parts.join("\n");
}

/** Decode VIN via Storage API and merge known fields into characteristicsStep. */
export async function applyVinDecode(thread: Thread): Promise<Partial<Thread["draft"]> | null> {
  const vin = thread.draft.carStep.vin;
  if (!vin || vin.length < 11) return null;
  try {
    const r = await decodeVin(vin);
    // r is a flexible bag; pick known-ish fields.
    const c: CharacteristicsStep = { ...thread.draft.characteristicsStep };
    const get = (k: string): unknown => (r as Record<string, unknown>)[k];
    const brand = get("brandName") ?? get("brand") ?? get("make");
    const model = get("modelCarName") ?? get("model");
    const year = get("year") ?? get("modelYear");
    const vol = get("engineVolume") ?? get("displacement");
    const fuel = get("engineType") ?? get("fuel") ?? get("fuelType");
    const tx = get("transmission");
    const drv = get("driveType") ?? get("drive");
    if (typeof brand === "string" && !c.brandName) c.brandName = brand;
    if (typeof model === "string" && !c.modelCarName) c.modelCarName = model;
    if (typeof year === "number" && !c.year) c.year = year;
    if (typeof vol === "number" && !c.engineVolume) c.engineVolume = vol;
    const eng = pickEnum(fuel, ENGINE_TYPES);
    if (eng && !c.engineType) c.engineType = eng;
    const t = pickEnum(tx, TRANSMISSIONS);
    if (t && !c.transmission) c.transmission = t;
    const d = pickEnum(drv, DRIVE_TYPES);
    if (d && !c.driveType) c.driveType = d;
    return { characteristicsStep: c };
  } catch {
    return null;
  }
}
