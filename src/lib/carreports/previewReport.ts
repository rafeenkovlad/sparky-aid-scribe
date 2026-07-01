// External preview integration for VIN DIEZEL report preview page.
// Opens https://<report-host>/?token=preview in a new tab and streams
// the current draft as CarReport JSON via postMessage.

import type { ReportDraft, InspectionPhoto } from "./types";
import { buildPrepareReportPayload, rpc } from "./storageApi";
import { resolveCar, type ResolvedCar } from "./carCatalog";
import { uploadTemporary } from "./photo";
import { getPhoto } from "./photoCache";

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

/**
 * Гарантирует, что у каждого фото осмотра есть свежая подписанная ссылка на
 * temp-бакет. Если у фото уже есть публичный URL — используем его; иначе
 * пробуем запросить свежий view-URL по имени файла; если и это не удалось —
 * поднимаем blob из IndexedDB и заливаем в temp-бакет заново.
 *
 * ВАЖНО: видео и документы в temp-бакет не выгружаем — превью их скроет.
 */
async function ensurePreviewPhotoUrls(
  photos: InspectionPhoto[],
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  for (const p of photos) {
    if (!p.filename) continue;
    if (isPublicUrl(p.url)) {
      urls.set(p.filename, p.url);
      continue;
    }
    // 1) свежий signed view URL по basename.
    try {
      const basename = p.filename.split("/").pop() ?? p.filename;
      const view = await rpc<{ url?: string }>(
        "ObjectStorage.GetTemporaryViewUrlBucketTemp",
        { filename: basename, expiresInSeconds: 3600 },
      );
      if (isPublicUrl(view.url)) {
        urls.set(p.filename, view.url);
        continue;
      }
    } catch {
      /* ignore, попробуем перезалить */
    }
    // 2) blob из IDB → uploadTemporary.
    if (p.photoId) {
      try {
        const blob = await getPhoto(p.photoId);
        if (blob) {
          const up = await uploadTemporary(
            { filename: p.filename, blob, photoId: p.photoId },
            { contentType: blob.type || "image/jpeg" },
          );
          urls.set(p.filename, up.url);
          continue;
        }
      } catch {
        /* фото пропустим — превью покажет заглушку */
      }
    }
  }
  return urls;
}

/** Обогащаем payload url'ами файлов. */
function attachFileUrls(
  payload: Record<string, unknown>,
  draft: ReportDraft,
  photoUrls: Map<string, string>,
): void {
  // 1) legalReviewStep.otherLegalReviews — только для картинок с публичным URL.
  //    Видео/документы отдаём без url — превью их скроет.
  const legal = (payload.legalReviewStep as { otherLegalReviews?: Array<Record<string, unknown>> })
    ?.otherLegalReviews;
  if (Array.isArray(legal)) {
    const materials = draft.legalReviewStep?.otherMaterials ?? [];
    for (const item of legal) {
      const m = materials.find((x) => x.filename === item.filename);
      const url = m && m.type === "image" && isPublicUrl(m.url) ? m.url : "";
      item.url = url;
    }
  }

  // 2) inspectionStep: прикрепляем file={filename,url,type=image} к каждому
  //    элементу, для которого есть загруженное фото.
  const insp = payload.inspectionStep as Record<string, Record<string, unknown>> | undefined;
  const photos = draft.inspectionStep?.photos ?? [];
  if (insp && photos.length) {
    for (const section of Object.values(insp)) {
      for (const [, coll] of Object.entries(section)) {
        if (!Array.isArray(coll)) continue;
        for (const el of coll as Array<Record<string, unknown>>) {
          const elementType = el.elementType as string | undefined;
          const sectionType = el.sectionType as string | undefined;
          if (!elementType || !sectionType) continue;
          const photo = photos.find(
            (p) =>
              !!p.elementId &&
              camelOrSnakeEq(p.elementId, elementType) &&
              sectionMatches(p.section, sectionType) &&
              photoUrls.has(p.filename),
          );
          if (photo) {
            el.file = {
              filename: photo.filename,
              url: photoUrls.get(photo.filename) ?? "",
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
  // Только фото: заливаем недостающие в temp-бакет и собираем свежие URL'ы.
  // Видео/документы намеренно игнорируем.
  const photoUrls = await ensurePreviewPhotoUrls(draft.inspectionStep?.photos ?? []);
  const payload = buildPrepareReportPayload(draft, resolved);
  attachFileUrls(payload, draft, photoUrls);
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

