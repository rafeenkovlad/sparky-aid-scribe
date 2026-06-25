// Tiny localStorage-backed token store, browser-only.

const KEY = "carreports.token";
const listeners = new Set<() => void>();
let cached: string | null | undefined; // undefined = not read yet

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  if (cached === undefined) {
    try {
      cached = window.localStorage.getItem(KEY);
    } catch {
      cached = null;
    }
  }
  return cached ?? null;
}

export function setToken(value: string | null) {
  if (typeof window === "undefined") return;
  cached = value;
  try {
    if (value) window.localStorage.setItem(KEY, value);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* ignore quota */
  }
  for (const l of listeners) l();
}

export function subscribeToken(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
