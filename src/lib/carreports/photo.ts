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

const DEFAULT_MAX_EDGE = 1600;
const DEFAULT_QUALITY = 0.82;
/** Hard size cap — 2 MB. */
const MAX_BYTES = 2 * 1024 * 1024;

export async function preparePhoto(
  file: File,
  opts: { maxBytes?: number } = {},
): Promise<PreparedPhoto> {
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const decoded = await ensureDecodable(file);
  const bitmap = await readImage(decoded);

  // Iteratively reduce quality, then dimensions, until under maxBytes.
  let edge = DEFAULT_MAX_EDGE;
  let quality = DEFAULT_QUALITY;
  let blob = await encodeJpeg(bitmap, edge, quality);
  // 1) reduce quality
  while (blob.size > maxBytes && quality > 0.4) {
    quality = Math.max(0.4, quality - 0.1);
    blob = await encodeJpeg(bitmap, edge, quality);
  }
  // 2) reduce dimensions
  while (blob.size > maxBytes && edge > 640) {
    edge = Math.round(edge * 0.8);
    quality = DEFAULT_QUALITY;
    blob = await encodeJpeg(bitmap, edge, quality);
    while (blob.size > maxBytes && quality > 0.4) {
      quality = Math.max(0.4, quality - 0.1);
      blob = await encodeJpeg(bitmap, edge, quality);
    }
  }

  const dataUrl = await blobToDataUrl(blob);
  const base = (file.name.replace(/\.[^.]+$/, "") || "photo").replace(/[^\w.-]+/g, "_");
  const filename = `${base}_${Date.now()}.jpg`;
  return { filename, blob, dataUrl };
}

async function encodeJpeg(
  bitmap: HTMLImageElement | ImageBitmap,
  maxEdge: number,
  quality: number,
): Promise<Blob> {
  const { width, height } = fitInside(bitmap.width, bitmap.height, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось обработать изображение");
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Канвас вернул пустой blob"))),
      "image/jpeg",
      quality,
    );
  });
}

/**
 * HEIC/HEIF не декодируется браузером напрямую — конвертируем в JPEG
 * через heic2any (lazy import, чтобы не тянуть пакет в основной бандл).
 */
async function ensureDecodable(file: File): Promise<File> {
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  const isHeic =
    type === "image/heic" ||
    type === "image/heif" ||
    type === "image/heic-sequence" ||
    type === "image/heif-sequence" ||
    name.endsWith(".heic") ||
    name.endsWith(".heif");
  if (!isHeic) return file;
  const mod = (await import("heic2any")).default as (opts: {
    blob: Blob;
    toType?: string;
    quality?: number;
  }) => Promise<Blob | Blob[]>;
  const out = await mod({ blob: file, toType: "image/jpeg", quality: 0.9 });
  const blob = Array.isArray(out) ? out[0] : out;
  const base = (file.name.replace(/\.[^.]+$/, "") || "photo");
  return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
}

async function readImage(file: Blob): Promise<HTMLImageElement | ImageBitmap> {
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
 * Загружает фото во временное объектное хранилище через
 * `ObjectStorage.GetTemporaryUploadUrlBucketTemp` (presigned PUT/POST).
 * Возвращает подписанный GET URL загруженного файла (для передачи в AI).
 */
export async function uploadTemporary(photo: PreparedPhoto): Promise<{
  filename: string;
  url: string;
  key?: string;
}> {
  type PresignResult = {
    url?: string;
    uploadUrl?: string;
    postUrl?: string;
    putUrl?: string;
    fields?: Record<string, string>;
    formData?: Record<string, string>;
    key?: string;
    filename?: string;
    downloadUrl?: string;
    publicUrl?: string;
    getUrl?: string;
    fileUrl?: string;
  };
  const r = await rpc<PresignResult>("ObjectStorage.GetTemporaryUploadUrlBucketTemp", {
    filename: photo.filename,
    contentType: "image/jpeg",
  });
  const uploadUrl = r.url ?? r.uploadUrl ?? r.putUrl ?? r.postUrl;
  if (!uploadUrl) {
    throw new ApiError("ObjectStorage.GetTemporaryUploadUrlBucketTemp: пустой url", 500);
  }
  const fields = r.fields ?? r.formData ?? {};
  const hasFields = Object.keys(fields).length > 0;
  let res: Response;
  if (hasFields) {
    // S3 presigned POST.
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append("file", photo.blob, photo.filename);
    res = await fetch(uploadUrl, { method: "POST", body: form });
  } else {
    // Presigned PUT.
    res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: photo.blob,
    });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(`Upload ${res.status} ${body.slice(0, 200)}`, res.status);
  }
  const key = r.key ?? r.filename ?? fields.key ?? photo.filename;
  // AI ожидает presigned GET URL, а не прямую ссылку на S3.
  const basename = (key ?? photo.filename).split("/").pop() ?? photo.filename;
  const view = await rpc<{ url?: string; key?: string }>(
    "ObjectStorage.GetTemporaryViewUrl",
    { reportNumber: "temp", filename: basename, expiresInSeconds: 3600 },
  );
  if (!view.url) {
    throw new ApiError("ObjectStorage.GetTemporaryViewUrl: пустой url", 500);
  }
  return { filename: basename, url: view.url, key };
}


/**
 * Обёртка для совместимости со старым кодом: пытается загрузить во временное
 * хранилище; при ошибке возвращает локальный fallback с note.
 */
export async function uploadPhoto(photo: PreparedPhoto): Promise<{
  filename: string;
  remote: boolean;
  url?: string;
  note?: string;
}> {
  try {
    const r = await uploadTemporary(photo);
    return { filename: r.filename, remote: true, url: r.url };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ошибка загрузки";
    return {
      filename: photo.filename,
      remote: false,
      note: `Загрузка на сервер не удалась (${msg}). Фото сохранено локально в черновике.`,
    };
  }
}
