// Helpers for the chat-based inspection step: current section/element pointer,
// finding accessor/mutator, and per-section progress counters.
//
// The data model lives in `InspectionStep` (types.ts). The chat UI works with
// a "current section + current element" cursor, plus structured findings keyed
// by `${section}.${elementId}`.

import type {
  InspectionElementFinding,
  InspectionStep,
  PendingTagName,
  ReportDraft,
} from "./types";
import {
  INSPECTION_SECTIONS,
  ZONE_TO_SECTION,
  findingKey,
  getSection,
  type InspectionElement,
  type InspectionSection,
  type SectionSnake,
} from "./inspectionSections";

export interface InspectionCursor {
  section: InspectionSection;
  element: InspectionElement;
}

/** Resolve the active section/element with sensible fallbacks. */
export function getCursor(draft: ReportDraft): InspectionCursor {
  const ins = draft.inspectionStep;
  const snake =
    (ins.currentSection as SectionSnake | undefined) ??
    (ins.currentZone ? ZONE_TO_SECTION[ins.currentZone] : undefined) ??
    INSPECTION_SECTIONS[0].snake;
  const section = getSection(snake) ?? INSPECTION_SECTIONS[0];
  const elementId = ins.currentElementId ?? section.elements[0].id;
  const element =
    section.elements.find((e) => e.id === elementId) ?? section.elements[0];
  return { section, element };
}

export function getFinding(
  ins: InspectionStep,
  section: SectionSnake,
  elementId: string,
): InspectionElementFinding | undefined {
  return ins.findings?.[findingKey(section, elementId)];
}

/** Mutate-in-place helper for use inside `updateThread(t => { ... })`. */
export function upsertFinding(
  ins: InspectionStep,
  section: SectionSnake,
  elementId: string,
  patch: (f: InspectionElementFinding) => void,
): InspectionElementFinding {
  if (!ins.findings) ins.findings = {};
  const key = findingKey(section, elementId);
  const next: InspectionElementFinding = ins.findings[key] ?? {
    section,
    elementId,
  };
  patch(next);
  ins.findings[key] = next;
  return next;
}

export function clearFinding(
  ins: InspectionStep,
  section: SectionSnake,
  elementId: string,
): void {
  if (!ins.findings) return;
  delete ins.findings[findingKey(section, elementId)];
}

/** Status used for element-chip badges. */
export type ElementStatus =
  | "empty"
  | "ok"
  | "minor"
  | "serious"
  | "noteOnly";

export function elementStatus(
  ins: InspectionStep,
  section: SectionSnake,
  elementId: string,
): ElementStatus {
  const f = getFinding(ins, section, elementId);
  if (!f) return "empty";
  if ((f.seriousDamageTagIds?.length ?? 0) > 0) return "serious";
  if ((f.noSeriousDamageTagIds?.length ?? 0) > 0) return "minor";
  if (f.noDamage === true) return "ok";
  if (f.note || (f.pendingTagNames?.length ?? 0) > 0) return "noteOnly";
  return "empty";
}

export interface SectionProgress {
  /** Сколько элементов раздела имеют finding с осмысленным результатом. */
  filled: number;
  total: number;
}

export function sectionProgress(
  ins: InspectionStep,
  section: InspectionSection,
): SectionProgress {
  let filled = 0;
  for (const el of section.elements) {
    const st = elementStatus(ins, section.snake, el.id);
    if (st !== "empty") filled += 1;
  }
  return { filled, total: section.elements.length };
}

export function photosFor(
  ins: InspectionStep,
  section: SectionSnake,
  elementId?: string,
): number {
  return ins.photos.filter(
    (p) =>
      p.section === section &&
      (elementId === undefined || p.elementId === elementId),
  ).length;
}

/** Toggle a tag id inside a finding (serious or non_serious bucket). */
export function toggleTag(
  f: InspectionElementFinding,
  bucket: "serious" | "non_serious",
  id: number,
): void {
  const key =
    bucket === "serious" ? "seriousDamageTagIds" : "noSeriousDamageTagIds";
  const list = new Set(f[key] ?? []);
  if (list.has(id)) list.delete(id);
  else list.add(id);
  f[key] = [...list];
  // having any tag implies the element has issues, so flip noDamage off.
  if (list.size > 0) f.noDamage = false;
}

export function togglePendingTag(
  f: InspectionElementFinding,
  name: string,
  severity: "serious" | "non_serious",
): void {
  const list = [...(f.pendingTagNames ?? [])];
  const trimmed = name.trim();
  if (!trimmed) return;
  const idx = list.findIndex(
    (p) => p.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (idx >= 0) list.splice(idx, 1);
  else list.push({ name: trimmed, severity } as PendingTagName);
  f.pendingTagNames = list;
  if (list.length > 0) f.noDamage = false;
}

/** Find the next element without a finding within the section; wraps to next section. */
export function nextEmptyLocation(
  ins: InspectionStep,
  fromSection: SectionSnake,
  fromElementId: string,
): InspectionCursor | null {
  const startSecIdx = INSPECTION_SECTIONS.findIndex(
    (s) => s.snake === fromSection,
  );
  for (let i = 0; i < INSPECTION_SECTIONS.length; i += 1) {
    const sec = INSPECTION_SECTIONS[(startSecIdx + i) % INSPECTION_SECTIONS.length];
    const startElIdx =
      i === 0 ? sec.elements.findIndex((e) => e.id === fromElementId) + 1 : 0;
    for (let j = startElIdx; j < sec.elements.length; j += 1) {
      const el = sec.elements[j];
      if (elementStatus(ins, sec.snake, el.id) === "empty") {
        return { section: sec, element: el };
      }
    }
  }
  return null;
}
