// Client for https://ai.carreports.ru — JSON-RPC 2.0.
// Auth: ?token=<jwt> query parameter (NOT a header).

import { getToken } from "./tokenStore";
import { ApiError } from "./storageApi";

// Прямой вызов AI API без локального прокси: токен идёт в заголовке
// Authorization: Bearer <jwt>, как требует https://ai.carreports.ru/.
const AI_URL = "https://ai.carreports.ru/";

export interface ChatCompletionsResult {
  content: string | null;
  finishReason: string | null;
  model: string;
  latencyMs: number;
  sessionMessageCount: number;
}

/**
 * Call AiQueue.ChatCompletions. The JSON-RPC `id` doubles as the chat session
 * identifier — pass the same id to keep the conversation context.
 */
export async function chatCompletions(opts: {
  id: number;
  text: string;
  cliche: string;
  fileUrls?: string[];
  model?: string;
}): Promise<ChatCompletionsResult> {
  const token = getToken();
  if (!token) throw new ApiError("Не указан токен.", 401);

  // Формат запроса — ровно как ожидает AI API (без поля `jsonrpc`):
  // { id, method, params: { text, cliche, files?, model? } }.
  // AI-сервер подставляет значение `params.text` в место плейсхолдера
  // `{text}` внутри `cliche`. Если плейсхолдера в клише нет — текст
  // эксперта потеряется и модель ответит «заметка не предоставлена».
  // Гарантируем, что плейсхолдер есть: добавляем хвост, если его нет.
  const clicheWithText = opts.cliche.includes("{text}")
    ? opts.cliche
    : `${opts.cliche.replace(/\s+$/, "")}\n\nТекст эксперта:\n{text}\n`;
  const body = {
    id: opts.id,
    method: "AiQueue.ChatCompletions",
    params: {
      text: opts.text,
      cliche: clicheWithText,
      ...(opts.fileUrls?.length ? { files: opts.fileUrls } : {}),
      ...(opts.model ? { model: opts.model } : {}),
    },
  };

  // AI API авторизуется заголовком Authorization: Bearer <jwt>.
  const res = await fetch(AI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new ApiError(`AI: HTTP ${res.status} ${t.slice(0, 200)}`, res.status);
  }
  const json = (await res.json()) as {
    error?: { code: number; message: string };
    errors?: { message?: string } | Array<{ message?: string }>;
    result?: ChatCompletionsResult | unknown[];
    response?: string;
  };
  if (json.error) throw new ApiError(`AI: ${json.error.message}`, undefined, json.error.code);
  // `errors` may arrive as an empty array even on success — only treat it as an
  // error when it actually carries a message.
  const errObj = Array.isArray(json.errors) ? json.errors[0] : json.errors;
  if (errObj && errObj.message) {
    throw new ApiError(
      errObj.message === "Unauthorized"
        ? "AI: токен не имеет доступа к AI API (нужна роль specialist/user). Проверьте токен."
        : `AI: ${errObj.message}`,
      401,
    );
  }
  const r = json.result;
  if (!r || Array.isArray(r)) throw new ApiError("AI: пустой ответ", 500);
  return r as ChatCompletionsResult;

}

/** Generate (or reuse) a stable AI chat id for a given purpose within a thread. */
export function aiChatIdFor(thread: { aiChatIds: Record<string, number> }, key: string): number {
  if (thread.aiChatIds[key]) return thread.aiChatIds[key];
  // small random 31-bit positive int
  const id = Math.floor(Math.random() * 0x7fffffff);
  thread.aiChatIds[key] = id;
  return id;
}
