// Threads + localStorage store with stable snapshots (for useSyncExternalStore).
// Avoids the classic "returning a new array on every getSnapshot" infinite loop.

import { emptyDraft, emptyStepMessages, type ChatMessage, type ReportDraft, type StepId, type StepMessages, type Thread } from "./types";

const LS_KEY = "carreports.threads.v1";

const EMPTY: readonly Thread[] = Object.freeze([]);
let cache: readonly Thread[] | null = null;
const listeners = new Set<() => void>();

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** Migrate legacy flat ChatMessage[] to per-step Record. */
function normalizeMessages(input: unknown): StepMessages {
  const out = emptyStepMessages();
  if (Array.isArray(input)) {
    for (const m of input as ChatMessage[]) {
      const step = (m?.step ?? "car") as StepId;
      if (out[step]) out[step].push(m);
      else out.car.push(m);
    }
    return out;
  }
  if (input && typeof input === "object") {
    const obj = input as Partial<Record<StepId, ChatMessage[]>>;
    for (const k of Object.keys(out) as StepId[]) {
      const arr = obj[k];
      if (Array.isArray(arr)) out[k] = arr as ChatMessage[];
    }
  }
  return out;
}

/** Defensive normalisation so old drafts loaded from localStorage do not crash. */
function normalizeThread(t: Partial<Thread> & { id: string }): Thread {
  const draft = (t.draft ?? {}) as Partial<ReportDraft>;
  const safeDraft: ReportDraft = {
    reportName: draft.reportName,
    reportDate: draft.reportDate,
    carStep: { ...(draft.carStep ?? {}) },
    characteristicsStep: { ...(draft.characteristicsStep ?? {}) },
    documentReconciliationStep: { ...(draft.documentReconciliationStep ?? {}) },
    inspectionStep: {
      sectionNotes: { ...(draft.inspectionStep?.sectionNotes ?? {}) },
      photos: Array.isArray(draft.inspectionStep?.photos) ? draft.inspectionStep!.photos : [],
      touched: !!draft.inspectionStep?.touched,
    },
    testDriveStep: { ...(draft.testDriveStep ?? {}) },
    resultStep: { ...(draft.resultStep ?? {}) },
  };
  return {
    id: t.id,
    title: t.title ?? "Новый отчёт",
    updatedAt: typeof t.updatedAt === "number" ? t.updatedAt : Date.now(),
    stepIndex: typeof t.stepIndex === "number" ? t.stepIndex : 0,
    draft: safeDraft,
    messages: normalizeMessages(t.messages),
    aiChatIds: { ...(t.aiChatIds ?? {}) },
  };
}

function readFromLS(): readonly Thread[] {
  if (!isBrowser()) return EMPTY;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Array<Partial<Thread> & { id: string }>;
    if (!Array.isArray(parsed) || parsed.length === 0) return EMPTY;
    return Object.freeze(parsed.map(normalizeThread));
  } catch {
    return EMPTY;
  }
}

function persist(next: readonly Thread[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    // QuotaExceeded etc. — best-effort, in-memory cache survives.
  }
}

function emit(next: readonly Thread[]): void {
  cache = Object.freeze(next.slice());
  persist(cache);
  for (const l of listeners) l();
}

/** Stable snapshot — same reference until threads actually change. */
export function loadThreads(): readonly Thread[] {
  if (cache === null) cache = readFromLS();
  return cache;
}

export function subscribeThreads(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getThread(id: string | null | undefined): Thread | null {
  if (!id) return null;
  return loadThreads().find((t) => t.id === id) ?? null;
}

export function createThread(initial?: Partial<Thread>): Thread {
  const t: Thread = normalizeThread({
    id: uid(),
    title: initial?.title ?? "Новый отчёт",
    updatedAt: Date.now(),
    stepIndex: 0,
    draft: initial?.draft ?? emptyDraft(),
    messages: initial?.messages ?? emptyStepMessages(),
    aiChatIds: initial?.aiChatIds ?? {},
  });
  const next = [t, ...loadThreads()];
  emit(next);
  return t;
}

export function updateThread(id: string, mut: (t: Thread) => Thread | void): Thread | null {
  const list = loadThreads();
  let changed = false;
  let updated: Thread | null = null;
  const next = list.map((t) => {
    if (t.id !== id) return t;
    // produce a deep-ish clone so callers can mutate safely
    const clone: Thread = {
      ...t,
      draft: {
        ...t.draft,
        carStep: { ...t.draft.carStep },
        characteristicsStep: { ...t.draft.characteristicsStep },
        documentReconciliationStep: { ...t.draft.documentReconciliationStep },
        inspectionStep: {
          ...t.draft.inspectionStep,
          sectionNotes: { ...t.draft.inspectionStep.sectionNotes },
          photos: [...t.draft.inspectionStep.photos],
        },
        testDriveStep: { ...t.draft.testDriveStep },
        resultStep: { ...t.draft.resultStep },
      },
      messages: {
        car: [...t.messages.car],
        characteristics: [...t.messages.characteristics],
        docs: [...t.messages.docs],
        inspection: [...t.messages.inspection],
        testDrive: [...t.messages.testDrive],
        result: [...t.messages.result],
        submit: [...t.messages.submit],
      },
      aiChatIds: { ...t.aiChatIds },
    };
    const result = mut(clone) ?? clone;
    result.updatedAt = Date.now();
    changed = true;
    updated = result;
    return result;
  });
  if (changed) emit(next);
  return updated;
}

export function deleteThread(id: string): void {
  const next = loadThreads().filter((t) => t.id !== id);
  if (next.length !== loadThreads().length) emit(next);
}
