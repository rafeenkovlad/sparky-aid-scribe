// IndexedDB-backed photo blob cache.
//
// Хранит полноразмерные blob'ы фотографий по стабильному photoId, чтобы:
//   • не таскать base64-копию по JS-state (RAM);
//   • не раздувать localStorage (драфт треда хранит только photoId + тонкий thumb);
//   • при истечении presigned URL можно перезалить файл из IDB, а не из dataUrl.
//
// Превью (≤ 256 px) при этом продолжает жить в `dataUrl` поля фото — это
// несколько килобайт и нужно для мгновенной отрисовки коллажа без обращения к IDB.

const DB_NAME = "carreports";
const DB_VERSION = 1;
const STORE = "photos";

let dbPromise: Promise<IDBDatabase | null> | null = null;
/** In-memory fallback, если IndexedDB недоступен (private mode и т.п.). */
const memoryStore = new Map<string, Blob>();

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function openDB(): Promise<IDBDatabase | null> {
  if (!isBrowser()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export function newPhotoId(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function putPhoto(id: string, blob: Blob): Promise<void> {
  const db = await openDB();
  if (!db) {
    memoryStore.set(id, blob);
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      memoryStore.set(id, blob);
      resolve();
    }
  });
}

export async function getPhoto(id: string): Promise<Blob | null> {
  if (!id) return null;
  const db = await openDB();
  if (!db) return memoryStore.get(id) ?? null;
  return new Promise<Blob | null>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => {
        const v = req.result as Blob | undefined;
        resolve(v instanceof Blob ? v : memoryStore.get(id) ?? null);
      };
      req.onerror = () => resolve(memoryStore.get(id) ?? null);
    } catch {
      resolve(memoryStore.get(id) ?? null);
    }
  });
}

export async function deletePhoto(id: string): Promise<void> {
  memoryStore.delete(id);
  const db = await openDB();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function listPhotoIds(): Promise<string[]> {
  const db = await openDB();
  if (!db) return [...memoryStore.keys()];
  return new Promise<string[]>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/** Удаляет всё, чего нет в `keep`. Безопасно: ошибки молча игнорируются. */
export async function gcOrphans(keep: ReadonlySet<string>): Promise<number> {
  const ids = await listPhotoIds();
  let removed = 0;
  for (const id of ids) {
    if (!keep.has(id)) {
      await deletePhoto(id);
      removed += 1;
    }
  }
  return removed;
}
