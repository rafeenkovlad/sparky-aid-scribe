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

/**
 * Best-effort submit. Tries a few likely method names; returns a remote id or
 * the local draft id on graceful fallback so the UI can show "saved locally".
 */
export async function submitReport(draft: unknown): Promise<{
  remote: boolean;
  reportId?: string | number;
  method?: string;
  note?: string;
}> {
  const candidates = ["Storage.SaveReport", "Storage.CreateReport", "Reports.Create"];
  let lastErr: unknown = null;
  for (const method of candidates) {
    try {
      const r = await rpc<Record<string, unknown>>(method, { report: draft });
      const id =
        (r as { id?: string | number }).id ??
        (r as { reportId?: string | number }).reportId;
      return { remote: true, reportId: id, method };
    } catch (e) {
      lastErr = e;
      if (e instanceof ApiError && e.status === 401) {
        return { remote: false, note: e.message };
      }
    }
  }
  const note =
    lastErr instanceof Error
      ? `Отправка пока недоступна: ${lastErr.message}. Черновик сохранён локально.`
      : "Отправка пока недоступна. Черновик сохранён локально.";
  return { remote: false, note };
}
