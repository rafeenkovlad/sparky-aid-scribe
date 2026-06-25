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
    result?: T;
    response?: string;
  };
  if (json.error) {
    throw new ApiError(`Storage ${method}: ${json.error.message}`, undefined, json.error.code);
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

import type { ReportDraft } from "./types";
import { resolveCar, type ResolvedCar } from "./carCatalog";
import {
  INSPECTION_SECTIONS,
  ZONE_TO_SECTION as ZONE_TO_SECTION_SNAKE,
  getSection,
  type SectionSnake,
} from "./inspectionSections";

/**
 * Build the inspectionStep payload from structured findings (preferred) plus
 * a legacy fallback: any zone note that did not yield findings is dropped as
 * a single element into the section's generalCondition collection so nothing
 * is lost.
 */
function buildInspectionStep(draft: ReportDraft): Record<string, unknown> {
  const out: Record<string, Record<string, unknown[]>> = {};
  for (const s of INSPECTION_SECTIONS) out[s.doc] = {};

  const findings = draft.inspectionStep.findings ?? {};
  const zonesCovered = new Set<string>();

  // 1) Structured findings → exact element collection.
  for (const f of Object.values(findings)) {
    const section = getSection(f.section as SectionSnake);
    if (!section) continue;
    const el = section.elements.find((e) => e.id === f.elementId);
    if (!el) continue;
    const sec = out[section.doc];
    const arr = (sec[el.collection] as unknown[] | undefined) ?? [];
    arr.push({
      noDamage: f.noDamage ?? true,
      ...(f.seriousDamageTagIds?.length
        ? { seriousDamageTags: f.seriousDamageTagIds }
        : {}),
      ...(f.noSeriousDamageTagIds?.length
        ? { noSeriousDamageTags: f.noSeriousDamageTagIds }
        : {}),
      ...(f.note ? { note: f.note } : {}),
      audioNotes: f.audioNotes ?? [],
    });
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
    const arr = (sec[general.collection] as unknown[] | undefined) ?? [];
    arr.push({ noDamage: true, note: text, audioNotes: [] });
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
  const frameId = resolved.modelGenerationRestylingFrameId ?? undefined;

  return {
    reportName: draft.reportName || `Отчёт ${new Date().toISOString().slice(0, 10)}`,
    ...(draft.reportDate ? { reportDate: draft.reportDate } : {}),
    carStep: {
      ...(car.vin ? { vin: car.vin } : {}),
      ...(car.unreadableVin ? { unreadableVin: true } : {}),
      ...(car.gosNumber ? { gosNumber: car.gosNumber } : {}),
      ...(car.uriListing ? { uriListing: car.uriListing } : {}),
      ...(typeof car.mileage === "number" ? { mileage: car.mileage } : {}),
      ...(car.visuallyMileageNotMatchCondition
        ? { visuallyMileageNotMatchCondition: true }
        : {}),
      ...(car.cityInspection ? { cityInspection: car.cityInspection } : {}),
      ...(car.dateInspection ? { dateInspection: car.dateInspection } : {}),
    },
    characteristicsStep: {
      ...(typeof modelCarId === "number" ? { modelCarId } : {}),
      ...(ch.year ? { year: String(ch.year) } : {}),
      ...(typeof ch.engineVolume === "number" ? { engineVolume: ch.engineVolume } : {}),
      ...(ch.engineType ? { engineType: ch.engineType } : {}),
      ...(ch.transmission ? { transmission: ch.transmission } : {}),
      ...(ch.driveType ? { driveType: ch.driveType } : {}),
      ...(ch.color ? { color: ch.color } : {}),
      ...(ch.equipment ? { equipment: ch.equipment } : {}),
    },
    documentReconciliationStep: {
      ...(typeof doc.ownersCount === "number" ? { ownersCount: doc.ownersCount } : {}),
      ...(typeof doc.ownerFullNameMatchWithPTSOrSTS === "boolean"
        ? { ownerFullNameMatchWithPTSOrSTS: doc.ownerFullNameMatchWithPTSOrSTS }
        : {}),
      ...(typeof doc.vinOnBodyMatchWithPTSOrSTS === "boolean"
        ? { vinOnBodyMatchWithPTSOrSTS: doc.vinOnBodyMatchWithPTSOrSTS }
        : {}),
      ...(typeof doc.engineModelMatchWithPTSOrSTS === "boolean"
        ? { engineModelMatchWithPTSOrSTS: doc.engineModelMatchWithPTSOrSTS }
        : {}),
    },
    legalReviewStep: {},
    inspectionStep: buildInspectionStep(draft),
    testDriveStep: {
      ...(typeof td.testDriveIsIncluded === "boolean"
        ? { testDriveIsIncluded: td.testDriveIsIncluded }
        : td.notDone
          ? { testDriveIsIncluded: false }
          : {}),
      ...(typeof td.testDriveEngineIsWorkingProperly === "boolean"
        ? { testDriveEngineIsWorkingProperly: td.testDriveEngineIsWorkingProperly }
        : {}),
      ...(typeof td.testDriveTransmissionIsWorkingProperly === "boolean"
        ? { testDriveTransmissionIsWorkingProperly: td.testDriveTransmissionIsWorkingProperly }
        : {}),
      ...(typeof td.testDriveSteeringWheelIsWorkingProperly === "boolean"
        ? { testDriveSteeringWheelIsWorkingProperly: td.testDriveSteeringWheelIsWorkingProperly }
        : {}),
      ...(typeof td.testDriveSuspensionInDriveIsWorkingProperly === "boolean"
        ? {
            testDriveSuspensionInDriveIsWorkingProperly:
              td.testDriveSuspensionInDriveIsWorkingProperly,
          }
        : {}),
      ...(typeof td.testDriveBrakesInDriveIsWorkingProperly === "boolean"
        ? { testDriveBrakesInDriveIsWorkingProperly: td.testDriveBrakesInDriveIsWorkingProperly }
        : {}),
      ...(td.testDriveEngineTags?.length ? { testDriveEngineTags: td.testDriveEngineTags } : {}),
      ...(td.testDriveTransmissionTags?.length
        ? { testDriveTransmissionTags: td.testDriveTransmissionTags }
        : {}),
      ...(td.testDriveSteeringWheelTags?.length
        ? { testDriveSteeringWheelTags: td.testDriveSteeringWheelTags }
        : {}),
      ...(td.testDriveSuspensionInDriveTags?.length
        ? { testDriveSuspensionInDriveTags: td.testDriveSuspensionInDriveTags }
        : {}),
      ...(td.testDriveBrakesInDriveTags?.length
        ? { testDriveBrakesInDriveTags: td.testDriveBrakesInDriveTags }
        : {}),
      ...(td.testDriveNote || td.notes
        ? { testDriveNote: td.testDriveNote ?? td.notes }
        : {}),
    },
    resultStep: {
      ...(summary ? { summaryInspectionNote: summary } : {}),
      ...(res.resultSpecialistNote ? { resultSpecialistNote: res.resultSpecialistNote } : {}),
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
export async function submitReport(draft: ReportDraft): Promise<{
  remote: boolean;
  reportId?: string | number;
  method?: string;
  note?: string;
}> {
  try {
    // Resolve modelCarId on the fly if missing — Doc requires it (or
    // modelGenerationRestylingFrameId) on characteristicsStep.
    let resolvedId: number | null = null;
    if (!draft.characteristicsStep.modelCarId) {
      resolvedId = await resolveModelCarId(
        draft.characteristicsStep.brandName,
        draft.characteristicsStep.modelCarName,
      );
    }

    const payload = buildPrepareReportPayload(draft, resolvedId);
    const r = await rpc<{ result?: PrepareReportResult } | PrepareReportResult>(
      "Storage.PrepareSpecialistReport",
      { report: payload },
    );
    const inner = (r as { result?: PrepareReportResult }).result ?? (r as PrepareReportResult);
    if (inner && inner.reportNumber) {
      const idHint =
        resolvedId && !draft.characteristicsStep.modelCarId
          ? ` Распознан modelCarId=${resolvedId}.`
          : "";
      return {
        remote: true,
        reportId: inner.reportNumber,
        method: "Storage.PrepareSpecialistReport",
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
