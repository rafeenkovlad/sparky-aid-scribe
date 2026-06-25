// Resolve brand + model names → modelCarId via Storage.GetBrand / Storage.GetModelCar.
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

const brandCache = new Map<string, BrandRow[]>();
const modelCache = new Map<string, ModelRow[]>();

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ё]/g, "е")
    .replace(/[^a-z0-9а-я]/gi, "")
    .trim();
}

async function fetchBrands(search: string): Promise<BrandRow[]> {
  const key = norm(search);
  const hit = brandCache.get(key);
  if (hit) return hit;
  const r = await rpc<{ result?: BrandRow[] } | BrandRow[]>("Storage.GetBrand", { search });
  const list = ((r as { result?: BrandRow[] }).result ?? (r as BrandRow[])) || [];
  brandCache.set(key, list);
  return list;
}

async function fetchModels(brandId: number, search: string): Promise<ModelRow[]> {
  const key = `${brandId}::${norm(search)}`;
  const hit = modelCache.get(key);
  if (hit) return hit;
  const r = await rpc<{ result?: ModelRow[] } | ModelRow[]>("Storage.GetModelCar", {
    search,
    brandId,
  });
  const list = ((r as { result?: ModelRow[] }).result ?? (r as ModelRow[])) || [];
  modelCache.set(key, list);
  return list;
}

function bestMatch<T extends { name: string }>(rows: T[], target: string): T | undefined {
  if (!rows.length) return undefined;
  const t = norm(target);
  const exact = rows.find((r) => norm(r.name) === t);
  if (exact) return exact;
  const starts = rows.find((r) => norm(r.name).startsWith(t));
  if (starts) return starts;
  const contains = rows.find((r) => norm(r.name).includes(t) || t.includes(norm(r.name)));
  return contains ?? rows[0];
}

/**
 * Resolve brandName + modelName → modelCarId. Returns null if anything fails
 * (network error, no brand, no model). Never throws.
 */
export async function resolveModelCarId(
  brandName: string | undefined,
  modelName: string | undefined,
): Promise<number | null> {
  try {
    if (!brandName || !modelName) return null;
    const brands = await fetchBrands(brandName);
    const brand = bestMatch(brands, brandName);
    if (!brand) return null;
    const models = await fetchModels(brand.id, modelName);
    const model = bestMatch(models, modelName);
    return model?.id ?? null;
  } catch {
    return null;
  }
}
