// Client for https://ai.carreports.ru — JSON-RPC 2.0.
// Auth: ?token=<jwt> query parameter (NOT a header).

import { getToken } from "./tokenStore";
import { ApiError } from "./storageApi";

const AI_URL = "/api/cr-proxy?target=ai";

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

  const url = `${AI_URL}&token=${encodeURIComponent(token)}`;

  const body = {
    jsonrpc: "2.0",
    id: opts.id,
    method: "AiQueue.ChatCompletions",
    params: {
      text: opts.text,
      cliche: opts.cliche,
      ...(opts.fileUrls?.length ? { fileUrls: opts.fileUrls } : {}),
      ...(opts.model ? { model: opts.model } : {}),
    },
  };
  // Note: AI API expects text/plain content-type per its OpenRPC doc.
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new ApiError(`AI: HTTP ${res.status} ${t.slice(0, 200)}`, res.status);
  }
  const json = (await res.json()) as {
    error?: { code: number; message: string };
    result?: ChatCompletionsResult;
  };
  if (json.error) throw new ApiError(`AI: ${json.error.message}`, undefined, json.error.code);
  if (!json.result) throw new ApiError("AI: пустой ответ", 500);
  return json.result;
}

/** Generate (or reuse) a stable AI chat id for a given purpose within a thread. */
export function aiChatIdFor(thread: { aiChatIds: Record<string, number> }, key: string): number {
  if (thread.aiChatIds[key]) return thread.aiChatIds[key];
  // small random 31-bit positive int
  const id = Math.floor(Math.random() * 0x7fffffff);
  thread.aiChatIds[key] = id;
  return id;
}
