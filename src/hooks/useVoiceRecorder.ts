// Client hook: record microphone via MediaRecorder, send to /api/transcribe,
// return text. Handles permission errors and unsupported browsers.

import { useCallback, useEffect, useRef, useState } from "react";

export type RecState = "idle" | "recording" | "transcribing" | "error";

export function useVoiceRecorder(opts: { onText: (text: string) => void; language?: string }) {
  const { onText, language = "ru" } = opts;
  const [state, setState] = useState<RecState>("idle");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recRef.current = null;
    chunksRef.current = [];
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const start = useCallback(async () => {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Микрофон не поддерживается этим браузером.");
      setState("error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        cleanup();
        if (blob.size < 1000) {
          setState("idle");
          return;
        }
        setState("transcribing");
        try {
          const form = new FormData();
          form.append("file", blob, `voice.${(rec.mimeType.split("/")[1] || "webm").split(";")[0]}`);
          form.append("language", language);
          const r = await fetch("/api/transcribe", { method: "POST", body: form });
          const j = (await r.json()) as { text?: string; error?: string };
          if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
          const text = (j.text ?? "").trim();
          if (text) onText(text);
          setState("idle");
        } catch (e) {
          setError(e instanceof Error ? e.message : "Ошибка расшифровки");
          setState("error");
        }
      };
      rec.start();
      setState("recording");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Нет доступа к микрофону");
      setState("error");
    }
  }, [cleanup, language, onText]);

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }, []);

  const cancel = useCallback(() => {
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") {
      rec.onstop = null;
      rec.stop();
    }
    cleanup();
    setState("idle");
  }, [cleanup]);

  return { state, error, start, stop, cancel };
}
