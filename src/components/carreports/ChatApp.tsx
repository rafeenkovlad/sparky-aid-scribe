import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
import assistantAvatar from "@/assets/cr-assistant-vindiesel.jpg";
import { TokenDialog } from "./TokenDialog";
import { PWAInstallButton } from "@/components/PWAInstallButton";
import { PWAInstallBanner } from "@/components/PWAInstallBanner";
import { ReportPreview } from "./ReportPreview";
import { FullReportView } from "./FullReportView";
import { InspectionDateField } from "./InspectionDateField";

import { CarChecklist } from "./CarChecklist";
import { DocsChecklist, countDocsPassport } from "./DocsChecklist";
import { StepPassport } from "./StepPassport";

import { InspectionFullPassport } from "./InspectionFullPassport";
import { NoteProposalCard } from "./NoteProposalCard";


import { useThreads, useToken } from "@/hooks/useThreads";
import {
  createThread,
  deleteThread,
  getThread,
  updateThread,
} from "@/lib/carreports/threadStore";
import { FLOW_STEPS, isConfirmAdvance, stepById } from "@/lib/carreports/flow";
import { STEP_INTROS } from "@/lib/carreports/stepChips";
import type { ChatChip, ChatMessage, NoteRef, PendingTagName, StepId, Thread } from "@/lib/carreports/types";
import { extractForStep, applyVinDecode, askQuestion, summarizeStepDraft, analyzeInspectionPhoto, analyzeInspectionNote, reformulateNote, type NotePatched } from "@/lib/carreports/orchestrator";
import { filledCount, isStepFilled, nextMissingPrompt, optionalHintSentence, remainingFieldLabels } from "@/lib/carreports/progress";

import {
  INSPECTION_SECTIONS,
  defaultElementIdFor,
  findingKey,
  getSection,
  type SectionSnake,
} from "@/lib/carreports/inspectionSections";
import {
  clearFinding,
  getCursor,
  nextEmptyLocation,
  togglePendingTag,
  toggleTag as toggleFindingTag,
  upsertFinding,
} from "@/lib/carreports/inspectionState";
import { InspectionChipsCard, SectionPickerCard } from "./InspectionChipsCard";
import {
  InspectionCollage,
  InspectionUploadPrompt,
} from "./InspectionCollage";
import { ElementFocusCard, type NoteProposal as NoteProposalT } from "./ElementFocusCard";
import { addUserTag, type UserTag } from "@/lib/carreports/inspectionTags";
import { Sparkles, FileText, Share2, ChevronRight } from "lucide-react";

import { ensurePhotoAccessible, preparePhoto, uploadFile, uploadPhoto, uploadTemporary } from "@/lib/carreports/photo";
import { submitReport } from "@/lib/carreports/storageApi";
import { generateSummary } from "@/lib/carreports/aiSummary";
import { collectMissingForSummary } from "@/lib/carreports/summaryGate";
import { enqueueAI, getQueueSize, subscribeQueue } from "@/lib/carreports/aiQueue";
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

function isLastMessagePassport(t: Thread): boolean {
  const all: ChatMessage[] = [];
  for (const k of Object.keys(t.messages) as StepId[]) {
    const arr = t.messages[k];
    if (arr && arr.length) all.push(...arr);
  }
  if (!all.length) return false;
  all.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const last = all[all.length - 1];
  return last.kind === "stepPassport" || last.kind === "passport" || last.kind === "docsPassport";
}

function totalMessages(m: Thread["messages"]): number {
  return (
    m.car.length +
    m.characteristics.length +
    m.docs.length +
    m.inspection.length +
    (m.legalMaterials?.length ?? 0) +
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
  legalMaterials: "Комментарий к материалам (необязательно). Файлы добавляйте карточкой выше.",
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
    ...(step === "inspection" ? { kind: "inspectionSectionPicker" as const } : {}),
    createdAt: Date.now(),
  };
}

/** Сообщение-«паспорт заполненности» уже заполненного шага. */
function makeStepPassportMessage(step: StepId): ChatMessage {
  return {
    id: msgId(),
    role: "assistant",
    text: "",
    step,
    kind: "stepPassport",
    createdAt: Date.now(),
  };
}

/** Сериализуем NoteRef в стабильный ключ (для id сообщения, dedup, in-flight). */
function noteRefKey(ref: NoteRef): string {
  return ref.kind === "inspection"
    ? `${ref.kind}:${ref.section}:${ref.elementId}`
    : ref.kind;
}

/** Шаг, к которому относится NoteRef — нужно для pushMsg/фильтрации. */
function stepForNoteRef(ref: NoteRef): StepId {
  switch (ref.kind) {
    case "inspection": return "inspection";
    case "testDrive": return "testDrive";
    case "docs": return "docs";
    case "resultSummary":
    case "resultVerdict": return "result";
  }
}

export function ChatApp({ threadId }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Один раз при монтировании чистим IndexedDB-кеш фото от «сирот» — записей,
  // которые больше не указаны ни в одном треде (например, после удаления
  // треда в этой или другой вкладке).
  const gcRanRef = useRef(false);
  const threads = useThreads();
  const token = useToken();
  const navigate = useNavigate();

  const thread = useMemo(() => threads.find((t) => t.id === threadId) ?? null, [threads, threadId]);

  useEffect(() => {
    if (gcRanRef.current || !mounted) return;
    gcRanRef.current = true;
    const keep = new Set<string>();
    for (const t of threads) {
      for (const p of t.draft.inspectionStep.photos) {
        if (p.photoId) keep.add(p.photoId);
      }
      for (const m of t.draft.legalReviewStep?.otherMaterials ?? []) {
        if (m.photoId) keep.add(m.photoId);
      }
    }
    void import("@/lib/carreports/photoCache").then((mod) => mod.gcOrphans(keep));
  }, [mounted, threads]);

  const [tokenOpen, setTokenOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [fullReportOpen, setFullReportOpen] = useState(false);
  const [composer, setComposer] = useState("");
  const [composerFocused, setComposerFocused] = useState(false);
  const [composerHeight, setComposerHeight] = useState<number | null>(null);
  const composerDragRef = useRef<{ startY: number; startH: number } | null>(null);
  // Re-render when the visual viewport changes (e.g. mobile keyboard opens),
  // so the composer height cap recomputes against the actually visible area.
  const [, setVvTick] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const onResize = () => {
      setVvTick((n) => n + 1);
      setComposerHeight((h) => {
        if (h == null) return h;
        const cap = Math.max(120, vv.height - 200);
        return Math.min(h, cap);
      });
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);
  const [busy, setBusy] = useState(false);
  const [askMode, setAskMode] = useState(false);
  /** Открытый «чат с фотографией»: индекс фото в `inspectionStep.photos`. */
  const [photoFocusIdx, setPhotoFocusIdx] = useState<number | null>(null);
  /** Сохранённое значение композера до входа в режим фото — восстановим на выходе. */
  const composerBackupRef = useRef<string | null>(null);
  /** Идёт ли AI-анализ заметки к фото. */
  const [photoAiBusy, setPhotoAiBusy] = useState(false);
  /**
   * Сериализатор задач на одно фото (text-note + vision). Гарантирует, что
   * `savePhotoNote` и `runPhotoAi`, выпущенные параллельно по одному фото,
   * не перезаписывают findings друг друга и не теряют теги.
   */
  const photoLockRef = useRef<Map<string, Promise<void>>>(new Map());
  const photoBusyCountRef = useRef(0);
  const runWithPhotoLock = useCallback(
    (key: string, fn: () => Promise<void>) => {
      const prev = photoLockRef.current.get(key) ?? Promise.resolve();
      const next = prev.catch(() => {}).then(async () => {
        photoBusyCountRef.current += 1;
        setPhotoAiBusy(true);
        try {
          await fn();
        } finally {
          photoBusyCountRef.current = Math.max(0, photoBusyCountRef.current - 1);
          if (photoBusyCountRef.current === 0) setPhotoAiBusy(false);
        }
      });
      const tracked = next.finally(() => {
        if (photoLockRef.current.get(key) === tracked) photoLockRef.current.delete(key);
      });
      photoLockRef.current.set(key, tracked);
      return next;
    },
    [],
  );
  /** Предложение по заметке: оригинал vs AI-переформулировка. */
  const [noteProposal, setNoteProposal] = useState<NoteProposalT | null>(null);

  
  /** Прикреплённые к следующему сообщению фото (для распознавания). */
  const [pendingAttachments, setPendingAttachments] = useState<
    Array<{
      id: string;
      /** id записи в IndexedDB-кеше — для перезалива/превью без base64 в state. */
      photoId: string;
      dataUrl: string;
      blob: Blob;
      filename: string;
      /** Оригинальный файл — без сжатия; используется для постоянной загрузки. */
      originalBlob: Blob;
      originalFilename: string;
    }>
  >([]);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const materialsInputRef = useRef<HTMLInputElement>(null);
  const materialsCameraRef = useRef<HTMLInputElement>(null);
  const [materialsBusy, setMaterialsBusy] = useState(false);

  const handleMaterialFiles = useCallback(
    async (files: File[]) => {
      if (!thread || !files.length) return;
      setMaterialsBusy(true);
      try {
        for (const f of files) {
          const placeholderId = msgId();
          updateThread(thread.id, (t) => {
            pushMsg(t, "legalMaterials", {
              id: placeholderId,
              role: "assistant",
              text: `⏳ Загружаю: ${f.name}…`,
              step: "legalMaterials",
              queueStatus: "running",
              createdAt: Date.now(),
            });
          });
          try {
            const up = await uploadFile(f);
            updateThread(thread.id, (t) => {
              const arr = t.draft.legalReviewStep?.otherMaterials ?? [];
              t.draft.legalReviewStep = {
                ...t.draft.legalReviewStep,
                otherMaterials: [
                  ...arr,
                  {
                    filename: up.filename,
                    key: up.key,
                    type: up.type,
                    url: up.url,
                    size: up.size,
                    mimeType: up.mimeType,
                    addedAt: Date.now(),
                  },
                ],
              };
              const i = t.messages.legalMaterials.findIndex((m) => m.id === placeholderId);
              const icon = up.type === "image" ? "🖼️" : up.type === "video" ? "🎬" : "📄";
              const kb =
                up.size >= 1024 * 1024
                  ? `${(up.size / 1024 / 1024).toFixed(1)} МБ`
                  : `${Math.max(1, Math.round(up.size / 1024))} КБ`;
              const text = `${icon} ${f.name} · ${kb} · загружено`;
              if (i >= 0) {
                t.messages.legalMaterials[i] = {
                  ...t.messages.legalMaterials[i],
                  text,
                  queueStatus: undefined,
                };
              }
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : "ошибка загрузки";
            updateThread(thread.id, (t) => {
              const i = t.messages.legalMaterials.findIndex((m) => m.id === placeholderId);
              if (i >= 0) {
                t.messages.legalMaterials[i] = {
                  ...t.messages.legalMaterials[i],
                  text: `❌ ${f.name}: ${msg}`,
                  queueStatus: "error",
                };
              }
            });
          }
        }
      } finally {
        setMaterialsBusy(false);
      }
    },
    [thread],
  );


  // Размер очереди AI-запросов по текущему треду (для индикатора).
  const queueSize = useSyncExternalStore(
    subscribeQueue,
    () => (threadId ? getQueueSize(threadId) : 0),
    () => 0,
  );


  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const askToggledByPointerRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const voiceBaseRef = useRef<string>("");
  const voice = useVoiceRecorder({
    onLive: (t) => {
      const base = voiceBaseRef.current;
      setComposer(base ? `${base} ${t}` : t);
    },
    onText: (t) => {
      const base = voiceBaseRef.current;
      setComposer(base ? `${base} ${t}` : t);
      voiceBaseRef.current = "";
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

  // Композер скоупим по (thread, step): при переходе на другой шаг текущий
  // черновик сохраняем, на новом шаге показываем его собственный (или пусто).
  // На возврат — восстанавливаем то, что было набрано.
  const composerDraftsRef = useRef<Record<string, string>>({});
  const composerStepKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!thread) return;
    const nextKey = `${thread.id}:${currentStep}`;
    const prevKey = composerStepKeyRef.current;
    if (prevKey === nextKey) return;
    if (prevKey !== null) {
      composerDraftsRef.current[prevKey] = composer;
    }
    composerStepKeyRef.current = nextKey;
    const restored = composerDraftsRef.current[nextKey] ?? "";
    setComposer(restored);
    // При уходе из шага «Осмотр» выходим из фокуса фото, чтобы выбранный
    // элемент не «протекал» в другие шаги.
    if (currentStep !== "inspection") {
      setPhotoFocusIdx(null);
      composerBackupRef.current = null;
    }
  }, [thread, currentStep, composer]);



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

  // Inspection: current section/element (new DTO-based cursor).
  const cursor = useMemo(
    () => (thread ? getCursor(thread.draft) : null),
    [thread],
  );
  const photoInputRef = useRef<HTMLInputElement>(null);

  /** Показывает в чате одну карточку для раздела внизу ленты:
   *  collage — если есть фото, иначе upload-prompt. Старые карточки этого
   *  раздела убираем, чтобы свежая всплыла в конце. */
  const ensureSectionMessages = useCallback(
    (snake: SectionSnake) => {
      if (!thread) return;
      updateThread(thread.id, (t) => {
        const promptId = `insp-prompt-${snake}`;
        const collageId = `insp-collage-${snake}`;
        const hasPhotos = t.draft.inspectionStep.photos.some(
          (p) => p.section === snake,
        );
        const keepId = hasPhotos ? collageId : promptId;
        const list = t.messages.inspection;
        for (let i = list.length - 1; i >= 0; i -= 1) {
          if (list[i].id === promptId || list[i].id === collageId) {
            list.splice(i, 1);
          }
        }
        pushMsg(t, "inspection", {
          id: keepId,
          role: "assistant",
          text: "",
          step: "inspection",
          kind: hasPhotos ? "inspectionCollage" : "inspectionUploadPrompt",
          sectionSnake: snake,
          createdAt: Date.now(),
        });
      });
    },
    [thread],
  );


  const showInspectionFullPassport = useCallback(() => {
    if (!thread) return;
    updateThread(thread.id, (t) => {
      const list = t.messages.inspection;
      // Удаляем предыдущий общий паспорт, чтобы не дублировался.
      for (let i = list.length - 1; i >= 0; i -= 1) {
        if (list[i].kind === "inspectionFullPassport") list.splice(i, 1);
      }
      pushMsg(t, "inspection", {
        id: `insp-full-passport-${Date.now()}`,
        role: "assistant",
        text: "",
        step: "inspection",
        kind: "inspectionFullPassport",
        createdAt: Date.now(),
      });
    });
  }, [thread]);


  const selectSection = useCallback(
    (snake: SectionSnake) => {
      if (!thread) return;
      updateThread(thread.id, (t) => {
        t.draft.inspectionStep.currentSection = snake;
        const sec = INSPECTION_SECTIONS.find((s) => s.snake === snake);
        t.draft.inspectionStep.currentElementId = sec?.elements[0].id;
        t.draft.inspectionStep.manualCursor = true;
        t.draft.inspectionStep.touched = true;
      });
      ensureSectionMessages(snake);
      textareaRef.current?.focus();
    },
    [thread, ensureSectionMessages],
  );



  const selectElement = useCallback(
    (elementId: string) => {
      if (!thread) return;
      updateThread(thread.id, (t) => {
        t.draft.inspectionStep.currentElementId = elementId;
        t.draft.inspectionStep.manualCursor = true;
      });
      textareaRef.current?.focus();
    },
    [thread],
  );

  const setVerdict = useCallback(
    (v: "ok" | "minor" | "serious") => {
      if (!thread || !cursor) return;
      updateThread(thread.id, (t) => {
        upsertFinding(
          t.draft.inspectionStep,
          cursor.section.snake,
          cursor.element.id,
          (f) => {
            if (v === "ok") {
              f.noDamage = true;
              f.seriousDamageTagIds = [];
              f.noSeriousDamageTagIds = [];
              f.pendingTagNames = [];
            } else {
              f.noDamage = false;
              // Don't wipe tags when switching between minor/serious so the user
              // can re-classify without losing input.
            }
          },
        );
        t.draft.inspectionStep.touched = true;
      });
    },
    [thread, cursor],
  );

  const toggleTagOnFinding = useCallback(
    (tag: UserTag) => {
      if (!thread || !cursor) return;
      const bucket: "serious" | "non_serious" =
        tag.type === "serious" ? "serious" : "non_serious";
      updateThread(thread.id, (t) => {
        upsertFinding(
          t.draft.inspectionStep,
          cursor.section.snake,
          cursor.element.id,
          (f) => toggleFindingTag(f, bucket, tag.id),
        );
        t.draft.inspectionStep.touched = true;
      });
    },
    [thread, cursor],
  );

  const addPendingTagOnFinding = useCallback(
    (name: string, severity: "serious" | "non_serious") => {
      if (!thread || !cursor) return;
      updateThread(thread.id, (t) => {
        upsertFinding(
          t.draft.inspectionStep,
          cursor.section.snake,
          cursor.element.id,
          (f) => togglePendingTag(f, name, severity),
        );
        t.draft.inspectionStep.touched = true;
      });
    },
    [thread, cursor],
  );

  const clearCurrentElement = useCallback(() => {
    if (!thread || !cursor) return;
    updateThread(thread.id, (t) => {
      clearFinding(
        t.draft.inspectionStep,
        cursor.section.snake,
        cursor.element.id,
      );
    });
  }, [thread, cursor]);

  const markSectionAllOk = useCallback(() => {
    if (!thread || !cursor) return;
    updateThread(thread.id, (t) => {
      for (const el of cursor.section.elements) {
        upsertFinding(
          t.draft.inspectionStep,
          cursor.section.snake,
          el.id,
          (f) => {
            // «Без замечаний» — обнуляем все теги и проставляем флаг.
            f.seriousDamageTagIds = [];
            f.noSeriousDamageTagIds = [];
            f.note = "";

            f.noDamage = true;
          },
        );
      }
      t.draft.inspectionStep.touched = true;
    });
  }, [thread, cursor]);


  const goNextElement = useCallback(() => {
    if (!thread || !cursor) return;
    const next = nextEmptyLocation(
      thread.draft.inspectionStep,
      cursor.section.snake,
      cursor.element.id,
    );
    if (!next) return;
    updateThread(thread.id, (t) => {
      t.draft.inspectionStep.currentSection = next.section.snake;
      t.draft.inspectionStep.currentElementId = next.element.id;
    });
    textareaRef.current?.focus();
  }, [thread, cursor]);

  const onPickPhoto = useCallback(
    async (file: File) => {
      // Legacy: точечное фото к активному элементу (без коллажа).
      if (!thread || !cursor) return;
      const sectionSnake = cursor.section.snake;
      const elementId = cursor.element.id;
      try {
        const prepared = await preparePhoto(file);
        const up = await uploadPhoto(prepared);
        updateThread(thread.id, (t) => {
          t.draft.inspectionStep.photos.push({
            section: sectionSnake,
            elementId,
            filename: up.filename,
            photoId: prepared.photoId,
            dataUrl: prepared.dataUrl,
            url: up.url,
            remote: up.remote,
            addedAt: Date.now(),
          });
          t.draft.inspectionStep.touched = true;
        });
      } catch (e) {
        const m = e instanceof Error ? e.message : "Ошибка обработки фото";
        updateThread(thread.id, (t) => {
          pushMsg(t, "inspection", {
            id: msgId(),
            role: "assistant",
            text: `⚠️ ${m}`,
            createdAt: Date.now(),
          });
        });
      }
    },
    [thread, cursor],
  );

  /** Загрузить пачку фото в активный раздел и поднять коллаж в конец. */
  const addInspectionPhotos = useCallback(
    async (sectionSnake: SectionSnake, files: File[]) => {
      if (!thread || !files.length) return;
      ensureSectionMessages(sectionSnake);
      for (const file of files) {
        try {
          const prepared = await preparePhoto(file);
          const up = await uploadPhoto(prepared);
          updateThread(thread.id, (t) => {
            t.draft.inspectionStep.photos.push({
              section: sectionSnake,
              filename: up.filename,
              photoId: prepared.photoId,
              dataUrl: prepared.dataUrl,
              url: up.url,
              remote: up.remote,
              addedAt: Date.now(),
            });
            t.draft.inspectionStep.touched = true;
          });
        } catch (e) {
          const m = e instanceof Error ? e.message : "Ошибка обработки фото";
          updateThread(thread.id, (t) => {
            pushMsg(t, "inspection", {
              id: msgId(),
              role: "assistant",
              text: `⚠️ ${m}`,
              createdAt: Date.now(),
            });
          });
        }
      }
      // После загрузки апгрейдим upload-prompt в коллаж.
      ensureSectionMessages(sectionSnake);
    },
    [thread, ensureSectionMessages],
  );

  const assignPendingPhoto = useCallback(
    (messageId: string, sectionSnake: SectionSnake) => {
      if (!thread) return;
      updateThread(thread.id, (t) => {
        for (const key of Object.keys(t.messages) as StepId[]) {
          const m = t.messages[key].find((x) => x.id === messageId);
          if (!m || !m.pendingPhoto || m.pendingPhoto.assignedSection) continue;
          const photo = m.pendingPhoto;
          t.draft.inspectionStep.photos.push({
            section: sectionSnake,
            filename: photo.filename,
            photoId: photo.photoId,
            dataUrl: photo.dataUrl,
            url: photo.url,
            remote: photo.remote === true,
            addedAt: Date.now(),
          });
          t.draft.inspectionStep.touched = true;
          const label =
            INSPECTION_SECTIONS.find((s) => s.snake === sectionSnake)?.label ??
            sectionSnake;
          // Сворачиваем карточку выбора в обычное «📌 Закреплено…»,
          // как при автоклассификации. Иначе в чате остаются полупустые
          // карточки выбора, которые засоряют ленту.
          m.kind = undefined;
          m.pendingPhoto = undefined;
          m.text = `📌 Закреплено в разделе «${label}»`;
          m.attachments = [
            {
              url: photo.url ?? photo.dataUrl ?? "",
              label: photo.filename,
            },
          ];
          ensureSectionMessages(sectionSnake);
          break;
        }
      });
    },
    [thread, ensureSectionMessages],
  );



  // ─── Photo focus mode (chat-with-photo) ──────────────────────────────────

  const photoFocus =
    photoFocusIdx !== null && thread
      ? thread.draft.inspectionStep.photos[photoFocusIdx] ?? null
      : null;

  // defaultElementIdFor — единый помощник в `inspectionSections.ts`,
  // см. импорт сверху файла. Локального дублирования больше нет.



  const enterPhotoFocus = useCallback(
    (idx: number) => {
      if (!thread) return;
      composerBackupRef.current = composer;
      setPhotoFocusIdx(idx);
      // Один проход по треду: и читаем note для композера, и переносим/создаём
      // карточку фокус-элемента в конец ленты. Раньше было два apdate'а и
      // мутация существующего объекта (existing.photoIdx = ...), которая
      // могла затереть поле в ещё отрендеренной ссылке.
      let composerSeed: string | null = null;
      updateThread(thread.id, (t) => {
        const p = t.draft.inspectionStep.photos[idx];
        if (p) {
          const sec = p.section as SectionSnake;
          const elId = p.elementId ?? defaultElementIdFor(sec);
          const f = t.draft.inspectionStep.findings?.[findingKey(sec, elId)];
          composerSeed = f?.note ?? "";
        }
        const arr = t.messages.inspection;
        const existingIdx = arr.findIndex((m) => m.kind === "inspectionElementFocus");
        const now = Date.now();
        if (existingIdx >= 0) {
          const [existing] = arr.splice(existingIdx, 1);
          // Иммутабельная замена — не мутируем старый объект.
          arr.push({ ...existing, photoIdx: idx, createdAt: now });
        } else {
          pushMsg(t, "inspection", {
            id: msgId(),
            role: "assistant",
            text: "",
            kind: "inspectionElementFocus",
            photoIdx: idx,
            createdAt: now,
          });
        }
      });
      if (composerSeed !== null) setComposer(composerSeed);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [composer, thread, defaultElementIdFor],
  );


  const exitPhotoFocus = useCallback(() => {
    setPhotoFocusIdx(null);
    setNoteProposal(null);
    if (composerBackupRef.current !== null) {
      setComposer(composerBackupRef.current);
      composerBackupRef.current = null;
    } else {
      setComposer("");
    }
  }, []);


  /** Мутация finding текущего фото в фокус-режиме. */
  // Мутирует finding фото по конкретному индексу. Без явного idx использует
  // глобальный photoFocusIdx (полноэкранный фокус). Inline-карточки в ленте
  // чата передают собственный idx, иначе клики по тегам в них уходят в null.
  const mutateFindingAt = useCallback(
    (
      idx: number,
      mutate: (f: import("@/lib/carreports/types").InspectionElementFinding) => void,
    ) => {
      if (!thread) return;
      updateThread(thread.id, (t) => {
        const p = t.draft.inspectionStep.photos[idx];
        if (!p) return;
        const sec = p.section as SectionSnake;
        const elId = p.elementId ?? defaultElementIdFor(sec);
        upsertFinding(t.draft.inspectionStep, sec, elId, mutate);
        t.draft.inspectionStep.touched = true;
      });
    },
    [thread, defaultElementIdFor],
  );

  const mutatePhotoFinding = useCallback(
    (mutate: (f: import("@/lib/carreports/types").InspectionElementFinding) => void) => {
      if (photoFocusIdx === null) return;
      mutateFindingAt(photoFocusIdx, mutate);
    },
    [photoFocusIdx, mutateFindingAt],
  );


  const photoChangeElement = useCallback(
    (elementId: string) => {
      if (photoFocusIdx === null || !thread) return;
      const idx = photoFocusIdx;
      // Один проход: меняем elementId и тут же читаем заметку нового элемента,
      // чтобы подставить её в композер. Без повторного getThread — меньше
      // допущений о синхронности store.
      let noteSeed = "";
      updateThread(thread.id, (t) => {
        const p = t.draft.inspectionStep.photos[idx];
        if (!p) return;
        p.elementId = elementId;
        t.draft.inspectionStep.touched = true;
        const f = t.draft.inspectionStep.findings?.[
          findingKey(p.section as SectionSnake, elementId)
        ];
        noteSeed = f?.note ?? "";
      });
      setComposer(noteSeed);
    },
    [photoFocusIdx, thread],
  );


  const photoSetVerdict = useCallback(
    (v: "ok" | "minor" | "serious") => {
      mutatePhotoFinding((f) => {
        if (v === "ok") {
          f.noDamage = true;
          f.seriousDamageTagIds = [];
          f.noSeriousDamageTagIds = [];
          f.pendingTagNames = [];
        } else {
          f.noDamage = false;
        }
      });
    },
    [mutatePhotoFinding],
  );

  const photoToggleTag = useCallback(
    (tag: UserTag) => {
      const bucket: "serious" | "non_serious" =
        tag.type === "serious" ? "serious" : "non_serious";
      mutatePhotoFinding((f) => toggleFindingTag(f, bucket, tag.id));
    },
    [mutatePhotoFinding],
  );

  const photoAddPendingTag = useCallback(
    (name: string, severity: "serious" | "non_serious") => {
      mutatePhotoFinding((f) => togglePendingTag(f, name, severity));
    },
    [mutatePhotoFinding],
  );

  const deletePhotoFocus = useCallback(() => {
    if (photoFocusIdx === null || !thread) return;
    const idx = photoFocusIdx;
    const removed = thread.draft.inspectionStep.photos[idx];
    updateThread(thread.id, (t) => {
      t.draft.inspectionStep.photos.splice(idx, 1);
    });
    if (removed?.photoId) {
      void import("@/lib/carreports/photoCache").then((m) =>
        m.deletePhoto(removed.photoId!),
      );
    }
    exitPhotoFocus();
  }, [photoFocusIdx, thread, exitPhotoFocus]);

  /**
   * Сохранить текст композера как заметку к фото. ИИ автоматически:
   * — переформулирует заметку чище и короче;
   * — подбирает подходящие теги из каталога раздела, либо создаёт новые;
   * — определяет, серьёзное это повреждение или нет.
   * Всё применяется к finding автоматически, без подтверждения пользователя.
   */
  const savePhotoNote = useCallback(() => {
    const text = composer.trim();
    if (!text) return;
    // Атомарно: читаем актуальный note и записываем объединённый черновик
    // в одной транзакции updateThread. Раньше между чтением previousNote и
    // mutatePhotoFinding мог проскочить чужой апдейт (AI-таск, повторный
    // клик «Сохранить») — и мы дублировали кусок текста.
    let previousNote = "";
    let draftCombined = text;
    if (thread && photoFocus && photoFocusIdx !== null) {
      const idxLocal = photoFocusIdx;
      updateThread(thread.id, (t) => {
        const p = t.draft.inspectionStep.photos[idxLocal];
        if (!p) return;
        const sec = p.section as SectionSnake;
        const elId = p.elementId ?? defaultElementIdFor(sec);
        const key = findingKey(sec, elId);
        previousNote = (t.draft.inspectionStep.findings?.[key]?.note ?? "").trim();
        draftCombined = previousNote && previousNote !== text
          ? `${previousNote}\n${text}`
          : text;
        upsertFinding(t.draft.inspectionStep, sec, elId, (f) => {
          f.note = draftCombined;
        });
        t.draft.inspectionStep.touched = true;
      });
    }


    setComposer("");
    setNoteProposal({ original: text, ai: null, loading: true, picked: "ai" });

    // 1) В ленту чата сразу попадают: реплика пользователя и «рассуждения» ИИ.
    const statusId = msgId();
    if (thread) {
      updateThread(thread.id, (t) => {
        pushMsg(t, "inspection", {
          id: msgId(),
          role: "user",
          text,
          step: "inspection",
          createdAt: Date.now(),
        });
        pushMsg(t, "inspection", {
          id: statusId,
          role: "assistant",
          text: "🧠 Анализирую заметку…\n• уточняю элемент\n• подбираю теги из каталога\n• оцениваю серьёзность",
          step: "inspection",
          createdAt: Date.now(),
        });
      });
    }

    const lockKey =
      thread && photoFocusIdx !== null ? `${thread.id}:${photoFocusIdx}` : `note:${statusId}`;
    runWithPhotoLock(lockKey, async () => {

      try {
        if (!thread || !photoFocus) {
          setNoteProposal((prev) =>
            prev && prev.original === text ? { ...prev, ai: "", loading: false } : prev,
          );
          return;
        }
        const fresh = getThread(thread.id);
        if (!fresh) return;
        const sec = photoFocus.section as SectionSnake;
        const elIdInitial = photoFocus.elementId ?? null;
        // Приоритет — текст заметки. Фото подключаем только если элемент
        // раздела ещё не определён и без vision его не угадать.
        let resultElementId: string | undefined;
        let r: {
          noDamage: boolean;
          seriousTagIds: number[];
          noSeriousTagIds: number[];
          pendingTags: PendingTagName[];
          note: string;
          paintworkThicknessFrom?: number;
          paintworkThicknessTo?: number;
        };
        const needVisionForElement = !elIdInitial && !!photoFocus.url;
        if (needVisionForElement) {
          // Проверяем, что фото всё ещё доступно по presigned URL — иначе
          // перезаливаем во временное хранилище из локального превью.
          const usableUrl = await ensurePhotoAccessible({
            url: photoFocus.url,
            dataUrl: photoFocus.dataUrl,
            filename: photoFocus.filename,
            photoId: photoFocus.photoId,
          });
          if (usableUrl && usableUrl !== photoFocus.url) {
            updateThread(thread.id, (t) => {
              const pp = t.draft.inspectionStep.photos[photoFocusIdx ?? -1];
              if (pp) pp.url = usableUrl;
            });
          }
          const v = await analyzeInspectionPhoto(
            fresh,
            sec,
            usableUrl ?? photoFocus.url!,
            text,
            previousNote || undefined,
          );
          r = {
            noDamage: v.noDamage,
            seriousTagIds: v.seriousTagIds,
            noSeriousTagIds: v.noSeriousTagIds,
            pendingTags: v.pendingTags,
            note: v.note,
            paintworkThicknessFrom: v.paintworkThicknessFrom,
            paintworkThicknessTo: v.paintworkThicknessTo,
          };
          resultElementId = v.elementId;
        } else {
          // Элемент уже известен (или фото нет) — работаем только по тексту.
          const n = await analyzeInspectionNote(fresh, sec, elIdInitial, text, previousNote || undefined);
          r = {
            noDamage: n.noDamage,
            seriousTagIds: n.seriousTagIds,
            noSeriousTagIds: n.noSeriousTagIds,
            pendingTags: n.pendingTags,
            note: n.note,
          };
          resultElementId = n.elementId;
        }
        // Сразу создаём в каталоге теги, которых там ещё не было, чтобы
        // не оставлять их в "pending" — пользователь должен видеть готовые теги.
        const promotedSerious: number[] = [...r.seriousTagIds];
        const promotedNonSerious: number[] = [...r.noSeriousTagIds];
        const stillPending: PendingTagName[] = [];
        for (const pp of r.pendingTags) {
          const created = await addUserTag(sec, pp.name, pp.severity);
          if (created && typeof created.id === "number") {
            if (pp.severity === "serious") promotedSerious.push(created.id);
            else promotedNonSerious.push(created.id);
          } else {
            stillPending.push(pp);
          }
        }
        r = {
          ...r,
          seriousTagIds: promotedSerious,
          noSeriousTagIds: promotedNonSerious,
          pendingTags: stillPending,
        };

        // Авто-применяем результат: заметка ИИ + теги + классификация.
        const sectionDef = getSection(sec);
        let elementLabelForSummary = "";
        let appliedSerious: number[] = [];
        let appliedNonSerious: number[] = [];
        let appliedPending: PendingTagName[] = [];
        let appliedNote = "";
        let appliedNoDamage = false;

        updateThread(thread.id, (t) => {
          t.aiChatIds = fresh.aiChatIds;
          const p = t.draft.inspectionStep.photos[photoFocusIdx ?? -1];
          if (!p) return;
          // Какой elId был использован для оптимистичного черновика — чтобы
          // подчистить «сиротский» finding, если AI определил другой элемент.
          const optimisticElId = elIdInitial ?? defaultElementIdFor(sec);
          if (resultElementId) p.elementId = resultElementId;
          const elId = p.elementId ?? resultElementId ?? elIdInitial;
          if (!elId) return;
          // Чистим сирот: если оптимистичный finding отличается от финального,
          // содержит только наш черновик и не имеет тегов — удаляем его.
          if (optimisticElId !== elId) {
            const orphanKey = findingKey(sec, optimisticElId);
            const orphan = t.draft.inspectionStep.findings?.[orphanKey];
            const orphanEmpty =
              orphan &&
              !(orphan.seriousDamageTagIds?.length ?? 0) &&
              !(orphan.noSeriousDamageTagIds?.length ?? 0) &&
              !(orphan.pendingTagNames?.length ?? 0) &&
              (orphan.note ?? "") === draftCombined;
            if (orphanEmpty && t.draft.inspectionStep.findings) {
              delete t.draft.inspectionStep.findings[orphanKey];
            }
          }
          elementLabelForSummary =
            sectionDef?.elements.find((el: { id: string; label: string }) => el.id === elId)?.label ?? elId;
          upsertFinding(t.draft.inspectionStep, sec, elId, (f) => {
            const sSet = new Set([...(f.seriousDamageTagIds ?? []), ...r.seriousTagIds]);
            const nsSet = new Set([...(f.noSeriousDamageTagIds ?? []), ...r.noSeriousTagIds]);
            f.seriousDamageTagIds = [...sSet];
            f.noSeriousDamageTagIds = [...nsSet];
            const existing = f.pendingTagNames ?? [];
            const have = new Set(existing.map((pp) => pp.name.toLowerCase()));
            for (const pp of r.pendingTags) {
              if (!have.has(pp.name.toLowerCase())) existing.push(pp);
            }
            f.pendingTagNames = existing;
            // Приоритет: AI-версия (она уже учла existingNote и переформулировала).
            // Если AI промолчал — оставляем оптимистичный черновик "previousNote + text".
            // Защита: если previousNote был, но AI вернул заметно более короткий
            // текст или потерял ключевые фрагменты прежней заметки — склеиваем
            // previousNote + r.note, чтобы не затереть данные пользователя.
            const aiNote = r.note?.trim() ?? "";
            let mergedNote = aiNote || draftCombined;
            if (aiNote && previousNote && aiNote !== previousNote) {
              const prevLow = previousNote.toLowerCase();
              const aiLow = aiNote.toLowerCase();
              const tokens = Array.from(
                new Set(prevLow.match(/[\p{L}\p{N}]{4,}/gu) ?? []),
              );
              const covered = tokens.length
                ? tokens.filter((t) => aiLow.includes(t)).length / tokens.length
                : 1;
              const tooShort = aiNote.length < previousNote.length * 0.6;
              const lostContent = tokens.length >= 3 && covered < 0.5;
              if ((tooShort || lostContent) && !aiLow.includes(prevLow)) {
                mergedNote = `${previousNote}\n${aiNote}`;
              }
            }
            f.note = mergedNote;
            if (sSet.size || nsSet.size || (f.pendingTagNames?.length ?? 0) > 0) {
              f.noDamage = false;
            }
            if (r.paintworkThicknessFrom != null) f.paintworkThicknessFrom = r.paintworkThicknessFrom;
            if (r.paintworkThicknessTo != null) f.paintworkThicknessTo = r.paintworkThicknessTo;
            appliedSerious = [...sSet];
            appliedNonSerious = [...nsSet];
            appliedPending = [...existing];
            appliedNote = f.note ?? "";
            appliedNoDamage = f.noDamage === true;
          });
          t.draft.inspectionStep.touched = true;

          // 2) Обновляем «рассуждение»: показываем итог компактно текстом.
          const arr = t.messages.inspection;
          const status = arr.find((m) => m.id === statusId);
          const verdict = appliedNoDamage
            ? "без замечаний"
            : appliedSerious.length
              ? "серьёзное повреждение"
              : appliedNonSerious.length
                ? "мелкое повреждение"
                : "не оценено";
          const summaryLines = [
            `✅ Готово`,
            `• Элемент: ${elementLabelForSummary}`,
            `• Состояние: ${verdict}`,
            appliedSerious.length || appliedPending.filter((p) => p.severity === "serious").length
              ? `• Серьёзные теги: ${
                  appliedSerious.length +
                  appliedPending.filter((p) => p.severity === "serious").length
                }`
              : "",
            appliedNonSerious.length || appliedPending.filter((p) => p.severity !== "serious").length
              ? `• Мелкие теги: ${
                  appliedNonSerious.length +
                  appliedPending.filter((p) => p.severity !== "serious").length
                }`
              : "",
            appliedNote ? `• Заметка: ${appliedNote}` : "",
          ].filter(Boolean);
          if (status) status.text = summaryLines.join("\n");

          // 3) Переносим карточку «Паспорт элемента» в конец ленты, чтобы
          // итог появился сразу после рассуждений ИИ.
          const focusIdx = arr.findIndex((m) => m.kind === "inspectionElementFocus");
          if (focusIdx >= 0) {
            const [focus] = arr.splice(focusIdx, 1);
            focus.createdAt = Date.now();
            arr.push(focus);
          } else if (photoFocusIdx !== null) {
            pushMsg(t, "inspection", {
              id: msgId(),
              role: "assistant",
              text: "",
              kind: "inspectionElementFocus",
              photoIdx: photoFocusIdx,
              createdAt: Date.now(),
            });
          }
        });

        setNoteProposal((prev) =>
          prev && prev.original === text
            ? {
                ...prev,
                ai: r.note,
                loading: false,
                picked: "ai",
                proposedSeriousIds: r.seriousTagIds,
                proposedNonSeriousIds: r.noSeriousTagIds,
                proposedPending: r.pendingTags,
                proposedElementId: resultElementId,
              }
            : prev,
        );
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        if (thread) {
          updateThread(thread.id, (t) => {
            const status = t.messages.inspection.find((m) => m.id === statusId);
            if (status) status.text = `⚠️ Не удалось проанализировать заметку: ${errMsg}`;
          });
        }
        setNoteProposal((prev) =>
          prev && prev.original === text ? { ...prev, ai: "", loading: false } : prev,
        );
      }
    });
  }, [composer, mutatePhotoFinding, thread, photoFocus, photoFocusIdx, runWithPhotoLock]);



  const pickNoteOriginal = useCallback(() => {
    setNoteProposal((p) => (p ? { ...p, picked: "original" } : p));
    mutatePhotoFinding((f) => {
      const p = noteProposal;
      if (p) f.note = p.original;
    });
  }, [mutatePhotoFinding, noteProposal]);

  const pickNoteAi = useCallback(() => {
    if (!noteProposal?.ai) return;
    const aiText = noteProposal.ai;
    setNoteProposal((p) => (p ? { ...p, picked: "ai" } : p));
    mutatePhotoFinding((f) => {
      f.note = aiText;
    });
  }, [mutatePhotoFinding, noteProposal]);

  const dismissNoteProposal = useCallback(() => setNoteProposal(null), []);

  // ─── Чат‑карточка «переформулировать заметку» ─────────────────────────
  // Один inflight на ref — чтобы не дублировать переформулировку.
  const noteReformInflight = useRef<Set<string>>(new Set());

  /** Записать text в нужное поле draft по NoteRef. */
  const writeNoteToDraft = useCallback(
    (threadIdLocal: string, ref: NoteRef, text: string) => {
      updateThread(threadIdLocal, (t) => {
        if (ref.kind === "inspection") {
          const key = findingKey(ref.section as SectionSnake, ref.elementId);
          const findings = { ...(t.draft.inspectionStep.findings ?? {}) };
          const f = findings[key];
          if (f) findings[key] = { ...f, note: text };
          t.draft.inspectionStep = { ...t.draft.inspectionStep, findings };
        } else if (ref.kind === "testDrive") {
          t.draft.testDriveStep = {
            ...t.draft.testDriveStep,
            testDriveNote: text,
            notes: text,
          };
        } else if (ref.kind === "docs") {
          t.draft.documentReconciliationStep = {
            ...t.draft.documentReconciliationStep,
            note: text,
          };
        } else if (ref.kind === "resultSummary") {
          t.draft.resultStep = { ...t.draft.resultStep, summaryInspectionNote: text };
        } else if (ref.kind === "resultVerdict") {
          t.draft.resultStep = { ...t.draft.resultStep, resultSpecialistNote: text };
        }
      });
    },
    [],
  );

  /** Обновить поле noteProposal у конкретного сообщения. */
  const patchNoteProposalMsg = useCallback(
    (
      threadIdLocal: string,
      step: StepId,
      messageId: string,
      patch: Partial<NonNullable<ChatMessage["noteProposal"]>>,
    ) => {
      updateThread(threadIdLocal, (t) => {
        const m = t.messages[step].find((x) => x.id === messageId);
        if (m?.noteProposal) m.noteProposal = { ...m.noteProposal, ...patch };
      });
    },
    [],
  );

  /** Пушит карточку‑proposal и запускает переформулировку. */
  const pushChatNoteProposal = useCallback(
    (threadIdLocal: string, np: NotePatched, opts?: { autoApply?: boolean }) => {
      const step = stepForNoteRef(np.ref);
      const stableId = `note-proposal:${noteRefKey(np.ref)}`;
      updateThread(threadIdLocal, (t) => {
        // не плодим карточки на тот же ref — заменяем
        t.messages[step] = t.messages[step].filter((m) => m.id !== stableId);
        pushMsg(t, step, {
          id: stableId,
          role: "assistant",
          text: "",
          step,
          kind: "noteProposal",
          noteProposal: {
            ref: np.ref,
            scopeLabel: np.scopeLabel,
            original: np.originalText,
            ai: null,
            loading: true,
            tagNames: np.tagNames,
          },
          createdAt: Date.now(),
        });
        // Показать паспорт шага, чтобы переформулировка отрисовалась inline
        // под исходной заметкой (для testDrive/docs/result). Для inspection
        // паспорт раздела не нужен — там inline в ElementFocusCard.
        if (np.ref.kind !== "inspection") {
          const passportId = `passport-${step}`;
          t.messages[step] = t.messages[step].filter((m) => m.id !== passportId);
          pushMsg(t, step, {
            id: passportId,
            role: "assistant",
            text: "",
            step,
            kind: "stepPassport",
            createdAt: Date.now(),
          });
        }
      });
      const key = noteRefKey(np.ref);
      if (noteReformInflight.current.has(key)) return;
      noteReformInflight.current.add(key);
      void (async () => {
        try {
          const t = getThread(threadIdLocal);
          if (!t) return;
          const stepLabel = stepById(step).label;
          const aiText = await reformulateNote(
            t,
            np.ref,
            stepLabel,
            np.scopeLabel,
            np.tagNames,
            np.originalText,
          );
          if (opts?.autoApply && aiText) {
            writeNoteToDraft(threadIdLocal, np.ref, aiText);
            patchNoteProposalMsg(threadIdLocal, step, stableId, {
              ai: aiText,
              loading: false,
              picked: "ai",
            });
          } else {
            patchNoteProposalMsg(threadIdLocal, step, stableId, {
              ai: aiText,
              loading: false,
            });
          }
        } finally {
          noteReformInflight.current.delete(key);
        }
      })();
    },
    [patchNoteProposalMsg, writeNoteToDraft],
  );

  const generateInspectionNote = useCallback(
    (args: {
      section: SectionSnake;
      elementId: string;
      scopeLabel: string;
      originalText: string;
      tagNames: string[];
    }) => {
      if (!thread) return;
      const tagNames = args.tagNames
        .map((name) => name.trim())
        .filter((name, idx, arr) => name && arr.indexOf(name) === idx);
      if (!tagNames.length) return;
      pushChatNoteProposal(
        thread.id,
        {
          ref: { kind: "inspection", section: args.section, elementId: args.elementId },
          scopeLabel: args.scopeLabel,
          originalText:
            args.originalText.trim() ||
            `Замечания: ${tagNames.join(", ")}.`,
          tagNames,
        },
        { autoApply: true },
      );
    },
    [thread, pushChatNoteProposal],
  );

  const acceptChatNoteOriginal = useCallback(
    (ref: NoteRef, originalText?: string) => {
      if (!thread) return;
      const step = stepForNoteRef(ref);
      const stableId = `note-proposal:${noteRefKey(ref)}`;
      if (originalText) writeNoteToDraft(thread.id, ref, originalText);
      patchNoteProposalMsg(thread.id, step, stableId, { picked: "original" });
    },
    [thread, writeNoteToDraft, patchNoteProposalMsg],
  );

  const acceptChatNoteAi = useCallback(
    (ref: NoteRef, aiText: string) => {
      if (!thread || !aiText) return;
      const step = stepForNoteRef(ref);
      const stableId = `note-proposal:${noteRefKey(ref)}`;
      writeNoteToDraft(thread.id, ref, aiText);
      patchNoteProposalMsg(thread.id, step, stableId, { picked: "ai" });
    },
    [thread, writeNoteToDraft, patchNoteProposalMsg],
  );

  /** Прочитать текущий текст заметки из draft по NoteRef. */
  const readNoteFromDraft = useCallback((threadIdLocal: string, ref: NoteRef): string => {
    const t = getThread(threadIdLocal);
    if (!t) return "";
    const d = t.draft;
    if (ref.kind === "inspection") {
      const key = findingKey(ref.section as SectionSnake, ref.elementId);
      return d.inspectionStep.findings?.[key]?.note ?? "";
    }
    if (ref.kind === "testDrive") return d.testDriveStep?.testDriveNote ?? d.testDriveStep?.notes ?? "";
    if (ref.kind === "docs") return d.documentReconciliationStep?.note ?? "";
    if (ref.kind === "resultSummary") return d.resultStep?.summaryInspectionNote ?? "";
    if (ref.kind === "resultVerdict") return d.resultStep?.resultSpecialistNote ?? "";
    return "";
  }, []);

  /** Регенерация AI-версии заметки: всегда на основе текущего текста + тегов. */
  const regenerateChatNoteAi = useCallback(
    (ref: NoteRef) => {
      if (!thread) return;
      const step = stepForNoteRef(ref);
      const stableId = `note-proposal:${noteRefKey(ref)}`;
      const fresh = getThread(thread.id);
      const msg = fresh?.messages[step].find((m) => m.id === stableId);
      const np = msg?.noteProposal;
      if (!np) return;
      const baseText = readNoteFromDraft(thread.id, ref) || np.original;
      const tagNames = np.tagNames ?? [];
      // показываем загрузку, снимаем флаг применённой версии
      patchNoteProposalMsg(thread.id, step, stableId, { loading: true, picked: undefined });
      void (async () => {
        try {
          const t = getThread(thread.id);
          if (!t) return;
          const stepLabel = stepById(step).label;
          const aiText = await reformulateNote(
            t,
            ref,
            stepLabel,
            np.scopeLabel,
            tagNames,
            baseText,
          );
          if (aiText) {
            writeNoteToDraft(thread.id, ref, aiText);
            patchNoteProposalMsg(thread.id, step, stableId, {
              ai: aiText,
              loading: false,
              picked: "ai",
            });
          } else {
            patchNoteProposalMsg(thread.id, step, stableId, { loading: false });
          }
        } catch {
          patchNoteProposalMsg(thread.id, step, stableId, { loading: false });
        }
      })();
    },
    [thread, readNoteFromDraft, patchNoteProposalMsg, writeNoteToDraft],
  );


  const dismissChatNoteProposal = useCallback(
    (ref: NoteRef) => {
      if (!thread) return;
      const step = stepForNoteRef(ref);
      const stableId = `note-proposal:${noteRefKey(ref)}`;
      updateThread(thread.id, (t) => {
        t.messages[step] = t.messages[step].filter((m) => m.id !== stableId);
      });
    },
    [thread],
  );

  /** Активные предложения переформулировать заметку в текущем шаге. */
  const stepNoteProposals = useMemo(() => {
    const out: Array<{
      payload: NonNullable<ChatMessage["noteProposal"]>;
      onPickOriginal: () => void;
      onPickAi: () => void;
      onDismiss: () => void;
    }> = [];
    for (const m of currentStepMessages) {
      if (m.kind !== "noteProposal" || !m.noteProposal) continue;
      const p = m.noteProposal;
      out.push({
        payload: p,
        onPickOriginal: () => {
          if (p.ref.kind === "inspection") {
            writeNoteToDraft(thread!.id, p.ref, "");
            dismissChatNoteProposal(p.ref);
          } else {
            acceptChatNoteOriginal(p.ref, p.original);
          }
        },
        onPickAi: () => regenerateChatNoteAi(p.ref),
        onDismiss: () => dismissChatNoteProposal(p.ref),
      });
    }
    return out;
  }, [currentStepMessages, acceptChatNoteOriginal, regenerateChatNoteAi, dismissChatNoteProposal, writeNoteToDraft, thread]);

  /** Скрываем отдельный пузырь noteProposal для testDrive/result, если в шаге
   *  есть stepPassport — там это уже отрисовано inline под исходной заметкой. */
  const hasStepPassport = useMemo(
    () => currentStepMessages.some((m) => m.kind === "stepPassport"),
    [currentStepMessages],
  );




  /** Распознать тег / описание по заметке через ИИ. */
  const runPhotoAi = useCallback(async () => {
    if (photoFocusIdx === null || !thread || !photoFocus?.url || photoAiBusy) return;
    const lockKey = `${thread.id}:${photoFocusIdx}`;
    await runWithPhotoLock(lockKey, async () => {
      try {
        const fresh = getThread(thread.id);
        if (!fresh) return;
        const hint = composer.trim();
        const usableUrl = await ensurePhotoAccessible({
          url: photoFocus.url!,
          dataUrl: photoFocus.dataUrl,
          filename: photoFocus.filename,
          photoId: photoFocus.photoId,
        });
        if (usableUrl && usableUrl !== photoFocus.url) {
          updateThread(thread.id, (t) => {
            const pp = t.draft.inspectionStep.photos[photoFocusIdx];
            if (pp) pp.url = usableUrl;
          });
        }
        const r = await analyzeInspectionPhoto(
          fresh,
          photoFocus.section as SectionSnake,
          usableUrl ?? photoFocus.url!,
          hint || undefined,
        );
        updateThread(thread.id, (t) => {
          t.aiChatIds = fresh.aiChatIds;
          const p = t.draft.inspectionStep.photos[photoFocusIdx];
          if (!p) return;
          if (!p.elementId && r.elementId) p.elementId = r.elementId;
          const sec = p.section as SectionSnake;
          const elId = p.elementId ?? r.elementId;
          upsertFinding(t.draft.inspectionStep, sec, elId, (f) => {
            const sSet = new Set([...(f.seriousDamageTagIds ?? []), ...r.seriousTagIds]);
            const nsSet = new Set([...(f.noSeriousDamageTagIds ?? []), ...r.noSeriousTagIds]);
            f.seriousDamageTagIds = [...sSet];
            f.noSeriousDamageTagIds = [...nsSet];
            const existing = f.pendingTagNames ?? [];
            const have = new Set(existing.map((p) => p.name.toLowerCase()));
            for (const p of r.pendingTags) {
              if (!have.has(p.name.toLowerCase())) existing.push(p);
            }
            f.pendingTagNames = existing;
            if (!f.note && r.note) f.note = r.note;
            if (sSet.size || nsSet.size || (f.pendingTagNames?.length ?? 0) > 0) {
              f.noDamage = false;
            }
            if (r.paintworkThicknessFrom != null) f.paintworkThicknessFrom = r.paintworkThicknessFrom;
            if (r.paintworkThicknessTo != null) f.paintworkThicknessTo = r.paintworkThicknessTo;
          });
          t.draft.inspectionStep.touched = true;
        });
      } catch (e) {
        const m = e instanceof Error ? e.message : "Ошибка ИИ";
        updateThread(thread.id, (t) => {
          pushMsg(t, "inspection", {
            id: msgId(),
            role: "assistant",
            text: `⚠️ ${m}`,
            createdAt: Date.now(),
          });
        });
      }
    });
  }, [photoFocusIdx, thread, photoFocus, photoAiBusy, composer, runWithPhotoLock]);




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
    // Gate: проверяем обязательные поля каждого шага. Если что-то
    // не заполнено — резюме не запускаем, показываем сообщение с
    // кнопками перехода в нужный шаг (и сразу в нужный раздел осмотра).
    const fresh0 = getThread(thread.id) ?? thread;
    const missing = collectMissingForSummary(fresh0.draft);
    if (missing.length > 0) {
      updateThread(thread.id, (t) => {
        pushMsg(t, "result", {
          id: msgId(),
          role: "assistant",
          text:
            "Резюме нельзя собрать — не заполнены обязательные поля. " +
            "Перейдите по кнопкам и допишите недостающее, затем нажмите «AI-резюме» снова.",
          step: "result",
          kind: "missingFields",
          missingFields: missing,
          createdAt: Date.now(),
        });
      });
      return;
    }
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
        if (!isLastMessagePassport(t)) {
          pushMsg(t, "result", makeStepPassportMessage("result"));
        }

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


  // «Завершить» на шаге Итог — сперва показываем подтверждение, что после
  // выгрузки отчёт уже нельзя будет редактировать. Кнопка «Продолжить»
  // внутри сообщения запускает doFinish().
  const doFinishConfirm = useCallback(() => {
    if (!thread || busy) return;
    // Сначала проверяем обязательные поля — нет смысла спрашивать
    // подтверждение, если выгрузка всё равно не пройдёт.
    const fresh0 = getThread(thread.id) ?? thread;
    const missing = collectMissingForSummary(fresh0.draft);
    if (missing.length > 0) {
      updateThread(thread.id, (t) => {
        t.messages.result = t.messages.result.filter(
          (m) => m.kind !== "finishConfirm",
        );
        pushMsg(t, "result", {
          id: msgId(),
          role: "assistant",
          text:
            "Не получится выгрузить отчёт — остались незаполненные обязательные поля. " +
            "Перейдите по кнопкам ниже и допишите недостающее, затем снова нажмите «Завершить».",
          step: "result",
          kind: "missingFields",
          missingFields: missing,
          createdAt: Date.now(),
        });
      });
      return;
    }
    updateThread(thread.id, (t) => {
      // не плодим дубликаты подтверждения
      t.messages.result = t.messages.result.filter(
        (m) => m.kind !== "finishConfirm",
      );
      pushMsg(t, "result", {
        id: msgId(),
        role: "assistant",
        text: "После выгрузки отчёт нельзя будет отредактировать. Продолжить?",
        step: "result",
        kind: "finishConfirm",
        createdAt: Date.now(),
      });
    });
  }, [thread, busy]);

  // Пошаговая выгрузка отчёта:
  //  1) Storage.PrepareSpecialistReport (submitReport) — создаёт черновик
  //     и возвращает список файлов для загрузки.
  //  2) загрузка файлов — отображаем прогресс-бар по числу файлов.
  //  3) Storage.CompleteSpecialistReport — фиксируем отчёт.
  //  4) сообщение «Отчёт успешно выгружен» с кнопкой «Поделиться».
  const doFinish = useCallback(async () => {
    if (!thread || busy) return;

    // Гейт обязательных полей — не дёргаем Storage.PrepareSpecialistReport,
    // если пользователь ещё не заполнил всё необходимое: иначе бэкенд
    // вернёт техническую ошибку «This value should not be blank.», которая
    // пользователю ни о чём не говорит. Показываем то же сообщение, что и
    // для AI-резюме, с кнопками перехода в нужный шаг/раздел.
    const fresh0 = getThread(thread.id) ?? thread;
    const missing = collectMissingForSummary(fresh0.draft);
    if (missing.length > 0) {
      updateThread(thread.id, (t) => {
        t.messages.result = t.messages.result.filter(
          (m) => m.kind !== "finishConfirm",
        );
        pushMsg(t, "result", {
          id: msgId(),
          role: "assistant",
          text:
            "Не получится выгрузить отчёт — остались незаполненные обязательные поля. " +
            "Перейдите по кнопкам ниже и допишите недостающее, затем снова нажмите «Завершить».",
          step: "result",
          kind: "missingFields",
          missingFields: missing,
          createdAt: Date.now(),
        });
      });
      return;
    }

    setBusy(true);
    const progressId = `finish-progress-${Date.now()}`;
    try {
      // скрываем карточку подтверждения, чтобы пользователь не нажал ещё раз,
      // и сразу показываем единый прогресс-бар (без текстовых «Шаг 1/Шаг 2»).
      updateThread(thread.id, (t) => {
        t.messages.result = t.messages.result.filter(
          (m) => m.kind !== "finishConfirm",
        );
        pushMsg(t, "result", {
          id: progressId,
          role: "assistant",
          text: "",
          step: "result",
          kind: "uploadProgress",
          uploadProgress: { phase: "preparing", percent: 0, uploaded: 0, total: 1, note: "Подготовка отчёта…" },
          createdAt: Date.now(),
        });
      });

      const fresh = getThread(thread.id) ?? thread;
      const r = await submitReport(fresh.draft);
      if (!r.remote) {
        // На случай, если бэкенд всё-таки вернул ошибку про незаполненные
        // поля (например, серверные требования изменились) — показываем
        // дружелюбное сообщение вместо технического текста ошибки.
        const raw = r.note ?? "Не удалось подготовить отчёт.";
        const looksLikeBlank = /should not be blank|обязательн|необходимо|required|теги|tags?/i.test(raw);
        updateThread(thread.id, (t) => {
          // убираем прогресс — будем показывать карточку с переходами
          t.messages.result = t.messages.result.filter((m) => m.id !== progressId);
          if (looksLikeBlank) {
            const miss = collectMissingForSummary(t.draft);
            if (miss.length === 0) {
              const low = raw.toLowerCase();
              const guesses: Array<{ re: RegExp; item: { label: string; step: StepId; sectionSnake?: string } }> = [
                { re: /трансмисси|кпп|коробк/, item: { label: "Тест-драйв: укажите теги для «трансмиссия»", step: "testDrive" } },
                { re: /двигател|engine/, item: { label: "Тест-драйв: укажите теги для «двигатель»", step: "testDrive" } },
                { re: /руль|steering/, item: { label: "Тест-драйв: укажите теги для «руль»", step: "testDrive" } },
                { re: /подвеск|suspension/, item: { label: "Тест-драйв: укажите теги для «подвеска»", step: "testDrive" } },
                { re: /тормоз|brake/, item: { label: "Тест-драйв: укажите теги для «тормоза»", step: "testDrive" } },
                { re: /vin|пробег|госномер|город|дата осмотра|марк|модел/, item: { label: "Автомобиль: заполните обязательные поля", step: "car" } },
                { re: /документ|птс|стс|собственник/, item: { label: "Документы: заполните обязательные поля", step: "docs" } },
                { re: /кузов/, item: { label: "Осмотр: раздел «Кузов»", step: "inspection", sectionSnake: "body" } },
                { re: /салон/, item: { label: "Осмотр: раздел «Салон»", step: "inspection", sectionSnake: "interior" } },
                { re: /подкапот/, item: { label: "Осмотр: раздел «Подкапотное»", step: "inspection", sectionSnake: "under_hood" } },
                { re: /остекл|стекл/, item: { label: "Осмотр: раздел «Остекление»", step: "inspection", sectionSnake: "glass" } },
                { re: /резюме|вердикт|итог/, item: { label: "Итог: заполните резюме и вердикт", step: "result" } },
              ];
              for (const g of guesses) {
                if (g.re.test(low)) miss.push(g.item);
              }
              if (miss.length === 0) {
                miss.push({ label: "Проверьте обязательные поля во всех шагах", step: "testDrive" });
              }
            }
            pushMsg(t, "result", {
              id: msgId(),
              role: "assistant",
              text:
                "Не получится выгрузить отчёт — остались незаполненные обязательные поля. " +
                "Перейдите по кнопкам ниже и допишите недостающее, затем снова нажмите «Завершить».",
              step: "result",
              kind: "missingFields",
              missingFields: miss,
              createdAt: Date.now(),
            });
          } else {
            pushMsg(t, "result", {
              id: msgId(),
              role: "assistant",
              text: `⚠️ ${raw}`,
              createdAt: Date.now(),
            });
          }
        });
        return;
      }

      // Шаг 2 — реальная выгрузка файлов через ObjectStorage multipart.
      //   Prepare возвращает uploadFiles[] с финальными ключами; исходники
      //   лежат во временном бакете (legalReviewStep.otherMaterials[].key).
      const uploadFiles = (r as { uploadFiles?: Array<{ filename: string; key: string; type: string; stepType: string }> }).uploadFiles ?? [];
      const total = Math.max(1, uploadFiles.length);
      updateThread(thread.id, (t) => {
        const m = t.messages.result.find((x) => x.id === progressId);
        if (m?.uploadProgress) {
          m.uploadProgress.phase = "uploading";
          m.uploadProgress.percent = 0;
          m.uploadProgress.uploaded = 0;
          m.uploadProgress.total = total;
          m.uploadProgress.note = undefined;
        }
      });

      const reportNumber = String(r.reportId ?? "");
      const tempByName = new Map<string, { key?: string; type?: string }>();
      for (const lm of (getThread(thread.id) ?? thread).draft.legalReviewStep?.otherMaterials ?? []) {
        if (lm.filename) tempByName.set(lm.filename, { key: lm.key, type: lm.type });
      }

      const { uploadReportFileMultipart } = await import("@/lib/carreports/storageApi");
      const uploadErrors: string[] = [];
      for (let i = 0; i < uploadFiles.length; i++) {
        const f = uploadFiles[i];
        const src = tempByName.get(f.filename);
        const up = await uploadReportFileMultipart({
          reportNumber,
          filename: f.filename,
          sourceKey: src?.key,
          contentType: f.type === "document" ? "application/pdf" : undefined,
        });
        if (!up.ok) uploadErrors.push(`${f.filename}: ${up.note}`);
        const done = i + 1;
        const percent = Math.round((done / total) * 100);
        updateThread(thread.id, (t) => {
          const m = t.messages.result.find((x) => x.id === progressId);
          if (m?.uploadProgress) {
            m.uploadProgress.percent = percent;
            m.uploadProgress.uploaded = done;
          }
        });
      }

      if (uploadErrors.length > 0) {
        updateThread(thread.id, (t) => {
          t.messages.result = t.messages.result.filter((m) => m.id !== progressId);
          pushMsg(t, "result", {
            id: msgId(),
            role: "assistant",
            text:
              "Не удалось выгрузить часть файлов: \n" +
              uploadErrors.map((e) => `• ${e}`).join("\n") +
              "\n\nПроверьте интернет-соединение и попробуйте ещё раз.",
            createdAt: Date.now(),
          });
        });
        return;
      }


      // Шаг 3 — финализация отчёта.
      updateThread(thread.id, (t) => {
        const m = t.messages.result.find((x) => x.id === progressId);
        if (m?.uploadProgress) {
          m.uploadProgress.phase = "finalizing";
          m.uploadProgress.percent = 100;
          m.uploadProgress.uploaded = total;
          m.uploadProgress.note = "Финализация отчёта…";
        }
      });

      const finalizeId = r.reportNumericId ?? r.reportId;
      let completeNote = "";
      if (finalizeId != null) {
        const { completeReport } = await import("@/lib/carreports/storageApi");
        const c = await completeReport(finalizeId);
        if (!c.remote) {
          completeNote = c.note ?? "Не удалось завершить отчёт на сервере.";
        }
      }

      // Шаг 4 — заменяем прогресс на карточку с кнопкой «Поделиться».
      updateThread(thread.id, (t) => {
        t.messages.result = t.messages.result.filter((m) => m.id !== progressId);
        pushMsg(t, "result", {
          id: msgId(),
          role: "assistant",
          text: completeNote
            ? `⚠️ Файлы выгружены, но финализация не удалась: ${completeNote}`
            : "",
          step: "result",
          kind: "finishComplete",
          finishComplete: {
            reportId: r.reportId,
            shareUrl: r.reportId
              ? `https://app.carreports.ru/r/${r.reportId}`
              : undefined,
          },
          createdAt: Date.now(),
        });
      });

    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка выгрузки";
      updateThread(thread.id, (t) => {
        const m = t.messages.result.find((x) => x.id === progressId);
        if (m?.uploadProgress) {
          m.uploadProgress.phase = "error";
          m.uploadProgress.note = msg;
        } else {
          pushMsg(t, "result", {
            id: `m_${Date.now()}`,
            role: "assistant",
            text: `⚠️ ${msg}`,
            createdAt: Date.now(),
          });
        }
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
      if (isStepFilled(nextStep, t.draft)) {
        // Шаг уже заполнен — показываем паспорт, но не дублируем подряд.
        if (!isLastMessagePassport(t)) {
          pushMsg(t, nextStep, makeStepPassportMessage(nextStep));
        }
      } else {
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
          photoId: prepared.photoId,
          dataUrl: prepared.dataUrl,
          blob: prepared.blob,
          filename: prepared.filename,
          originalBlob: file,
          originalFilename: file.name || prepared.filename,
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
        legalMaterials: "Опиши, что видно на материале (документ, скан, отчёт сканера) — кратко, по фактам.",
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
    if (!thread) return;
    const threadIdLocal = thread.id;
    const typed = composer.trim();
    const atts = pendingAttachments;

    // Gather selected chip values from the last interactive options message.
    let selectedFromChips: string[] = [];
    if (lastOptionsMsgId) {
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

    const stepForTask = currentStep;
    const askModeLocal = askMode;
    const userAttachments = atts.map((a) => ({
      url: a.dataUrl,
      label: a.filename,
    }));
    // 1) push user message (with thumbnails if any) — синхронно
    const baseText = combined || (atts.length ? `📎 Прикреплено фото: ${atts.length}` : "");
    const displayText = askModeLocal ? `❓ ${baseText}` : baseText;
    const statusId = msgId();
    updateThread(threadIdLocal, (t) => {
      pushMsg(t, stepForTask, {
        id: msgId(),
        role: "user",
        text: displayText,
        step: stepForTask,
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
      // Плейсхолдер статуса очереди — пользователь сразу видит, что задача принята.
      pushMsg(t, stepForTask, {
        id: statusId,
        role: "assistant",
        text: "⏳ В очереди…",
        step: stepForTask,
        queueStatus: "queued",
        createdAt: Date.now(),
      });
    });
    // Сразу освобождаем композер и вложения — пользователь может писать дальше.
    setComposer("");
    setPendingAttachments([]);
    if (askModeLocal) setAskMode(false);

    // Утилиты обновления плейсхолдера статуса.
    const setStatus = (patch: Partial<ChatMessage>) => {
      updateThread(threadIdLocal, (t) => {
        for (const key of Object.keys(t.messages) as StepId[]) {
          const m = t.messages[key].find((x) => x.id === statusId);
          if (m) { Object.assign(m, patch); return; }
        }
      });
    };
    const removeStatus = () => {
      updateThread(threadIdLocal, (t) => {
        for (const key of Object.keys(t.messages) as StepId[]) {
          const i = t.messages[key].findIndex((x) => x.id === statusId);
          if (i >= 0) { t.messages[key].splice(i, 1); return; }
        }
      });
    };

    // ─── Спец-кейс: шаг «осмотр» с фото ────────────────────────────────────
    // Каждое фото — отдельная задача в очереди ИИ (а не один общий task
    // c внутренним for-циклом). Пользователь видит реальный размер очереди:
    // «11 в очереди + 1 в работе» для 12 фоток.
    if (stepForTask === "inspection" && atts.length) {
      // Убираем общий placeholder — вместо него поставим один групповой статус
      // на весь пакет (а не по одной строке на каждое фото).
      removeStatus();

      const { classifyInspectionPhotoSection } = await import(
        "@/lib/carreports/orchestrator"
      );

      const classifiedSections = new Set<SectionSnake>();
      const total = atts.length;
      let done = 0;
      // Очередь имён ещё не начатых файлов и имя текущего «в работе» —
      // нужны для единственной батч-строки статуса.
      const queuedNames: string[] = atts.map((a) => a.filename);
      let running: string | null = null;

      const batchStatusId = msgId();
      const renderBatchStatus = () => {
        // «В очереди» — только ещё не начатые файлы; текущий «в работе»
        // показываем отдельной строкой и не учитываем в счётчике очереди.
        const parts: string[] = [];
        if (running) parts.push(`🔄 Обработка: ${running}`);
        if (queuedNames.length > 0) {
          parts.push(`⏳ В очереди: ${queuedNames.length}`);
        }
        return parts.join("\n") || "🔄 Обработка…";
      };

      const updateBatchStatus = () => {
        updateThread(threadIdLocal, (t) => {
          for (const key of Object.keys(t.messages) as StepId[]) {
            const m = t.messages[key].find((x) => x.id === batchStatusId);
            if (m) {
              m.text = renderBatchStatus();
              m.queueStatus = running ? "running" : "queued";
              return;
            }
          }
        });
      };
      const removeBatchStatus = () => {
        updateThread(threadIdLocal, (t) => {
          for (const key of Object.keys(t.messages) as StepId[]) {
            const i = t.messages[key].findIndex((x) => x.id === batchStatusId);
            if (i >= 0) {
              t.messages[key].splice(i, 1);
              return;
            }
          }
        });
      };

      updateThread(threadIdLocal, (t) => {
        pushMsg(t, "inspection", {
          id: batchStatusId,
          role: "assistant",
          text: renderBatchStatus(),
          step: "inspection",
          queueStatus: "queued",
          createdAt: Date.now(),
        });
      });

      for (const a of atts) {
        void enqueueAI(threadIdLocal, async () => {
          // Перекладываем файл из «в очереди» в «в работе».
          const idxInQueue = queuedNames.indexOf(a.filename);
          if (idxInQueue >= 0) queuedNames.splice(idxInQueue, 1);
          running = a.filename;
          updateBatchStatus();
          try {
            // 1) Грузим сжатый JPEG для AI-классификации (preparePhoto уже
            //    конвертировал HEIC/HEIF → JPEG). AI получает именно сжатую
            //    копию — это быстрее и распознаётся надёжнее.
            const up = await uploadTemporary({
              filename: a.filename,
              blob: a.blob,
              dataUrl: a.dataUrl,
            });
            // 2) Параллельно грузим оригинал (без сжатия), чтобы в коллаж/
            //    раздел попал именно он. HEIC/HEIF браузер не отрисует —
            //    в этом случае оставляем сжатую JPEG-копию как «оригинал».
            const origType = (a.originalBlob.type || "").toLowerCase();
            const origName = (a.originalFilename || a.filename).toLowerCase();
            const isHeic =
              origType.includes("heic") ||
              origType.includes("heif") ||
              /\.(heic|heif)$/i.test(origName);
            let displayUrl = up.url;
            let displayFilename = up.filename;
            if (!isHeic) {
              try {
                const upOrig = await uploadTemporary(
                  {
                    filename: a.originalFilename || a.filename,
                    blob: a.originalBlob,
                    dataUrl: a.dataUrl,
                  },
                  { contentType: origType || "image/jpeg" },
                );
                displayUrl = upOrig.url;
                displayFilename = upOrig.filename;
              } catch {
                // Не критично: если оригинал не загрузился — оставим сжатый.
              }
            }
            const fresh = getThread(threadIdLocal);
            const classified = fresh
              ? await classifyInspectionPhotoSection(fresh, up.url)
              : null;
            if (fresh) {
              updateThread(threadIdLocal, (t) => {
                t.aiChatIds = fresh.aiChatIds;
              });
            }
            if (classified) {
              const { section, elementId } = classified;
              const sec = INSPECTION_SECTIONS.find((s) => s.snake === section);
              const sectionLabel = sec?.label ?? section;
              const elementLabel =
                sec?.elements.find((e) => e.id === elementId)?.label ?? elementId;
              updateThread(threadIdLocal, (t) => {
                t.draft.inspectionStep.photos.push({
                  section,
                  elementId,
                  filename: displayFilename,
                  photoId: a.photoId,
                  dataUrl: a.dataUrl,
                  url: displayUrl,
                  remote: true,
                  addedAt: Date.now(),
                });
                t.draft.inspectionStep.touched = true;
                pushMsg(t, "inspection", {
                  id: msgId(),
                  role: "assistant",
                  text: `📌 «${sectionLabel}» → «${elementLabel}»`,
                  step: "inspection",
                  attachments: [{ url: displayUrl, label: a.filename }],
                  createdAt: Date.now(),
                });
              });
              classifiedSections.add(section);
            } else {
              updateThread(threadIdLocal, (t) => {
                pushMsg(t, "inspection", {
                  id: msgId(),
                  role: "assistant",
                  text: "",
                  step: "inspection",
                  kind: "inspectionAttachAssign",
                  pendingPhoto: {
                    url: displayUrl,
                    dataUrl: a.dataUrl,
                    filename: displayFilename,
                    photoId: a.photoId,
                    remote: true,
                  },
                  createdAt: Date.now(),
                });
              });
            }

          } catch (e) {
            const message = e instanceof Error ? e.message : "ошибка";
            updateThread(threadIdLocal, (t) => {
              pushMsg(t, "inspection", {
                id: msgId(),
                role: "assistant",
                text: `⚠️ Не удалось обработать ${a.filename}: ${message}`,
                createdAt: Date.now(),
              });
            });
          } finally {
            running = null;
            done += 1;
            if (done === total) {
              removeBatchStatus();
              if (classifiedSections.size > 0) {
                for (const section of classifiedSections) {
                  ensureSectionMessages(section);
                }
              }
            } else {
              updateBatchStatus();
            }
          }
        });
      }




      // Если кроме фото пришёл и текст — отдельная задача для extractForStep.
      if (combined) {
        const textStatusId = msgId();
        updateThread(threadIdLocal, (t) => {
          pushMsg(t, "inspection", {
            id: textStatusId,
            role: "assistant",
            text: "⏳ В очереди…",
            step: "inspection",
            queueStatus: "queued",
            createdAt: Date.now(),
          });
        });
        const setTextStatus = (text: string, queueStatus: "queued" | "running") => {
          updateThread(threadIdLocal, (t) => {
            for (const key of Object.keys(t.messages) as StepId[]) {
              const m = t.messages[key].find((x) => x.id === textStatusId);
              if (m) { m.text = text; m.queueStatus = queueStatus; return; }
            }
          });
        };
        const removeTextStatus = () => {
          updateThread(threadIdLocal, (t) => {
            for (const key of Object.keys(t.messages) as StepId[]) {
              const i = t.messages[key].findIndex((x) => x.id === textStatusId);
              if (i >= 0) { t.messages[key].splice(i, 1); return; }
            }
          });
        };
        void enqueueAI(threadIdLocal, async () => {
          setTextStatus("🔄 Обрабатывается…", "running");
          try {
            const fresh = getThread(threadIdLocal);
            if (!fresh) return;
            const onClarify = (entry: { kind: "ai" | "web"; label: string; detail?: string }) => {
              const icon = entry.kind === "web" ? "🌐" : "🧠";
              updateThread(threadIdLocal, (t) => {
                pushMsg(t, "inspection", {
                  id: msgId(),
                  role: "assistant",
                  text: `${icon} ${entry.label}${entry.detail ? `\n${entry.detail}` : ""}`,
                  step: "inspection",
                  createdAt: Date.now(),
                });
              });
            };
            const { patch, reply, attachments, chips, notePatched } = await extractForStep(
              "inspection",
              combined,
              fresh,
              { onClarify },
            );
            updateThread(threadIdLocal, (t) => {
              Object.assign(t.draft, patch);
              if (reply) {
                pushMsg(t, "inspection", {
                  id: msgId(),
                  role: "assistant",
                  text: reply,
                  step: "inspection",
                  ...(attachments && attachments.length ? { attachments } : {}),
                  ...(chips && chips.length
                    ? { chips, optionsStep: "inspection", selectedChipValues: [] }
                    : {}),
                  createdAt: Date.now(),
                });
              }
            });
            if (notePatched) pushChatNoteProposal(threadIdLocal, notePatched);
          } catch (e) {
            const message = e instanceof Error ? e.message : "Ошибка ИИ";
            updateThread(threadIdLocal, (t) => {
              pushMsg(t, "inspection", {
                id: msgId(),
                role: "assistant",
                text: `⚠️ ${message}`,
                createdAt: Date.now(),
              });
            });
          } finally {
            removeTextStatus();
          }
        });
      }
      return;
    }


    void enqueueAI(threadIdLocal, async () => {
      setStatus({ text: "🔄 Обрабатывается…", queueStatus: "running" });

      try {
        // 1b) If photos attached — recognize them via vision and append to text.
        let textForAI = combined;
        if (atts.length) {
          // Шаг «осмотр» с фото обрабатывается отдельной веткой выше
          // (per-photo enqueue + батч-статус). Сюда долетают только
          // не-inspection шаги — на них прогоняем общий vision-распознаватель.
          const recognized = await analyzeAttachments(atts, stepForTask, combined);
          if (recognized) {
            updateThread(threadIdLocal, (t) => {
              pushMsg(t, stepForTask, {
                id: msgId(),
                role: "assistant",
                text: `📄 Распознано с фото:\n${recognized}`,
                step: stepForTask,
                createdAt: Date.now(),
              });
            });
            textForAI = combined ? `${combined}\n\n[Данные с фото]\n${recognized}` : recognized;
          }
        }


        // Q&A mode: free-form question, no draft mutation.
        if (askModeLocal) {
          const fresh = getThread(threadIdLocal);
          if (!fresh) return;
          const stepLabel = FLOW_STEPS.find((s) => s.id === stepForTask)?.label ?? stepForTask;
          const answer = await askQuestion(stepForTask, textForAI || combined, fresh, stepLabel);
          updateThread(threadIdLocal, (t) => {
            pushMsg(t, stepForTask, {
              id: msgId(),
              role: "assistant",
              text: answer,
              step: stepForTask,
              createdAt: Date.now(),
            });
          });
          return;
        }

        const fresh = getThread(threadIdLocal);
        if (!fresh) return;
        const prevVin = fresh.draft.carStep.vin;
        const onClarify = (entry: { kind: "ai" | "web"; label: string; detail?: string }) => {
          const icon = entry.kind === "web" ? "🌐" : "🧠";
          updateThread(threadIdLocal, (t) => {
            pushMsg(t, stepForTask, {
              id: msgId(),
              role: "assistant",
              text: `${icon} ${entry.label}${entry.detail ? `\n${entry.detail}` : ""}`,
              step: stepForTask,
              createdAt: Date.now(),
            });
          });
        };
        const { patch, reply, attachments, chips, notePatched } = await extractForStep(stepForTask, textForAI || combined, fresh, { onClarify });
        updateThread(threadIdLocal, (t) => {
          Object.assign(t.draft, patch);
          if (reply) {
            if (stepForTask === "testDrive") {
              // Вместо текстового резюме показываем паспорт тест-драйва,
              // как в шаге «Итог». Чипы прокидываем отдельным сообщением.
              if (!isLastMessagePassport(t)) {
                pushMsg(t, "testDrive", makeStepPassportMessage("testDrive"));
              }
              if (chips && chips.length) {
                pushMsg(t, "testDrive", {
                  id: msgId(),
                  role: "assistant",
                  text: "",
                  step: "testDrive",
                  chips,
                  optionsStep: "testDrive",
                  selectedChipValues: [],
                  createdAt: Date.now(),
                });
              }
            } else if (stepForTask === "docs") {
              // По аналогии с тест-драйвом: вместо «Зафиксировал сверку…»
              // отдаём паспорт документов.
              const passportId = `passport-docs-${Date.now()}`;
              t.messages.docs = t.messages.docs.filter((m) => m.kind !== "docsPassport");
              pushMsg(t, "docs", {
                id: passportId,
                role: "assistant",
                text: "",
                step: "docs",
                kind: "docsPassport",
                createdAt: Date.now(),
              });
              if (chips && chips.length) {
                pushMsg(t, "docs", {
                  id: msgId(),
                  role: "assistant",
                  text: "",
                  step: "docs",
                  chips,
                  optionsStep: "docs",
                  selectedChipValues: [],
                  createdAt: Date.now(),
                });
              }
            } else if (stepForTask === "car" || stepForTask === "characteristics") {
              // Вместо текстового «Зафиксировал по автомобилю…» —
              // показываем паспорт авто (как в тест-драйве/итоге).
              if (!isLastMessagePassport(t)) {
                pushMsg(t, stepForTask, makeStepPassportMessage(stepForTask));
              }
              if (chips && chips.length) {
                pushMsg(t, stepForTask, {
                  id: msgId(),
                  role: "assistant",
                  text: "",
                  step: stepForTask,
                  chips,
                  optionsStep: stepForTask,
                  selectedChipValues: [],
                  createdAt: Date.now(),
                });
              }
            } else {
              pushMsg(t, stepForTask, {
                id: msgId(),
                role: "assistant",
                text: reply,
                step: stepForTask,
                ...(attachments && attachments.length ? { attachments } : {}),
                ...(chips && chips.length
                  ? { chips, optionsStep: stepForTask, selectedChipValues: [] }
                  : {}),
                createdAt: Date.now(),
              });
            }

          }

          const nextAsk = nextMissingPrompt(stepForTask, t.draft);
          const remaining = remainingFieldLabels(stepForTask, t.draft);
          const remainingHint = remaining.length
            ? `\n📋 Ещё не заполнено: ${remaining.slice(0, 6).join(", ")}${remaining.length > 6 ? "…" : ""}.`
            : "";
          const tailLine = nextAsk
            ? `➡️ ${nextAsk}${remainingHint}`
            : `✅ Шаг заполнен. ${optionalHintSentence(stepForTask, t.draft)}`;
          if (tailLine) {
            pushMsg(t, stepForTask, {
              id: msgId(),
              role: "assistant",
              text: tailLine,
              step: stepForTask,
              createdAt: Date.now(),
            });
          }
          if (stepForTask === "car" && !t.draft.reportName) {
            const c = t.draft.carStep;
            t.title = c.vin
              ? `Отчёт · VIN ${c.vin.slice(-6)}`
              : c.gosNumber
                ? `Отчёт · ${c.gosNumber}`
                : "Новый отчёт";
          }
        });
        if (notePatched) pushChatNoteProposal(threadIdLocal, notePatched);
        // After car extract: if VIN newly known, decode it and fill characteristics
        if (stepForTask === "car") {
          const after = getThread(threadIdLocal);
          const newVin = after?.draft.carStep.vin;
          if (newVin && newVin !== prevVin && newVin.length >= 11) {
            void doVinDecode();
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "Ошибка ИИ";
        updateThread(threadIdLocal, (t) => {
          pushMsg(t, stepForTask, {
            id: msgId(),
            role: "assistant",
            text: `⚠️ ${message}`,
            createdAt: Date.now(),
          });
        });
      } finally {
        removeStatus();
      }
    });
  }, [thread, composer, currentStep, advanceStep, askMode, doVinDecode, lastOptionsMsgId, currentStepMessages, pendingAttachments, analyzeAttachments]);



  function jumpTo(step: StepId) {
    if (!thread) return;
    const idx = FLOW_STEPS.findIndex((s) => s.id === step);
    if (idx < 0) return;
    updateThread(thread.id, (t) => {
      const changed = t.stepIndex !== idx;
      t.stepIndex = idx;
      if (!changed) return;
      if (isStepFilled(step, t.draft)) {
        if (!isLastMessagePassport(t)) {
          pushMsg(t, step, makeStepPassportMessage(step));
        }
      } else {
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
  // Для шага «осмотр» карандаш доступен всегда — это вход в панель редактирования.
  const hasCurrentStepDraft =
    currentStep === "inspection" ||
    currentStep === "legalMaterials" ||
    summarizeStepDraft(currentStep, thread.draft).trim().length > 0;

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
              <PWAInstallButton onAction={() => setMenuOpen(false)} />
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
          {filled}/{FLOW_STEPS.length}
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

      <PWAInstallBanner />

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
              // Не вызываем .focus() — это раскрыло бы композер. Пользователь
              // сам тапнет по полю, когда захочет редактировать.
              requestAnimationFrame(() => {
                const ta = textareaRef.current;
                if (ta) {
                  ta.setSelectionRange(ta.value.length, ta.value.length);
                  ta.scrollTop = ta.scrollHeight;
                }
              });
            }}
            onPassportEdit={(template) => {
              setComposer((prev) => (prev.trim() ? prev + "\n" + template : template));
              setAskMode(false);
              // Раскрываем композер — пользователь нажал «Редактировать» в паспорте.
              requestAnimationFrame(() => {
                const ta = textareaRef.current;
                if (ta) {
                  ta.focus();
                  ta.setSelectionRange(ta.value.length, ta.value.length);
                  ta.scrollTop = ta.scrollHeight;
                }
              });
            }}
            onAdvance={advanceStep}
            onDocsAllMatch={() => {
              updateThread(thread.id, (t) => {
                t.draft.documentReconciliationStep = {
                  ...t.draft.documentReconciliationStep,
                  ownerFullNameMatchWithPTSOrSTS: true,
                  vinOnBodyMatchWithPTSOrSTS: true,
                  engineModelMatchWithPTSOrSTS: true,
                };
                pushMsg(t, "docs", {
                  id: msgId(),
                  role: "assistant",
                  text: "✅ Отмечено: VIN на кузове, № двигателя и собственник совпадают с ПТС/СТС.",
                  step: "docs",
                  createdAt: Date.now(),
                });
              });
            }}
            onTestDriveAllOk={() => {
              updateThread(thread.id, (t) => {
                t.draft.testDriveStep = {
                  ...t.draft.testDriveStep,
                  testDriveIsIncluded: true,
                  notDone: false,
                  testDriveEngineIsWorkingProperly: true,
                  testDriveTransmissionIsWorkingProperly: true,
                  testDriveSteeringWheelIsWorkingProperly: true,
                  testDriveSuspensionInDriveIsWorkingProperly: true,
                  testDriveBrakesInDriveIsWorkingProperly: true,
                  // Сброс всех тегов — раз нареканий нет.
                  testDriveEngineTags: [],
                  testDriveTransmissionTags: [],
                  testDriveSteeringWheelTags: [],
                  testDriveSuspensionInDriveTags: [],
                  testDriveBrakesInDriveTags: [],
                  testDriveTagTypes: {},
                };

                pushMsg(t, "testDrive", {
                  id: msgId(),
                  role: "assistant",
                  text: "✅ Тест-драйв: нареканий нет — двигатель, КПП, руль, подвеска, тормоза работают штатно.",
                  step: "testDrive",
                  createdAt: Date.now(),
                });
              });
            }}
            onTestDriveAddTag={(catKey, tag) => {
              if (!tag || typeof tag.id !== "number") return;
              const idStr = String(tag.id);
              const nameKey = tag.name.trim().toLowerCase();
              updateThread(thread.id, (t) => {
                const td = { ...(t.draft.testDriveStep ?? {}) } as Record<string, unknown>;
                const prev = Array.isArray(td[catKey])
                  ? (td[catKey] as unknown[]).filter(
                      (x): x is string => typeof x === "string",
                    )
                  : [];
                const has = prev.some((x) => {
                  const s = x.trim();
                  return s === idStr || s.toLowerCase() === nameKey;
                });
                if (!has) td[catKey] = [...prev, idStr];
                // Запоминаем тип, чтобы при сохранении не отправить null.
                const types = {
                  ...((td.testDriveTagTypes as Record<string, "serious" | "non_serious">) ?? {}),
                };
                if (tag.type === "serious" || tag.type === "non_serious") {
                  types[nameKey] = tag.type;
                }
                td.testDriveTagTypes = types;
                // Если добавили тег — категория уже не "норма", снимаем флаг исправности.
                const flagByCat: Record<string, string> = {
                  testDriveEngineTags: "testDriveEngineIsWorkingProperly",
                  testDriveTransmissionTags: "testDriveTransmissionIsWorkingProperly",
                  testDriveSteeringWheelTags: "testDriveSteeringWheelIsWorkingProperly",
                  testDriveSuspensionInDriveTags: "testDriveSuspensionInDriveIsWorkingProperly",
                  testDriveBrakesInDriveTags: "testDriveBrakesInDriveIsWorkingProperly",
                };
                const flagKey = flagByCat[catKey];
                if (flagKey) td[flagKey] = false;
                td.testDriveIsIncluded = true;
                td.notDone = false;
                t.draft.testDriveStep = td as typeof t.draft.testDriveStep;
              });
            }}

            inspectionDraft={thread.draft.inspectionStep}
            inspectionCursor={cursor ?? undefined}
            onSelectSection={selectSection}
            onShowInspectionFullPassport={showInspectionFullPassport}
            onSelectElement={selectElement}
            onSetVerdict={setVerdict}
            onToggleTag={toggleTagOnFinding}
            onAddPendingTag={addPendingTagOnFinding}
            onClearElement={clearCurrentElement}
            onAllNoDamage={markSectionAllOk}
            onNextElement={goNextElement}
            onPickInspectionPhotos={(snake, files) => void addInspectionPhotos(snake, files)}
            onOpenAnnotator={enterPhotoFocus}
            onDeleteInspectionPhoto={(idx: number) => {
              if (!thread) return;
              const removed = thread.draft.inspectionStep.photos[idx];
              updateThread(thread.id, (t) => {
                t.draft.inspectionStep.photos.splice(idx, 1);
              });
              if (removed?.photoId) {
                void import("@/lib/carreports/photoCache").then((m) =>
                  m.deletePhoto(removed.photoId!),
                );
              }
              if (photoFocusIdx === idx) exitPhotoFocus();
              else if (photoFocusIdx !== null && photoFocusIdx > idx)
                setPhotoFocusIdx(photoFocusIdx - 1);
            }}
            onAssignPendingPhoto={assignPendingPhoto}
            elementFocusPhotoIdx={photoFocusIdx}
            onElementFocusChangePhoto={(idx) => {
              setNoteProposal(null);
              setPhotoFocusIdx(idx);
            }}
            onElementFocusChangeElement={photoChangeElement}
            onElementFocusSetVerdict={photoSetVerdict}
            onElementFocusToggleTag={photoToggleTag}
            onElementFocusAddPendingTag={photoAddPendingTag}
            onElementFocusDeletePhoto={deletePhotoFocus}
            onMutateFindingAt={mutateFindingAt}
            onGenerateInspectionNote={generateInspectionNote}
            elementFocusNoteProposal={noteProposal}
            onElementFocusPickNoteOriginal={pickNoteOriginal}
            onElementFocusPickNoteAi={pickNoteAi}
            onElementFocusDismissNoteProposal={dismissNoteProposal}
            onDeleteLegalMaterial={(idx: number) => {
              if (!thread) return;
              updateThread(thread.id, (t) => {
                const arr = t.draft.legalReviewStep?.otherMaterials ?? [];
                t.draft.legalReviewStep = {
                  ...t.draft.legalReviewStep,
                  otherMaterials: arr.filter((_, i) => i !== idx),
                };
              });
            }}
            onAddLegalMaterial={() => materialsInputRef.current?.click()}
            onChatNoteAcceptOriginal={acceptChatNoteOriginal}
            onChatNoteAcceptAi={acceptChatNoteAi}
            onChatNoteDismiss={dismissChatNoteProposal}
            stepNoteProposals={stepNoteProposals}
            hasStepPassport={hasStepPassport}
            onJumpToMissing={(step, snake) => {
              jumpTo(step);
              if (step === "inspection" && snake) {
                // Дать шагу смонтироваться, затем выбрать раздел.
                requestAnimationFrame(() => selectSection(snake as Parameters<typeof selectSection>[0]));
              }
            }}
            onFinishContinue={() => void doFinish()}
            onReformulateResultNote={(kind) => {
              if (!thread) return;
              const r = thread.draft.resultStep ?? {};
              const originalText =
                (kind === "resultSummary"
                  ? r.summaryInspectionNote
                  : r.resultSpecialistNote) ?? "";
              if (!originalText.trim()) return;
              pushChatNoteProposal(thread.id, {
                ref: { kind },
                scopeLabel: kind === "resultSummary" ? "Резюме" : "Вердикт",
                originalText,
                tagNames: [],
              });
            }}

          />


        ))}

        {currentStep === "legalMaterials" && (thread.draft.legalReviewStep?.otherMaterials.length ?? 0) === 0 && (
          <div className="flex gap-2 items-start">
            <div className="h-8 w-8 shrink-0 rounded-full overflow-hidden border border-white/15 bg-zinc-900">
              <img
                src={assistantAvatar}
                alt="ИИ-ассистент"
                loading="lazy"
                width={32}
                height={32}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="max-w-[85%] w-full space-y-2">
              <div className="text-[10px] uppercase tracking-wide text-white/40">ИИ-ассистент</div>
              <div className="rounded-2xl rounded-tl-md bg-white/[0.04] border border-white/10 px-3 py-3 space-y-2.5">
                <div className="text-sm text-white">
                  Прикрепите дополнительные материалы проверки — фото, видео, документы или
                  отчёты сканеров. <span className="text-white/60">Файлов: {thread.draft.legalReviewStep?.otherMaterials.length ?? 0}</span>
                </div>
                <input
                  ref={materialsCameraRef}
                  type="file"
                  accept="image/*,.heic,.heif"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    if (files.length) void handleMaterialFiles(files);
                  }}
                />
                <input
                  ref={materialsInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  accept=".jpg,.jpeg,.png,.webp,.heic,.heif,.mp4,.mov,.avi,.pdf,.doc,.docx,image/*,video/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    if (files.length) void handleMaterialFiles(files);
                  }}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={materialsBusy}
                    onClick={() => materialsCameraRef.current?.click()}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm py-2.5"
                  >
                    <Camera className="h-5 w-5" /> Снять
                  </button>
                  <button
                    type="button"
                    disabled={materialsBusy}
                    onClick={() => materialsInputRef.current?.click()}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-40 text-white text-sm py-2.5"
                  >
                    <Paperclip className="h-5 w-5" /> {materialsBusy ? "Загрузка…" : "Файлы"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}


        {(busy || queueSize > 0) && (
          <div className="flex items-center gap-2 text-sm text-white/50">
            <span className="inline-block h-2 w-2 rounded-full bg-orange-400 animate-pulse" />
            {queueSize > 0
              ? `ИИ обрабатывает запросы… (в очереди: ${queueSize})`
              : "ИИ-ассистент думает…"}
          </div>
        )}

        <div ref={messagesEndRef} />
      </main>





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



        <button
          onClick={() => {
            if (currentStep === "result") {
              doFinishConfirm();
              return;
            }
            setAskMode(false);
            advanceStep();
          }}
          disabled={busy && currentStep === "result"}
          className="rounded-full bg-orange-500/90 hover:bg-orange-500 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 flex items-center gap-1"
        >
          {currentStep === "result" ? (
            <><FileText className="h-3.5 w-3.5" /> Завершить</>
          ) : (
            <><ChevronRight className="h-3.5 w-3.5" /> Далее</>
          )}
        </button>

        {hasCurrentStepDraft && (
          <button
            onClick={() => {
              setAskMode(false);
              updateThread(thread.id, (t) => {
                if (currentStep === "inspection") {
                  // Полноценная панель редактирования: раздел → элемент → теги.
                  const editId = "inspection-edit";
                  t.messages.inspection = t.messages.inspection.filter(
                    (m) => m.id !== editId,
                  );
                  pushMsg(t, "inspection", {
                    id: editId,
                    role: "assistant",
                    text: "",
                    step: "inspection",
                    kind: "inspectionSectionPicker",
                    createdAt: Date.now(),
                  });

                  return;
                }
                if (currentStep === "legalMaterials") {
                  const collageId = "legal-materials-collage";
                  t.messages.legalMaterials = t.messages.legalMaterials.filter(
                    (m) => m.id !== collageId,
                  );
                  const hasFiles =
                    (t.draft.legalReviewStep?.otherMaterials.length ?? 0) > 0;
                  if (hasFiles) {
                    pushMsg(t, "legalMaterials", {
                      id: collageId,
                      role: "assistant",
                      text: "",
                      step: "legalMaterials",
                      kind: "legalMaterialsCollage",
                      createdAt: Date.now(),
                    });
                  }
                  return;
                }
                const intro = STEP_INTROS[currentStep];
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
              // Карандаш не должен раскрывать композер — не фокусируем textarea.
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
                  kind: "stepPassport",
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
        {(currentStep === "inspection" ||
          currentStep === "legalMaterials" ||
          currentStep === "testDrive" ||
          currentStep === "result") &&
          (currentStep === "inspection" || isStepFilled(currentStep, thread.draft)) && (
            <button
              type="button"
              onClick={() => {
                if (currentStep === "inspection") {
                  showInspectionFullPassport();
                  return;
                }
                const passportId = `passport-${currentStep}`;
                updateThread(thread.id, (t) => {
                  t.messages[currentStep] = t.messages[currentStep].filter(
                    (m) => m.id !== passportId,
                  );
                  pushMsg(t, currentStep, {
                    id: passportId,
                    role: "assistant",
                    text: "",
                    step: currentStep,
                    kind: "stepPassport",
                    createdAt: Date.now(),
                  });
                });
              }}
              aria-label="Паспорт"
              title="Паспорт"
              className="h-8 rounded-full bg-white/5 hover:bg-white/10 text-white/80 flex items-center gap-1.5 px-2.5"
            >
              <ClipboardCheck className="h-4 w-4 text-emerald-400" />
              <span className="text-xs">Паспорт</span>
            </button>
          )}

        <button
          type="button"
          onPointerDown={(e) => {
            // Prevent textarea blur / mobile keyboard collapse so the toggle
            // fires on the first tap regardless of current focus.
            e.preventDefault();
            askToggledByPointerRef.current = true;
            setAskMode((v) => !v);
            textareaRef.current?.focus();
          }}
          onClick={() => {
            // Keyboard activation (Enter/Space) fires click without pointerdown.
            if (askToggledByPointerRef.current) {
              askToggledByPointerRef.current = false;
              return;
            }
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
          </div>
        )}
        {photoFocusIdx !== null && photoFocus && (() => {
          const sec = photoFocus.section as SectionSnake;
          const secLabel = INSPECTION_SECTIONS.find((s) => s.snake === sec)?.label ?? sec;
          const elId =
            photoFocus.elementId ??
            INSPECTION_SECTIONS.find((s) => s.snake === sec)?.elements[0]?.id;
          const elLabel = elId
            ? INSPECTION_SECTIONS.find((s) => s.snake === sec)?.elements.find((e) => e.id === elId)?.label
            : null;
          return (
            <div className="mb-2 flex items-center gap-2 rounded-xl bg-orange-500/10 border border-orange-500/40 px-2.5 py-1.5">
              {photoFocus.dataUrl && (
                <img
                  src={photoFocus.dataUrl}
                  alt=""
                  className="h-8 w-8 rounded object-cover border border-white/20 shrink-0"
                />
              )}
              <div className="min-w-0 flex-1 text-[12px] leading-tight">
                <div className="text-orange-100 truncate">📎 Заметка к фото · {elLabel ?? "—"}</div>
                <div className="text-orange-200/60 truncate">Раздел «{secLabel}»</div>
              </div>
              <button
                type="button"
                onClick={exitPhotoFocus}
                aria-label="Снять режим"
                className="h-6 w-6 rounded-full bg-black/30 hover:bg-black/50 text-white flex items-center justify-center shrink-0"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })()}
        {(() => {
          const isExpanded =
            composerFocused ||
            pendingAttachments.length > 0 ||
            voice.state === "error" ||
            voice.state === "recording" ||
            voice.state === "transcribing";
          const maxComposerH = () => {
            const vh =
              (typeof window !== "undefined" && window.visualViewport?.height) ||
              (typeof window !== "undefined" ? window.innerHeight : 800);
            return Math.max(120, vh - 200);
          };
          return (
            <div className="w-full">
              <div
                className={
                  "rounded-2xl border bg-white/[0.04] transition-all duration-300 " +
                  (isExpanded ? "border-white/15" : "border-white/10")
                }
              >
                {isExpanded && (
                  <div
                    role="separator"
                    aria-label="Потяните, чтобы изменить высоту"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                      const cur = composerHeight ?? (textareaRef.current?.offsetHeight ?? 44);
                      composerDragRef.current = { startY: e.clientY, startH: cur };
                    }}
                    onPointerMove={(e) => {
                      const d = composerDragRef.current;
                      if (!d) return;
                      const next = Math.min(
                        Math.max(44, d.startH + (d.startY - e.clientY)),
                        maxComposerH(),
                      );
                      setComposerHeight(next);
                    }}
                    onPointerUp={(e) => {
                      composerDragRef.current = null;
                      try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
                    }}
                    onPointerCancel={() => { composerDragRef.current = null; }}
                    onDoubleClick={() => setComposerHeight(null)}
                    className="flex items-center justify-center cursor-ns-resize touch-none py-1.5 -mb-1 select-none"
                    title="Перетащите, чтобы изменить высоту. Двойной клик — сброс"
                  >
                    <span className="h-1 w-10 rounded-full bg-white/25" />
                  </div>
                )}

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

                {isExpanded ? (
                  // ── Развёрнутый композер: текст на всю ширину, кнопки оверлеем ──
                  <div className="relative p-2">
                    <Textarea
                      ref={textareaRef}
                      value={composer}
                      onChange={(e) => setComposer(e.target.value)}
                      onFocus={() => setComposerFocused(true)}
                      onBlur={() => setComposerFocused(false)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (photoFocusIdx !== null) savePhotoNote();
                          else void submit();
                        }
                      }}
                      placeholder={
                        photoFocusIdx !== null
                          ? "Заметка к фото… Enter — сохранить, ✨ — добавить тег"
                          : askMode
                            ? "Спросите ИИ — ответ не запишется в шаг (Enter — отправить)"
                            : currentStep === "inspection" && cursor
                              ? `Заметка по «${cursor.element.label}» (раздел «${cursor.section.label}»)… Enter — сохранить`
                              : STEP_PLACEHOLDERS[currentStep]
                      }
                      style={
                        composerHeight != null
                          ? { height: composerHeight, minHeight: composerHeight, maxHeight: composerHeight }
                          : undefined
                      }
                      className={
                        "block w-full border-0 bg-transparent text-white placeholder:text-white/40 focus-visible:ring-0 " +
                        // Внизу — место под кнопки + ещё пара строк, чтобы текст под ними можно было прокрутить и прочитать.
                        (voice.error ? "pb-32 " : "pb-24 ") +
                        (composerHeight != null
                          ? "resize-none "
                          : "min-h-[88px] max-h-[60vh] resize-y ") +
                        (askMode ? "placeholder:text-sky-300/60" : "")
                      }
                    />
                    {voice.error && (
                      <div className="pointer-events-none absolute bottom-14 left-3 right-3 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-[12px] leading-snug text-red-100">
                        {voice.error}
                      </div>
                    )}
                    <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex items-end justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => attachInputRef.current?.click()}
                        onMouseDown={(e) => e.preventDefault()}
                        className="pointer-events-auto h-9 w-9 shrink-0 rounded-full bg-zinc-900/85 backdrop-blur hover:bg-zinc-800 flex items-center justify-center text-white ring-1 ring-white/10"
                        aria-label="Прикрепить фото"
                        title="Прикрепить фото"
                      >
                        <Paperclip className="h-4 w-4" />
                      </button>
                      <div className="flex items-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            if (voice.state === "recording") {
                              voice.stop();
                            } else {
                              voiceBaseRef.current = composer.trim();
                              void voice.start();
                            }
                          }}
                          onMouseDown={(e) => e.preventDefault()}
                          disabled={voice.state === "transcribing"}
                          className={
                            "pointer-events-auto h-9 w-9 shrink-0 rounded-full backdrop-blur flex items-center justify-center text-white ring-1 ring-white/10 transition-colors " +
                            (voice.state === "recording"
                              ? "bg-red-500/90 hover:bg-red-600 animate-pulse"
                              : "bg-zinc-900/85 hover:bg-zinc-800")
                          }
                          aria-label={voice.state === "recording" ? "Остановить запись" : "Голосовой ввод"}
                          title={voice.error ?? "Голосовой ввод"}
                        >
                          {voice.state === "recording" ? (
                            <Square className="h-3.5 w-3.5 fill-white" />
                          ) : voice.state === "transcribing" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Mic className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            if (photoFocusIdx !== null) savePhotoNote();
                            else void submit();
                          }}
                          disabled={
                            photoFocusIdx !== null
                              ? false
                              : !composer.trim() &&
                                pendingAttachments.length === 0 &&
                                !(lastOptionsMsgId &&
                                  (currentStepMessages.find((m) => m.id === lastOptionsMsgId)
                                    ?.selectedChipValues?.length ?? 0) > 0)
                          }
                          className="pointer-events-auto h-10 w-10 shrink-0 rounded-full bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-white shadow-[0_0_24px_-6px_rgba(249,115,22,0.6)]"
                          aria-label={photoFocusIdx !== null ? "Сохранить заметку" : "Отправить"}
                        >
                          <ArrowUp className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  // ── Свёрнутый композер: узкая полоска ─────────────────────
                  <div className="flex items-center gap-2 p-1.5">
                    <Textarea
                      ref={textareaRef}
                      value={composer}
                      onChange={(e) => setComposer(e.target.value)}
                      onFocus={() => setComposerFocused(true)}
                      onBlur={() => setComposerFocused(false)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (photoFocusIdx !== null) savePhotoNote();
                          else void submit();
                        }
                      }}
                      placeholder={
                        photoFocusIdx !== null
                          ? "Заметка к фото…"
                          : STEP_PLACEHOLDERS[currentStep]
                      }
                      className={
                        "border-0 bg-transparent text-white placeholder:text-white/40 focus-visible:ring-0 min-h-[32px] max-h-[32px] py-1 text-sm resize-none " +
                        (askMode ? "placeholder:text-sky-300/60" : "")
                      }
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (photoFocusIdx !== null) savePhotoNote();
                        else void submit();
                      }}
                      disabled={
                        photoFocusIdx !== null
                          ? false
                          : !composer.trim() &&
                            pendingAttachments.length === 0 &&
                            !(lastOptionsMsgId &&
                              (currentStepMessages.find((m) => m.id === lastOptionsMsgId)
                                ?.selectedChipValues?.length ?? 0) > 0)
                      }
                      className="shrink-0 rounded-full bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-white h-8 w-8"
                      aria-label={photoFocusIdx !== null ? "Сохранить заметку" : "Отправить"}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

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
  /** Версия onFillMissing, которая дополнительно раскрывает композер. */
  onPassportEdit?: (template: string) => void;
  onDocsAllMatch?: () => void;
  onTestDriveAllOk?: () => void;
  onTestDriveAddTag?: (
    catKey:
      | "testDriveEngineTags"
      | "testDriveTransmissionTags"
      | "testDriveSteeringWheelTags"
      | "testDriveSuspensionInDriveTags"
      | "testDriveBrakesInDriveTags",
    tag: UserTag,
  ) => void;
  onAdvance?: () => void;
  /** Inspection chat card data + handlers. */
  inspectionDraft?: import("@/lib/carreports/types").InspectionStep;
  inspectionCursor?: import("@/lib/carreports/inspectionState").InspectionCursor;
  onSelectSection?: (snake: SectionSnake) => void;
  onShowInspectionFullPassport?: () => void;
  onSelectElement?: (elementId: string) => void;
  onSetVerdict?: (v: "ok" | "minor" | "serious") => void;
  onToggleTag?: (t: UserTag) => void;
  onAddPendingTag?: (name: string, severity: "serious" | "non_serious") => void;
  onClearElement?: () => void;
  onAllNoDamage?: () => void;
  onNextElement?: () => void;
  onPickInspectionPhotos?: (snake: SectionSnake, files: File[]) => void;
  onOpenAnnotator?: (photoIdx: number) => void;
  onDeleteInspectionPhoto?: (photoIdx: number) => void;
  onAssignPendingPhoto?: (msgId: string, snake: SectionSnake) => void;
  /** Element-focus card (живёт прямо в чате) */
  elementFocusPhotoIdx?: number | null;
  onElementFocusChangePhoto?: (idx: number) => void;
  onElementFocusChangeElement?: (elementId: string) => void;
  onElementFocusSetVerdict?: (v: "ok" | "minor" | "serious") => void;
  onElementFocusToggleTag?: (t: UserTag) => void;
  onElementFocusAddPendingTag?: (name: string, severity: "serious" | "non_serious") => void;
  onElementFocusDeletePhoto?: () => void;
  /** Прямая мутация finding фото по индексу — для inline-карточек чата,
   *  у которых нет глобального photoFocusIdx. */
  onMutateFindingAt?: (
    idx: number,
    mutate: (f: import("@/lib/carreports/types").InspectionElementFinding) => void,
  ) => void;
  onGenerateInspectionNote?: (args: {
    section: SectionSnake;
    elementId: string;
    scopeLabel: string;
    originalText: string;
    tagNames: string[];
  }) => void;
  elementFocusNoteProposal?: NoteProposalT | null;
  onElementFocusPickNoteOriginal?: () => void;
  onElementFocusPickNoteAi?: () => void;
  onElementFocusDismissNoteProposal?: () => void;
  onDeleteLegalMaterial?: (idx: number) => void;
  onAddLegalMaterial?: () => void;
  /** Chat-level note proposal handlers (предлагать переформулировку заметки) */
  onChatNoteAcceptOriginal?: (ref: NoteRef) => void;
  onChatNoteAcceptAi?: (ref: NoteRef, ai: string) => void;
  onChatNoteDismiss?: (ref: NoteRef) => void;
  stepNoteProposals?: Array<{
    payload: NonNullable<ChatMessage["noteProposal"]>;
    onPickOriginal: () => void;
    onPickAi: () => void;
    onDismiss: () => void;
  }>;
  hasStepPassport?: boolean;
  /** Прыжок на шаг (и опционально сразу выбрать раздел осмотра). */
  onJumpToMissing?: (step: StepId, sectionSnake?: string) => void;
  /** Подтверждение «Продолжить» в карточке завершения отчёта. */
  onFinishContinue?: () => void;
  /** Запустить ИИ-переформулировку для шага «Итог» (резюме/вердикт). */
  onReformulateResultNote?: (kind: "resultSummary" | "resultVerdict") => void;
}


function MessageBubble({
  msg,
  interactive,
  onChipTap,
  inspectionDateValue,
  onInspectionDateChange,
  draft,
  onFillMissing,
  onPassportEdit,
  onDocsAllMatch,
  onTestDriveAllOk,
  onTestDriveAddTag,
  onAdvance,
  inspectionDraft,
  inspectionCursor,
  onSelectSection,
  onShowInspectionFullPassport,
  onSelectElement,
  onSetVerdict,
  onToggleTag,
  onAddPendingTag,
  onClearElement,
  onAllNoDamage,
  onNextElement,
  onPickInspectionPhotos,
  onOpenAnnotator,
  onDeleteInspectionPhoto,
  onAssignPendingPhoto,
  elementFocusPhotoIdx,
  onElementFocusChangePhoto,
  onElementFocusChangeElement,
  onElementFocusSetVerdict,
  onElementFocusToggleTag,
  onElementFocusAddPendingTag,
  onElementFocusDeletePhoto,
  onMutateFindingAt,
  onGenerateInspectionNote,
  elementFocusNoteProposal,
  onElementFocusPickNoteOriginal,
  onElementFocusPickNoteAi,
  onElementFocusDismissNoteProposal,
  onDeleteLegalMaterial,
  onAddLegalMaterial,
  onChatNoteAcceptOriginal,
  onChatNoteAcceptAi,
  onChatNoteDismiss,
  stepNoteProposals,
  hasStepPassport,
  onJumpToMissing,
  onFinishContinue,
  onReformulateResultNote,
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
      <div className="h-8 w-8 shrink-0 rounded-full overflow-hidden border border-white/15 bg-zinc-900">
        <img src={assistantAvatar} alt="ИИ-ассистент" loading="lazy" width={32} height={32} className="h-full w-full object-cover" />
      </div>
      <div className={`max-w-[85%] ${msg.kind === "inspectionCollage" ? "w-full" : ""} space-y-2`}>
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
              onEdit={onPassportEdit ?? onFillMissing}
              onAllMatch={onDocsAllMatch}
            />
            {msg.text && (
              <div className="mt-2 pt-2 border-t border-white/5 text-[12px] text-white/55 whitespace-pre-wrap">
                {msg.text}
              </div>
            )}
          </div>
        ) : msg.kind === "stepPassport" && draft && msg.step ? (
          <StepPassport
            step={msg.step}
            draft={draft}
            onEdit={onPassportEdit ?? onFillMissing}
            onConfirm={onAdvance}
            onDocsAllMatch={onDocsAllMatch}
            onTestDriveAllOk={onTestDriveAllOk}
            onTestDriveAddTag={onTestDriveAddTag}
            noteProposals={stepNoteProposals?.filter(
              (p) => stepForNoteRef(p.payload.ref) === msg.step,
            )}
            onReformulateResultNote={onReformulateResultNote}
            onDeleteLegalMaterial={onDeleteLegalMaterial}
          />


        ) : msg.kind === "noteProposal" && msg.noteProposal ? (
          // Карточка переформулировки не показывается отдельным пузырём —
          // она рисуется inline (под исходной заметкой в паспорте шага или
          // в ElementFocusCard для осмотра). Сам message нужен как источник
          // данных для inline-рендера (см. stepNoteProposals).
          null
        ) : msg.kind === "missingFields" && msg.missingFields?.length ? (
          <div className="rounded-2xl rounded-tl-md bg-white/[0.04] border border-amber-400/30 text-sm px-3 py-2.5 text-white space-y-2">
            {msg.text && (
              <div className="whitespace-pre-wrap text-white/85">{msg.text}</div>
            )}
            <div className="flex flex-col gap-1.5">
              {msg.missingFields.map((it, i) => (
                <button
                  key={`${it.step}-${it.sectionSnake ?? ""}-${i}`}
                  type="button"
                  onClick={() => onJumpToMissing?.(it.step, it.sectionSnake)}
                  className="text-left rounded-lg border border-white/15 bg-white/[0.03] hover:bg-white/[0.07] px-3 py-2 text-[13px] text-white/90 transition"
                >
                  → {it.label}
                </button>
              ))}
            </div>
          </div>

        ) : msg.kind === "finishConfirm" ? (
          <div className="rounded-2xl rounded-tl-md bg-white/[0.04] border border-amber-400/30 text-sm px-3 py-2.5 text-white space-y-2.5 max-w-[320px]">
            <div className="whitespace-pre-wrap text-white/85">
              {msg.text || "После выгрузки отчёт нельзя будет отредактировать. Продолжить?"}
            </div>
            <button
              type="button"
              onClick={() => onFinishContinue?.()}
              className="w-full rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-[13px] font-medium px-3 py-2 transition"
            >
              Продолжить
            </button>
          </div>

        ) : msg.kind === "finishComplete" ? (
          (() => {
            const fc = msg.finishComplete ?? {};
            const shareUrl = fc.shareUrl;
            const onShare = async () => {
              if (!shareUrl) return;
              const data = {
                title: "Отчёт об осмотре",
                text: fc.reportId ? `Отчёт ${fc.reportId}` : "Отчёт",
                url: shareUrl,
              };
              try {
                if (typeof navigator !== "undefined" && "share" in navigator) {
                  await (navigator as Navigator & { share: (d: ShareData) => Promise<void> }).share(data);
                  return;
                }
              } catch { /* fallback ниже */ }
              try {
                await navigator.clipboard?.writeText(shareUrl);
              } catch { /* ignore */ }
            };
            return (
              <div className="rounded-2xl rounded-tl-md bg-emerald-500/10 border border-emerald-400/30 text-sm px-3 py-2.5 text-white space-y-2.5 max-w-[320px]">
                <div className="whitespace-pre-wrap text-white/90">
                  {msg.text || "✅ Отчёт успешно выгружен."}
                </div>
                {shareUrl && (
                  <button
                    type="button"
                    onClick={() => void onShare()}
                    className="w-full rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-[13px] font-medium px-3 py-2 transition flex items-center justify-center gap-1.5"
                  >
                    <Share2 className="h-3.5 w-3.5" /> Поделиться
                  </button>
                )}
              </div>
            );
          })()

        ) : msg.kind === "uploadProgress" && msg.uploadProgress ? (
          (() => {
            const up = msg.uploadProgress!;
            const isErr = up.phase === "error";
            const isDone = up.phase === "done";
            const isPrep = up.phase === "preparing";
            const isFin = up.phase === "finalizing";
            const barColor = isErr
              ? "bg-rose-500"
              : isDone
                ? "bg-emerald-500"
                : "bg-orange-400";
            const title = isErr
              ? "Ошибка выгрузки"
              : isDone
                ? "Файлы выгружены"
                : isPrep
                  ? "Подготовка отчёта…"
                  : isFin
                    ? "Финализация отчёта…"
                    : "Выгрузка файлов…";

            return (
              <div className="rounded-2xl rounded-tl-md bg-white/[0.04] border border-white/10 text-sm px-3 py-2.5 text-white space-y-2 min-w-[240px]">
                <div className="flex items-center justify-between text-[12px] text-white/80">
                  <span>{title}</span>
                  <span className="tabular-nums text-white/60">
                    {up.uploaded ?? 0}/{up.total ?? "?"} · {up.percent}%
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={`h-full ${barColor} transition-all duration-200`}
                    style={{ width: `${Math.min(100, Math.max(0, up.percent))}%` }}
                  />
                </div>
                {up.note && (
                  <div className={`text-[12px] ${isErr ? "text-rose-300" : "text-white/60"}`}>
                    {up.note}
                  </div>
                )}
              </div>
            );
          })()
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
        {msg.kind === "inspectionSectionPicker" && inspectionDraft && (
          <SectionPickerCard
            ins={inspectionDraft}
            currentSection={inspectionCursor?.section.snake}
            interactive
            onPick={onSelectSection ?? (() => {})}
            onShowFullPassport={onShowInspectionFullPassport}
          />
        )}
        {msg.kind === "inspectionFullPassport" && inspectionDraft && (
          <InspectionFullPassport step={inspectionDraft} />
        )}
        {msg.kind === "inspectionChips" && inspectionDraft && inspectionCursor && (
          <InspectionChipsCard
            ins={inspectionDraft}
            cursor={inspectionCursor}
            interactive={interactive}
            onSelectSection={onSelectSection ?? (() => {})}
            onSelectElement={onSelectElement ?? (() => {})}
            onSetVerdict={onSetVerdict ?? (() => {})}
            onToggleTag={onToggleTag ?? (() => {})}
            onAddPendingTag={onAddPendingTag ?? (() => {})}
            onClearElement={onClearElement ?? (() => {})}
            onAllNoDamage={onAllNoDamage ?? (() => {})}
            onNextElement={onNextElement ?? (() => {})}
          />
        )}
        

        {msg.kind === "inspectionUploadPrompt" && msg.sectionSnake && inspectionDraft && (
          <InspectionUploadPrompt
            sectionSnake={msg.sectionSnake as SectionSnake}
            interactive
            onPick={(files) =>
              onPickInspectionPhotos?.(msg.sectionSnake as SectionSnake, files)
            }
          />
        )}
        {msg.kind === "inspectionCollage" && msg.sectionSnake && inspectionDraft && (
          <InspectionCollage
            ins={inspectionDraft}
            sectionSnake={msg.sectionSnake as SectionSnake}
            interactive
            onPick={(files) =>
              onPickInspectionPhotos?.(msg.sectionSnake as SectionSnake, files)
            }
            onOpenPhoto={(idx) => onOpenAnnotator?.(idx)}
            onDeletePhoto={(idx) => onDeleteInspectionPhoto?.(idx)}
          />
        )}
        {msg.kind === "inspectionElementFocus" &&
          inspectionDraft &&
          typeof msg.photoIdx === "number" &&
          inspectionDraft.photos[msg.photoIdx] && (
            <ElementFocusCard
              ins={inspectionDraft}
              photoIdx={
                elementFocusPhotoIdx !== null && elementFocusPhotoIdx !== undefined
                  ? elementFocusPhotoIdx
                  : msg.photoIdx
              }
              onChangePhotoIdx={(idx) => onElementFocusChangePhoto?.(idx)}
              onChangeElement={(elementId) => onElementFocusChangeElement?.(elementId)}
              onSetVerdict={(v) => {
                const idx =
                  elementFocusPhotoIdx !== null && elementFocusPhotoIdx !== undefined
                    ? elementFocusPhotoIdx
                    : (msg.photoIdx as number);
                onMutateFindingAt?.(idx, (f) => {
                  if (v === "ok") {
                    f.noDamage = true;
                    f.seriousDamageTagIds = [];
                    f.noSeriousDamageTagIds = [];
                    f.pendingTagNames = [];
                  } else {
                    f.noDamage = false;
                  }
                });
              }}
              onToggleTag={(t) => {
                const idx =
                  elementFocusPhotoIdx !== null && elementFocusPhotoIdx !== undefined
                    ? elementFocusPhotoIdx
                    : (msg.photoIdx as number);
                const bucket: "serious" | "non_serious" =
                  t.type === "serious" ? "serious" : "non_serious";
                onMutateFindingAt?.(idx, (f) => toggleFindingTag(f, bucket, t.id));
              }}
              onAddPendingTag={(n, s) => {
                const idx =
                  elementFocusPhotoIdx !== null && elementFocusPhotoIdx !== undefined
                    ? elementFocusPhotoIdx
                    : (msg.photoIdx as number);
                onMutateFindingAt?.(idx, (f) => togglePendingTag(f, n, s));
              }}
              onTogglePendingTag={(n, s) => {
                const idx =
                  elementFocusPhotoIdx !== null && elementFocusPhotoIdx !== undefined
                    ? elementFocusPhotoIdx
                    : (msg.photoIdx as number);
                onMutateFindingAt?.(idx, (f) => togglePendingTag(f, n, s));
              }}
              onDeletePhoto={onElementFocusDeletePhoto}
              noteProposal={elementFocusNoteProposal ?? null}
              onPickNoteOriginal={onElementFocusPickNoteOriginal}
              onPickNoteAi={onElementFocusPickNoteAi}
              onDismissNoteProposal={onElementFocusDismissNoteProposal}
              aiUpdating={!!elementFocusNoteProposal?.loading}
              chatNoteProposal={(() => {
                const idx =
                  elementFocusPhotoIdx !== null && elementFocusPhotoIdx !== undefined
                    ? elementFocusPhotoIdx
                    : (msg.photoIdx as number);
                const photo = inspectionDraft.photos[idx];
                if (!photo) return undefined;
                const sec = photo.section;
                const elId =
                  photo.elementId ??
                  getSection(sec as SectionSnake)?.elements[0]?.id;
                const found = stepNoteProposals?.find(
                  (p) =>
                    p.payload.ref.kind === "inspection" &&
                    p.payload.ref.section === sec &&
                    p.payload.ref.elementId === elId,
                );
                return found;
              })()}
              onGenerateNote={onGenerateInspectionNote}
              onEdit={onFillMissing}
              onSetPaintwork={(from, to) => {
                const idx =
                  elementFocusPhotoIdx !== null && elementFocusPhotoIdx !== undefined
                    ? elementFocusPhotoIdx
                    : (msg.photoIdx as number);
                onMutateFindingAt?.(idx, (f) => {
                  f.paintworkThicknessFrom = from;
                  f.paintworkThicknessTo = to;
                });
              }}
            />

          )}
        {msg.kind === "inspectionAttachAssign" && msg.pendingPhoto && (
          <div className="rounded-2xl rounded-tl-md bg-white/[0.04] border border-white/10 px-3 py-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <img
                src={msg.pendingPhoto.dataUrl || msg.pendingPhoto.url}
                alt={msg.pendingPhoto.filename}
                className="h-12 w-12 rounded-lg object-cover border border-white/10"
              />
              <div className="text-[12px] text-white/70 leading-tight truncate">
                {msg.pendingPhoto.assignedSection
                  ? `Закреплено в разделе «${
                      INSPECTION_SECTIONS.find(
                        (s) => s.snake === msg.pendingPhoto!.assignedSection,
                      )?.label ?? msg.pendingPhoto.assignedSection
                    }»`
                  : "Выберите раздел, к которому относится фото:"}
              </div>
            </div>
            {!msg.pendingPhoto.assignedSection && (
              <div className="flex flex-wrap gap-1.5">
                {INSPECTION_SECTIONS.map((s) => (
                  <button
                    key={s.snake}
                    disabled={!interactive}
                    onClick={() => onAssignPendingPhoto?.(msg.id, s.snake)}
                    className={
                      "rounded-full border px-2.5 py-1 text-xs whitespace-nowrap transition-colors " +
                      (interactive
                        ? "border-white/15 text-white/80 hover:border-orange-400/60 hover:text-white"
                        : "border-white/10 text-white/40 cursor-default")
                    }
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {msg.kind === "legalMaterialsCollage" && draft && (
          <div className="rounded-2xl rounded-tl-md bg-white/[0.04] border border-white/10 px-3 py-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[13px] text-white">Загруженные материалы</div>
              <div className="text-[11px] text-white/45">
                {draft.legalReviewStep?.otherMaterials.length ?? 0} файл(ов)
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(draft.legalReviewStep?.otherMaterials ?? []).map((mat, idx) => {
                  const icon =
                    mat.type === "image" ? "🖼️" : mat.type === "video" ? "🎬" : "📄";
                  const kb =
                    mat.size && mat.size >= 1024 * 1024
                      ? `${(mat.size / 1024 / 1024).toFixed(1)} МБ`
                      : mat.size
                        ? `${Math.max(1, Math.round(mat.size / 1024))} КБ`
                        : "";
                  return (
                    <div
                      key={`${mat.key}:${idx}`}
                      className="relative aspect-square rounded-lg overflow-hidden border border-white/10 bg-white/5 group"
                    >
                      <a
                        href={mat.url}
                        target="_blank"
                        rel="noreferrer"
                        className="absolute inset-0 w-full h-full flex items-center justify-center"
                        title={mat.filename}
                      >
                        {mat.type === "image" && (mat.url || mat.dataUrl) ? (
                          <img
                            src={mat.dataUrl || mat.url}
                            alt={mat.filename}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center gap-1 text-white/70 px-1 text-center">
                            <span className="text-2xl">{icon}</span>
                            <span className="text-[10px] truncate w-full">
                              {mat.filename}
                            </span>
                          </div>
                        )}
                        <div className="absolute inset-x-0 bottom-0 px-1.5 py-0.5 bg-gradient-to-t from-black/80 to-transparent">
                          <div className="text-[10px] text-white/85 truncate">
                            {kb}
                          </div>
                        </div>
                      </a>
                      {onDeleteLegalMaterial && (
                        <button
                          type="button"
                          onPointerDown={(e) => {
                            if (e.button !== undefined && e.button !== 0) return;
                            e.preventDefault();
                            e.stopPropagation();
                            onDeleteLegalMaterial(idx);
                          }}
                          aria-label="Удалить файл"
                          className="absolute top-1 right-1 z-10 h-5 w-5 rounded-full bg-black/55 hover:bg-rose-500/80 text-white flex items-center justify-center ring-1 ring-white/15 backdrop-blur-md opacity-80 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              {onAddLegalMaterial && (
                <button
                  type="button"
                  onClick={() => onAddLegalMaterial()}
                  className="aspect-square rounded-lg border border-dashed border-white/20 text-white/60 hover:text-white hover:border-white/40 flex flex-col items-center justify-center gap-1 text-[11px]"
                >
                  <Plus className="h-6 w-6" />
                  Добавить
                </button>
              )}
            </div>

          </div>
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
              {groups.map((g) => {
                const isYesNo = g.items.length > 0 && g.items.every((c) => c.groupKind === "yesno");
                if (isYesNo) {
                  return (
                    <div
                      key={g.label || "_"}
                      className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-1.5"
                    >
                      <div className="text-[12px] text-white/75 flex-1 min-w-0">
                        {g.label || "Вопрос"}
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        {g.items.map((c) => {
                          const isSel = selected.has(c.value);
                          const isYes = /^да$/i.test(c.label.trim());
                          const onCls = isYes
                            ? "bg-emerald-500 text-white border-emerald-500"
                            : "bg-rose-500 text-white border-rose-500";
                          return (
                            <button
                              key={c.label}
                              disabled={!interactive}
                              onClick={() => onChipTap(c)}
                              className={
                                "rounded-full border px-3 py-1 text-xs min-w-[44px] transition-colors " +
                                (isSel
                                  ? onCls
                                  : interactive
                                    ? "border-white/15 text-white/80 hover:border-white/40 hover:text-white"
                                    : "border-white/10 text-white/40 cursor-default")
                              }
                            >
                              {c.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={g.label || "_"} className="space-y-1">
                    {g.label && (
                      <div className="text-[10px] uppercase tracking-wide text-white/45">
                        {g.label}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1.5">{g.items.map(renderChip)}</div>
                  </div>
                );
              })}
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
