// External preview integration for VIN DIEZEL report preview page.
// Opens https://<report-host>/?token=preview in a new tab and streams
// the current draft as CarReport JSON via postMessage.

import type { ReportDraft } from "./types";
import { buildPrepareReportPayload } from "./storageApi";
import { resolveCar, type ResolvedCar } from "./carCatalog";

const PREVIEW_URL =
  (import.meta.env.VITE_PREVIEW_URL as string | undefined) ||
  "https://vindiezel.ru/?token=preview";
const PREVIEW_MESSAGE_TYPE = "vin-diezel:preview";
const PREVIEW_READY_TYPE = "vin-diezel:preview-ready";
const PREVIEW_STORAGE_KEY = "vin-diezel:preview-report";

/** true, если URL — публичный https/http, а не blob:/file:/data:. */
function isPublicUrl(u: unknown): u is string {
  return typeof u === "string" && /^https?:\/\//i.test(u);
}

/** Обогащаем payload url'ами файлов (для тех, у кого есть публичный URL). */
function attachFileUrls(
  payload: Record<string, unknown>,
  draft: ReportDraft,
): void {
  // 1) legalReviewStep.otherLegalReviews — прикрепить url из материала.
  const legal = (payload.legalReviewStep as { otherLegalReviews?: Array<Record<string, unknown>> })
    ?.otherLegalReviews;
  if (Array.isArray(legal)) {
    const materials = draft.legalReviewStep?.otherMaterials ?? [];
    for (const item of legal) {
      const m = materials.find((x) => x.filename === item.filename);
      const url = isPublicUrl(m?.url) ? m!.url : "";
      item.url = url;
    }
  }

  // 2) inspectionStep: для каждого элемента положить file={filename,url,type}
  //    если у нас есть удалённое фото на секцию+элемент.
  const insp = payload.inspectionStep as Record<string, Record<string, unknown>> | undefined;
  const photos = draft.inspectionStep?.photos ?? [];
  if (insp && photos.length) {
    // Собираем first-remote-photo по (sectionType, elementType).
    // sectionType/elementType в payload соответствуют photo.section/elementId
    // с точностью до snake_case, поэтому матчим по photo.filename → элементу.
    for (const section of Object.values(insp)) {
      for (const [, coll] of Object.entries(section)) {
        if (!Array.isArray(coll)) continue;
        for (const el of coll as Array<Record<string, unknown>>) {
          const elementType = el.elementType as string | undefined;
          const sectionType = el.sectionType as string | undefined;
          if (!elementType || !sectionType) continue;
          const photo = photos.find(
            (p) =>
              (p.elementId && camelOrSnakeEq(p.elementId, elementType)) &&
              sectionMatches(p.section, sectionType) &&
              isPublicUrl(p.url),
          );
          if (photo) {
            el.file = {
              filename: photo.filename,
              url: photo.url,
              type: "image",
            };
          }
        }
      }
    }
  }
}

function camelOrSnakeEq(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/_/g, "").toLowerCase();
  return norm(a) === norm(b);
}

function sectionMatches(photoSection: string, sectionType: string): boolean {
  const norm = (s: string) => s.replace(/_/g, "").toLowerCase();
  return norm(photoSection).startsWith(norm(sectionType)) ||
    norm(sectionType).startsWith(norm(photoSection));
}

/** Собирает CarReport-JSON для превью. */
export async function buildPreviewReport(draft: ReportDraft): Promise<Record<string, unknown>> {
  let resolved: ResolvedCar = {
    modelCarId: draft.characteristicsStep.modelCarId ?? null,
    modelGenerationRestylingFrameId:
      draft.characteristicsStep.modelGenerationRestylingFrameId ?? null,
    trace: [],
  };
  if (!resolved.modelCarId && !resolved.modelGenerationRestylingFrameId) {
    try {
      resolved = await resolveCar(
        draft.characteristicsStep.brandName,
        draft.characteristicsStep.modelCarName,
        draft.characteristicsStep.year,
      );
    } catch {
      /* игнорируем — для превью не критично */
    }
  }
  const payload = buildPrepareReportPayload(draft, resolved);
  attachFileUrls(payload, draft);
  return payload;
}

/**
 * Открывает превью в новой вкладке и отправляет туда JSON отчёта.
 * ВАЖНО: window.open ДОЛЖЕН вызываться синхронно из клика (Safari/iOS
 * иначе блокируют попап). Поэтому используем двухшаговый API:
 *   1) openPreviewWindow() — sync, возвращает Window|null.
 *   2) deliverPreviewReport(win, report) — async, шлёт JSON.
 */
export function openPreviewWindow(): Window | null {
  return window.open(PREVIEW_URL, "_blank", "noopener=no");
}

export function deliverPreviewReport(
  previewWindow: Window | null,
  report: Record<string, unknown>,
): void {
  // Фолбэк-канал: sessionStorage — превью-страница читает его,
  // если postMessage не долетел.
  try {
    sessionStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(report));
  } catch {
    /* ignore quota */
  }

  if (!previewWindow) {
    // Попап заблокирован — открываем ещё раз (данные уже в storage).
    window.open(PREVIEW_URL, "_blank");
    return;
  }

  const targetOrigin = new URL(PREVIEW_URL).origin;

  const onMessage = (event: MessageEvent) => {
    if (event.origin !== targetOrigin) return;
    if (event.source !== previewWindow) return;
    const data = event.data as { type?: string } | null;
    if (!data || data.type !== PREVIEW_READY_TYPE) return;
    try {
      previewWindow.postMessage({ type: PREVIEW_MESSAGE_TYPE, report }, targetOrigin);
    } catch {
      /* окно могло закрыться */
    }
    window.removeEventListener("message", onMessage);
  };
  window.addEventListener("message", onMessage);

  // Страховка: если ready-сигнал не пришёл — попытаться отправить всё равно.
  setTimeout(() => {
    try {
      previewWindow.postMessage({ type: PREVIEW_MESSAGE_TYPE, report }, targetOrigin);
    } catch {
      /* ignore */
    }
    window.removeEventListener("message", onMessage);
  }, 5000);
}

