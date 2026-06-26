// Client hook: распознавание речи через браузерный Web Speech API
// (window.SpeechRecognition / webkitSpeechRecognition). Работает оффлайн в
// большинстве браузеров (Chrome/Edge/Safari) и не требует кредитов AI.

import { useCallback, useEffect, useRef, useState } from "react";

export type RecState = "idle" | "recording" | "transcribing" | "error";

// Минимальные типы для Web Speech API (TS lib их не описывает).
interface SRResultAlternative { transcript: string; confidence: number }
interface SRResult { 0: SRResultAlternative; isFinal: boolean; length: number }
interface SRResultList { length: number; [i: number]: SRResult }
interface SREvent extends Event { resultIndex: number; results: SRResultList }
interface SRErrorEvent extends Event { error: string; message?: string }
interface SRInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SRConstructor = new () => SRInstance;

function getSR(): SRConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SRConstructor;
    webkitSpeechRecognition?: SRConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useVoiceRecorder(opts: { onText: (text: string) => void; language?: string }) {
  const { onText, language = "ru-RU" } = opts;
  const [state, setState] = useState<RecState>("idle");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SRInstance | null>(null);
  const finalRef = useRef<string>("");
  const cancelledRef = useRef<boolean>(false);

  const cleanup = useCallback(() => {
    const rec = recRef.current;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      rec.onstart = null;
    }
    recRef.current = null;
    finalRef.current = "";
    cancelledRef.current = false;
  }, []);

  useEffect(() => () => {
    const rec = recRef.current;
    if (rec) {
      try { rec.abort(); } catch { /* ignore */ }
    }
    cleanup();
  }, [cleanup]);

  const start = useCallback(async () => {
    setError(null);
    const SR = getSR();
    if (!SR) {
      setError("Распознавание речи не поддерживается этим браузером. Используйте Chrome, Edge или Safari.");
      setState("error");
      return;
    }
    // Попросим разрешение на микрофон явно — даёт понятную ошибку, если запрещён.
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      setError("Нет доступа к микрофону.");
      setState("error");
      return;
    }
    try {
      const rec = new SR();
      rec.lang = language;
      rec.continuous = true;
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      finalRef.current = "";
      cancelledRef.current = false;

      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) {
            const t = r[0].transcript.trim();
            if (t) finalRef.current += (finalRef.current ? " " : "") + t;
          }
        }
      };
      rec.onerror = (e) => {
        const code = e.error || "unknown";
        const map: Record<string, string> = {
          "not-allowed": "Доступ к микрофону запрещён.",
          "service-not-allowed": "Распознавание недоступно в этом контексте.",
          "no-speech": "Речь не распознана — попробуйте ещё раз.",
          "audio-capture": "Микрофон не найден.",
          "network": "Ошибка сети при распознавании.",
        };
        if (code === "no-speech" || code === "aborted") {
          // не считаем ошибкой — просто завершаем
          return;
        }
        setError(map[code] ?? `Ошибка распознавания: ${code}`);
        setState("error");
      };
      rec.onend = () => {
        const text = finalRef.current.trim();
        cleanup();
        if (cancelledRef.current) {
          setState("idle");
          return;
        }
        if (text) onText(text);
        setState((s) => (s === "error" ? s : "idle"));
      };

      recRef.current = rec;
      rec.start();
      setState("recording");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось запустить распознавание");
      setState("error");
    }
  }, [cleanup, language, onText]);

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    try { rec.stop(); } catch { /* ignore */ }
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    const rec = recRef.current;
    if (rec) {
      try { rec.abort(); } catch { /* ignore */ }
    }
    cleanup();
    setState("idle");
  }, [cleanup]);

  return { state, error, start, stop, cancel };
}
