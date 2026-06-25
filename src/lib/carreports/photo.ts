// Client-side photo pipeline:
// 1) downscale to JPEG (≤ ~1600px long edge, q=0.82)
// 2) try presigned PUT via Storage (best-effort)
// 3) fall back to keeping the data URL locally for preview
//
// Final shape stored in thread.draft.inspectionStep.photos[i]:
//   { section, filename, dataUrl? }

import { ApiError, rpc } from "./storageApi";

export interface PreparedPhoto {
  /** display name */
  filename: string;
  /** JPEG blob ready to upload */
  blob: Blob;
  /** small in-memory preview */
  dataUrl: string;
}

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const bitmap = await readImage(file);
  const { width, height } = fitInside(bitmap.width, bitmap.height, MAX_EDGE);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось обработать изображение");
  ctx.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Канвас вернул пустой blob"))),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
  const dataUrl = await blobToDataUrl(blob);
  const base = (file.name.replace(/\.[^.]+$/, "") || "photo").replace(/[^\w.-]+/g, "_");
  const filename = `${base}_${Date.now()}.jpg`;
  return { filename, blob, dataUrl };
}

async function readImage(file: File): Promise<HTMLImageElement | ImageBitmap> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fallback below */
    }
  }
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не удалось прочитать файл"));
    };
    img.src = url;
  });
}

function fitInside(w: number, h: number, max: number): { width: number; height: number } {
  if (w <= max && h <= max) return { width: w, height: h };
  const r = w >= h ? max / w : max / h;
  return { width: Math.round(w * r), height: Math.round(h * r) };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Чтение blob не удалось"));
    r.readAsDataURL(blob);
  });
}

/**
 * Best-effort presigned PUT. We try a few likely method names and gracefully
 * fall back if the backend doesn't expose them yet — the local data URL keeps
 * preview/draft working either way.
 */
export async function uploadPhoto(photo: PreparedPhoto): Promise<{
  filename: string;
  remote: boolean;
  note?: string;
}> {
  const candidates = [
    "Storage.RequestUploadUrl",
    "Storage.GetUploadUrl",
    "Storage.CreateUpload",
  ];
  let lastErr: unknown = null;
  for (const method of candidates) {
    try {
      const r = await rpc<{ url?: string; filename?: string; key?: string }>(method, {
        filename: photo.filename,
        contentType: "image/jpeg",
      });
      const url = (r as { url?: string }).url;
      const key = (r as { filename?: string; key?: string }).filename ?? (r as { key?: string }).key;
      if (!url) {
        lastErr = new Error(`${method}: no url`);
        continue;
      }
      const put = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: photo.blob,
      });
      if (!put.ok) {
        lastErr = new Error(`PUT ${put.status}`);
        continue;
      }
      return { filename: key ?? photo.filename, remote: true };
    } catch (e) {
      lastErr = e;
      if (e instanceof ApiError && e.status && e.status >= 500) break;
    }
  }
  const note =
    lastErr instanceof Error
      ? `Загрузка на сервер пока недоступна (${lastErr.message}). Фото сохранено локально в черновике.`
      : "Загрузка на сервер пока недоступна. Фото сохранено локально в черновике.";
  return { filename: photo.filename, remote: false, note };
}
