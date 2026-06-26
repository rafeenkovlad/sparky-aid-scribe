import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowUp,
  Camera,
  Check,
  CheckCheck,
  Copy,
  HelpCircle,
  Loader2,
  Menu,
  Mic,
  Paperclip,
  Pencil,
  Plus,
  Settings2,
  Square,
  Trash2,
  X,
  PanelRightOpen,
  ClipboardCheck,
} from "lucide-react";



import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

import logo from "@/assets/cr-logo.png";
import { TokenDialog } from "./TokenDialog";
import { ReportPreview } from "./ReportPreview";
import { FullReportView } from "./FullReportView";
import { InspectionDateField } from "./InspectionDateField";
import { LexChips } from "./LexChips";
import { CarChecklist } from "./CarChecklist";
import { DocsChecklist, countDocsPassport } from "./DocsChecklist";


import { useThreads, useToken } from "@/hooks/useThreads";
import {
  createThread,
  deleteThread,
  getThread,
  updateThread,
} from "@/lib/carreports/threadStore";
import { FLOW_STEPS, isConfirmAdvance, stepById } from "@/lib/carreports/flow";
import { STEP_INTROS } from "@/lib/carreports/stepChips";
import type { ChatChip, ChatMessage, StepId, Thread } from "@/lib/carreports/types";
import { extractForStep, applyVinDecode, askQuestion, summarizeStepDraft } from "@/lib/carreports/orchestrator";
import { filledCount, nextMissingPrompt, optionalHintSentence, remainingFieldLabels } from "@/lib/carreports/progress";
import { INSPECTION_ZONES, zoneById } from "@/lib/carreports/inspectionZones";
import { preparePhoto, uploadPhoto, uploadTemporary } from "@/lib/carreports/photo";
import { submitReport } from "@/lib/carreports/storageApi";
import { generateSummary } from "@/lib/carreports/aiSummary";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";

interface Props {
  threadId: string;
}

function msgId(): string {
  return Math.random().toString(36).slice(2);
}

function pushMsg(t: Thread, step: StepId, m: ChatMessage): void {
  t.messages[step].push({ ...m, step: m.step ?? step });
}

function totalMessages(m: Thread["messages"]): number {
  return (
    m.car.length +
    m.characteristics.length +
    m.docs.length +
    m.inspection.length +
    m.testDrive.length +
    m.result.length +
    m.submit.length
  );
}
const STEP_PLACEHOLDERS: Record<StepId, string> = {
  car: "VIN, госномер, пробег, город/дата осмотра, марка, модель, поколение, год, двигатель, КПП, привод, цвет… (Enter — отправить)",
  characteristics: "Марка, модель, поколение, год, двигатель, КПП, привод, цвет… (Enter — отправить)",
  docs: "Кол-во владельцев, совпадения VIN/двигателя/ФИО с ПТС/СТС… (Enter — отправить)",
  inspection: "Заметки по текущей зоне осмотра… (Enter — сохранить)",
  testDrive: "Тест-драйв: двигатель, КПП, руль, подвеска, тормоза, замечания… (Enter — отправить)",
  result: "Итоговый комментарий специалиста и вердикт… (Enter — отправить)",
  submit: "Готово к отправке — подтвердите или уточните детали… (Enter — отправить)",
};

function makeIntroMessage(step: StepId): ChatMessage {
  const intro = STEP_INTROS[step];
  return {
    id: msgId(),
    role: "assistant",
    text: intro.greeting,
    step,
    chips: intro.chips,
    optionsStep: step,
    selectedChipValues: [],
    createdAt: Date.now(),
  };
}

export function ChatApp({ threadId }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const threads = useThreads();
  const token = useToken();
  const navigate = useNavigate();

  const thread = useMemo(() => threads.find((t) => t.id === threadId) ?? null, [threads, threadId]);

  const [tokenOpen, setTokenOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [fullReportOpen, setFullReportOpen] = useState(false);
  const [composer, setComposer] = useState("");
  const [busy, setBusy] = useState(false);
  const [askMode, setAskMode] = useState(false);
  const [selectedInspectionChips, setSelectedInspectionChips] = useState<Set<string>>(new Set());
  /** Прикреплённые к следующему сообщению фото (для распознавания). */
  const [pendingAttachments, setPendingAttachments] = useState<
    Array<{ id: string; dataUrl: string; blob: Blob; filename: string }>
  >([]);
  const [analyzing, setAnalyzing] = useState(false);
  const attachInputRef = useRef<HTMLInputElement>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const voice = useVoiceRecorder({
    onText: (t) => {
      setComposer((cur) => (cur.trim() ? `${cur.trim()} ${t}` : t));
      textareaRef.current?.focus();
    },
  });

  // Open token dialog automatically the very first time.
  useEffect(() => {
    if (!token) setTokenOpen(true);
  }, [token]);

  // Seed first intro message on a fresh thread (StrictMode-safe: re-check
  // current store state, only push when truly empty).
  useEffect(() => {
    if (!thread) return;
    const fresh = getThread(thread.id);
    if (fresh && totalMessages(fresh.messages) === 0) {
      updateThread(thread.id, (t) => {
        if (totalMessages(t.messages) === 0) {
          const step = FLOW_STEPS[t.stepIndex].id;
          pushMsg(t, step, makeIntroMessage(step));
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);


  // Keep textarea focused.
  useEffect(() => {
    textareaRef.current?.focus();
  }, [threadId, busy]);

  const currentStep = thread ? FLOW_STEPS[thread.stepIndex].id : "car";

  const currentStepMessages = thread ? thread.messages[currentStep] : [];

  // Auto-scroll on new messages in the current step. Также реагируем на
  // обновление createdAt последнего сообщения — карандаш/паспорт переносят
  // существующее сообщение в конец, и тогда меняется только timestamp.
  const lastMsg = currentStepMessages[currentStepMessages.length - 1];
  const lastMsgId = lastMsg?.id ?? null;
  const lastMsgStamp = lastMsg?.createdAt ?? 0;
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [currentStepMessages.length, currentStep, lastMsgId, lastMsgStamp]);

  const lastOptionsMsgId = useMemo(() => {
    for (let i = currentStepMessages.length - 1; i >= 0; i--) {
      const m = currentStepMessages[i];
      if (m.optionsStep === currentStep) return m.id;
    }
    return null;
  }, [currentStepMessages, currentStep]);

  const insertChip = useCallback((messageId: string, chip: ChatChip) => {
    if (!thread) return;
    updateThread(thread.id, (t) => {
      let msg: ChatMessage | undefined;
      for (const key of Object.keys(t.messages) as StepId[]) {
        msg = t.messages[key].find((x) => x.id === messageId);
        if (msg) break;
      }
      if (!msg) return;
      const prev = msg.selectedChipValues ?? [];
      // single-group: replace any previously-selected chip from same group
      let nextSelected: string[];
      if (chip.single && chip.group) {
        const groupValues = (msg.chips ?? [])
          .filter((c) => c.group === chip.group)
          .map((c) => c.value);
        nextSelected = prev.filter((v) => !groupValues.includes(v));
        if (!prev.includes(chip.value)) nextSelected.push(chip.value);
      } else if (prev.includes(chip.value)) {
        nextSelected = prev.filter((v) => v !== chip.value);
      } else {
        nextSelected = [...prev, chip.value];
      }
      msg.selectedChipValues = nextSelected;
    });
    textareaRef.current?.focus();
  }, [thread]);

  const setInspectionDate = useCallback(
    (iso: string) => {
      if (!thread) return;
      updateThread(thread.id, (t) => {
        t.draft.carStep.dateInspection = iso;
      });
    },
    [thread],
  );

  // Inspection: current zone (defaults to first when entering the step)
  const currentZoneId = thread?.draft.inspectionStep.currentZone ?? INSPECTION_ZONES[0].id;
  const currentZone = zoneById(currentZoneId) ?? INSPECTION_ZONES[0];
  const photoInputRef = useRef<HTMLInputElement>(null);

  const selectZone = useCallback(
    (zoneId: string) => {
      if (!thread) return;
      updateThread(thread.id, (t) => {
        t.draft.inspectionStep.currentZone = zoneId;
      });
      setSelectedInspectionChips(new Set());
      textareaRef.current?.focus();
    },
    [thread],
  );

  const insertInspectionChip = useCallback((chip: ChatChip) => {
    setSelectedInspectionChips((prev) => {
      const next = new Set(prev);
      if (next.has(chip.value)) next.delete(chip.value);
      else next.add(chip.value);
      return next;
    });
    textareaRef.current?.focus();
  }, []);

  const onPickPhoto = useCallback(
    async (file: File) => {
      if (!thread) return;
      const zoneId = thread.draft.inspectionStep.currentZone ?? INSPECTION_ZONES[0].id;
      try {
        const prepared = await preparePhoto(file);
        const up = await uploadPhoto(prepared);
        updateThread(thread.id, (t) => {
          t.draft.inspectionStep.photos.push({
            section: zoneId,
            filename: up.filename,
            dataUrl: prepared.dataUrl,
            remote: up.remote,
            addedAt: Date.now(),
          });
          t.draft.inspectionStep.touched = true;
          pushMsg(t, "inspection", {
            id: msgId(),
            role: "assistant",
            text: up.remote
              ? `📷 Фото добавлено к зоне «${zoneById(zoneId)?.label}» (загружено: ${up.filename}).`
              : `📷 Фото добавлено к зоне «${zoneById(zoneId)?.label}» локально. ${up.note ?? ""}`,
            createdAt: Date.now(),
          });
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Ошибка обработки фото";
        updateThread(thread.id, (t) => {
          pushMsg(t, "inspection", {
            id: msgId(),
            role: "assistant",
            text: `⚠️ ${msg}`,
            createdAt: Date.now(),
          });
        });
      }
    },
    [thread],
  );

  const doSubmit = useCallback(async () => {
    if (!thread || busy) return;
    setBusy(true);
    try {
      const r = await submitReport(thread.draft);
      updateThread(thread.id, (t) => {
        pushMsg(t, "submit", {
          id: msgId(),
          role: "assistant",
          text: r.remote
            ? `✅ Отчёт отправлен (id: ${r.reportId ?? "—"}, метод: ${r.method ?? "?"}).`
            : `⚠️ ${r.note ?? "Отправка не удалась."}`,
          createdAt: Date.now(),
        });
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : "Ошибка отправки";
      updateThread(thread.id, (t) => {
        pushMsg(t, "submit", {
          id: msgId(),
          role: "assistant",
          text: `⚠️ ${m}`,
          createdAt: Date.now(),
        });
      });
    } finally {
      setBusy(false);
    }
  }, [thread, busy]);

  const doGenSummary = useCallback(async () => {
    if (!thread || busy) return;
    setBusy(true);
    updateThread(thread.id, (t) => {
      pushMsg(t, "result", {
        id: msgId(),
        role: "assistant",
        text: "🪄 Готовлю AI-резюме отчёта…",
        createdAt: Date.now(),
      });
    });
    try {
      const fresh = getThread(thread.id);
      if (!fresh) return;
      const r = await generateSummary(fresh);
      updateThread(thread.id, (t) => {
        t.draft.resultStep.summaryInspectionNote = r.summary;
        if (r.verdict) t.draft.resultStep.resultSpecialistNote = r.verdict;
        pushMsg(t, "result", {
          id: msgId(),
          role: "assistant",
          text:
            `✅ AI-резюме готово (${r.model}, ${Math.round(r.latencyMs)} мс):\n\n` +
            r.summary +
            (r.verdict ? `\n\nВЕРДИКТ: ${r.verdict}` : "") +
            "\n\nПоправьте при необходимости и переходите к отправке.",
          step: "result",
          createdAt: Date.now(),
        });
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : "Ошибка AI";
      updateThread(thread.id, (t) => {
        pushMsg(t, "result", {
          id: msgId(),
          role: "assistant",
          text: `⚠️ ${m}`,
          createdAt: Date.now(),
        });
      });
    } finally {
      setBusy(false);
    }
  }, [thread, busy]);




  const advanceStep = useCallback(() => {
    if (!thread) return;
    const nextIdx = Math.min(thread.stepIndex + 1, FLOW_STEPS.length - 1);
    if (nextIdx === thread.stepIndex) return;
    const nextStep = FLOW_STEPS[nextIdx].id;
    updateThread(thread.id, (t) => {
      t.stepIndex = nextIdx;
      // Always greet on step entry — intro message with quick-pick chips.
      pushMsg(t, nextStep, makeIntroMessage(nextStep));
      const ask = nextMissingPrompt(nextStep, t.draft);
      if (ask) {
        pushMsg(t, nextStep, {
          id: msgId(),
          role: "assistant",
          text: `➡️ ${ask}`,
          step: nextStep,
          createdAt: Date.now(),
        });
      }
    });
  }, [thread]);


  const doVinDecode = useCallback(async () => {
    if (!thread) return;
    const vin = thread.draft.carStep.vin;
    if (!vin) return;
    const fresh = getThread(thread.id);
    if (!fresh) return;
    const patch = await applyVinDecode(fresh);
    if (patch) {
      updateThread(thread.id, (t) => {
        Object.assign(t.draft, patch);
        pushMsg(t, "car", {
          id: msgId(),
          role: "assistant",
          text: "Подтянул характеристики по VIN. Поправьте, если есть расхождения.",
          createdAt: Date.now(),
        });
      });
    }
  }, [thread]);

  const addAttachment = useCallback(async (file: File) => {
    try {
      const prepared = await preparePhoto(file, { maxBytes: 2 * 1024 * 1024 });
      setPendingAttachments((prev) => [
        ...prev,
        {
          id: msgId(),
          dataUrl: prepared.dataUrl,
          blob: prepared.blob,
          filename: prepared.filename,
        },
      ]);
    } catch (e) {
      const m = e instanceof Error ? e.message : "Не удалось подготовить фото";
      if (thread) {
        updateThread(thread.id, (t) => {
          pushMsg(t, FLOW_STEPS[t.stepIndex].id, {
            id: msgId(),
            role: "assistant",
            text: `⚠️ ${m}`,
            createdAt: Date.now(),
          });
        });
      }
    }
  }, [thread]);

  const removeAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  /** Распознать прикреплённые фото и вернуть текстовое summary для AI. */
  const analyzeAttachments = useCallback(
    async (
      atts: Array<{ id: string; blob: Blob; filename: string }>,
      step: StepId,
      userText: string,
    ): Promise<string> => {
      if (!atts.length || !thread) return "";
      const STEP_HINTS: Record<StepId, string> = {
        car: "На фото — документ авто (СТС/ПТС), VIN-таблица, шильдик или объявление. Извлеки: VIN, госномер, марку, модель, год, объём, мощность, тип топлива, КПП, привод, цвет, пробег.",
        characteristics: "Извлеки характеристики авто с фото: марка, модель, поколение, год, объём и мощность двигателя, тип топлива, КПП, привод, цвет, комплектация.",
        docs: "На фото — ПТС/СТС или договор. Извлеки: ФИО владельца, кол-во владельцев, VIN, номер двигателя, серию/номер документа.",
        inspection: "На фото — элемент кузова/салона. Опиши состояние и видимые дефекты (царапины, сколы, ржавчина, вмятины, трещины), укажи деталь.",
        testDrive: "На фото — приборная панель / салон при тест-драйве. Опиши показания (пробег, ошибки, ESP/ABS, давление) и особенности.",
        result: "Опиши, что видно на фото — кратко, по фактам.",
        submit: "Опиши, что видно на фото — кратко, по фактам.",
      };
      // 1) Загружаем все фото во временное объектное хранилище.
      const urls: string[] = [];
      const failures: string[] = [];
      for (const a of atts) {
        try {
          const up = await uploadTemporary({
            filename: a.filename,
            blob: a.blob,
            dataUrl: "",
          });
          urls.push(up.url);
        } catch (e) {
          failures.push(`[не удалось загрузить ${a.filename}: ${e instanceof Error ? e.message : "ошибка"}]`);
        }
      }
      if (!urls.length) return failures.join("\n");
      // 2) Один запрос в ai.carreports.ru со всеми ссылками сразу.
      const fresh = getThread(thread.id);
      if (!fresh) return failures.join("\n");
      const hint = STEP_HINTS[step] ?? STEP_HINTS.result;
      const prompt = userText
        ? `${hint}\n\nОтвет — компактный список фактов на русском, без воды.\n\nКонтекст: ${userText}`
        : `${hint}\n\nОтвет — компактный список фактов на русском, без воды.`;
      try {
        const { chatCompletions, aiChatIdFor } = await import("@/lib/carreports/aiApi");
        const id = aiChatIdFor(fresh, `vision:${step}`);
        const r = await chatCompletions({
          id,
          text: prompt,
          cliche: "{text}",
          fileUrls: urls,
        });
        updateThread(thread.id, (t) => {
          t.aiChatIds = fresh.aiChatIds;
        });
        const text = (r.content ?? "").trim();
        return [text, ...failures].filter(Boolean).join("\n\n");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "ошибка AI";
        return [...failures, `[AI: ${msg}]`].join("\n");
      }
    },
    [thread],
  );

  const submit = useCallback(async () => {
    if (!thread || busy) return;
    const typed = composer.trim();
    const atts = pendingAttachments;

    // Gather selected chip values from the last interactive options message
    // (per-step chips) or the inspection chip selection state.
    let selectedFromChips: string[] = [];
    if (currentStep === "inspection") {
      selectedFromChips = [...selectedInspectionChips];
    } else if (lastOptionsMsgId) {
      const msg = currentStepMessages.find((m) => m.id === lastOptionsMsgId);
      selectedFromChips = msg?.selectedChipValues ?? [];
    }

    const combined = [typed, ...selectedFromChips].filter(Boolean).join("\n");
    if (!combined && !atts.length) return;

    // Confirm-advance shortcut (only when no chips/attachments, typed-only).
    if (!askMode && !selectedFromChips.length && !atts.length && isConfirmAdvance(typed)) {
      setComposer("");
      advanceStep();
      return;
    }

    setBusy(true);
    const userAttachments = atts.map((a) => ({
      url: a.dataUrl,
      label: a.filename,
    }));
    // 1) push user message (with thumbnails if any)
    const baseText = combined || (atts.length ? `📎 Прикреплено фото: ${atts.length}` : "");
    const displayText = askMode ? `❓ ${baseText}` : baseText;
    updateThread(thread.id, (t) => {
      pushMsg(t, currentStep, {
        id: msgId(),
        role: "user",
        text: displayText,
        step: currentStep,
        ...(userAttachments.length ? { attachments: userAttachments } : {}),
        createdAt: Date.now(),
      });
      // Clear chip selections on the last options message
      if (lastOptionsMsgId) {
        for (const key of Object.keys(t.messages) as StepId[]) {
          const m = t.messages[key].find((x) => x.id === lastOptionsMsgId);
          if (m) { m.selectedChipValues = []; break; }
        }
      }
    });
    setComposer("");
    setPendingAttachments([]);
    if (currentStep === "inspection") setSelectedInspectionChips(new Set());

    // 1b) If photos attached — recognize them via vision and append to text.
    let textForAI = combined;
    if (atts.length) {
      setAnalyzing(true);
      updateThread(thread.id, (t) => {
        pushMsg(t, currentStep, {
          id: msgId(),
          role: "assistant",
          text: `🔍 Распознаю фото (${atts.length})…`,
          step: currentStep,
          createdAt: Date.now(),
        });
      });
      const recognized = await analyzeAttachments(atts, currentStep, combined);
      setAnalyzing(false);
      if (recognized) {
        updateThread(thread.id, (t) => {
          pushMsg(t, currentStep, {
            id: msgId(),
            role: "assistant",
            text: `📄 Распознано с фото:\n${recognized}`,
            step: currentStep,
            createdAt: Date.now(),
          });
        });
        textForAI = combined ? `${combined}\n\n[Данные с фото]\n${recognized}` : recognized;
      }
    }


    // Q&A mode: free-form question, no draft mutation.
    if (askMode) {
      try {
        const fresh = getThread(thread.id);
        if (!fresh) return;
        const stepLabel = FLOW_STEPS.find((s) => s.id === currentStep)?.label ?? currentStep;
        const answer = await askQuestion(currentStep, textForAI || combined, fresh, stepLabel);
        updateThread(thread.id, (t) => {
          pushMsg(t, currentStep, {
            id: msgId(),
            role: "assistant",
            text: answer,
            step: currentStep,
            createdAt: Date.now(),
          });
        });
      } finally {
        setAskMode(false);
        setBusy(false);
      }
      return;
    }

    try {
      const fresh = getThread(thread.id);
      if (!fresh) return;
      const prevVin = fresh.draft.carStep.vin;
      const onClarify = (entry: { kind: "ai" | "web"; label: string; detail?: string }) => {
        const icon = entry.kind === "web" ? "🌐" : "🧠";
        updateThread(thread.id, (t) => {
          pushMsg(t, currentStep, {
            id: msgId(),
            role: "assistant",
            text: `${icon} ${entry.label}${entry.detail ? `\n${entry.detail}` : ""}`,
            step: currentStep,
            createdAt: Date.now(),
          });
        });
      };
      const { patch, reply, attachments, chips } = await extractForStep(currentStep, textForAI || combined, fresh, { onClarify });
      updateThread(thread.id, (t) => {
        Object.assign(t.draft, patch);
        // Карточка заполнения — только summary/reply, без уточняющих вопросов.
        if (reply) {
          pushMsg(t, currentStep, {
            id: msgId(),
            role: "assistant",
            text: reply,
            step: currentStep,
            ...(attachments && attachments.length ? { attachments } : {}),
            ...(chips && chips.length
              ? { chips, optionsStep: currentStep, selectedChipValues: [] }
              : {}),
            createdAt: Date.now(),
          });
        }
        // Уточняющий вопрос / подтверждение шага — отдельным сообщением.
        const nextAsk = nextMissingPrompt(currentStep, t.draft);
        const remaining = remainingFieldLabels(currentStep, t.draft);
        const remainingHint = remaining.length
          ? `\n📋 Ещё не заполнено: ${remaining.slice(0, 6).join(", ")}${remaining.length > 6 ? "…" : ""}.`
          : "";
        const tailLine = nextAsk
          ? `➡️ ${nextAsk}${remainingHint}`
          : `✅ Шаг заполнен. ${optionalHintSentence(currentStep, t.draft)}`;
        if (tailLine) {
          pushMsg(t, currentStep, {
            id: msgId(),
            role: "assistant",
            text: tailLine,
            step: currentStep,
            createdAt: Date.now(),
          });
        }
        if (currentStep === "car" && !t.draft.reportName) {
          const c = t.draft.carStep;
          t.title = c.vin
            ? `Отчёт · VIN ${c.vin.slice(-6)}`
            : c.gosNumber
              ? `Отчёт · ${c.gosNumber}`
              : "Новый отчёт";
        }
      });
      // After car extract: if VIN newly known, decode it and fill characteristics
      if (currentStep === "car") {
        const after = getThread(thread.id);
        const newVin = after?.draft.carStep.vin;
        if (newVin && newVin !== prevVin && newVin.length >= 11) {
          void doVinDecode();
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Ошибка ИИ";
      updateThread(thread.id, (t) => {
        pushMsg(t, currentStep, {
          id: msgId(),
          role: "assistant",
          text: `⚠️ ${message}`,
          createdAt: Date.now(),
        });
      });
    } finally {
      setBusy(false);
    }
  }, [thread, busy, composer, currentStep, advanceStep, askMode, doVinDecode, lastOptionsMsgId, currentStepMessages, selectedInspectionChips, pendingAttachments, analyzeAttachments]);


  function jumpTo(step: StepId) {
    if (!thread) return;
    const idx = FLOW_STEPS.findIndex((s) => s.id === step);
    if (idx < 0) return;
    updateThread(thread.id, (t) => {
      const changed = t.stepIndex !== idx;
      t.stepIndex = idx;
      if (changed) {
        pushMsg(t, step, makeIntroMessage(step));
        const ask = nextMissingPrompt(step, t.draft);
        if (ask) {
          pushMsg(t, step, {
            id: msgId(),
            role: "assistant",
            text: `➡️ ${ask}`,
            step,
            createdAt: Date.now(),
          });
        }
      }
    });
    setDraftOpen(false);
  }


  function newThread() {
    const t = createThread();
    setMenuOpen(false);
    navigate({ to: "/$threadId", params: { threadId: t.id } });
  }

  if (!mounted || !thread) {
    return (
      <div className="flex flex-col h-[100dvh] bg-zinc-950 text-white items-center justify-center">
        <div className="text-sm text-white/60">Открываю отчёт…</div>
      </div>
    );
  }

  const filled = filledCount(thread.draft);
  const stepDef = stepById(currentStep);
  const hasCurrentStepDraft = summarizeStepDraft(currentStep, thread.draft).trim().length > 0;

  return (
    <div className="flex flex-col h-[100dvh] bg-zinc-950 text-white">
      {/* Header */}
      <header className="flex items-center gap-2 px-3 h-12 border-b border-white/10 shrink-0">
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/10">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="bg-zinc-950 border-white/10 text-white p-0 w-[88%] max-w-[360px]">
            <SheetHeader className="px-4 py-3 border-b border-white/10">
              <SheetTitle className="flex items-center gap-2 text-white">
                <img src={logo} alt="" className="h-6 w-6 invert" />
                ИИ-отчёт carreports
              </SheetTitle>
            </SheetHeader>
            <div className="p-3 space-y-2">
              <Button
                onClick={newThread}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white justify-start"
              >
                <Plus className="h-4 w-4 mr-2" /> Новый отчёт
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setTokenOpen(true);
                  setMenuOpen(false);
                }}
                className="w-full justify-start text-white hover:bg-white/10"
              >
                <Settings2 className="h-4 w-4 mr-2" /> Токен carreports
              </Button>
            </div>
            <div className="px-3 pb-1 pt-2 text-xs uppercase tracking-wider text-white/40">История</div>
            <div className="px-2 pb-4 space-y-1 overflow-y-auto" style={{ maxHeight: "60dvh" }}>
              {threads.length === 0 && <div className="px-2 py-3 text-sm text-white/50">Пока пусто</div>}
              {threads.map((t) => (
                <div
                  key={t.id}
                  className={
                    "group flex items-center rounded-lg px-2 py-2 text-sm cursor-pointer " +
                    (t.id === threadId ? "bg-white/10" : "hover:bg-white/5")
                  }
                  onClick={() => {
                    navigate({ to: "/$threadId", params: { threadId: t.id } });
                    setMenuOpen(false);
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{t.title}</div>
                    <div className="text-xs text-white/40">
                      {new Date(t.updatedAt).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!confirm("Удалить этот отчёт?")) return;
                      const remaining = threads.filter((x) => x.id !== t.id);
                      deleteThread(t.id);
                      if (t.id === threadId) {
                        const next = remaining[0] ?? createThread();
                        navigate({ to: "/$threadId", params: { threadId: next.id } });
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 text-white/60 hover:text-destructive p-1"
                    aria-label="Удалить"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </SheetContent>
        </Sheet>

        <div className="flex-1 min-w-0 text-center">
          <div className="text-sm font-medium truncate">{thread.title}</div>
          <div className="text-[11px] text-white/50 truncate">Шаг: {stepDef.label}</div>
        </div>

        <div className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white/80 tabular-nums">
          {filled}/{FLOW_STEPS.length - 1}
        </div>
        <Sheet open={draftOpen} onOpenChange={setDraftOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/10">
              <PanelRightOpen className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="bg-zinc-950 border-white/10 text-white p-0 w-[88%] max-w-[400px]">
            <SheetHeader className="sr-only">
              <SheetTitle>Черновик отчёта</SheetTitle>
            </SheetHeader>
            <ReportPreview
              thread={thread}
              onJump={jumpTo}
              onOpenFullReport={() => {
                setDraftOpen(false);
                setFullReportOpen(true);
              }}
            />
          </SheetContent>
        </Sheet>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
        {currentStepMessages.map((m) => (
          <MessageBubble
            key={m.id}
            msg={m}
            interactive={m.id === lastOptionsMsgId}
            onChipTap={(chip) => insertChip(m.id, chip)}
            inspectionDateValue={thread.draft.carStep.dateInspection}
            onInspectionDateChange={setInspectionDate}
            draft={thread.draft}
            onFillMissing={(template) => {
              setComposer((prev) => (prev.trim() ? prev + "\n" + template : template));
              setAskMode(false);
              requestAnimationFrame(() => {
                const ta = textareaRef.current;
                if (ta) {
                  ta.focus();
                  ta.setSelectionRange(ta.value.length, ta.value.length);
                  ta.scrollTop = ta.scrollHeight;
                }
              });
            }}
          />
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-sm text-white/50">
            <span className="inline-block h-2 w-2 rounded-full bg-orange-400 animate-pulse" />
            ИИ-ассистент думает…
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Inspection panel: zone picker + per-zone chips + photo button */}
      {currentStep === "inspection" && (
        <div className="px-3 pt-2 shrink-0 border-t border-white/5">
          <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-none">
            {INSPECTION_ZONES.map((z) => {
              const sel = z.id === currentZoneId;
              const hasNote = !!thread.draft.inspectionStep.sectionNotes[z.id];
              const photoCount = thread.draft.inspectionStep.photos.filter(
                (p) => p.section === z.id,
              ).length;
              return (
                <button
                  key={z.id}
                  onClick={() => selectZone(z.id)}
                  className={
                    "shrink-0 rounded-xl px-3 py-1.5 text-xs font-medium border whitespace-nowrap transition-colors " +
                    (sel
                      ? "bg-orange-500 border-orange-500 text-white"
                      : hasNote || photoCount > 0
                        ? "bg-white/10 border-white/15 text-white"
                        : "bg-transparent border-white/10 text-white/70 hover:border-white/25")
                  }
                >
                  <span className="mr-1">{z.emoji}</span>
                  {z.label}
                  {(hasNote || photoCount > 0) && (
                    <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] opacity-80">
                      {hasNote && <span>✓</span>}
                      {photoCount > 0 && <span>📷{photoCount}</span>}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="text-[11px] text-white/50 px-0.5 pb-1.5">{currentZone.intro}</div>
          <div className="flex flex-wrap gap-1.5 pb-1">
            {currentZone.chips.map((c) => {
              const isSel = selectedInspectionChips.has(c.value);
              return (
                <button
                  key={c.label}
                  onClick={() => insertInspectionChip(c)}
                  className={
                    "rounded-full border px-2.5 py-1 text-xs transition-colors " +
                    (isSel
                      ? "bg-orange-500 text-white border-orange-500"
                      : "border-white/15 text-white/80 hover:border-orange-400/60 hover:text-white")
                  }
                >
                  {isSel ? "✓ " : ""}
                  {c.label}
                </button>
              );
            })}
            <LexChips
              step="inspection"
              zone={currentZoneId}
              selectedValues={selectedInspectionChips}
              onTap={insertInspectionChip}
            />
          </div>
        </div>
      )}


      {/* Quick actions */}
      <div className="px-3 pt-2 flex flex-wrap gap-2 shrink-0">
        {currentStep === "result" && (
          <button
            onClick={() => void doGenSummary()}
            disabled={busy}
            className="rounded-full bg-violet-500 hover:bg-violet-600 disabled:opacity-50 text-white text-xs font-semibold px-4 py-1.5 flex items-center gap-1 shadow-[0_0_24px_-6px_rgba(139,92,246,0.6)]"
          >
            ✨ AI-резюме
          </button>
        )}
        {currentStep === "submit" && (
          <button
            onClick={() => void doSubmit()}
            disabled={busy}
            className="rounded-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-semibold px-4 py-1.5 flex items-center gap-1 shadow-[0_0_24px_-6px_rgba(16,185,129,0.6)]"
          >
            <CheckCheck className="h-3.5 w-3.5" /> Отправить отчёт
          </button>
        )}
        <button
          onClick={() => {
            setAskMode(false);
            advanceStep();
          }}
          className="rounded-full bg-orange-500/90 hover:bg-orange-500 text-white text-xs font-medium px-3 py-1.5 flex items-center gap-1"
        >
          <CheckCheck className="h-3.5 w-3.5" /> Всё верно, далее
        </button>
        {hasCurrentStepDraft && (
          <button
            onClick={() => {
              setAskMode(false);
              const intro = STEP_INTROS[currentStep];
              updateThread(thread.id, (t) => {
                const recapId = `recap-${currentStep}`;
                t.messages[currentStep] = t.messages[currentStep].filter(
                  (m) => m.id !== recapId,
                );
                pushMsg(t, currentStep, {
                  id: recapId,
                  role: "assistant",
                  text: "",
                  step: currentStep,
                  chips: intro.chips,
                  optionsStep: currentStep,
                  selectedChipValues: [],
                  createdAt: Date.now(),
                });
              });
              textareaRef.current?.focus();
            }}
            aria-label="Нужно изменить"
            title="Нужно изменить"
            className="h-8 w-8 rounded-full bg-white/5 hover:bg-white/10 text-white/80 flex items-center justify-center"
          >
            <Pencil className="h-4 w-4" />
          </button>
        )}
        {currentStep === "car" && (
          <button
            type="button"
            onClick={() => {
              const passportId = "passport-car";
              updateThread(thread.id, (t) => {
                t.messages.car = t.messages.car.filter((m) => m.id !== passportId);
                pushMsg(t, "car", {
                  id: passportId,
                  role: "assistant",
                  text: "",
                  step: "car",
                  kind: "passport",
                  createdAt: Date.now(),
                });
              });
            }}
            aria-label="Паспорт авто"
            title="Паспорт авто"
            className="h-8 rounded-full bg-white/5 hover:bg-white/10 text-white/80 flex items-center gap-1.5 px-2.5"
          >
            <ClipboardCheck className="h-4 w-4 text-emerald-400" />
            <span className="text-xs tabular-nums">
              {countCarPassport(thread.draft)}/10
            </span>
          </button>
        )}
        {currentStep === "docs" && (
          <button
            type="button"
            onClick={() => {
              const passportId = "passport-docs";
              updateThread(thread.id, (t) => {
                t.messages.docs = t.messages.docs.filter((m) => m.id !== passportId);
                pushMsg(t, "docs", {
                  id: passportId,
                  role: "assistant",
                  text: "",
                  step: "docs",
                  kind: "docsPassport",
                  createdAt: Date.now(),
                });
              });
            }}
            aria-label="Сверка документов"
            title="Сверка документов"
            className="h-8 rounded-full bg-white/5 hover:bg-white/10 text-white/80 flex items-center gap-1.5 px-2.5"
          >
            <ClipboardCheck className="h-4 w-4 text-emerald-400" />
            <span className="text-xs tabular-nums">
              {countDocsPassport(thread.draft)}/4
            </span>
          </button>
        )}
        <button
          onClick={() => {
            setAskMode((v) => !v);
            textareaRef.current?.focus();
          }}
          aria-label={askMode ? "Отменить вопрос" : "Есть вопрос"}
          title={askMode ? "Отменить вопрос" : "Есть вопрос"}
          className={`h-8 w-8 rounded-full flex items-center justify-center ${
            askMode
              ? "bg-sky-500 hover:bg-sky-600 text-white"
              : "bg-white/5 hover:bg-white/10 text-white/80"
          }`}
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </div>


      {/* Composer */}
      <div className="px-3 pb-3 pt-2 shrink-0">
        {(() => {
          if (!lastOptionsMsgId) return null;
          const optMsg = currentStepMessages.find((m) => m.id === lastOptionsMsgId);
          const sel = optMsg?.selectedChipValues ?? [];
          if (!sel.length) return null;
          const chipByValue = new Map((optMsg?.chips ?? []).map((c) => [c.value, c] as const));
          return (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {sel.map((v) => {
                const c = chipByValue.get(v);
                if (!c) return null;
                return (
                  <span
                    key={v}
                    className="inline-flex items-center gap-1 rounded-full bg-orange-500/15 border border-orange-500/50 text-orange-100 text-xs px-2 py-1"
                    title="Выбрано — будет отправлено вместе с сообщением"
                  >
                    <span className="select-none">{c.label}</span>
                    <button
                      type="button"
                      aria-label="Убрать"
                      onClick={() => insertChip(lastOptionsMsgId, c)}
                      className="text-orange-200/80 hover:text-white"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          );
        })()}
        {pendingAttachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pendingAttachments.map((a) => (
              <div
                key={a.id}
                className="relative h-16 w-16 rounded-lg overflow-hidden border border-white/15 bg-white/[0.04]"
                title={a.filename}
              >
                <img src={a.dataUrl} alt={a.filename} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeAttachment(a.id)}
                  aria-label="Убрать фото"
                  className="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-black/70 hover:bg-black text-white flex items-center justify-center"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {analyzing && (
              <div className="h-16 px-2 flex items-center gap-1.5 text-xs text-white/70">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> распознаю…
              </div>
            )}
          </div>
        )}
        <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-2">
          {/* Универсальная кнопка вложения — для всех шагов. */}
          <input
            ref={attachInputRef}
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              for (const f of files) void addAttachment(f);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => attachInputRef.current?.click()}
            className="h-10 w-10 shrink-0 rounded-full bg-white/10 hover:bg-white/15 flex items-center justify-center text-white"
            aria-label="Прикрепить фото для распознавания"
            title="Прикрепить фото (≤2MB, распознаем текст и характеристики)"
          >
            <Paperclip className="h-5 w-5" />
          </button>
          {currentStep === "inspection" && (
            <>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*,.heic,.heif"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onPickPhoto(f);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => photoInputRef.current?.click()}
                className="h-10 w-10 shrink-0 rounded-full bg-white/10 hover:bg-white/15 flex items-center justify-center text-white"
                aria-label="Прикрепить фото"
                title="Прикрепить фото"
              >
                <Camera className="h-5 w-5" />
              </button>
            </>
          )}
          <Textarea
            ref={textareaRef}
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={
              askMode
                ? "Спросите ИИ — ответ не запишется в шаг (Enter — отправить)"
                : currentStep === "inspection"
                  ? `Заметки по зоне «${currentZone.label}»… (Enter — сохранить)`
                  : STEP_PLACEHOLDERS[currentStep]
            }
            className={`min-h-[44px] max-h-40 resize-none border-0 bg-transparent text-white placeholder:text-white/40 focus-visible:ring-0 ${
              askMode ? "placeholder:text-sky-300/60" : ""
            }`}

          />
          <button
            onClick={() => (voice.state === "recording" ? voice.stop() : void voice.start())}
            disabled={voice.state === "transcribing"}
            className={
              "h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-white transition-colors " +
              (voice.state === "recording"
                ? "bg-red-500 hover:bg-red-600 animate-pulse"
                : voice.state === "transcribing"
                  ? "bg-white/10"
                  : "bg-white/10 hover:bg-white/15")
            }
            aria-label={
              voice.state === "recording"
                ? "Остановить запись"
                : voice.state === "transcribing"
                  ? "Расшифровка…"
                  : "Голосовой ввод"
            }
            title={voice.error ?? "Голосовой ввод"}
          >
            {voice.state === "recording" ? (
              <Square className="h-4 w-4 fill-white" />
            ) : voice.state === "transcribing" ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
          </button>
          <button
            onClick={() => void submit()}
            disabled={
              busy ||
              analyzing ||
              (!composer.trim() &&
                pendingAttachments.length === 0 &&
                (currentStep === "inspection"
                  ? selectedInspectionChips.size === 0
                  : !(lastOptionsMsgId &&
                      (currentStepMessages.find((m) => m.id === lastOptionsMsgId)
                        ?.selectedChipValues?.length ?? 0) > 0)))
            }
            className="h-10 w-10 shrink-0 rounded-full bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-white shadow-[0_0_24px_-6px_rgba(249,115,22,0.6)]"
            aria-label="Отправить и перейти дальше"
          >
            <ArrowUp className="h-5 w-5" />
          </button>
        </div>
      </div>


      <TokenDialog open={tokenOpen} onOpenChange={setTokenOpen} initialToken={token} />
      {fullReportOpen && (
        <FullReportView thread={thread} onClose={() => setFullReportOpen(false)} />
      )}

    </div>
  );
}

// ─── Message bubble ────────────────────────────────────────────────────────

interface BubbleProps {
  msg: ChatMessage;
  interactive: boolean;
  onChipTap: (chip: ChatChip) => void;
  inspectionDateValue?: string;
  onInspectionDateChange: (iso: string) => void;
  draft?: import("@/lib/carreports/types").ReportDraft;
  onFillMissing?: (template: string) => void;
  onDocsAllMatch?: () => void;
}

function MessageBubble({
  msg,
  interactive,
  onChipTap,
  inspectionDateValue,
  onInspectionDateChange,
  draft,
  onFillMissing,
  onDocsAllMatch,
}: BubbleProps) {

  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] space-y-1">
          {msg.attachments && msg.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 justify-end">
              {msg.attachments.map((a) => (
                <a
                  key={a.url}
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block h-20 w-20 rounded-lg overflow-hidden border border-orange-500/40"
                  title={a.label}
                >
                  <img src={a.url} alt={a.label ?? ""} className="h-full w-full object-cover" />
                </a>
              ))}
            </div>
          )}
          {msg.text && (
            <>
              <div className="rounded-2xl rounded-br-md bg-orange-500 text-white text-sm px-3 py-2 whitespace-pre-wrap">
                {msg.text}
              </div>
              <div className="flex justify-end">
                <CopyButton text={msg.text} />
              </div>
            </>
          )}
        </div>
      </div>
    );
  }
  // assistant
  const intro = msg.step ? STEP_INTROS[msg.step] : null;
  // Дата осмотра — показываем в активной (редактируемой) карточке шага.
  const showDate = interactive && intro?.needsDate;
  const selected = new Set(msg.selectedChipValues ?? []);

  return (
    <div className="flex gap-2 items-start">
      <div className="h-7 w-7 shrink-0 rounded-full bg-orange-500/15 border border-orange-500/30 flex items-center justify-center">
        <img src={logo} alt="" className="h-4 w-4 invert" />
      </div>
      <div className="max-w-[85%] space-y-2">
        <div className="text-[10px] uppercase tracking-wide text-white/40">ИИ-ассистент</div>
        {msg.kind === "passport" && draft ? (
          <div className="rounded-2xl rounded-tl-md bg-white/[0.04] border border-white/10 text-sm px-3 py-2.5 text-white">
            <CarChecklist draft={draft} onFillMissing={onFillMissing} />
            {msg.text && (
              <div className="mt-2 pt-2 border-t border-white/5 text-[12px] text-white/55 whitespace-pre-wrap">
                {msg.text}
              </div>
            )}
          </div>
        ) : msg.kind === "docsPassport" && draft ? (
          <div className="rounded-2xl rounded-tl-md bg-white/[0.04] border border-white/10 text-sm px-3 py-2.5 text-white">
            <DocsChecklist
              draft={draft}
              onFillMissing={onFillMissing}
              onAllMatch={onDocsAllMatch}
            />
            {msg.text && (
              <div className="mt-2 pt-2 border-t border-white/5 text-[12px] text-white/55 whitespace-pre-wrap">
                {msg.text}
              </div>
            )}
          </div>
        ) : (
          msg.text && (
            <>
              <div className="rounded-2xl rounded-tl-md bg-white/[0.04] border border-white/10 text-sm px-3 py-2 text-white whitespace-pre-wrap">
                {msg.text}
              </div>
              <CopyButton text={msg.text} />
            </>
          )
        )}
        {msg.attachments && msg.attachments.length > 0 && (() => {
          // В сформированных карточках не показываем крупные изображения
          // марки/модели/поколения — оставляем только мелкие миниатюры (если есть).
          const small = msg.attachments.filter(
            (a) => a.kind !== "generation" && a.kind !== "model" && a.kind !== "brand",
          );
          if (!small.length) return null;
          const big = undefined as typeof small[number] | undefined;
          return (
            <div className="flex flex-col gap-2">
              {big && (
                <a
                  href={big.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-xl overflow-hidden border border-white/10 bg-white/[0.03]"
                  title={big.label}
                >
                  <img
                    src={big.url}
                    alt={big.label ?? ""}
                    loading="lazy"
                    className="block w-full h-44 object-contain bg-white/5"
                  />
                  {big.label && (
                    <div className="text-[11px] text-white/70 px-2 py-1 truncate text-center">
                      {big.label}
                    </div>
                  )}
                </a>
              )}
              {small.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {small.map((a) => (
                    <a
                      key={a.url}
                      href={a.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-lg overflow-hidden border border-white/10 bg-white/[0.03]"
                      title={a.label}
                    >
                      <img
                        src={a.url}
                        alt={a.label ?? ""}
                        loading="lazy"
                        className="block w-full h-16 object-contain bg-white/5"
                      />
                      {a.label && (
                        <div className="text-[10px] text-white/60 px-1.5 py-1 truncate text-center">
                          {a.label}
                        </div>
                      )}
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
        {msg.chips && msg.chips.length > 0 && (() => {
          // Group chips by groupLabel (chips without a label fall into "").
          const groups: Array<{ label: string; items: ChatChip[] }> = [];
          for (const c of msg.chips) {
            const key = c.groupLabel ?? "";
            let g = groups.find((x) => x.label === key);
            if (!g) {
              g = { label: key, items: [] };
              groups.push(g);
            }
            g.items.push(c);
          }
          const renderChip = (c: ChatChip) => {
            const isSel = selected.has(c.value);
            const hasImage = !!c.image;
            if (hasImage) {
              return (
                <button
                  key={c.label}
                  disabled={!interactive}
                  onClick={() => onChipTap(c)}
                  className={
                    "flex flex-col items-stretch w-[112px] rounded-lg overflow-hidden border transition-colors text-left " +
                    (isSel
                      ? "bg-orange-500/10 border-orange-500"
                      : interactive
                        ? "border-white/15 hover:border-orange-400/60"
                        : "border-white/10 opacity-60 cursor-default")
                  }
                >
                  <img
                    src={c.image}
                    alt={c.label}
                    loading="lazy"
                    className="block w-full h-16 object-contain bg-white/5"
                  />
                  <div className="px-1.5 py-1">
                    <div className={"text-[11px] leading-tight " + (isSel ? "text-white" : "text-white/85")}>
                      {isSel ? "✓ " : ""}
                      {c.label}
                    </div>
                    {c.description && (
                      <div className="text-[10px] text-white/55 truncate">{c.description}</div>
                    )}
                  </div>
                </button>
              );
            }
            return (
              <button
                key={c.label}
                disabled={!interactive}
                onClick={() => onChipTap(c)}
                className={
                  "rounded-full border px-2.5 py-1 text-xs transition-colors " +
                  (isSel
                    ? "bg-orange-500 text-white border-orange-500"
                    : interactive
                      ? "border-white/15 text-white/80 hover:border-orange-400/60 hover:text-white"
                      : "border-white/10 text-white/40 cursor-default")
                }
              >
                {isSel ? "✓ " : ""}
                {c.label}
                {c.description ? ` · ${c.description}` : ""}
              </button>
            );
          };
          // If there are no labeled groups, fall back to the flat layout.
          if (groups.length === 1 && groups[0].label === "") {
            return <div className="flex flex-wrap gap-2">{groups[0].items.map(renderChip)}</div>;
          }
          return (
            <div className="space-y-2">
              {groups.map((g) => (
                <div key={g.label || "_"} className="space-y-1">
                  {g.label && (
                    <div className="text-[10px] uppercase tracking-wide text-white/45">
                      {g.label}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">{g.items.map(renderChip)}</div>
                </div>
              ))}
            </div>
          );
        })()}
        {showDate && (
          <InspectionDateField value={inspectionDateValue} onChange={onInspectionDateChange} />
        )}

      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* noop */
        }
      }}
      aria-label="Скопировать сообщение"
      title={copied ? "Скопировано" : "Скопировать"}
      className="inline-flex items-center gap-1 text-[11px] text-white/40 hover:text-white/80 transition-colors px-1.5 py-0.5 rounded"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3" />
          Скопировано
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          Копировать
        </>
      )}
    </button>
  );
}

function countCarPassport(draft: import("@/lib/carreports/types").ReportDraft): number {
  const c = draft.carStep ?? {};
  const ch = draft.characteristicsStep ?? {};
  const checks: boolean[] = [
    !!c.vin && c.vin.length >= 11,
    !!(ch.brandName && ch.modelCarName),
    !!c.mileage,
    !!c.cityInspection,
    !!c.dateInspection,
    !!ch.year,
    !!ch.engineType,
    !!ch.transmission,
    !!ch.driveType,
    !!ch.color,
  ];
  return checks.filter(Boolean).length;
}
