// User-defined chip lexicon, persisted in localStorage.
// Scoped per (step, group?). Each entry tracks a usage weight so frequently
// used clichés float to the top. Built-in chips stay where they are; custom
// chips render after them, sorted by weight desc.

import { useSyncExternalStore } from "react";
import type { ChatChip, StepId } from "./types";

const KEY = "cr.lexicon.v1";

export interface LexEntry {
  id: string;
  step: StepId;
  /** zone id for inspection step, undefined otherwise */
  zone?: string;
  label: string;
  value: string;
  weight: number;
  updatedAt: number;
}

type Store = { entries: LexEntry[] };

function safeRead(): Store {
  if (typeof window === "undefined") return { entries: [] };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { entries: [] };
    const parsed = JSON.parse(raw) as Store;
    if (!parsed || !Array.isArray(parsed.entries)) return { entries: [] };
    return parsed;
  } catch {
    return { entries: [] };
  }
}

let memo: Store = safeRead();
const listeners = new Set<() => void>();

function persist() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(memo));
  } catch {
    /* ignore quota */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function snapshot(): Store {
  return memo;
}

const SSR: Store = { entries: [] };

export function useLexicon(step: StepId, zone?: string): LexEntry[] {
  const store = useSyncExternalStore(
    subscribe,
    snapshot,
    () => SSR,
  );
  return store.entries
    .filter((e) => e.step === step && (e.zone ?? null) === (zone ?? null))
    .sort((a, b) => b.weight - a.weight || b.updatedAt - a.updatedAt);
}

export function addLexEntry(
  step: StepId,
  zone: string | undefined,
  label: string,
  value: string,
): LexEntry {
  const e: LexEntry = {
    id: Math.random().toString(36).slice(2),
    step,
    zone,
    label: label.trim().slice(0, 60),
    value: value.trim().slice(0, 240),
    weight: 1,
    updatedAt: Date.now(),
  };
  memo = { entries: [...memo.entries, e] };
  persist();
  return e;
}

export function updateLexEntry(id: string, patch: Partial<Pick<LexEntry, "label" | "value">>) {
  memo = {
    entries: memo.entries.map((e) =>
      e.id === id
        ? { ...e, ...patch, label: (patch.label ?? e.label).slice(0, 60), updatedAt: Date.now() }
        : e,
    ),
  };
  persist();
}

export function deleteLexEntry(id: string) {
  memo = { entries: memo.entries.filter((e) => e.id !== id) };
  persist();
}

export function bumpLexWeight(id: string) {
  memo = {
    entries: memo.entries.map((e) =>
      e.id === id ? { ...e, weight: e.weight + 1, updatedAt: Date.now() } : e,
    ),
  };
  persist();
}

/** Convert a lex entry to a chip for rendering. */
export function lexToChip(e: LexEntry): ChatChip {
  return { label: e.label, value: e.value };
}
