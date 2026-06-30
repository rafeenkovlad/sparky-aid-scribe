// Thin JSON-RPC 2.0 client for https://app.carreports.ru/
// Auth: header Authorization: Bearer <token>.

import { getToken } from "./tokenStore";

const STORAGE_URL = "/api/cr-proxy?target=storage";

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: number,
  ) {
    super(message);
  }
}

let idCounter = 1;

export async function rpc<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  opts: { token?: string } = {},
): Promise<T> {
  const token = opts.token ?? getToken();
  if (!token) throw new ApiError("Не указан токен. Откройте меню и вставьте Bearer-токен.", 401);

  const id = idCounter++;
  const res = await fetch(`${STORAGE_URL}&token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });

  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch {
      /* ignore */
    }
    throw new ApiError(`Storage ${method}: HTTP ${res.status} ${body.slice(0, 200)}`, res.status);
  }
  const json = (await res.json()) as {
    error?: { code: number; message: string };
    errors?: { message?: string; code?: number } | string | unknown[] | null;
    response?: string;
    result?: T;
  };
  if (json.error) {
    throw new ApiError(`Storage ${method}: ${json.error.message}`, undefined, json.error.code);
  }
  // CarReports backend variант: { response: "error", errors: {...} | "..." }.
  // ВАЖНО: на успехе сервер часто отдаёт errors: [] (пустой массив, truthy в JS),
  // поэтому ориентируемся прежде всего на response === "error".
  const errs = json.errors;
  const hasErrorPayload =
    typeof errs === "string"
      ? errs.length > 0
      : Array.isArray(errs)
        ? errs.length > 0
        : errs != null && typeof errs === "object" && Object.keys(errs).length > 0;
  if (json.response === "error" || hasErrorPayload) {
    let msg = "Unknown error";
    let code: number | undefined;
    if (typeof errs === "string") msg = errs;
    else if (Array.isArray(errs)) {
      const first = errs[0] as { message?: string; code?: number } | string | undefined;
      if (typeof first === "string") msg = first;
      else if (first && typeof first === "object") {
        msg = first.message ?? msg;
        code = first.code;
      }
    } else if (errs && typeof errs === "object") {
      msg = (errs as { message?: string }).message ?? msg;
      code = (errs as { code?: number }).code;
    }
    const status = /unauthorized/i.test(msg) ? 401 : undefined;
    throw new ApiError(`Storage ${method}: ${msg}`, status, code);
  }
  // Some methods return {result: ...}, others wrap as { result: { result: ... } }.
  return (json.result ?? (json as unknown as T)) as T;
}

// ─── Typed wrappers used in Phase 1 ──────────────────────────────────────

export interface ProfileResult {
  id: number;
  email: string | null;
  firstName?: string | null;
  lastName?: string | null;
  role: "specialist" | "company" | "client";
}

export async function getProfile(): Promise<ProfileResult> {
  const r = await rpc<{ result?: ProfileResult } | ProfileResult>("Storage.GetProfile");
  return (r as { result?: ProfileResult }).result ?? (r as ProfileResult);
}

export interface DecodedVin {
  // backend returns additionalProperties=true; flexible bag.
  [k: string]: unknown;
}

export async function decodeVin(vin: string): Promise<DecodedVin> {
  const r = await rpc<{ result?: DecodedVin } | DecodedVin>("DecodeVin", { vin });
  return (r as { result?: DecodedVin }).result ?? (r as DecodedVin);
}

/**
 * Конвертация госномера → VIN через ApiCloud (Storage.RunBatchLegalReview с
 * checkType=api_cloud_converter_search) и опрос результатов через
 * Storage.GetBatchLegalReviewResults. Возвращает VIN из responseNormalized
 * или null если не удалось получить за timeout.
 */
export async function resolveVinFromGosNumber(
  gosNumber: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<string | null> {
  const timeoutMs = opts.timeoutMs ?? 25000;
  const intervalMs = opts.intervalMs ?? 1500;
  const plate = gosNumber.toUpperCase().replace(/\s+/g, "");
  if (!plate) return null;

  type RunRes = { result?: { batchNumber?: string } } | { batchNumber?: string };
  const runRaw = await rpc<RunRes>("Storage.RunBatchLegalReview", {
    checkTypes: ["api_cloud_converter_search"],
    gosNumber: plate,
  });
  const batchNumber =
    (runRaw as { result?: { batchNumber?: string } }).result?.batchNumber ??
    (runRaw as { batchNumber?: string }).batchNumber;
  if (!batchNumber) return null;

  type Check = {
    checkType?: string | null;
    status?: string | null;
    vehicleVin?: string | null;
    responseNormalized?: unknown;
  };
  type ResultsRes =
    | { result?: { checks?: Check[] } }
    | { checks?: Check[] };

  const extractVin = (r: unknown): string | null => {
    if (!r) return null;
    if (typeof r === "string") {
      const m = r.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i);
      return m ? m[0].toUpperCase() : null;
    }
    if (typeof r === "object") {
      const obj = r as Record<string, unknown>;
      for (const key of ["vin", "VIN", "Vin"]) {
        const v = obj[key];
        if (typeof v === "string" && /^[A-HJ-NPR-Z0-9]{17}$/i.test(v)) {
          return v.toUpperCase();
        }
      }
      for (const v of Object.values(obj)) {
        const found = extractVin(v);
        if (found) return found;
      }
    }
    return null;
  };

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    try {
      const resRaw = await rpc<ResultsRes>("Storage.GetBatchLegalReviewResults", {
        batchNumber,
      });
      const checks =
        (resRaw as { result?: { checks?: Check[] } }).result?.checks ??
        (resRaw as { checks?: Check[] }).checks ??
        [];
      const conv = checks.find((c) => c.checkType === "api_cloud_converter_search");
      if (!conv) continue;
      if (conv.vehicleVin && /^[A-HJ-NPR-Z0-9]{17}$/i.test(conv.vehicleVin)) {
        return conv.vehicleVin.toUpperCase();
      }
      const fromBody = extractVin(conv.responseNormalized);
      if (fromBody) return fromBody;
      if (conv.status && conv.status !== "pending") {
        // Завершено, но VIN не найден.
        return null;
      }
    } catch {
      // продолжаем опрос
    }
  }
  return null;
}

import type { ReportDraft } from "./types";
import { resolveCar, type ResolvedCar } from "./carCatalog";
import {
  INSPECTION_SECTIONS,
  ZONE_TO_SECTION as ZONE_TO_SECTION_SNAKE,
  getSection,
  type SectionSnake,
} from "./inspectionSections";

/** camelCase → snake_case (frontBumper → front_bumper, generalCondition → general_condition). */
function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

/** Section.doc → sectionType used by element DTOs (e.g. bodySection → body). */
const SECTION_DOC_TO_TYPE: Record<string, string> = {
  bodySection: "body",
  bodyReinforcementElementsSection: "bodyReinforcement",
  glassSection: "glass",
  interiorSection: "interior",
  underHoodSpaceSection: "under_hood",
  wheelsAndBrakesSection: "wheelsAndBrakes",
  lightningSection: "lightning",
  computerDiagnosticsSection: "computerDiagnostics",
};

/** Sections whose elements carry paintworkThickness* fields. */
const PAINTWORK_SECTION_TYPES = new Set(["body", "bodyReinforcement"]);
/** Sections whose section-level DTO requires paintworkThicknessFrom/To. */
const PAINTWORK_SECTION_DOCS = new Set([
  "bodySection",
  "bodyReinforcementElementsSection",
]);

function buildInspectionStep(draft: ReportDraft): Record<string, unknown> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const s of INSPECTION_SECTIONS) {
    const section: Record<string, unknown> = {};
    for (const el of s.elements) section[el.collection] = [];
    if (PAINTWORK_SECTION_DOCS.has(s.doc)) {
      section.paintworkThicknessFrom = 80;
      section.paintworkThicknessTo = 200;
    }
    out[s.doc] = section;
  }

  const findings = draft.inspectionStep.findings ?? {};
  const zonesCovered = new Set<string>();


  const makeElement = (
    sectionType: string,
    elementId: string,
    opts: {
      hasFile?: boolean;
      noDamage?: boolean;
      seriousDamageTags?: number[];
      noSeriousDamageTags?: number[];
      note?: string;
      audioNotes?: string[];
      paintworkThicknessFrom?: number;
      paintworkThicknessTo?: number;
    },
  ) => {
    const hasFile = opts.hasFile === true;
    const base: Record<string, unknown> = {
      file: null,
      noDamage: hasFile ? (opts.noDamage ?? true) : true,
      seriousDamageTags: hasFile ? (opts.seriousDamageTags ?? []) : [],
      noSeriousDamageTags: hasFile ? (opts.noSeriousDamageTags ?? []) : [],
      note: hasFile && opts.note ? opts.note : null,
      audioNotes: hasFile ? (opts.audioNotes ?? []) : [],
      sectionType,
      elementType: camelToSnake(elementId),
    };
    // paintworkThickness* — у элементов кузова и силового каркаса.
    if (PAINTWORK_SECTION_TYPES.has(sectionType)) {
      const from = Number.isFinite(opts.paintworkThicknessFrom)
        ? Math.max(0, Math.round(opts.paintworkThicknessFrom!))
        : 80;
      const toRaw = Number.isFinite(opts.paintworkThicknessTo)
        ? Math.max(0, Math.round(opts.paintworkThicknessTo!))
        : 200;
      const to = Math.max(from, toRaw);
      base.paintworkThicknessFrom = from;
      base.paintworkThicknessTo = to;
    }

    return base;
  };

  // 1) Structured findings → exact element collection.
  for (const f of Object.values(findings)) {
    const section = getSection(f.section as SectionSnake);
    if (!section) continue;
    const el = section.elements.find((e) => e.id === f.elementId);
    if (!el) continue;
    const sec = out[section.doc];
    const arr = (sec[el.collection] as unknown[]) ?? [];
    const sectionType = SECTION_DOC_TO_TYPE[section.doc] ?? section.snake;
    arr.push(
      makeElement(sectionType, el.id, {
        hasFile: true,
        noDamage: f.noDamage,
        seriousDamageTags: f.seriousDamageTagIds,
        noSeriousDamageTags: f.noSeriousDamageTagIds,
        note: f.note,
        audioNotes: f.audioNotes,
        paintworkThicknessFrom: f.paintworkThicknessFrom,
        paintworkThicknessTo: f.paintworkThicknessTo,
      }),
    );
    sec[el.collection] = arr;
    zonesCovered.add(f.section);
  }

  // 2) Legacy fallback: zone notes for sections not covered by findings.
  const notes = draft.inspectionStep.sectionNotes ?? {};
  for (const [zoneId, note] of Object.entries(notes)) {
    const text = note?.trim();
    if (!text) continue;
    const snake = ZONE_TO_SECTION_SNAKE[zoneId];
    if (!snake || zonesCovered.has(snake)) continue;
    const section = getSection(snake);
    const general = section.elements.find((e) => e.id === "generalCondition");
    if (!general) continue;
    const sec = out[section.doc];
    const arr = (sec[general.collection] as unknown[]) ?? [];
    const sectionType = SECTION_DOC_TO_TYPE[section.doc] ?? section.snake;
    arr.push(makeElement(sectionType, general.id, { hasFile: false }));
    sec[general.collection] = arr;
  }

  return out;
}


/**
 * Build the request payload for Storage.PrepareSpecialistReport from our local
 * draft, mapping to the Doc schema field names.
 */
function buildPrepareReportPayload(
  draft: ReportDraft,
  resolved: ResolvedCar,
): Record<string, unknown> {
  const car = draft.carStep;
  const ch = draft.characteristicsStep;
  const doc = draft.documentReconciliationStep;
  const td = draft.testDriveStep ?? {};
  const res = draft.resultStep ?? {};

  const docNote = doc.note?.trim();
  const summary = [res.summaryInspectionNote, docNote && `Документы: ${docNote}`]
    .filter(Boolean)
    .join("\n\n");

  const modelCarId = ch.modelCarId ?? resolved.modelCarId ?? undefined;
  const frameId = ch.modelGenerationRestylingFrameId ?? resolved.modelGenerationRestylingFrameId ?? undefined;

  const tdIncluded =
    typeof td.testDriveIsIncluded === "boolean"
      ? td.testDriveIsIncluded
      : td.notDone
        ? false
        : true;
  const intTags = (arr: unknown): number[] =>
    Array.isArray(arr)
      ? arr.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0)
      : [];

  return {
    reportName: draft.reportName || `Отчёт ${new Date().toISOString().slice(0, 10)}`,
    ...(draft.reportDate ? { reportDate: draft.reportDate } : {}),
    // CarStepDTO: unreadableVin / visuallyMileageNotMatchCondition — NotNull bool.
    carStep: {
      ...(car.vin ? { vin: car.vin } : {}),
      unreadableVin: car.unreadableVin === true,
      ...(car.gosNumber ? { gosNumber: car.gosNumber } : {}),
      ...(car.uriListing ? { uriListing: car.uriListing } : {}),
      ...(typeof car.mileage === "number" ? { mileage: car.mileage } : {}),
      visuallyMileageNotMatchCondition: car.visuallyMileageNotMatchCondition === true,
      ...(car.cityInspection ? { cityInspection: car.cityInspection } : {}),
      ...(car.dateInspection ? { dateInspection: car.dateInspection } : {}),
    },
    characteristicsStep: {
      ...(typeof modelCarId === "number" ? { modelCarId } : {}),
      ...(typeof frameId === "number" ? { modelGenerationRestylingFrameId: frameId } : {}),
      ...(ch.year ? { year: String(ch.year) } : {}),
      ...(typeof ch.engineVolume === "number" ? { engineVolume: ch.engineVolume } : {}),
      ...(ch.engineType ? { engineType: ch.engineType } : {}),
      ...(ch.transmission ? { transmission: ch.transmission } : {}),
      ...(ch.driveType ? { driveType: ch.driveType } : {}),
      ...(ch.color ? { color: ch.color } : {}),
      ...(ch.equipment ? { equipment: ch.equipment } : {}),
    },
    // DocumentReconciliationStepDTO: 3 NotNull bool, defaults = true.
    documentReconciliationStep: {
      ...(typeof doc.ownersCount === "number" ? { ownersCount: doc.ownersCount } : {}),
      ownerFullNameMatchWithPTSOrSTS:
        typeof doc.ownerFullNameMatchWithPTSOrSTS === "boolean"
          ? doc.ownerFullNameMatchWithPTSOrSTS
          : true,
      vinOnBodyMatchWithPTSOrSTS:
        typeof doc.vinOnBodyMatchWithPTSOrSTS === "boolean"
          ? doc.vinOnBodyMatchWithPTSOrSTS
          : true,
      engineModelMatchWithPTSOrSTS:
        typeof doc.engineModelMatchWithPTSOrSTS === "boolean"
          ? doc.engineModelMatchWithPTSOrSTS
          : true,
    },
    // LegalReviewStepDTO: otherLegalReviews — массив FileDTO, batchIds — int[].
    legalReviewStep: {
      otherLegalReviews: (draft.legalReviewStep?.otherMaterials ?? [])
        .filter((m) => !!m.filename)
        .map((m) => ({
          filename: m.filename,
          key: m.key ?? null,
          type: m.type,
          stepType: "legalReview",
        })),
      batchIds: [],
    },

    inspectionStep: buildInspectionStep(draft),
    // TestDriveStepDTO: все *IsWorkingProperly — NotNull bool, теги — int[].
    testDriveStep: {
      testDriveIsIncluded: tdIncluded,
      testDriveEngineTags: intTags(td.testDriveEngineTags),
      testDriveEngineIsWorkingProperly:
        typeof td.testDriveEngineIsWorkingProperly === "boolean"
          ? td.testDriveEngineIsWorkingProperly
          : true,
      testDriveTransmissionTags: intTags(td.testDriveTransmissionTags),
      testDriveTransmissionIsWorkingProperly:
        typeof td.testDriveTransmissionIsWorkingProperly === "boolean"
          ? td.testDriveTransmissionIsWorkingProperly
          : true,
      testDriveSteeringWheelTags: intTags(td.testDriveSteeringWheelTags),
      testDriveSteeringWheelIsWorkingProperly:
        typeof td.testDriveSteeringWheelIsWorkingProperly === "boolean"
          ? td.testDriveSteeringWheelIsWorkingProperly
          : true,
      testDriveSuspensionInDriveTags: intTags(td.testDriveSuspensionInDriveTags),
      testDriveSuspensionInDriveIsWorkingProperly:
        typeof td.testDriveSuspensionInDriveIsWorkingProperly === "boolean"
          ? td.testDriveSuspensionInDriveIsWorkingProperly
          : true,
      testDriveBrakesInDriveTags: intTags(td.testDriveBrakesInDriveTags),
      testDriveBrakesInDriveIsWorkingProperly:
        typeof td.testDriveBrakesInDriveIsWorkingProperly === "boolean"
          ? td.testDriveBrakesInDriveIsWorkingProperly
          : true,
      testDriveNote: td.testDriveNote ?? td.notes ?? null,
    },
    // ResultStepDTO: оба поля NotBlank.
    resultStep: {
      summaryInspectionNote: summary || "Отчёт по результатам осмотра.",
      resultSpecialistNote:
        res.resultSpecialistNote && res.resultSpecialistNote.trim()
          ? res.resultSpecialistNote
          : "Заключение специалиста.",
    },
  };
}

export interface PrepareReportResult {
  id: number;
  reportNumber: string;
  isDraft: boolean;
  uploadFiles: Array<{ filename: string; key: string; type: string; stepType: string }>;
}

/**
 * Submit draft → Storage.PrepareSpecialistReport. Returns a remote id (the
 * `reportNumber`) on success or a fallback note on failure.
 */
export interface PrepareUploadFile {
  filename: string;
  /** Финальный ключ S3 (в бакете отчётов), куда нужно положить файл. */
  key: string;
  type: string;
  stepType: string;
}

export async function submitReport(draft: ReportDraft): Promise<{
  remote: boolean;
  reportId?: string | number;
  reportNumericId?: number;
  method?: string;
  uploadFilesCount?: number;
  uploadFiles?: PrepareUploadFile[];
  note?: string;
}> {

  try {
    // 0) Resolve any pendingTagNames → real tag ids via Storage.AddUserTag.
    //    Mutates `draft.inspectionStep.findings` in place: created ids are
    //    moved into seriousDamageTagIds / noSeriousDamageTagIds; pending list
    //    is cleared on success. Failures are logged silently — server-side
    //    validation will surface unresolved tags via the response.
    try {
      const { addUserTag } = await import("./inspectionTags");
      const findings = draft.inspectionStep?.findings ?? {};
      for (const f of Object.values(findings)) {
        const pending = f.pendingTagNames ?? [];
        if (!pending.length) continue;
        const remaining: typeof pending = [];
        for (const p of pending) {
          const created = await addUserTag(
            f.section as SectionSnake,
            p.name,
            p.severity,
          );
          if (created?.id) {
            if (p.severity === "serious") {
              const ids = new Set(f.seriousDamageTagIds ?? []);
              ids.add(created.id);
              f.seriousDamageTagIds = [...ids];
            } else {
              const ids = new Set(f.noSeriousDamageTagIds ?? []);
              ids.add(created.id);
              f.noSeriousDamageTagIds = [...ids];
            }
          } else {
            remaining.push(p);
          }
        }
        f.pendingTagNames = remaining;
      }
    } catch {
      /* keep pending names — server will report if any blocking */
    }

    // 0b) Resolve test-drive tag NAMES (strings) → numeric ids. The AI/edit
    //     flows store tag names; the server expects int[]. Without this step
    //     `intTags()` silently drops every string and the backend rejects with
    //     "необходимо указать теги".
    try {
      const { loadTagsFor, findTagId, addUserTag } = await import("./inspectionTags");
      const td = draft.testDriveStep ?? {};
      const td2 = td as Record<string, unknown>;
      const TD_MAP: Array<{ key: string; section: string }> = [
        { key: "testDriveEngineTags", section: "engine" },
        { key: "testDriveTransmissionTags", section: "transmission" },
        { key: "testDriveSteeringWheelTags", section: "steering_wheel" },
        { key: "testDriveSuspensionInDriveTags", section: "suspension_in_drive" },
        { key: "testDriveBrakesInDriveTags", section: "brakes_in_drive" },
      ];
      for (const { key, section } of TD_MAP) {
        const arr = td2[key];
        if (!Array.isArray(arr) || arr.length === 0) continue;
        const ids: number[] = [];
        let catalogue: Awaited<ReturnType<typeof loadTagsFor>> | null = null;
        for (const v of arr) {
          if (typeof v === "number" && Number.isInteger(v) && v > 0) {
            ids.push(v);
            continue;
          }
          if (typeof v !== "string" || !v.trim()) continue;
          if (!catalogue) {
            try {
              catalogue = await loadTagsFor("testDrive", section);
            } catch {
              catalogue = [];
            }
          }
          const hit = findTagId(catalogue ?? [], v);
          if (hit?.id) {
            ids.push(hit.id);
            continue;
          }
          try {
            const created = await addUserTag(section, v, "non_serious", "testDrive");
            if (created?.id) ids.push(created.id);
          } catch {
            /* skip unresolved */
          }
        }
        td2[key] = Array.from(new Set(ids));
      }
      draft.testDriveStep = td2 as typeof draft.testDriveStep;
    } catch {
      /* fallthrough — server will surface the missing-tags error */
    }

    // Resolve modelCarId + modelGenerationRestylingFrameId on the fly if
    // missing — Doc requires one of them on characteristicsStep.
    let resolved: ResolvedCar = { modelCarId: null, modelGenerationRestylingFrameId: null, trace: [] };
    if (!draft.characteristicsStep.modelCarId) {
      resolved = await resolveCar(
        draft.characteristicsStep.brandName,
        draft.characteristicsStep.modelCarName,
        draft.characteristicsStep.year,
      );
    }

    const payload = buildPrepareReportPayload(draft, resolved);

    const r = await rpc<{ result?: PrepareReportResult } | PrepareReportResult>(
      "Storage.PrepareSpecialistReport",
      { report: payload },
    );
    const inner = (r as { result?: PrepareReportResult }).result ?? (r as PrepareReportResult);
    if (inner && inner.reportNumber) {
      const hints: string[] = [];
      if (resolved.modelCarId && !draft.characteristicsStep.modelCarId) {
        hints.push(`modelCarId=${resolved.modelCarId}`);
      }
      if (resolved.modelGenerationRestylingFrameId) {
        hints.push(`frameId=${resolved.modelGenerationRestylingFrameId}`);
      }
      const idHint = hints.length ? ` Распознан ${hints.join(", ")}.` : "";
      return {
        remote: true,
        reportId: inner.reportNumber,
        reportNumericId: inner.id,
        method: "Storage.PrepareSpecialistReport",
        uploadFilesCount: inner.uploadFiles?.length ?? 0,
        uploadFiles: inner.uploadFiles ?? [],
        note: `Черновик создан: ${inner.reportNumber}. Файлы для загрузки: ${inner.uploadFiles?.length ?? 0}.${idHint}`,
      };

    }
    return { remote: false, note: "Ответ сервера без reportNumber." };
  } catch (e) {
    if (e instanceof ApiError) {
      return {
        remote: false,
        note: `Отправка не удалась: ${e.message}. Черновик сохранён локально.`,
      };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { remote: false, note: `Отправка не удалась: ${msg}` };
  }
}

/**
 * Finalize report after files are uploaded → Storage.CompleteSpecialistReport.
 * `reportId` is the numeric `id` returned by PrepareSpecialistReport (preferred)
 * or the reportNumber as a fallback.
 */
export async function completeReport(reportId: string | number): Promise<{
  remote: boolean;
  note?: string;
}> {
  try {
    await rpc("Storage.CompleteSpecialistReport", { id: reportId });
    return { remote: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 5xx от апстрима возвращается как HTML — не показываем пользователю.
    const friendly = /HTTP 5\d\d|Bad gateway|<html|<!DOCTYPE/i.test(msg)
      ? "Сервис временно недоступен, попробуйте ещё раз через минуту."
      : msg;
    return { remote: false, note: friendly };
  }
}

/**
 * Загружает один файл в финальный ключ отчёта через S3 multipart upload.
 *
 * Источник байтов выбирается так:
 *   • `opts.blob` — приоритет (видео/документы, которые мы держали локально и
 *     никогда не загружали в temp-бакет);
 *   • иначе скачиваем из temp/ через `ObjectStorage.GetTemporaryViewUrlBucketTemp`
 *     (картинки, которые уже там лежат).
 *
 * Поток:
 *   1) ObjectStorage.InitiateMultipartUpload → uploadId
 *   2) делим blob на части по 5 МБ (последняя может быть меньше)
 *   3) для каждой части: ObjectStorage.GetPartUploadUrl → PUT в S3 → ETag
 *   4) ObjectStorage.CompleteMultipartUpload({ parts: [{PartNumber, ETag}…] })
 *   5) при ошибке — ObjectStorage.AbortMultipartUpload
 */
export async function uploadReportFileMultipart(opts: {
  reportNumber: string;
  filename: string;
  /** Ключ исходного файла во временном бакете (например `temp/foo.pdf`). */
  sourceKey?: string;
  /** Локальные байты (видео/документы, не загруженные заранее). */
  blob?: Blob;
  contentType?: string;
  /** 0..1, прогресс по байтам конкретного файла. */
  onProgress?: (fraction: number) => void;
}): Promise<{ ok: true } | { ok: false; note: string }> {
  const { reportNumber, filename } = opts;
  const PART_SIZE = 5 * 1024 * 1024; // 5 MB — минимум S3 multipart (кроме последней)
  let uploadId: string | undefined;
  try {
    // 1) забираем blob
    let blob: Blob | null = opts.blob ?? null;
    if (!blob) {
      const basename = (opts.sourceKey ?? filename).split("/").pop() ?? filename;
      const view = await rpc<{ url?: string }>(
        "ObjectStorage.GetTemporaryViewUrlBucketTemp",
        { filename: basename, expiresInSeconds: 3600 },
      );
      if (!view.url) {
        return { ok: false, note: "Не получен URL временного файла." };
      }
      blob = await (await fetch(view.url)).blob();
    }
    if (!blob || blob.size === 0) {
      return { ok: false, note: "Пустой файл." };
    }

    // 2) инициируем multipart
    const init = await rpc<{ uploadId: string; key: string }>(
      "ObjectStorage.InitiateMultipartUpload",
      { reportNumber, filename },
    );
    uploadId = init.uploadId;
    if (!uploadId) {
      return { ok: false, note: "Не получен uploadId от ObjectStorage." };
    }

    // 3) считаем количество частей
    const totalParts = Math.max(1, Math.ceil(blob.size / PART_SIZE));
    const parts: { partNumber: number; etag: string }[] = [];
    for (let i = 0; i < totalParts; i++) {
      const partNumber = i + 1;
      const start = i * PART_SIZE;
      const end = Math.min(start + PART_SIZE, blob.size);
      const chunk = blob.slice(start, end);
      const part = await rpc<{ url: string; partNumber: number }>(
        "ObjectStorage.GetPartUploadUrl",
        { reportNumber, filename, uploadId, partNumber },
      );
      const putRes = await fetch(part.url, {
        method: "PUT",
        body: chunk,
        headers: { "Content-Type": contentType },
      });
      if (!putRes.ok) {
        return { ok: false, note: `S3 PUT part ${partNumber}: ${putRes.status}` };
      }
      const etag = putRes.headers.get("ETag") ?? putRes.headers.get("etag");
      if (!etag) {
        return { ok: false, note: "S3 не вернул ETag (проверьте CORS expose ETag)." };
      }
      parts.push({ partNumber, etag: etag.replace(/"/g, "") });
      opts.onProgress?.(partNumber / totalParts);
    }

    // 4) завершаем multipart
    await rpc("ObjectStorage.CompleteMultipartUpload", {
      reportNumber,
      filename,
      uploadId,
      parts,
    });
    return { ok: true };
  } catch (e) {
    if (uploadId) {
      try {
        await rpc("ObjectStorage.AbortMultipartUpload", {
          reportNumber,
          filename,
          uploadId,
        });
      } catch {
        /* ignore */
      }
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, note: msg };
  }
}



