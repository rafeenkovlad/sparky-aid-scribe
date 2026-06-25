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

/**
 * Build the request payload for Storage.PrepareSpecialistReport from our local
 * draft, mapping to the Doc schema field names.
 */
function buildPrepareReportPayload(draft: ReportDraft): Record<string, unknown> {
  const car = draft.carStep;
  const ch = draft.characteristicsStep;
  const doc = draft.documentReconciliationStep;
  const ins = draft.inspectionStep;
  const td = draft.testDriveStep ?? {};
  const res = draft.resultStep ?? {};

  // Append free-form zone notes to summaryInspectionNote so the data is not lost
  // until we wire structured inspection sections per Doc schema.
  const zoneNotes = Object.entries(ins.sectionNotes)
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `[${k}] ${v.trim()}`)
    .join("\n");
  const docNote = doc.note?.trim();
  const summary = [res.summaryInspectionNote, docNote && `Документы: ${docNote}`, zoneNotes]
    .filter(Boolean)
    .join("\n\n");

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
      // NOTE: Doc требует modelCarId или modelGenerationRestylingFrameId.
      // brandName/modelCarName храним локально, на сервер не отправляем.
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
    // TODO: распределить ins.sectionNotes по структуре bodySection/glassSection/…
    inspectionStep: {},
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
    const payload = buildPrepareReportPayload(draft);
    const r = await rpc<{ result?: PrepareReportResult } | PrepareReportResult>(
      "Storage.PrepareSpecialistReport",
      { report: payload },
    );
    const inner = (r as { result?: PrepareReportResult }).result ?? (r as PrepareReportResult);
    if (inner && inner.reportNumber) {
      return {
        remote: true,
        reportId: inner.reportNumber,
        method: "Storage.PrepareSpecialistReport",
        note: `Черновик создан: ${inner.reportNumber}. Файлы для загрузки: ${inner.uploadFiles?.length ?? 0}.`,
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
