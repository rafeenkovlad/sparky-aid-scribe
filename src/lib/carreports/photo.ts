// Client-side photo pipeline:
// 1) downscale to JPEG (≤ ~1600px long edge, q=0.82) для отправки в AI/хранилище
// 2) генерируем тонкий thumb (≤ 256 px, ~5–30 КБ) для мгновенного превью в UI
// 3) полный blob кешируем в IndexedDB под стабильным photoId — состояние треда
//    хранит только { photoId, filename, url?, dataUrl (thumb) }, без base64 на
//    весь файл. Это экономит RAM и квоту localStorage.

import { ApiError, rpc } from "./storageApi";
import { getPhoto, newPhotoId, putPhoto } from "./photoCache";

export interface PreparedPhoto {
  /** стабильный id для IndexedDB-кеша полного blob'а */
  photoId: string;
  /** display name */
  filename: string;
  /** JPEG blob ready to upload */
  blob: Blob;
  /** тонкий 256-px JPEG-thumb в виде data: URL для UI-превью */
  dataUrl: string;
}

const DEFAULT_MAX_EDGE = 1600;
const DEFAULT_QUALITY = 0.82;
/** Hard size cap — 2 MB. */
const MAX_BYTES = 2 * 1024 * 1024;
/** Размер thumb для UI (256 px по длинной стороне). */
const THUMB_EDGE = 256;
const THUMB_QUALITY = 0.7;

export async function preparePhoto(
  file: File,
  opts: { maxBytes?: number } = {},
): Promise<PreparedPhoto> {
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const decoded = await ensureDecodable(file);

  // Если файл уже в пределах лимита и в браузеро-декодируемом формате —
  // не пережимаем, грузим оригинал.
  const decodedType = (decoded.type || "").toLowerCase();
  const passthroughOk =
    decoded.size <= maxBytes &&
    (decodedType === "image/jpeg" ||
      decodedType === "image/png" ||
      decodedType === "image/webp");

  let blob: Blob;
  let bitmap: HTMLImageElement | ImageBitmap;
  let filename: string;
  if (passthroughOk) {
    bitmap = await readImage(decoded);
    blob = decoded;
    const ext = decodedType === "image/png"
      ? ".png"
      : decodedType === "image/webp"
        ? ".webp"
        : ".jpg";
    const base = (decoded.name || file.name).replace(/\.[^.]+$/, "") || "photo";
    const safe = base.replace(/[^\w.-]+/g, "_");
    filename = `${safe}_${Date.now()}${ext}`;
  } else {
    bitmap = await readImage(decoded);
    // Iteratively reduce quality, then dimensions, until under maxBytes.
    let edge = DEFAULT_MAX_EDGE;
    let quality = DEFAULT_QUALITY;
    blob = await encodeJpeg(bitmap, edge, quality);
    while (blob.size > maxBytes && quality > 0.4) {
      quality = Math.max(0.4, quality - 0.1);
      blob = await encodeJpeg(bitmap, edge, quality);
    }
    while (blob.size > maxBytes && edge > 640) {
      edge = Math.round(edge * 0.8);
      quality = DEFAULT_QUALITY;
      blob = await encodeJpeg(bitmap, edge, quality);
      while (blob.size > maxBytes && quality > 0.4) {
        quality = Math.max(0.4, quality - 0.1);
        blob = await encodeJpeg(bitmap, edge, quality);
      }
    }
    const base = (file.name.replace(/\.[^.]+$/, "") || "photo").replace(/[^\w.-]+/g, "_");
    filename = `${base}_${Date.now()}.jpg`;
  }

  // Тонкий thumb (≤ 256 px) — только для превью в UI / fallback'а.
  const thumbBlob = await encodeJpeg(bitmap, THUMB_EDGE, THUMB_QUALITY);
  const dataUrl = await blobToDataUrl(thumbBlob);

  // Полный blob уезжает в IndexedDB, чтобы не лежать в React state / LS.
  const photoId = newPhotoId();
  try {
    await putPhoto(photoId, blob);
  } catch {
    /* best-effort */
  }

  return { photoId, filename, blob, dataUrl };
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
export async function uploadTemporary(
  photo: { filename: string; blob: Blob; dataUrl?: string; photoId?: string },
  opts: { contentType?: string } = {},
): Promise<{
  filename: string;
  url: string;
  key?: string;
}> {
  const contentType = opts.contentType ?? (photo.blob.type || "image/jpeg");
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
    contentType,
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
      headers: { "Content-Type": contentType },
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
    "ObjectStorage.GetTemporaryViewUrlBucketTemp",
    { filename: basename, expiresInSeconds: 3600 },
  );
  if (!view.url) {
    throw new ApiError("ObjectStorage.GetTemporaryViewUrlBucketTemp: пустой url", 500);
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



/**
 * Категория файла по MIME / расширению — для FileDTO бэкенда.
 * Бэкенд принимает только: image | video | document.
 */
export function classifyFile(file: { name?: string; type?: string }): "image" | "video" | "document" {
  const t = (file.type ?? "").toLowerCase();
  const n = (file.name ?? "").toLowerCase();
  if (t.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/.test(n))
    return "image";
  if (t.startsWith("video/") || /\.(mp4|mov|avi|mkv|webm|m4v)$/.test(n)) return "video";
  return "document";
}

/**
 * Универсальная загрузка произвольного файла во временное объектное хранилище.
 * Не сжимает и не конвертирует — отправляет файл как есть с его MIME-типом.
 * Возвращает имя на сервере, presigned GET URL и S3-ключ.
 */
export async function uploadFile(file: File): Promise<{
  filename: string;
  url: string;
  key?: string;
  type: "image" | "video" | "document";
  size: number;
  mimeType: string;
}> {
  const kind = classifyFile(file);

  // Картинки (включая HEIC/HEIF) — конвертируем в JPEG и ужимаем до ≤2МБ,
  // чтобы укладываться в лимит бакета temp-carreports-files.
  if (kind === "image") {
    const prepared = await preparePhoto(file);
    const mime = prepared.blob.type || "image/jpeg";
    const up = await uploadTemporary(prepared, { contentType: mime });
    return {
      filename: up.filename,
      url: up.url,
      key: up.key,
      type: "image",
      size: prepared.blob.size,
      mimeType: mime,
    };
  }


  const contentType = file.type || "application/octet-stream";
  const safeBase = (file.name.replace(/\.[^.]+$/, "") || "file").replace(/[^\w.-]+/g, "_");
  const ext = (file.name.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
  const filename = `${safeBase}_${Date.now()}${ext}`;
  if (file.size > MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    throw new ApiError(
      `Файл слишком большой (${mb} МБ). Лимит — 2 МБ. Сожмите или загрузите по частям.`,
      413,
    );
  }
  const up = await uploadTemporary(
    { filename, blob: file, dataUrl: "" },
    { contentType },
  );
  return {
    filename: up.filename,
    url: up.url,
    key: up.key,
    type: kind,
    size: file.size,
    mimeType: contentType,
  };
}


/**
 * Парсит срок жизни presigned-URL по `X-Amz-Date` + `X-Amz-Expires`. Возвращает
 * `null`, если ссылка не AWS SigV4 (в т.ч. локальная) или параметры не читаемы.
 */
function presignedExpiryMs(url: string): number | null {
  try {
    const u = new URL(url);
    const date = u.searchParams.get("X-Amz-Date");
    const exp = u.searchParams.get("X-Amz-Expires");
    if (!date || !exp) return null;
    // X-Amz-Date: YYYYMMDDTHHMMSSZ
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(date);
    if (!m) return null;
    const issuedAt = Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6]),
    );
    const seconds = Number(exp);
    if (!Number.isFinite(seconds)) return null;
    return issuedAt + seconds * 1000;
  } catch {
    return null;
  }
}

/**
 * Проверяет, доступна ли картинка по URL, и если нет — повторно загружает её
 * во временное хранилище из локального dataUrl и возвращает новый presigned
 * GET URL. Если URL рабочий — возвращает его без изменений.
 *
 * Стратегия:
 *  1) Если URL — это AWS presigned GET, читаем `X-Amz-Date`+`X-Amz-Expires`
 *     и считаем URL валидным, если до истечения ≥ 60с. Это избавляет от
 *     ложных «недоступно» из-за CORS/HEAD-ограничений S3 (HEAD на
 *     presigned-GET даёт 403, а Range требует CORS allow-headers).
 *  2) Иначе пробуем лёгкий Range-GET (без HEAD, чтобы не упереться в CORS).
 *  3) Если всё равно недоступно — перезаливаем из локального dataUrl.
 *
 * Если ни URL, ни dataUrl не дают результата — возвращает `null`.
 */
export async function ensurePhotoAccessible(opts: {
  url?: string;
  dataUrl?: string;
  filename?: string;
}): Promise<string | null> {
  const { url, dataUrl, filename } = opts;

  // 1) Быстрая проверка по сроку жизни presigned-URL — без сетевого запроса.
  if (url) {
    const expiryMs = presignedExpiryMs(url);
    if (expiryMs !== null) {
      if (expiryMs - Date.now() > 60_000) return url;
      // URL истёк или вот-вот истечёт — сразу к шагу 3.
    } else {
      // Не presigned (или нечитаемый) — пробуем сетевой Range-GET.
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: { Range: "bytes=0-0" },
        }).catch(() => null);
        if (res && (res.ok || res.status === 206)) return url;
      } catch {
        // ignore — пойдём перезаливать
      }
    }
  }

  // 2) Перезаливаем из локального превью.
  if (!dataUrl) return url ?? null;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const name = filename ?? `photo-${Date.now()}.jpg`;
    const r = await uploadTemporary({ filename: name, blob, dataUrl });
    return r.url;
  } catch {
    return url ?? null;
  }
}

