// AI-assisted resolver: brand+model+generation hints → modelCarId +
// modelGenerationRestylingFrameId via Storage.GetBrand / Storage.GetModelCar /
// Storage.GetModelGeneration. AI picks one option from real catalog lists at
// each step. Falls back to string match if AI is unavailable.

import { aiChatIdFor, chatCompletions } from "./aiApi";
import {
  CLICHE_PICK_BRAND,
  CLICHE_PICK_GENERATION,
  CLICHE_PICK_MODEL,
  parseJsonResponse,
  type GenerationFrameCandidate,
} from "./cliche";
import { rpc } from "./storageApi";
import type { Thread } from "./types";

interface BrandRow {
  id: number;
  name: string;
  country?: string | null;
}
interface ModelRow {
  id: number;
  name: string;
}

interface RestylingFrameRow {
  id: number;
  name?: string;
  yearStart?: number | string | null;
  yearEnd?: number | string | null;
  startYear?: number | string | null;
  endYear?: number | string | null;
}
interface RestylingRow {
  id: number;
  name?: string;
  yearStart?: number | string | null;
  yearEnd?: number | string | null;
  startYear?: number | string | null;
  endYear?: number | string | null;
  frames?: RestylingFrameRow[];
  restylingFrames?: RestylingFrameRow[];
  modelGenerationRestylingFrames?: RestylingFrameRow[];
}
interface GenerationRow {
  id: number;
  name?: string;
  yearStart?: number | string | null;
  yearEnd?: number | string | null;
  startYear?: number | string | null;
  endYear?: number | string | null;
  restylings?: RestylingRow[];
  modelGenerationRestylings?: RestylingRow[];
  frames?: RestylingFrameRow[];
  restylingFrames?: RestylingFrameRow[];
  modelGenerationRestylingFrames?: RestylingFrameRow[];
}

const brandCache = new Map<string, BrandRow[]>();
const modelCache = new Map<number, ModelRow[]>();
const generationCache = new Map<number, GenerationRow[]>();

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ё]/g, "е")
    .replace(/[^a-z0-9а-я]/gi, "")
    .trim();
}

function unwrap<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  const obj = r as { result?: T[] | { items?: T[] } } | null;
  const res = obj?.result;
  if (Array.isArray(res)) return res;
  if (res && Array.isArray((res as { items?: T[] }).items)) return (res as { items: T[] }).items;
  return [];
}

async function fetchBrands(search: string): Promise<BrandRow[]> {
  const key = norm(search);
  const hit = brandCache.get(key);
  if (hit) return hit;
  const r = await rpc<unknown>("Storage.GetBrand", { search });
  const list = unwrap<BrandRow>(r);
  brandCache.set(key, list);
  return list;
}

async function fetchModels(brandId: number): Promise<ModelRow[]> {
  const hit = modelCache.get(brandId);
  if (hit) return hit;
  const r = await rpc<unknown>("Storage.GetModelCar", { brandId });
  const list = unwrap<ModelRow>(r);
  modelCache.set(brandId, list);
  return list;
}

async function fetchGenerations(modelCarId: number): Promise<GenerationRow[]> {
  const hit = generationCache.get(modelCarId);
  if (hit) return hit;
  const r = await rpc<unknown>("Storage.GetModelGeneration", { modelCarId });
  const list = unwrap<GenerationRow>(r);
  generationCache.set(modelCarId, list);
  return list;
}

function asYear(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const m = v.match(/\d{4}/);
    if (m) return Number(m[0]);
  }
  return null;
}

function bestMatch<T extends { name?: string }>(rows: T[], target: string): T | undefined {
  if (!rows.length) return undefined;
  const t = norm(target);
  if (!t) return rows[0];
  const exact = rows.find((r) => norm(r.name ?? "") === t);
  if (exact) return exact;
  const starts = rows.find((r) => norm(r.name ?? "").startsWith(t));
  if (starts) return starts;
  const contains = rows.find((r) => {
    const n = norm(r.name ?? "");
    return n && (n.includes(t) || t.includes(n));
  });
  return contains ?? rows[0];
}

/** Flatten generation → restyling → frame into pickable candidates. */
function flattenFrames(generations: GenerationRow[]): GenerationFrameCandidate[] {
  const out: GenerationFrameCandidate[] = [];
  for (const g of generations) {
    const genName = g.name ?? `Поколение #${g.id}`;
    const genStart = asYear(g.yearStart) ?? asYear(g.startYear);
    const genEnd = asYear(g.yearEnd) ?? asYear(g.endYear);
    const restylings = g.modelGenerationRestylings ?? g.restylings ?? [];
    if (restylings.length === 0) {
      // generation may directly carry frames
      const frames =
        g.modelGenerationRestylingFrames ?? g.restylingFrames ?? g.frames ?? [];
      for (const f of frames) {
        out.push({
          frameId: f.id,
          generationName: genName,
          restylingName: f.name,
          yearStart: asYear(f.yearStart) ?? asYear(f.startYear) ?? genStart,
          yearEnd: asYear(f.yearEnd) ?? asYear(f.endYear) ?? genEnd,
        });
      }
      continue;
    }
    for (const r of restylings) {
      const rStart = asYear(r.yearStart) ?? asYear(r.startYear) ?? genStart;
      const rEnd = asYear(r.yearEnd) ?? asYear(r.endYear) ?? genEnd;
      const frames =
        r.modelGenerationRestylingFrames ?? r.restylingFrames ?? r.frames ?? [];
      if (frames.length === 0) {
        // some servers expose restyling as the leaf — synthesise a frame entry
        out.push({
          frameId: r.id,
          generationName: genName,
          restylingName: r.name ?? "Базовый",
          yearStart: rStart,
          yearEnd: rEnd,
        });
        continue;
      }
      for (const f of frames) {
        out.push({
          frameId: f.id,
          generationName: genName,
          restylingName: f.name ?? r.name,
          yearStart: asYear(f.yearStart) ?? asYear(f.startYear) ?? rStart,
          yearEnd: asYear(f.yearEnd) ?? asYear(f.endYear) ?? rEnd,
        });
      }
    }
  }
  return out;
}

export interface ResolvedCar {
  modelCarId: number | null;
  modelGenerationRestylingFrameId: number | null;
  brandName?: string;
  modelCarName?: string;
  generationLabel?: string;
  /** debug trace per step, for the assistant reply */
  trace: Array<{
    step: "brand" | "model" | "generation";
    candidates: number;
    pickedId: number | null;
    confidence: number;
    needsWeb: boolean;
    reason?: string;
  }>;
}

interface ResolveOpts {
  userText: string;
  brandHint?: string;
  modelHint?: string;
  generationHint?: string;
  year?: number;
  thread?: Thread;
}

async function aiPick<T>(
  thread: Thread | undefined,
  chatKey: string,
  cliche: string,
  userText: string,
  parser: (raw: unknown) => T | null,
): Promise<T | null> {
  if (!thread) return null;
  try {
    const id = aiChatIdFor(thread, chatKey);
    const res = await chatCompletions({ id, text: userText, cliche });
    const raw = parseJsonResponse<unknown>(res.content);
    return parser(raw);
  } catch {
    return null;
  }
}

/**
 * AI-assisted resolver. Uses string-match fallback if `opts.thread` is absent
 * or AI fails at any step. Caches lists per (brand,model).
 */
export async function resolveCar(
  brandHintOrName: string | undefined,
  modelHintOrName: string | undefined,
  year?: number,
  opts?: { thread?: Thread; userText?: string; generationHint?: string },
): Promise<ResolvedCar> {
  const empty: ResolvedCar = {
    modelCarId: null,
    modelGenerationRestylingFrameId: null,
    trace: [],
  };
  try {
    if (!brandHintOrName || !modelHintOrName) return empty;
    const thread = opts?.thread;
    const userText =
      opts?.userText ?? `${brandHintOrName} ${modelHintOrName} ${year ?? ""}`.trim();
    const generationHint = opts?.generationHint;
    const trace: ResolvedCar["trace"] = [];

    // [1] Brand
    const brands = await fetchBrands(brandHintOrName);
    if (!brands.length) return { ...empty, trace };
    let brand: BrandRow | undefined;
    let brandConf = 0;
    const brandPick = await aiPick<{
      brandId: number | null;
      confidence: number;
      needsWeb: boolean;
      reason?: string;
    }>(
      thread,
      "resolveCar:brand",
      CLICHE_PICK_BRAND(userText, brandHintOrName, brands),
      userText,
      (raw) => {
        const r = raw as { brandId?: unknown; confidence?: unknown; needsWeb?: unknown; reason?: unknown } | null;
        if (!r || typeof r.brandId !== "number") return null;
        return {
          brandId: r.brandId,
          confidence: typeof r.confidence === "number" ? r.confidence : 0,
          needsWeb: r.needsWeb === true,
          reason: typeof r.reason === "string" ? r.reason : undefined,
        };
      },
    );
    if (brandPick?.brandId) {
      brand = brands.find((b) => b.id === brandPick.brandId);
      brandConf = brandPick.confidence;
    }
    if (!brand) {
      brand = bestMatch(brands, brandHintOrName);
      brandConf = brand ? 0.4 : 0;
    }
    trace.push({
      step: "brand",
      candidates: brands.length,
      pickedId: brand?.id ?? null,
      confidence: brandConf,
      needsWeb: brandPick?.needsWeb ?? false,
      reason: brandPick?.reason,
    });
    if (!brand) return { ...empty, trace };

    // [2] Model
    const models = await fetchModels(brand.id);
    if (!models.length) {
      return { ...empty, trace, brandName: brand.name };
    }
    let model: ModelRow | undefined;
    let modelConf = 0;
    const modelPick = await aiPick<{
      modelCarId: number | null;
      confidence: number;
      needsWeb: boolean;
      reason?: string;
    }>(
      thread,
      "resolveCar:model",
      CLICHE_PICK_MODEL(userText, brand.name, modelHintOrName, models),
      userText,
      (raw) => {
        const r = raw as {
          modelCarId?: unknown;
          confidence?: unknown;
          needsWeb?: unknown;
          reason?: unknown;
        } | null;
        if (!r || typeof r.modelCarId !== "number") return null;
        return {
          modelCarId: r.modelCarId,
          confidence: typeof r.confidence === "number" ? r.confidence : 0,
          needsWeb: r.needsWeb === true,
          reason: typeof r.reason === "string" ? r.reason : undefined,
        };
      },
    );
    if (modelPick?.modelCarId) {
      model = models.find((m) => m.id === modelPick.modelCarId);
      modelConf = modelPick.confidence;
    }
    if (!model) {
      model = bestMatch(models, modelHintOrName);
      modelConf = model ? 0.4 : 0;
    }
    trace.push({
      step: "model",
      candidates: models.length,
      pickedId: model?.id ?? null,
      confidence: modelConf,
      needsWeb: modelPick?.needsWeb ?? false,
      reason: modelPick?.reason,
    });
    if (!model) return { ...empty, trace, brandName: brand.name };

    const partial: ResolvedCar = {
      modelCarId: model.id,
      modelGenerationRestylingFrameId: null,
      brandName: brand.name,
      modelCarName: model.name,
      trace,
    };

    // [3] Generation/restyling/frame (optional — only if we have hints)
    if (!year && !generationHint) return partial;
    let frames: GenerationFrameCandidate[] = [];
    try {
      const gens = await fetchGenerations(model.id);
      frames = flattenFrames(gens);
    } catch {
      return partial;
    }
    if (!frames.length) return partial;

    let frame: GenerationFrameCandidate | undefined;
    let frameConf = 0;
    const framePick = await aiPick<{
      frameId: number | null;
      confidence: number;
      needsWeb: boolean;
      reason?: string;
    }>(
      thread,
      "resolveCar:generation",
      CLICHE_PICK_GENERATION(userText, brand.name, model.name, year, generationHint, frames),
      userText,
      (raw) => {
        const r = raw as { frameId?: unknown; confidence?: unknown; needsWeb?: unknown; reason?: unknown } | null;
        if (!r || typeof r.frameId !== "number") return null;
        return {
          frameId: r.frameId,
          confidence: typeof r.confidence === "number" ? r.confidence : 0,
          needsWeb: r.needsWeb === true,
          reason: typeof r.reason === "string" ? r.reason : undefined,
        };
      },
    );
    if (framePick?.frameId) {
      frame = frames.find((f) => f.frameId === framePick.frameId);
      frameConf = framePick.confidence;
    }
    if (!frame && year) {
      frame =
        frames.find(
          (f) =>
            (f.yearStart == null || year >= f.yearStart) &&
            (f.yearEnd == null || year <= f.yearEnd),
        ) ?? frames[0];
      frameConf = frame ? 0.3 : 0;
    }
    trace.push({
      step: "generation",
      candidates: frames.length,
      pickedId: frame?.frameId ?? null,
      confidence: frameConf,
      needsWeb: framePick?.needsWeb ?? false,
      reason: framePick?.reason,
    });

    if (!frame) return partial;
    const label = [frame.generationName, frame.restylingName]
      .filter(Boolean)
      .join(" / ");
    const years =
      frame.yearStart || frame.yearEnd
        ? ` (${frame.yearStart ?? "?"}–${frame.yearEnd ?? "н.в."})`
        : "";
    return {
      ...partial,
      modelGenerationRestylingFrameId: frame.frameId,
      generationLabel: `${label}${years}`,
    };
  } catch {
    return empty;
  }
}

/** Backwards-compatible shortcut returning only modelCarId. */
export async function resolveModelCarId(
  brandName: string | undefined,
  modelName: string | undefined,
): Promise<number | null> {
  const r = await resolveCar(brandName, modelName);
  return r.modelCarId;
}
