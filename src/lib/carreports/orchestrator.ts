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
  CLICHE_ASK,
  CLICHE_INSPECTION_ROUTE,
} from "./cliche";

import { decodeVin } from "./storageApi";
import {
  INSPECTION_SECTIONS,
  ZONE_TO_SECTION,
  defaultElementIdFor,
  getSection,
  findingKey,
  type SectionSnake,
} from "./inspectionSections";

import { loadSectionTags, findTagId, addUserTag, type UserTag } from "./inspectionTags";

/**
 * Резолвит имя тега в id: сначала ищет в каталоге, при отсутствии —
 * сразу создаёт пользовательский тег через Storage.AddUserTag и
 * подмешивает его в локальный каталог, чтобы следующий вызов в той же
 * сессии нашёл его без обращения к серверу.
 */
async function resolveOrCreateTagId(
  catalogue: UserTag[],
  section: import("./inspectionSections").SectionSnake,
  name: string,
  severity: "serious" | "non_serious",
): Promise<number | null> {
  const hit = findTagId(catalogue, name);
  if (hit) return hit.id;
  const created = await addUserTag(section, name, severity);
  if (created?.id) {
    catalogue.push(created);
    return created.id;
  }
  return null;
}
import type {
  CarStep,
  CharacteristicsStep,
  ChatChip,
  DocumentReconciliationStep,
  InspectionElementFinding,
  MessageAttachment,
  PendingTagName,
  StepId,
  TestDriveStep,
  Thread,
} from "./types";
import { optionalHintSentence, remainingFieldLabels, nextMissingPrompt } from "./progress";

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
  opts?: {
    onClarify?: (entry: { kind: "ai" | "web"; label: string; detail?: string }) => void;
  },
): Promise<{
  patch: Partial<Thread["draft"]>;
  reply: string;
  attachments?: MessageAttachment[];
  chips?: ChatChip[];
}> {
  // Inspection step: AI splits the dictated note into per-element findings,
  // resolves tag names against the server section catalogue, stores both the
  // legacy free-form note and structured findings.
  if (step === "inspection") {
    const ins = thread.draft.inspectionStep;
    // Resolve cursor → active section + element. Legacy fallback via ZONE_TO_SECTION.
    let sectionSnake: SectionSnake =
      (ins.currentSection as SectionSnake | undefined) ??
      (ins.currentZone ? ZONE_TO_SECTION[ins.currentZone] : undefined) ??
      INSPECTION_SECTIONS[0].snake;
    let section = getSection(sectionSnake) ?? INSPECTION_SECTIONS[0];
    let elementId = ins.currentElementId ?? section.elements[0].id;
    let activeElement =
      section.elements.find((e) => e.id === elementId) ?? section.elements[0];

    // ─── Маршрутизация заметки по разделам/элементам ─────────────────────
    // По свободному тексту эксперта пытаемся понять, к какому разделу/
    // элементу относится сообщение. Если смысла нет — отвечаем «не поняла»
    // и НЕ трогаем findings.
    try {
      const routeId = aiChatIdFor(thread, "route:inspection");
      const routeRes = await chatCompletions({
        id: routeId,
        text,
        cliche: CLICHE_INSPECTION_ROUTE(
          INSPECTION_SECTIONS.map((s) => ({
            snake: s.snake,
            label: s.label,
            elements: s.elements.map((el) => ({ id: el.id, label: el.label })),
          })),
          {
            sectionSnake,
            sectionLabel: section.label,
            elementId: activeElement.id,
            elementLabel: activeElement.label,
          },
        ),
      });
      const route = parseJsonResponse<{
        section?: string | null;
        elementId?: string | null;
        confidence?: number;
        noMatch?: boolean;
        bulkGeneralCondition?: boolean;
        reason?: string;
      }>(routeRes.content);
      const confidence =
        typeof route?.confidence === "number" ? route.confidence : 0;
      if (route?.noMatch === true || confidence < 0.25) {
        return {
          patch: {},
          reply:
            "🤔 Не поняла, к какому разделу осмотра это относится. " +
            "Сформулируйте, пожалуйста, иначе — или выберите раздел " +
            "вручную внизу.",
        };
      }
      if (route?.section) {
        const picked = getSection(route.section as SectionSnake);
        if (picked) {
          section = picked;
          sectionSnake = picked.snake;
          const pickedEl =
            (route.elementId &&
              picked.elements.find((el) => el.id === route.elementId)) ||
            picked.elements.find((el) => el.id === "generalCondition") ||
            picked.elements[0];
          activeElement = pickedEl;
          elementId = pickedEl.id;
        }
      }

      // ─── Bulk: «все фото раздела — общее состояние» ───────────────────
      if (route?.bulkGeneralCondition === true) {
        const generalEl =
          section.elements.find((el) => el.id === "generalCondition") ??
          section.elements[section.elements.length - 1];
        const nextPhotos = ins.photos.map((p) =>
          p.section === sectionSnake
            ? { ...p, elementId: generalEl.id }
            : p,
        );
        // Перевешиваем существующие per-element findings раздела на
        // generalCondition, объединяя заметки/теги.
        const prev = ins.findings ?? {};
        const next: Record<string, InspectionElementFinding> = {};
        const genKey = findingKey(sectionSnake, generalEl.id);
        const gen: InspectionElementFinding = prev[genKey]
          ? { ...prev[genKey] }
          : { section: sectionSnake, elementId: generalEl.id };
        const sIds = new Set<number>(gen.seriousDamageTagIds ?? []);
        const nsIds = new Set<number>(gen.noSeriousDamageTagIds ?? []);
        const pend: PendingTagName[] = [...(gen.pendingTagNames ?? [])];
        const notes: string[] = gen.note ? [gen.note] : [];
        for (const [key, f] of Object.entries(prev)) {
          if (!key.startsWith(`${sectionSnake}.`) || key === genKey) {
            if (key !== genKey) next[key] = f;
            continue;
          }
          for (const id of f.seriousDamageTagIds ?? []) sIds.add(id);
          for (const id of f.noSeriousDamageTagIds ?? []) nsIds.add(id);
          for (const p of f.pendingTagNames ?? []) {
            if (!pend.some((x) => x.name === p.name)) pend.push(p);
          }
          if (f.note && !notes.includes(f.note)) notes.push(f.note);
        }
        const photoCount = nextPhotos.filter(
          (p) => p.section === sectionSnake,
        ).length;
        next[genKey] = {
          section: sectionSnake,
          elementId: generalEl.id,
          ...(sIds.size || nsIds.size || pend.length
            ? { noDamage: false }
            : gen.noDamage !== undefined
              ? { noDamage: gen.noDamage }
              : {}),
          ...(sIds.size ? { seriousDamageTagIds: [...sIds] } : {}),
          ...(nsIds.size ? { noSeriousDamageTagIds: [...nsIds] } : {}),
          ...(pend.length ? { pendingTagNames: pend } : {}),
          ...(notes.length ? { note: notes.join("\n") } : {}),
        };
        return {
          patch: {
            inspectionStep: {
              ...ins,
              photos: nextPhotos,
              findings: next,
              touched: true,
              currentSection: sectionSnake,
              currentElementId: generalEl.id,
            },
          },
          reply:
            `📌 Раздел «${section.label}»: «${generalEl.label}» теперь стоит ` +
            `на ${photoCount === 1 ? "1 фото" : `${photoCount} фото`} раздела. ` +
            `Заметки и теги от элементов раздела объединены в общее состояние.`,
        };
      }
    } catch {
      // если роутер упал — используем текущий раздел/элемент как раньше.
    }

    // Fetch tags catalogue for this section (cached); never throws.
    const tagCatalogue = await loadSectionTags(sectionSnake);

    // Tell the AI to default to the currently focused element.
    const focusedText =
      `Активный элемент: ${activeElement.id} — «${activeElement.label}» ` +
      `(раздел «${section.label}»). Если эксперт явно не назвал другой элемент ` +
      `из этого раздела — пиши находку для активного.\n\n${text}`;

    let cleaned = text;
    let aiFindings: Array<{
      elementId?: string;
      noDamage?: boolean;
      seriousTags?: unknown;
      nonSeriousTags?: unknown;
      note?: string;
    }> = [];
    try {
      const id = aiChatIdFor(thread, `extract:inspection:${sectionSnake}`);
      const res = await chatCompletions({
        id,
        text: focusedText,
        cliche: CLICHE_INSPECTION(
          activeElement.label,
          section.label,
          section.elements.map((el) => ({ id: el.id, label: el.label })),
          tagCatalogue.map((t) => ({ name: t.name, type: t.type })),
        ),
      });
      const raw = parseJsonResponse<{
        note?: string;
        findings?: typeof aiFindings;
      }>(res.content);
      if (raw?.note && typeof raw.note === "string") cleaned = raw.note.trim();
      if (Array.isArray(raw?.findings)) aiFindings = raw!.findings!;
    } catch {
      /* keep raw text */
    }

    // If AI returned nothing usable — treat the raw text as a note on the active element.
    if (!aiFindings.length && text.trim()) {
      aiFindings = [{ elementId, note: text.trim() }];
    }

    // Resolve element findings: validate elementId, map tag names → server IDs.
    const elementIds = new Set(section.elements.map((el) => el.id));
    const prevFindings = ins.findings ?? {};
    const nextFindings: Record<string, InspectionElementFinding> = { ...prevFindings };
    const touchedElements: string[] = [];

    for (const f of aiFindings) {
      const eid = typeof f.elementId === "string" && elementIds.has(f.elementId)
        ? f.elementId
        : elementId; // fallback to active element
      const key = findingKey(sectionSnake, eid);
      const base = nextFindings[key] ?? { section: sectionSnake, elementId: eid };

      let noDamage = typeof f.noDamage === "boolean" ? f.noDamage : base.noDamage;

      const sNames = Array.isArray(f.seriousTags)
        ? (f.seriousTags as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      const nsNames = Array.isArray(f.nonSeriousTags)
        ? (f.nonSeriousTags as unknown[]).filter((x): x is string => typeof x === "string")
        : [];

      const sIds = new Set(base.seriousDamageTagIds ?? []);
      const nsIds = new Set(base.noSeriousDamageTagIds ?? []);
      const pending: PendingTagName[] = [...(base.pendingTagNames ?? [])];

      for (const name of sNames) {
        const t = findTagId(tagCatalogue, name);
        if (t) sIds.add(t.id);
        else if (!pending.some((p) => p.name === name)) pending.push({ name, severity: "serious" });
      }
      for (const name of nsNames) {
        const t = findTagId(tagCatalogue, name);
        if (t) nsIds.add(t.id);
        else if (!pending.some((p) => p.name === name))
          pending.push({ name, severity: "non_serious" });
      }

      const nextNote = f.note?.trim()
        ? base.note
          ? `${base.note}\n${f.note.trim()}`
          : f.note.trim()
        : base.note;

      // Защита от противоречия: noDamage=true несовместим с наличием тегов
      // (как серверных, так и pending). Сбрасываем в false, как это делают
      // analyzeInspectionPhoto/Note в финальном маппинге.
      if (noDamage === true && (sIds.size || nsIds.size || pending.length)) {
        noDamage = false;
      }


      nextFindings[key] = {
        section: sectionSnake,
        elementId: eid,
        ...(noDamage !== undefined ? { noDamage } : {}),
        ...(sIds.size ? { seriousDamageTagIds: [...sIds] } : {}),
        ...(nsIds.size ? { noSeriousDamageTagIds: [...nsIds] } : {}),
        ...(pending.length ? { pendingTagNames: pending } : {}),
        ...(nextNote ? { note: nextNote } : {}),
      };
      touchedElements.push(eid);
    }

    // Build a human-readable reply that lists per-element findings touched now.
    const lines: string[] = [];
    const idToName = new Map(tagCatalogue.map((t) => [t.id, t.name]));
    const seen = new Set<string>();
    for (const eid of touchedElements) {
      if (seen.has(eid)) continue;
      seen.add(eid);
      const f = nextFindings[findingKey(sectionSnake, eid)];
      const el = section.elements.find((x) => x.id === eid);
      if (!f || !el) continue;
      const mark = f.noDamage === true ? "✅" : f.noDamage === false ? "⚠️" : "•";
      const tags: string[] = [];
      for (const id of f.seriousDamageTagIds ?? []) {
        const n = idToName.get(id);
        if (n) tags.push(`❗${n}`);
      }
      for (const id of f.noSeriousDamageTagIds ?? []) {
        const n = idToName.get(id);
        if (n) tags.push(n);
      }
      for (const p of f.pendingTagNames ?? []) {
        tags.push(`${p.severity === "serious" ? "❗" : ""}${p.name}*`);
      }
      const tagPart = tags.length ? ` — ${tags.join(", ")}` : "";
      const notePart = f.note ? ` · ${f.note}` : "";
      lines.push(`${mark} ${el.label}${tagPart}${notePart}`);
    }
    const head = lines.length
      ? `Записал по разделу «${section.label}»:\n${lines.join("\n")}`
      : cleaned;
    const tail = lines.some((l) => l.includes("*"))
      ? "\n\n* — теги добавятся локально и поедут при отправке как pendingTagNames."
      : "";

    return {
      patch: {
        inspectionStep: {
          ...ins,
          findings: nextFindings,
          touched: true,
          currentSection: sectionSnake,
          currentElementId: elementId,
        },
      },
      reply: head + tail,
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
        chips: testDriveChips(),
      };
    } catch {
      const notDone = /не\s+проводил/i.test(text) ? true : prev.notDone;
      const notes = prev.notes ? `${prev.notes}\n${text}` : text;
      return {
        patch: { testDriveStep: { ...prev, notDone, notes } },
        reply: notDone
          ? "Отметил: тест-драйв не проводился."
          : "Записал заметки по тест-драйву.",
        chips: testDriveChips(),
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
        reply: bits.length ? bits.join("\n\n") : "Зафиксировал.",
        chips: resultChips(),
      };
    } catch {
      const isRec = /рекоменд/i.test(text);
      const merged = isRec
        ? { ...prev, resultSpecialistNote: prev.resultSpecialistNote ? `${prev.resultSpecialistNote}\n${text}` : text }
        : { ...prev, summaryInspectionNote: prev.summaryInspectionNote ? `${prev.summaryInspectionNote}\n${text}` : text };
      return { patch: { resultStep: merged }, reply: "Зафиксировал.", chips: resultChips() };
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
      if (typeof data.gosNumber === "string") carStep.gosNumber = data.gosNumber.toUpperCase().replace(/\s+/g, " ").trim();
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

      // Эксперт может прямо на шаге «Автомобиль» назвать марку/модель/поколение
      // («волксваген тигуан 2 версия»). Если так — сразу пишем в characteristicsStep
      // и подбираем по каталогу, чтобы не дублировать ввод на следующем шаге.
      const charPatch: CharacteristicsStep = { ...thread.draft.characteristicsStep };
      let charTouched = false;

      // Combined step also extracts engine/transmission/drive/color/equipment.
      try {
        const charId = aiChatIdFor(thread, "extract:characteristics");
        const charRes = await chatCompletions({ id: charId, text, cliche: CLICHE_CHARACTERISTICS });
        const charData = parseJsonResponse<Record<string, unknown>>(charRes.content) ?? {};
        if (typeof charData.engineVolume === "number") {
          charPatch.engineVolume = charData.engineVolume;
          charTouched = true;
        }
        if (typeof charData.enginePower === "number") {
          charPatch.enginePower = charData.enginePower;
          charTouched = true;
        }
        const et = pickEnum(charData.engineType, ENGINE_TYPES);
        if (et) { charPatch.engineType = et; charTouched = true; }
        const tr = pickEnum(charData.transmission, TRANSMISSIONS);
        if (tr) { charPatch.transmission = tr; charTouched = true; }
        const dr = pickEnum(charData.driveType, DRIVE_TYPES);
        if (dr) { charPatch.driveType = dr; charTouched = true; }
        if (typeof charData.color === "string" && charData.color.trim()) {
          charPatch.color = charData.color.trim();
          charTouched = true;
        }
        if (typeof charData.equipment === "string" && charData.equipment.trim()) {
          charPatch.equipment = charData.equipment.trim();
          charTouched = true;
        }
        // brand/model/year/generationHint already extracted by CLICHE_CAR below
        // but if CAR didn't catch them, allow CHARACTERISTICS to fill in.
        if (typeof charData.brandName === "string" && charData.brandName.trim() && !data.brandName) {
          (data as Record<string, unknown>).brandName = charData.brandName.trim();
        }
        if (typeof charData.modelCarName === "string" && charData.modelCarName.trim() && !data.modelCarName) {
          (data as Record<string, unknown>).modelCarName = charData.modelCarName.trim();
        }
        if (typeof charData.year === "number" && !data.year) {
          (data as Record<string, unknown>).year = charData.year;
        }
        if (typeof charData.generationHint === "string" && !data.generationHint) {
          (data as Record<string, unknown>).generationHint = charData.generationHint;
        }
      } catch {
        /* ignore — partial extraction is fine */
      }

      if (typeof data.brandName === "string" && data.brandName.trim()) {
        charPatch.brandName = data.brandName.trim();
        charTouched = true;
      }
      if (typeof data.modelCarName === "string" && data.modelCarName.trim()) {
        charPatch.modelCarName = data.modelCarName.trim();
        charTouched = true;
      }
      if (typeof data.year === "number") {
        charPatch.year = data.year;
        charTouched = true;
      } else if (typeof data.year === "string" && /^\d{4}$/.test(data.year)) {
        charPatch.year = Number(data.year);
        charTouched = true;
      }
      let generationHint =
        typeof data.generationHint === "string" ? data.generationHint : undefined;

      // Если пользователь явно говорит про поколение/рестайлинг («выбери поколение 2»,
      // «второе поколение, рестайлинг 1», «II поколение») — это уточнение.
      const mentionsGen = /поколени[еяюйя]|рестайлинг/i.test(text);
      const prevChar = thread.draft.characteristicsStep;
      // Подхватываем ранее сохранённый pending hint, если он есть.
      const pendingHint = prevChar.pendingGenerationHint || undefined;
      if (mentionsGen) {
        if (!generationHint) generationHint = text;
        if (!charPatch.brandName && prevChar.brandName) {
          charPatch.brandName = prevChar.brandName;
          charTouched = true;
        }
        if (!charPatch.modelCarName && prevChar.modelCarName) {
          charPatch.modelCarName = prevChar.modelCarName;
          charTouched = true;
        }
        if (!charPatch.year && prevChar.year) {
          charPatch.year = prevChar.year;
          charTouched = true;
        }
        if (charPatch.brandName && charPatch.modelCarName) charTouched = true;
      }
      if (!generationHint && pendingHint) generationHint = pendingHint;

      // Уточняющий шаг: эксперт назвал только модель («тигуан 2 рестайлинг 1»),
      // марка не извлечена ни сейчас, ни в черновике. Делаем follow-up запрос
      // к нейронке, чтобы определить марку по имени модели (с веб-фолбэком).
      const clarifyLog: Array<{ kind: "ai" | "web"; label: string; detail?: string }> = [];
      if (!charPatch.brandName && charPatch.modelCarName) {
        try {
          const { inferBrandFromModelName } = await import("./carCatalog");
          const inferred = await inferBrandFromModelName(
            charPatch.modelCarName,
            text,
            thread,
            opts?.onClarify,
          );
          if (inferred?.brandName) {
            charPatch.brandName = inferred.brandName;
            if (inferred.modelCarName) charPatch.modelCarName = inferred.modelCarName;
            charTouched = true;
            clarifyLog.push(...inferred.trace);
          }
        } catch {
          /* ignore — поведение деградирует к ручному уточнению ниже */
        }
      }

      // Случай: пользователь назвал поколение/рестайлинг, но марка/модель
      // не известны ни сейчас, ни в черновике. Сохраняем hint, просим модель.
      if (
        mentionsGen &&
        (!charPatch.brandName || !charPatch.modelCarName)
      ) {
        const mergedCarEarly = { ...thread.draft.carStep, ...carStep };
        return {
          patch: {
            carStep: mergedCarEarly,
            characteristicsStep: {
              ...charPatch,
              pendingGenerationHint: generationHint ?? text,
            },
          },
          reply:
            "Поняла, нужно выбрать поколение/рестайлинг — но сначала укажите марку и модель автомобиля " +
            "(например «Volkswagen Tiguan» или «BMW X5»). Я сохранила ваш выбор и применю его, как только " +
            "появится модель.",
        };
      }


      let catalogNote = "";
      const attachments: MessageAttachment[] = [];
      const chips: ChatChip[] = [];
      if (charTouched && charPatch.brandName && charPatch.modelCarName) {
        const modelMentionedThisTurn = typeof data.modelCarName === "string" && data.modelCarName.trim().length > 0;

        const brandModelChanged =
          prevChar.brandName !== charPatch.brandName ||
          prevChar.modelCarName !== charPatch.modelCarName;
        const knownModelCarId =
          !brandModelChanged && typeof prevChar.modelCarId === "number"
            ? prevChar.modelCarId
            : undefined;

        // Правило: СНАЧАЛА определяем марку+модель, и только в следующий
        // шаг — поколение/рестайлинг. Если марка/модель меняются в этом
        // сообщении, hint поколения откладываем как pending.
        const deferGeneration = brandModelChanged;
        const resolveHint = deferGeneration ? undefined : generationHint;
        const resolveYear = deferGeneration ? undefined : charPatch.year;

        let resolved: Awaited<ReturnType<typeof import("./carCatalog").resolveCar>>;
        if (!deferGeneration && mentionsGen && knownModelCarId && !modelMentionedThisTurn) {
          const { resolveGenerationByModelId } = await import("./carCatalog");
          resolved = await resolveGenerationByModelId(knownModelCarId, {
            thread,
            userText: text,
            generationHint: resolveHint,
            year: resolveYear,
            brandName: charPatch.brandName,
            modelCarName: charPatch.modelCarName,
            onTrace: opts?.onClarify,
          });
        } else {
          const { resolveCar } = await import("./carCatalog");
          resolved = await resolveCar(
            charPatch.brandName,
            charPatch.modelCarName,
            resolveYear,
            { thread, userText: text, generationHint: resolveHint, onTrace: opts?.onClarify },
          );
        }
        if (resolved.modelCarId) {
          charPatch.modelCarId = resolved.modelCarId;
          if (resolved.modelGenerationRestylingFrameId) {
            charPatch.modelGenerationRestylingFrameId =
              resolved.modelGenerationRestylingFrameId;
          }
          if (resolved.generationLabel) charPatch.generationLabel = resolved.generationLabel;
        }
        if (resolved.brandName && resolved.brandImage)
          attachments.push({ url: resolved.brandImage, label: resolved.brandName, kind: "brand" });
        if (resolved.modelImage)
          attachments.push({
            url: resolved.modelImage,
            label: [resolved.brandName, resolved.modelCarName].filter(Boolean).join(" "),
            kind: "model",
          });
        if (resolved.generationImage)
          attachments.push({
            url: resolved.generationImage,
            label: resolved.generationLabel ?? "Поколение",
            kind: "generation",
          });

        // Чипы-подсказки brand/model (опечатки, альтернативы). Чипы группы
        // "generation" из resolved.suggestions ИГНОРИРУЕМ — поколения берём
        // ТОЛЬКО через listGenerationChipsForModel(modelCarId), чтобы не
        // показывать поколения других моделей.
        if (resolved.suggestions?.length) {
          for (const s of resolved.suggestions) {
            if (resolved.modelCarId && s.group === "generation") continue;
            chips.push({
              label: s.label,
              value: s.value,
              group: s.group,
              single: true,
              ...(s.image ? { image: s.image } : {}),
              ...(s.description ? { description: s.description } : {}),
            });
          }
        }

        // Коллаж поколений строго по modelCarId через Storage.GetModelGeneration.
        // Показываем всегда, когда модель резолвится, но frame ещё не выбран.
        if (resolved.modelCarId && !resolved.modelGenerationRestylingFrameId) {
          const { listGenerationChipsForModel } = await import("./carCatalog");
          const genChips = await listGenerationChipsForModel(resolved.modelCarId);
          const seenValues = new Set(chips.map((c) => c.value));
          for (const s of genChips) {
            if (seenValues.has(s.value)) continue;
            seenValues.add(s.value);
            chips.push({
              label: s.label,
              value: s.value,
              group: s.group,
              single: true,
              ...(s.image ? { image: s.image } : {}),
              ...(s.description ? { description: s.description } : {}),
            });
          }
          if (deferGeneration && (generationHint || pendingHint)) {
            charPatch.pendingGenerationHint = generationHint ?? pendingHint;
          }
        }


        const last = resolved.trace[resolved.trace.length - 1];
        const lowConf = resolved.trace.some((t) => t.confidence > 0 && t.confidence < 0.5);
        const webHint = resolved.trace.some((t) => t.needsWeb);
        if (resolved.modelCarId && resolved.modelGenerationRestylingFrameId) {
          // Полностью разрешено — лишних подтверждений не пишем.
          catalogNote = "";
        } else if (resolved.modelCarId && resolved.restylingChoiceRequired) {
          const genLabel = resolved.pendingGenerationLabel ?? "Поколение";
          catalogNote =
            `\n🔎 По каталогу: ${[resolved.brandName, resolved.modelCarName].filter(Boolean).join(" ")} · ${genLabel}` +
            `\n👉 У этого поколения несколько рестайлингов. Выберите рестайлинг ниже:`;
        } else if (resolved.modelCarId && resolved.generationNotFound) {
          catalogNote =
            `\n🔎 По каталогу: ${[resolved.brandName, resolved.modelCarName].filter(Boolean).join(" ")}` +
            `\n❌ Указанное поколение/рестайлинг не найдено. Выберите подходящий вариант ниже:`;
        } else if (resolved.modelCarId && deferGeneration) {
          catalogNote =
            `\n🔎 Марка и модель: ${[resolved.brandName, resolved.modelCarName].filter(Boolean).join(" ")}` +
            `\n👉 Теперь выберите поколение/рестайлинг ниже${generationHint ? " (я запомнила вашу подсказку и применю при выборе)" : ""}:`;
        } else if (resolved.modelCarId) {
          catalogNote =
            `\n🔎 По каталогу: ${[resolved.brandName, resolved.modelCarName].filter(Boolean).join(" ")}` +
            `\n⚠️ Поколение не определено — выберите вариант ниже.`;
        } else if (last) {
          catalogNote = `\n🔎 Каталог: подобрать не удалось (шаг «${last.step}», вариантов ${last.candidates}). Уточните бренд/модель — или нажмите подсказку ниже.`;
        }

        // Уточняющие запросы стримятся отдельными сообщениями через onClarify.

        // Если pendingHint был применён — очищаем.
        if (!deferGeneration && pendingHint) charPatch.pendingGenerationHint = null;
      }

      const mergedCar = { ...thread.draft.carStep, ...carStep };

      // Если VIN не указан (или помечен как нечитаемый), но есть госномер —
      // конвертируем плэйт→VIN через ApiCloud (Storage.RunBatchLegalReview
      // checkType=api_cloud_converter_search).
      let vinNote = "";
      if (!mergedCar.vin && mergedCar.gosNumber) {
        try {
          const { resolveVinFromGosNumber } = await import("./storageApi");
          const vin = await resolveVinFromGosNumber(mergedCar.gosNumber);
          if (vin) {
            mergedCar.vin = vin;
            mergedCar.unreadableVin = false;
            vinNote = `\n🔎 VIN получен по госномеру: ${vin}`;
          } else {
            vinNote = "\n⚠️ Не удалось получить VIN по госномеру — введите вручную или загрузите фото документа.";
          }
        } catch (e) {
          vinNote = `\n⚠️ Ошибка конвертации госномера в VIN: ${(e as Error).message}`;
        }
      }

      const mergedChar = charTouched
        ? { ...thread.draft.characteristicsStep, ...charPatch }
        : thread.draft.characteristicsStep;
      const reply = summarizeCarAndChar(mergedCar, mergedChar, catalogNote + vinNote);

      return {
        patch: {
          carStep: mergedCar,
          ...(charTouched ? { characteristicsStep: charPatch } : {}),
        },
        reply,
        ...(attachments.length ? { attachments } : {}),
        ...(chips.length ? { chips } : {}),
      };
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
      let generationHint = typeof data.generationHint === "string" ? data.generationHint : undefined;
      const mentionsGen = /поколени[еяюйя]|рестайлинг/i.test(text);
      if (mentionsGen && !generationHint) generationHint = text;
      const merged: CharacteristicsStep = { ...thread.draft.characteristicsStep, ...c };
      // Подхватываем сохранённый ранее pending hint.
      const pendingHint = thread.draft.characteristicsStep.pendingGenerationHint || undefined;
      if (!generationHint && pendingHint) generationHint = pendingHint;

      // Уточняющий шаг: эксперт назвал только модель («тигуан 2 рестайлинг 1»),
      // марка не извлечена. Делаем follow-up запрос к нейронке.
      const clarifyLog: Array<{ kind: "ai" | "web"; label: string; detail?: string }> = [];
      if (!merged.brandName && merged.modelCarName) {
        try {
          const { inferBrandFromModelName } = await import("./carCatalog");
          const inferred = await inferBrandFromModelName(
            merged.modelCarName,
            text,
            thread,
            opts?.onClarify,
          );
          if (inferred?.brandName) {
            merged.brandName = inferred.brandName;
            if (inferred.modelCarName) merged.modelCarName = inferred.modelCarName;
            c.brandName = merged.brandName;
            c.modelCarName = merged.modelCarName;
            clarifyLog.push(...inferred.trace);
          }
        } catch {
          /* ignore */
        }
      }

      // Случай: пользователь назвал поколение/рестайлинг, но марка/модель неизвестны.
      // Сохраняем hint в pending и просим уточнить модель.
      if (mentionsGen && (!merged.brandName || !merged.modelCarName)) {
        return {
          patch: {
            characteristicsStep: { ...merged, pendingGenerationHint: generationHint ?? text },
          },
          reply:
            "Поняла, нужно выбрать поколение/рестайлинг — но сначала укажите марку и модель автомобиля " +
            "(например «Volkswagen Tiguan» или «BMW X5»). Я сохранила ваш выбор и применю его, как только появится модель.",
        };
      }

      // Если есть бренд+модель — асинхронно подобрать modelCarId и frameId.
      let catalogNote = "";
      const attachments: MessageAttachment[] = [];
      const chips: ChatChip[] = [];
      if (merged.brandName && merged.modelCarName) {
        const prev = thread.draft.characteristicsStep;
        const modelMentionedThisTurn = typeof data.modelCarName === "string" && data.modelCarName.trim().length > 0;
        const brandModelChanged =
          prev.brandName !== merged.brandName || prev.modelCarName !== merged.modelCarName;
        const needsResolve =
          brandModelChanged ||
          !merged.modelCarId ||
          (merged.year && !merged.modelGenerationRestylingFrameId) ||
          mentionsGen ||
          Boolean(pendingHint);
        const knownModelCarId =
          !brandModelChanged && typeof prev.modelCarId === "number"
            ? prev.modelCarId
            : undefined;

        if (needsResolve) {
          // Правило: СНАЧАЛА определяем марку+модель, и только в следующий
          // шаг (или подтверждение чипом) — поколение/рестайлинг. Если
          // марка/модель изменились в этом сообщении, hint поколения
          // откладываем как pending и не передаём в resolveCar.
          const deferGeneration = brandModelChanged;
          const resolveHint = deferGeneration ? undefined : generationHint;
          const resolveYear = deferGeneration ? undefined : merged.year;

          let resolved: Awaited<ReturnType<typeof import("./carCatalog").resolveCar>>;
          if (!deferGeneration && (mentionsGen || pendingHint) && knownModelCarId && !modelMentionedThisTurn) {
            const { resolveGenerationByModelId } = await import("./carCatalog");
            resolved = await resolveGenerationByModelId(knownModelCarId, {
              thread,
              userText: text,
              generationHint: resolveHint,
              year: resolveYear,
              brandName: merged.brandName,
              modelCarName: merged.modelCarName,
              onTrace: opts?.onClarify,
            });
          } else {
            const { resolveCar } = await import("./carCatalog");
            resolved = await resolveCar(merged.brandName, merged.modelCarName, resolveYear, {
              thread,
              userText: text,
              generationHint: resolveHint,
              onTrace: opts?.onClarify,
            });
          }
          if (resolved.modelCarId) {
            merged.modelCarId = resolved.modelCarId;
            if (resolved.modelGenerationRestylingFrameId) {
              merged.modelGenerationRestylingFrameId = resolved.modelGenerationRestylingFrameId;
            }
            if (resolved.generationLabel) merged.generationLabel = resolved.generationLabel;
          }
          if (resolved.brandName && resolved.brandImage)
            attachments.push({ url: resolved.brandImage, label: resolved.brandName, kind: "brand" });
          if (resolved.modelImage)
            attachments.push({
              url: resolved.modelImage,
              label: [resolved.brandName, resolved.modelCarName].filter(Boolean).join(" "),
              kind: "model",
            });
          if (resolved.generationImage)
            attachments.push({
              url: resolved.generationImage,
              label: resolved.generationLabel ?? "Поколение",
              kind: "generation",
            });

          // Чипы-подсказки brand/model (опечатки, альтернативы). Чипы группы
          // "generation" из resolved.suggestions ИГНОРИРУЕМ — поколения берём
          // ТОЛЬКО через listGenerationChipsForModel(modelCarId), чтобы не
          // показывать поколения других моделей.
          if (resolved.suggestions?.length) {
            for (const s of resolved.suggestions) {
              if (resolved.modelCarId && s.group === "generation") continue;
              chips.push({
                label: s.label,
                value: s.value,
                group: s.group,
                single: true,
                ...(s.image ? { image: s.image } : {}),
                ...(s.description ? { description: s.description } : {}),
              });
            }
          }

          // Коллаж поколений строго по modelCarId через Storage.GetModelGeneration.
          // Показываем всегда, когда модель резолвится, но frame ещё не выбран.
          if (resolved.modelCarId && !resolved.modelGenerationRestylingFrameId) {
            const { listGenerationChipsForModel } = await import("./carCatalog");
            const genChips = await listGenerationChipsForModel(resolved.modelCarId);
            const seenValues = new Set(chips.map((c) => c.value));
            for (const s of genChips) {
              if (seenValues.has(s.value)) continue;
              seenValues.add(s.value);
              chips.push({
                label: s.label,
                value: s.value,
                group: s.group,
                single: true,
                ...(s.image ? { image: s.image } : {}),
                ...(s.description ? { description: s.description } : {}),
              });
            }
            if (deferGeneration && (generationHint || pendingHint)) {
              merged.pendingGenerationHint = generationHint ?? pendingHint;
            }
          }


          const last = resolved.trace[resolved.trace.length - 1];
          const lowConf = resolved.trace.some((t) => t.confidence > 0 && t.confidence < 0.5);
          const webHint = resolved.trace.some((t) => t.needsWeb);
          if (resolved.modelCarId && resolved.modelGenerationRestylingFrameId) {
            // Полностью разрешено — лишних подтверждений не пишем.
            catalogNote = "";
          } else if (resolved.modelCarId && resolved.restylingChoiceRequired) {
            const genLabel = resolved.pendingGenerationLabel ?? "Поколение";
            catalogNote =
              `\n🔎 По каталогу: ${[resolved.brandName, resolved.modelCarName].filter(Boolean).join(" ")} · ${genLabel}` +
              `\n👉 У этого поколения несколько рестайлингов. Выберите рестайлинг ниже:`;
          } else if (resolved.modelCarId && resolved.generationNotFound) {
            catalogNote =
              `\n🔎 По каталогу: ${[resolved.brandName, resolved.modelCarName].filter(Boolean).join(" ")}` +
              `\n❌ Указанное поколение/рестайлинг не найдено. Выберите подходящий вариант ниже:`;
          } else if (resolved.modelCarId && deferGeneration) {
            catalogNote =
              `\n🔎 Марка и модель: ${[resolved.brandName, resolved.modelCarName].filter(Boolean).join(" ")}` +
              `\n👉 Теперь выберите поколение/рестайлинг ниже${generationHint ? " (я запомнила вашу подсказку и применю при выборе)" : ""}:`;
          } else if (resolved.modelCarId) {
            catalogNote =
              `\n🔎 По каталогу: ${[resolved.brandName, resolved.modelCarName].filter(Boolean).join(" ")}` +
              (resolved.suggestions?.length
                ? `\n⚠️ Поколение не определено — выберите вариант ниже.`
                : "");
          } else if (last) {
            catalogNote = `\n🔎 Каталог: подобрать не удалось (шаг «${last.step}», вариантов ${last.candidates}). Уточните бренд/модель.`;
          }

          // Уточняющие запросы стримятся отдельными сообщениями через onClarify.

          if (!deferGeneration && pendingHint) merged.pendingGenerationHint = null;
        }
      }

      return {
        patch: { characteristicsStep: merged },
        reply: summarizeChar(merged) + catalogNote,
        ...(attachments.length ? { attachments } : {}),
        ...(chips.length ? { chips } : {}),
      };
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

function summarizeCarAndChar(
  c: CarStep,
  ch: CharacteristicsStep,
  catalogNote: string,
): string {
  const parts: string[] = ["Зафиксировал по автомобилю:"];
  if (c.vin) parts.push(`• VIN ${c.vin}`);
  if (c.unreadableVin) parts.push("• VIN нечитаемый");
  if (c.gosNumber) parts.push(`• Госномер ${c.gosNumber}`);
  if (ch.brandName || ch.modelCarName)
    parts.push(`• Модель: ${[ch.brandName, ch.modelCarName].filter(Boolean).join(" ")}`);
  if (ch.generationLabel) parts.push(`• Поколение: ${ch.generationLabel}`);
  if (ch.year) parts.push(`• Год: ${ch.year}`);
  if (ch.engineVolume) parts.push(`• Объём: ${ch.engineVolume} л`);
  if (ch.engineType) parts.push(`• Тип двигателя: ${ch.engineType}`);
  if (ch.transmission) parts.push(`• КПП: ${ch.transmission}`);
  if (ch.driveType) parts.push(`• Привод: ${ch.driveType}`);
  if (ch.color) parts.push(`• Цвет: ${ch.color}`);
  if (ch.equipment) parts.push(`• Комплектация: ${ch.equipment}`);
  if (typeof c.mileage === "number") parts.push(`• Пробег ${c.mileage.toLocaleString("ru-RU")} км`);
  if (c.cityInspection) parts.push(`• Город осмотра: ${c.cityInspection}`);
  if (c.dateInspection) parts.push(`• Дата осмотра: ${c.dateInspection}`);
  if (c.uriListing) parts.push(`• Объявление: ${c.uriListing}`);
  if (c.visuallyMileageNotMatchCondition) parts.push("• Пробег не соответствует состоянию");
  if (catalogNote) parts.push(catalogNote.trimStart());
  return parts.join("\n");
}

function summarizeChar(c: CharacteristicsStep): string {
  const parts: string[] = ["Зафиксировал характеристики:"];
  if (c.brandName || c.modelCarName) parts.push(`• Модель: ${[c.brandName, c.modelCarName].filter(Boolean).join(" ")}`);
  if (c.generationLabel) parts.push(`• Поколение: ${c.generationLabel}`);
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

/** Структура распознанной находки для одного фото. */
export interface PhotoFindingDraft {
  elementId: string;
  noDamage: boolean;
  seriousTagIds: number[];
  noSeriousTagIds: number[];
  pendingTags: PendingTagName[];
  note: string;
}

/**
 * Распознать одно фото осмотра в структурированную находку (без записи в draft).
 * Возвращает поля для предзаполнения PhotoAnnotator. Бросает при ошибке AI.
 */
export async function analyzeInspectionPhoto(
  thread: Thread,
  sectionSnake: SectionSnake,
  photoUrl: string,
  hint?: string,
  existingNote?: string,
): Promise<PhotoFindingDraft> {
  const section = getSection(sectionSnake) ?? INSPECTION_SECTIONS[0];
  const { CLICHE_INSPECTION_PHOTO } = await import("./cliche");
  const { elementHint } = await import("./inspectionElementHints");
  const tagCatalogue = await loadSectionTags(sectionSnake);

  const id = aiChatIdFor(thread, `vision:inspection:${sectionSnake}:${photoUrl.slice(-12)}`);
  const cliche = CLICHE_INSPECTION_PHOTO(
    section.label,
    section.elements.map((el) => ({
      id: el.id,
      label: el.label,
      hint: elementHint(sectionSnake, el.id),
    })),
    tagCatalogue.map((t) => ({ name: t.name, type: t.type })),
    existingNote,
  );
  const text = hint?.trim() || "Опиши, что видно на фото.";

  const res = await chatCompletions({ id, text, cliche, fileUrls: [photoUrl], model: "gpt-5.4" });



  const raw = parseJsonResponse<{
    elementId?: string;
    noDamage?: boolean;
    seriousTags?: unknown;
    nonSeriousTags?: unknown;
    note?: string;
  }>(res.content) ?? {};

  const elementIds = new Set(section.elements.map((e) => e.id));
  const elementId =
    typeof raw.elementId === "string" && elementIds.has(raw.elementId)
      ? raw.elementId
      : defaultElementIdFor(section.snake);
  const noDamage = raw.noDamage === true;
  const sNames = Array.isArray(raw.seriousTags)
    ? (raw.seriousTags as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const nsNames = Array.isArray(raw.nonSeriousTags)
    ? (raw.nonSeriousTags as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  const seriousIds = new Set<number>();
  const nsIds = new Set<number>();
  const pending: PendingTagName[] = [];
  for (const name of sNames) {
    const t = findTagId(tagCatalogue, name);
    if (t) seriousIds.add(t.id);
    else pending.push({ name, severity: "serious" });
  }
  for (const name of nsNames) {
    const t = findTagId(tagCatalogue, name);
    if (t) nsIds.add(t.id);
    else pending.push({ name, severity: "non_serious" });
  }

  return {
    elementId,
    noDamage: noDamage && !seriousIds.size && !nsIds.size,
    seriousTagIds: [...seriousIds],
    noSeriousTagIds: [...nsIds],
    pendingTags: pending,
    note: typeof raw.note === "string" ? raw.note.trim() : "",
  };
}

/**
 * Обработать текст заметки без фото: подобрать теги (из каталога или
 * новые pending), определить серьёзность, переформулировать.
 */
export async function analyzeInspectionNote(
  thread: Thread,
  sectionSnake: SectionSnake,
  elementId: string | null,
  noteText: string,
  existingNote?: string,
): Promise<PhotoFindingDraft> {
  const section = getSection(sectionSnake) ?? INSPECTION_SECTIONS[0];
  const { CLICHE_INSPECTION_NOTE } = await import("./cliche");
  const { elementHint } = await import("./inspectionElementHints");
  const tagCatalogue = await loadSectionTags(sectionSnake);
  // Если элемент уже выбран — используем стабильный ключ (история помогает
  // переформулировать заметки одного элемента в одном стиле). Если элемента
  // нет, не сваливаем все заметки в одну сессию "any" — иначе AI смешивает
  // контексты разных элементов. Делаем ключ уникальным на каждый вызов.
  const sessionScope =
    elementId ?? `none:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
  const id = aiChatIdFor(thread, `note:inspection:${sectionSnake}:${sessionScope}`);
  const cliche = CLICHE_INSPECTION_NOTE(
    section.label,
    section.elements.map((el) => ({
      id: el.id,
      label: el.label,
      hint: elementHint(sectionSnake, el.id),
    })),
    elementId,
    tagCatalogue.map((t) => ({ name: t.name, type: t.type })),
    existingNote,
  );
  const res = await chatCompletions({ id, text: noteText, cliche, model: "gpt-5.4" });
  const raw = parseJsonResponse<{
    elementId?: string;
    noDamage?: boolean;
    seriousTags?: unknown;
    nonSeriousTags?: unknown;
    note?: string;
  }>(res.content) ?? {};
  const elementIds = new Set(section.elements.map((e) => e.id));
  const resolvedElementId =
    typeof raw.elementId === "string" && elementIds.has(raw.elementId)
      ? raw.elementId
      : elementId ?? defaultElementIdFor(section.snake);
  const noDamage = raw.noDamage === true;
  const sNames = Array.isArray(raw.seriousTags)
    ? (raw.seriousTags as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const nsNames = Array.isArray(raw.nonSeriousTags)
    ? (raw.nonSeriousTags as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const seriousIds = new Set<number>();
  const nsIds = new Set<number>();
  const pending: PendingTagName[] = [];
  for (const name of sNames) {
    const t = findTagId(tagCatalogue, name);
    if (t) seriousIds.add(t.id);
    else pending.push({ name, severity: "serious" });
  }
  for (const name of nsNames) {
    const t = findTagId(tagCatalogue, name);
    if (t) nsIds.add(t.id);
    else pending.push({ name, severity: "non_serious" });
  }
  return {
    elementId: resolvedElementId,
    noDamage: noDamage && !seriousIds.size && !nsIds.size,
    seriousTagIds: [...seriousIds],
    noSeriousTagIds: [...nsIds],
    pendingTags: pending,
    note: typeof raw.note === "string" ? raw.note.trim() : "",
  };
}


/**
 * Определить, к какому разделу осмотра и какому элементу относится фото.
 * Возвращает `{section, elementId}` или `null`, если уверенности нет.
 * Если элемент по фото не однозначен — возвращает elementId="generalCondition".
 */
export async function classifyInspectionPhotoSection(
  thread: Thread,
  photoUrl: string,
): Promise<{ section: SectionSnake; elementId: string } | null> {
  const id = aiChatIdFor(thread, `vision:section:${photoUrl.slice(-12)}`);
  const { elementHint } = await import("./inspectionElementHints");
  const sectionsBlock = INSPECTION_SECTIONS.map((s) => {
    const els = s.elements
      .map((el) => {
        const h = elementHint(s.snake, el.id).trim();
        return h
          ? `    • ${el.id} — ${el.label}\n        ↳ ${h}`
          : `    • ${el.id} — ${el.label}`;
      })
      .join("\n");
    return `- ${s.snake}: ${s.label}\n${els}`;
  }).join("\n\n");
  const cliche =
    "Ты — ассистент эксперта по осмотру авто. Тебе показывают одно фото.\n" +
    "Определи к какому РАЗДЕЛУ и какому ЭЛЕМЕНТУ внутри раздела оно " +
    "относится. Используй подсказки-референсы (после ↳) — они описывают " +
    "характерные признаки элемента (расположение, форма, что вокруг).\n\n" +
    "ВАЖНО:\n" +
    "• Сначала выбирай РАЗДЕЛ (snake), потом ЭЛЕМЕНТ (id) ВНУТРИ этого раздела.\n" +
    "• Если фото общее (видно несколько элементов раздела сразу) или ты не " +
    "можешь однозначно выбрать один элемент — ставь " +
    "elementId=\"generalCondition\". Это правильный, ожидаемый ответ.\n" +
    "• НЕ выбирай первый элемент списка по умолчанию. Лучше generalCondition, " +
    "чем угаданный конкретный элемент.\n" +
    "• Если ни один раздел уверенно не подходит — верни {\"section\": null, " +
    "\"elementId\": null}.\n\n" +
    "Разделы и элементы:\n" +
    sectionsBlock +
    "\n\nОтветь СТРОГО валидным JSON одной строкой, без markdown:\n" +
    "{\"section\": \"<snake>\", \"elementId\": \"<id или generalCondition>\"}\n" +
    "или {\"section\": null, \"elementId\": null}.\n\n{text}";

  try {
    const res = await chatCompletions({
      id,
      text: "Определи раздел и элемент осмотра по этому фото.",
      cliche,
      fileUrls: [photoUrl],
    });
    const raw =
      parseJsonResponse<{ section?: string | null; elementId?: string | null }>(
        res.content,
      ) ?? {};
    const s = typeof raw.section === "string" ? raw.section.trim() : "";
    if (!s) return null;
    const known = INSPECTION_SECTIONS.find((x) => x.snake === s);
    if (!known) return null;
    const eidRaw =
      typeof raw.elementId === "string" ? raw.elementId.trim() : "";
    const eid =
      (eidRaw && known.elements.find((e) => e.id === eidRaw)?.id) ||
      known.elements.find((e) => e.id === "generalCondition")?.id ||
      known.elements[known.elements.length - 1].id;
    return { section: known.snake, elementId: eid };
  } catch {
    return null;
  }
}



/**
 * Build a short recap of what's already filled for a given step. Returns an
 * empty string when there's nothing yet — caller should then skip the recap
 * message and show only the step intro.
 */
export function summarizeStepDraft(step: StepId, draft: Thread["draft"]): string {
  switch (step) {
    case "car": {
      const c = draft.carStep;
      const ch = draft.characteristicsStep;
      const hasCar =
        c.vin ||
        c.unreadableVin ||
        c.gosNumber ||
        typeof c.mileage === "number" ||
        c.cityInspection ||
        c.dateInspection ||
        c.uriListing ||
        c.visuallyMileageNotMatchCondition;
      const hasChar =
        ch.brandName || ch.modelCarName || ch.year || ch.engineVolume ||
        ch.engineType || ch.transmission || ch.driveType || ch.color || ch.equipment;
      if (!hasCar && !hasChar) return "";
      const parts: string[] = ["Уже зафиксировано по автомобилю:"];
      if (c.vin) parts.push(`• VIN ${c.vin}`);
      if (c.unreadableVin) parts.push("• VIN нечитаемый");
      if (c.gosNumber) parts.push(`• Госномер ${c.gosNumber}`);
      if (typeof c.mileage === "number")
        parts.push(`• Пробег ${c.mileage.toLocaleString("ru-RU")} км`);
      if (c.cityInspection) parts.push(`• Город осмотра: ${c.cityInspection}`);
      if (c.dateInspection) parts.push(`• Дата осмотра: ${c.dateInspection}`);
      if (c.uriListing) parts.push(`• Объявление: ${c.uriListing}`);
      if (c.visuallyMileageNotMatchCondition) parts.push("• Пробег не соответствует состоянию");
      if (hasChar) {
        if (ch.brandName || ch.modelCarName)
          parts.push(`• Модель: ${[ch.brandName, ch.modelCarName].filter(Boolean).join(" ")}`);
        if (ch.generationLabel) parts.push(`• Поколение: ${ch.generationLabel}`);
        if (ch.year) parts.push(`• Год: ${ch.year}`);
        if (ch.engineVolume) parts.push(`• Объём: ${ch.engineVolume} л`);
        if (ch.engineType) parts.push(`• Тип двигателя: ${ch.engineType}`);
        if (ch.transmission) parts.push(`• КПП: ${ch.transmission}`);
        if (ch.driveType) parts.push(`• Привод: ${ch.driveType}`);
        if (ch.color) parts.push(`• Цвет: ${ch.color}`);
        if (ch.equipment) parts.push(`• Комплектация: ${ch.equipment}`);
      }
      parts.push("\n" + optionalHintSentence("car", draft));
      return parts.join("\n");
    }
    case "characteristics": {
      const c = draft.characteristicsStep;
      const has =
        c.brandName ||
        c.modelCarName ||
        c.year ||
        c.engineVolume ||
        c.engineType ||
        c.transmission ||
        c.driveType ||
        c.color ||
        c.equipment;
      if (!has) return "";
      const parts: string[] = ["Уже зафиксированы характеристики:"];
      if (c.brandName || c.modelCarName)
        parts.push(`• Модель: ${[c.brandName, c.modelCarName].filter(Boolean).join(" ")}`);
      if (c.generationLabel) parts.push(`• Поколение: ${c.generationLabel}`);
      if (c.year) parts.push(`• Год: ${c.year}`);
      if (c.engineVolume) parts.push(`• Объём: ${c.engineVolume} л`);
      if (c.engineType) parts.push(`• Тип двигателя: ${c.engineType}`);
      if (c.transmission) parts.push(`• КПП: ${c.transmission}`);
      if (c.driveType) parts.push(`• Привод: ${c.driveType}`);
      if (c.color) parts.push(`• Цвет: ${c.color}`);
      if (c.equipment) parts.push(`• Комплектация: ${c.equipment}`);
      parts.push("\n" + optionalHintSentence("characteristics", draft));
      return parts.join("\n");
    }
    case "docs":
      return draft.documentReconciliationStep &&
        (draft.documentReconciliationStep.ownersCount !== undefined ||
          draft.documentReconciliationStep.ownerFullNameMatchWithPTSOrSTS !== undefined ||
          draft.documentReconciliationStep.vinOnBodyMatchWithPTSOrSTS !== undefined ||
          draft.documentReconciliationStep.engineModelMatchWithPTSOrSTS !== undefined ||
          draft.documentReconciliationStep.note)
        ? summarizeDocs(draft.documentReconciliationStep)
        : "";
    case "inspection": {
      const ins = draft.inspectionStep;
      const findings = Object.values(ins.findings ?? {});
      if (!findings.length) return "";
      const bySection = new Map<string, typeof findings>();
      for (const f of findings) {
        const arr = bySection.get(f.section) ?? [];
        arr.push(f);
        bySection.set(f.section, arr);
      }
      const lines: string[] = ["Зафиксировано по осмотру:"];
      for (const s of INSPECTION_SECTIONS) {
        const list = bySection.get(s.snake);
        if (!list?.length) continue;
        let ok = 0, minor = 0, serious = 0;
        for (const f of list) {
          if ((f.seriousDamageTagIds?.length ?? 0) > 0) serious += 1;
          else if ((f.noSeriousDamageTagIds?.length ?? 0) > 0) minor += 1;
          else if (f.noDamage === true) ok += 1;
        }
        const bits: string[] = [`${list.length}/${s.elements.length}`];
        if (ok) bits.push(`✅${ok}`);
        if (minor) bits.push(`🟡${minor}`);
        if (serious) bits.push(`🔴${serious}`);
        lines.push(`• ${s.label}: ${bits.join(" · ")}`);
      }
      lines.push("\nПродолжайте по элементам или нажмите «Всё верно, далее».");
      return lines.join("\n");
    }

    case "testDrive": {
      const td = draft.testDriveStep ?? {};
      const has =
        td.testDriveIsIncluded !== undefined ||
        td.notDone ||
        td.notes ||
        td.testDriveNote ||
        td.testDriveEngineIsWorkingProperly !== undefined ||
        td.testDriveTransmissionIsWorkingProperly !== undefined ||
        td.testDriveSteeringWheelIsWorkingProperly !== undefined ||
        td.testDriveSuspensionInDriveIsWorkingProperly !== undefined ||
        td.testDriveBrakesInDriveIsWorkingProperly !== undefined;
      if (!has) return "";
      return summarizeTestDrive(td as Record<string, unknown> & Partial<TestDriveStep>);
    }
    case "result": {
      const r = draft.resultStep ?? {};
      if (!r.summaryInspectionNote && !r.resultSpecialistNote) return "";
      const parts: string[] = ["Уже зафиксировано по итогу:"];
      if (r.summaryInspectionNote) parts.push(`📝 Резюме:\n${r.summaryInspectionNote}`);
      if (r.resultSpecialistNote) parts.push(`✅ Вердикт:\n${r.resultSpecialistNote}`);
      parts.push("\nДополните или нажмите «Всё верно, далее».");
      return parts.join("\n");
    }
    default:
      return "";
  }
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

/**
 * Свободный Q&A режим. Не модифицирует черновик. Использует summarizeStepDraft
 * как контекст. Возвращает текст ответа ассистента (или сообщение об ошибке).
 */
export async function askQuestion(
  step: StepId,
  question: string,
  thread: Thread,
  stepLabel: string,
): Promise<string> {
  const text = question.trim();
  if (!text) return "Задайте вопрос.";
  try {
    const filled = summarizeStepDraft(step, thread.draft) || "(на этом шаге пока пусто)";
    const remaining = remainingFieldLabels(step, thread.draft);
    const nextHint = nextMissingPrompt(step, thread.draft);
    const remainingStr = remaining.length
      ? `Ещё не заполнено: ${remaining.join(", ")}.`
      : "Все обязательные поля шага заполнены.";
    const hintStr = nextHint ? `Подсказка по следующему полю: ${nextHint}` : "";
    const draftContext = [filled, remainingStr, hintStr].filter(Boolean).join("\n\n");
    const cliche = CLICHE_ASK(stepLabel, draftContext);
    const id = aiChatIdFor(thread, `ask:${step}`);
    const res = await chatCompletions({ id, text, cliche });
    return res.content?.trim() || "Не удалось получить ответ.";
  } catch (e) {
    return `⚠️ ${e instanceof Error ? e.message : "Ошибка ИИ"}`;
  }
}


function testDriveChips(): ChatChip[] {
  const systems = [
    ["Двигатель", "engine"],
    ["КПП", "transmission"],
    ["Руль", "steering"],
    ["Подвеска", "suspension"],
    ["Тормоза", "brakes"],
  ] as const;
  const out: ChatChip[] = [
    {
      label: "Тест-драйв не проводился",
      value: "Тест-драйв не проводился.",
      group: "testDrive-system",
      single: true,
    },
  ];
  for (const [label] of systems) {
    out.push({
      label: `${label} — ок`,
      value: `${label}: работает корректно.`,
      group: "testDrive-system",
      single: true,
    });
    out.push({
      label: `${label} — есть замечания`,
      value: `${label}: есть замечания — `,
      group: "testDrive-system",
      single: true,
    });
  }
  return out;
}

function resultChips(): ChatChip[] {
  return [
    {
      label: "✅ Рекомендую к покупке",
      value: "Рекомендую к покупке.",
      group: "result-template",
      single: true,
    },
    {
      label: "⚠️ Покупать с торгом",
      value: "Можно покупать, но с торгом по выявленным замечаниям.",
      group: "result-template",
      single: true,
    },
    {
      label: "❌ Не рекомендую",
      value: "Не рекомендую к покупке.",
      group: "result-template",
      single: true,
    },
    {
      label: "📝 Резюме осмотра",
      value: "Резюме осмотра: ",
      group: "result-template",
      single: true,
    },
    {
      label: "🔧 Работы перед покупкой",
      value: "Перед покупкой рекомендуется выполнить: ",
      group: "result-template",
      single: true,
    },
  ];
}
