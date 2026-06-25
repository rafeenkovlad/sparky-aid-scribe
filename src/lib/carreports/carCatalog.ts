// Resolve brand + model + year → modelCarId and modelGenerationRestylingFrameId
// via Storage.GetBrand / Storage.GetModelCar / Storage.GetModelGeneration.
// Results are cached in-memory per session.

import { rpc } from "./storageApi";

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

function asYear(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const m = v.match(/\d{4}/);
    if (m) return Number(m[0]);
  }
  return null;
}

function yearMatches(
  start: unknown,
  end: unknown,
  startAlt: unknown,
  endAlt: unknown,
  year: number,
): boolean {
  const s = asYear(start) ?? asYear(startAlt);
  const e = asYear(end) ?? asYear(endAlt);
  if (s == null && e == null) return false;
  if (s != null && year < s) return false;
  if (e != null && year > e) return false;
  return true;
}

export interface ResolvedCar {
  modelCarId: number | null;
  modelGenerationRestylingFrameId: number | null;
}

/**
 * Resolve brandName + modelName (+ optional year) → modelCarId and best
 * matching modelGenerationRestylingFrameId. Returns nulls on any failure.
 */
export async function resolveCar(
  brandName: string | undefined,
  modelName: string | undefined,
  year?: number,
): Promise<ResolvedCar> {
  const empty: ResolvedCar = { modelCarId: null, modelGenerationRestylingFrameId: null };
  try {
    if (!brandName || !modelName) return empty;
    const brands = await fetchBrands(brandName);
    const brand = bestMatch(brands, brandName);
    if (!brand) return empty;
    const models = await fetchModels(brand.id);
    const model = bestMatch(models, modelName);
    if (!model) return empty;

    let frameId: number | null = null;
    if (year && Number.isFinite(year)) {
      try {
        const gens = await fetchGenerations(model.id);
        const gen =
          gens.find((g) =>
            yearMatches(g.yearStart, g.yearEnd, g.startYear, g.endYear, year),
          ) ?? gens[0];
        if (gen) {
          const restylings = gen.modelGenerationRestylings ?? gen.restylings ?? [];
          const restyling =
            restylings.find((r) =>
              yearMatches(r.yearStart, r.yearEnd, r.startYear, r.endYear, year),
            ) ?? restylings[0];
          const frames =
            restyling?.modelGenerationRestylingFrames ??
            restyling?.restylingFrames ??
            restyling?.frames ??
            gen.modelGenerationRestylingFrames ??
            gen.restylingFrames ??
            gen.frames ??
            [];
          const frame =
            frames.find((f) =>
              yearMatches(f.yearStart, f.yearEnd, f.startYear, f.endYear, year),
            ) ?? frames[0];
          if (frame?.id) frameId = frame.id;
        }
      } catch {
        // ignore — fall back to modelCarId only
      }
    }

    return { modelCarId: model.id, modelGenerationRestylingFrameId: frameId };
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
