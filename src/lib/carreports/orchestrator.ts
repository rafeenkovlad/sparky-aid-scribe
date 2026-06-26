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
} from "./cliche";

import { decodeVin } from "./storageApi";
import { zoneById } from "./inspectionZones";
import {
  ZONE_TO_SECTION,
  getSection,
  findingKey,
  type SectionSnake,
} from "./inspectionSections";
import { loadSectionTags, findTagId } from "./inspectionTags";
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
import { optionalHintSentence } from "./progress";

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
    const zone = ins.currentZone ?? "body";
    const zoneLabel = zoneById(zone)?.label ?? zone;
    const sectionSnake: SectionSnake = ZONE_TO_SECTION[zone] ?? "body";
    const section = getSection(sectionSnake);

    // Fetch tags catalogue for this section (cached); never throws.
    const tagCatalogue = await loadSectionTags(sectionSnake);

    let cleaned = text;
    let aiFindings: Array<{
      elementId?: string;
      noDamage?: boolean;
      seriousTags?: unknown;
      nonSeriousTags?: unknown;
      note?: string;
    }> = [];
    try {
      const id = aiChatIdFor(thread, `extract:inspection:${zone}`);
      const res = await chatCompletions({
        id,
        text,
        cliche: CLICHE_INSPECTION(
          zoneLabel,
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

    // Resolve element findings: validate elementId, map tag names → server IDs.
    const elementIds = new Set(section.elements.map((el) => el.id));
    const prevFindings = ins.findings ?? {};
    const nextFindings: Record<string, InspectionElementFinding> = { ...prevFindings };
    let hasIssues = false;

    for (const f of aiFindings) {
      const eid = typeof f.elementId === "string" ? f.elementId : "";
      if (!eid || !elementIds.has(eid)) continue;
      const key = findingKey(sectionSnake, eid);
      const base = nextFindings[key] ?? { section: sectionSnake, elementId: eid };

      const noDamage = typeof f.noDamage === "boolean" ? f.noDamage : base.noDamage;

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

      nextFindings[key] = {
        section: sectionSnake,
        elementId: eid,
        ...(noDamage !== undefined ? { noDamage } : {}),
        ...(sIds.size ? { seriousDamageTagIds: [...sIds] } : {}),
        ...(nsIds.size ? { noSeriousDamageTagIds: [...nsIds] } : {}),
        ...(pending.length ? { pendingTagNames: pending } : {}),
        ...(nextNote ? { note: nextNote } : {}),
      };

      if (noDamage === false || sIds.size || nsIds.size) hasIssues = true;
    }

    const prev = ins.sectionNotes[zone] ?? "";
    const merged = prev ? `${prev}\n${cleaned}` : cleaned;
    const nextNotes = { ...ins.sectionNotes, [zone]: merged };

    // Build a human-readable reply that lists per-element findings.
    const lines: string[] = [`Записал по зоне «${zoneLabel}»:`];
    const zoneFindings = Object.values(nextFindings).filter(
      (f) => f.section === sectionSnake,
    );
    for (const f of zoneFindings) {
      const el = section.elements.find((x) => x.id === f.elementId);
      if (!el) continue;
      const mark = f.noDamage === true ? "✅" : f.noDamage === false ? "⚠️" : "•";
      const tags: string[] = [];
      const idToName = new Map(tagCatalogue.map((t) => [t.id, t.name]));
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
    if (zoneFindings.length === 0) lines.push(cleaned);
    lines.push(
      hasIssues
        ? "\n* — теги добавятся локально и поедут при отправке как pendingTagNames."
        : "",
    );
    lines.push(
      "Продолжайте по этой зоне, выберите другую кнопкой ниже, или нажмите «Всё верно, далее».",
    );

    return {
      patch: {
        inspectionStep: {
          ...ins,
          sectionNotes: nextNotes,
          findings: nextFindings,
          touched: true,
          currentZone: zone,
        },
      },
      reply: lines.filter(Boolean).join("\n"),
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
          const label =
            [resolved.brandName, resolved.modelCarName].filter(Boolean).join(" ") +
            (resolved.generationLabel ? ` · ${resolved.generationLabel}` : "");
          catalogNote = `\n🔎 По каталогу: ${label}`;
          if (lowConf || webHint)
            catalogNote += "\n⚠️ Уверенность подбора низкая — выберите вариант ниже или уточните.";
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

        // Показать в чате уточняющие запросы нейросети (доп. AI/web вызовы).
        try {
          const { formatClarifyTrace, resolvedTraceToClarify } = await import("./carCatalog");
          const fullClarify = [...clarifyLog, ...resolvedTraceToClarify(resolved)];
          const note = formatClarifyTrace(fullClarify);
          if (note) catalogNote = note + catalogNote;
        } catch {
          /* ignore — трейс необязателен */
        }

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
            const label =
              [resolved.brandName, resolved.modelCarName].filter(Boolean).join(" ") +
              (resolved.generationLabel ? ` · ${resolved.generationLabel}` : "");
            catalogNote = `\n🔎 По каталогу: ${label}`;
            if (lowConf || webHint) {
              catalogNote += "\n⚠️ Уверенность подбора низкая — проверьте поколение/модификацию.";
            }
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

          // Показать в чате уточняющие запросы нейросети (доп. AI/web вызовы).
          try {
            const { formatClarifyTrace, resolvedTraceToClarify } = await import("./carCatalog");
            const fullClarify = [...clarifyLog, ...resolvedTraceToClarify(resolved)];
            const note = formatClarifyTrace(fullClarify);
            if (note) catalogNote = note + catalogNote;
          } catch {
            /* ignore — трейс необязателен */
          }

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
      const zone = ins.currentZone ?? "body";
      const zoneLabel = zoneById(zone)?.label ?? zone;
      const findings = Object.values(ins.findings ?? {});
      const zoneFindings = findings.filter((f) => f.section === (ZONE_TO_SECTION[zone] ?? "body"));
      if (!zoneFindings.length && !ins.sectionNotes[zone]) return "";
      const section = getSection(ZONE_TO_SECTION[zone] ?? "body");
      const lines: string[] = [`Уже зафиксировано по зоне «${zoneLabel}»:`];
      for (const f of zoneFindings) {
        const el = section.elements.find((x) => x.id === f.elementId);
        if (!el) continue;
        const mark = f.noDamage === true ? "✅" : f.noDamage === false ? "⚠️" : "•";
        const tagCount =
          (f.seriousDamageTagIds?.length ?? 0) +
          (f.noSeriousDamageTagIds?.length ?? 0) +
          (f.pendingTagNames?.length ?? 0);
        const tagPart = tagCount ? ` — тегов: ${tagCount}` : "";
        const notePart = f.note ? ` · ${f.note}` : "";
        lines.push(`${mark} ${el.label}${tagPart}${notePart}`);
      }
      if (!zoneFindings.length && ins.sectionNotes[zone]) {
        lines.push(ins.sectionNotes[zone]);
      }
      lines.push("\nПродолжайте, выберите другую зону или нажмите «Всё верно, далее».");
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
    const draftContext = summarizeStepDraft(step, thread.draft);
    const cliche = CLICHE_ASK(stepLabel, draftContext);
    const id = aiChatIdFor(thread, `ask:${step}`);
    const res = await chatCompletions({ id, text, cliche });
    return res.content?.trim() || "Не удалось получить ответ.";
  } catch (e) {
    return `⚠️ ${e instanceof Error ? e.message : "Ошибка ИИ"}`;
  }
}

