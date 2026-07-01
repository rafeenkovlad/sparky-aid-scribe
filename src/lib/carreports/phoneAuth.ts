// Phone-call authentication for carreports Storage API.
//
// Flow:
//   1. Storage.Auth({ phone }) → { callToPhone, notificationToken, ... }
//      Пользователю показывается номер callToPhone, куда нужно позвонить с
//      указанного phone.
//   2. Каждые 3 секунды дергаем Storage.AuthVerify (Bearer = notificationToken)
//      пока accessToken !== null → значит пользователь позвонил.
//   3. Сохраняем accessToken как рабочий, refreshToken — на будущее.

const STORAGE_URL = "/api/cr-proxy?target=storage";
const REFRESH_KEY = "carreports.refreshToken";

let idCounter = 1;

async function rpc<T>(method: string, params: Record<string, unknown>, token?: string): Promise<T> {
  const id = idCounter++;
  const url = token ? `${STORAGE_URL}&token=${encodeURIComponent(token)}` : STORAGE_URL;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  if (!res.ok) {
    throw new Error(`${method}: HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    response?: string;
    result?: T;
    errors?: Array<{ field?: string; message?: string }> | string;
  };
  if (json.response === "error") {
    const errs = json.errors;
    let msg = "Ошибка";
    if (typeof errs === "string") msg = errs;
    else if (Array.isArray(errs) && errs.length) {
      msg = errs.map((e) => e.message || e.field || "").filter(Boolean).join("; ") || msg;
    }
    throw new Error(msg);
  }
  return json.result as T;
}

export interface AuthStartResult {
  phone: string | null;
  email: string | null;
  callToPhone: string;
  notificationToken: string;
}

export async function authByPhone(phone: string): Promise<AuthStartResult> {
  return rpc<AuthStartResult>("Storage.Auth", { phone });
}

export interface AuthVerifyResult {
  accessToken: string | null;
  refreshToken: string | null;
}

export async function verifyAuth(
  notificationToken: string,
  phone: string,
): Promise<AuthVerifyResult> {
  return rpc<AuthVerifyResult>(
    "Storage.AuthVerify",
    { phone, platform: "web" },
    notificationToken,
  );
}

export function saveRefreshToken(token: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (token) window.localStorage.setItem(REFRESH_KEY, token);
    else window.localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* ignore */
  }
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

/**
 * Форматирует номер +7XXXXXXXXXX для отображения / звонка.
 * Принимает как +7…, так и 7… / 8… — приводит к E.164 (+7…).
 */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (!digits) return null;
  let d = digits;
  if (d.length === 11 && (d.startsWith("7") || d.startsWith("8"))) d = "7" + d.slice(1);
  else if (d.length === 10) d = "7" + d;
  if (d.length !== 11 || !d.startsWith("7")) return null;
  return "+" + d;
}

export function formatPhone(input: string): string {
  const p = input.startsWith("+") ? input : "+" + input.replace(/\D/g, "");
  const m = p.match(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/);
  if (!m) return p;
  return `+7 (${m[1]}) ${m[2]}-${m[3]}-${m[4]}`;
}
