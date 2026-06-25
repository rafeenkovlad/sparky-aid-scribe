// AI-assisted resolver: brand+model+generation hints → modelCarId +
// modelGenerationRestylingFrameId via Storage.GetBrand / Storage.GetModelCar /
// Storage.GetModelGeneration. AI picks one option from real catalog lists at
// each step. When AI is unsure or the catalog list is empty, falls back to a
// Firecrawl web search and re-asks the AI with the web context. Falls back to
// string match if AI is unavailable.

import { aiChatIdFor, chatCompletions } from "./aiApi";
import {
  CLICHE_CANONICAL_BRAND,
  CLICHE_PICK_BRAND,
  CLICHE_PICK_GENERATION,
  CLICHE_PICK_MODEL,
  parseJsonResponse,
  type GenerationFrameCandidate,
} from "./cliche";
import { rpc } from "./storageApi";
import type { Thread } from "./types";
import { webSearchContext } from "./webSearch";

const LOW_CONF = 0.5;


/** Common image-url aliases that carreports endpoints have been seen to use. */
function pickImageUrl(row: Record<string, unknown> | null | undefined): string | undefined {
  if (!row) return undefined;
  const keys = [
    "urlImage",
    "urlLogo",
    "urlPhoto",
    "urlPicture",
    "urlPreview",
    "urlAvatar",
    "image",
    "logo",
    "photo",
    "picture",
    "preview",
    "url",
  ];
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
  }
  // photos: [{size:'m'|'s', urlX1, urlX2}]
  const photos = row["photos"];
  if (Array.isArray(photos) && photos.length) {
    const pickFrom = (p: unknown): string | undefined => {
      const o = p as { urlX2?: unknown; urlX1?: unknown } | null;
      if (!o) return undefined;
      if (typeof o.urlX2 === "string" && /^https?:\/\//.test(o.urlX2)) return o.urlX2;
      if (typeof o.urlX1 === "string" && /^https?:\/\//.test(o.urlX1)) return o.urlX1;
      return undefined;
    };
    const medium = photos.find(
      (p) => (p as { size?: string } | null)?.size === "m",
    );
    return pickFrom(medium) ?? pickFrom(photos[0]);
  }
  return undefined;
}


interface BrandRow {
  id: number;
  name: string;
  country?: string | null;
  urlImage?: string;
}
interface ModelRow {
  id: number;
  name: string;
  urlImage?: string;
}

type ApiDate = { date?: string } | string | number | null | undefined;

interface ApiPhoto {
  id?: number;
  size?: string;
  urlX1?: string;
  urlX2?: string;
}

interface RestylingFrameRow {
  id: number;
  name?: string;
  frame?: string;
  yearStart?: ApiDate;
  yearEnd?: ApiDate;
  startYear?: ApiDate;
  endYear?: ApiDate;
  urlImage?: string;
  photos?: ApiPhoto[];
}
interface RestylingRow {
  id: number;
  name?: string;
  /** numeric restyling index as string ("0" = базовый, "1" = первый рестайлинг) */
  restyling?: string | number;
  yearStart?: ApiDate;
  yearEnd?: ApiDate;
  startYear?: ApiDate;
  endYear?: ApiDate;
  frames?: RestylingFrameRow[];
  restylingFrames?: RestylingFrameRow[];
  modelGenerationRestylingFrames?: RestylingFrameRow[];
  urlImage?: string;
  photos?: ApiPhoto[];
}
interface GenerationRow {
  id: number;
  name?: string;
  /** numeric generation index (1, 2, 3 ...) */
  generation?: number;
  yearStart?: ApiDate;
  yearEnd?: ApiDate;
  startYear?: ApiDate;
  endYear?: ApiDate;
  restylings?: RestylingRow[];
  modelGenerationRestylings?: RestylingRow[];
  frames?: RestylingFrameRow[];
  restylingFrames?: RestylingFrameRow[];
  modelGenerationRestylingFrames?: RestylingFrameRow[];
  urlImage?: string;
  photos?: ApiPhoto[];
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
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const m = v.match(/\d{4}/);
    if (m) return Number(m[0]);
    return null;
  }
  if (typeof v === "object") {
    const d = (v as { date?: unknown }).date;
    if (typeof d === "string") {
      const m = d.match(/\d{4}/);
      if (m) return Number(m[0]);
    }
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

/** Damerau-Levenshtein-ish simple distance. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

/** Top N rows by name similarity to target (excluding excludeId). */
function topMatches<T extends { id: number; name?: string }>(
  rows: T[],
  target: string,
  n: number,
  excludeId?: number,
): T[] {
  if (!rows.length) return [];
  const t = norm(target);
  const scored = rows
    .filter((r) => r.id !== excludeId && r.name)
    .map((r) => {
      const nm = norm(r.name ?? "");
      let score = editDistance(t, nm);
      if (nm.startsWith(t) || t.startsWith(nm)) score -= 2;
      if (nm.includes(t) || t.includes(nm)) score -= 1;
      return { r, score };
    })
    .sort((a, b) => a.score - b.score);
  return scored.slice(0, n).map((s) => s.r);
}

/** Flatten generation → restyling → frame into pickable candidates. */
function flattenFrames(generations: GenerationRow[]): GenerationFrameCandidate[] {
  const out: GenerationFrameCandidate[] = [];
  // Сортируем поколения по возрастанию номера (1, 2, 3 ...) если задан.
  const gens = [...generations].sort((a, b) => {
    const an = typeof a.generation === "number" ? a.generation : 0;
    const bn = typeof b.generation === "number" ? b.generation : 0;
    return an - bn;
  });
  for (const g of gens) {
    const genStart = asYear(g.yearStart) ?? asYear(g.startYear);
    const genEnd = asYear(g.yearEnd) ?? asYear(g.endYear);
    const genNum = typeof g.generation === "number" ? g.generation : undefined;
    const genName =
      (g.name && g.name.trim()) ||
      (genNum != null ? `Поколение ${genNum}` :
        (genStart || genEnd ? `Поколение ${genStart ?? "?"}–${genEnd ?? "н.в."}` : ""));
    const genImg = pickImageUrl(g as unknown as Record<string, unknown>);
    const restylings = g.modelGenerationRestylings ?? g.restylings ?? [];
    if (restylings.length === 0) {
      const frames =
        g.modelGenerationRestylingFrames ?? g.restylingFrames ?? g.frames ?? [];
      for (const f of frames) {
        out.push({
          frameId: f.id,
          generationName: genName,
          restylingName: f.name ?? f.frame,
          generationNumber: genNum,
          restylingNumber: 0,
          yearStart: asYear(f.yearStart) ?? asYear(f.startYear) ?? genStart,
          yearEnd: asYear(f.yearEnd) ?? asYear(f.endYear) ?? genEnd,
          urlImage: pickImageUrl(f as unknown as Record<string, unknown>) ?? genImg,
        });
      }
      continue;
    }
    // Сортируем рестайлинги по возрастанию номера (0 = базовый, 1 = первый рестайлинг ...).
    const sortedR = [...restylings].sort((a, b) => {
      const an = Number(a.restyling ?? 999);
      const bn = Number(b.restyling ?? 999);
      return an - bn;
    });
    for (const r of sortedR) {
      const rStart = asYear(r.yearStart) ?? asYear(r.startYear) ?? genStart;
      const rEnd = asYear(r.yearEnd) ?? asYear(r.endYear) ?? genEnd;
      const rImg = pickImageUrl(r as unknown as Record<string, unknown>) ?? genImg;
      const rNum = r.restyling != null && r.restyling !== "" ? Number(r.restyling) : undefined;
      const rName =
        r.name ??
        (rNum === 0 ? "Базовый" : rNum != null ? `Рестайлинг ${rNum}` : "Базовый");
      const frames =
        r.modelGenerationRestylingFrames ?? r.restylingFrames ?? r.frames ?? [];
      if (frames.length === 0) {
        out.push({
          frameId: r.id,
          generationName: genName,
          restylingName: rName,
          generationNumber: genNum,
          restylingNumber: rNum,
          yearStart: rStart,
          yearEnd: rEnd,
          urlImage: rImg,
        });
        continue;
      }
      for (const f of frames) {
        out.push({
          frameId: f.id,
          generationName: genName,
          restylingName: f.name ?? f.frame ?? rName,
          generationNumber: genNum,
          restylingNumber: rNum,
          yearStart: asYear(f.yearStart) ?? asYear(f.startYear) ?? rStart,
          yearEnd: asYear(f.yearEnd) ?? asYear(f.endYear) ?? rEnd,
          urlImage: pickImageUrl(f as unknown as Record<string, unknown>) ?? rImg,
        });
      }
    }
  }
  return out;
}

export interface CatalogSuggestion {
  label: string;
  value: string;
  group: "brand" | "model" | "generation";
  image?: string;
  description?: string;
}

export interface ResolvedCar {
  modelCarId: number | null;
  modelGenerationRestylingFrameId: number | null;
  brandName?: string;
  modelCarName?: string;
  generationLabel?: string;
  /** image URLs from the catalogue, when available */
  brandImage?: string;
  modelImage?: string;
  generationImage?: string;
  /** clickable suggestions when name lookup is uncertain or has alternatives */
  suggestions?: CatalogSuggestion[];
  /** true when user explicitly named a generation/restyling that we couldn't find */
  generationNotFound?: boolean;
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
    let brands = await fetchBrands(brandHintOrName);
    let brand: BrandRow | undefined;
    let brandConf = 0;
    let brandWebUsed = false;
    let brandReason: string | undefined;

    const pickBrand = async (webContext?: string) =>
      aiPick<{
        brandId: number | null;
        confidence: number;
        needsWeb: boolean;
        reason?: string;
      }>(
        thread,
        "resolveCar:brand",
        CLICHE_PICK_BRAND(userText, brandHintOrName, brands, webContext),
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

    let brandPick = brands.length ? await pickBrand() : null;
    if (brandPick?.brandId) {
      brand = brands.find((b) => b.id === brandPick!.brandId);
      brandConf = brandPick.confidence;
      brandReason = brandPick.reason;
    }

    // Web fallback: empty catalog list OR low confidence OR AI explicitly asked
    const needBrandWeb = !brand || brandConf < LOW_CONF || brandPick?.needsWeb === true || brands.length === 0;
    if (needBrandWeb) {
      const ctx = await webSearchContext(
        `site:drom.ru ${brandHintOrName} автомобиль марка производитель`,
        5,
      );
      if (ctx) {
        brandWebUsed = true;
        // If catalog returned nothing, ask AI to extract canonical brand name from web → refetch
        if (brands.length === 0) {
          const canonical = await aiPick<{ brandName: string; confidence: number }>(
            thread,
            "resolveCar:brand:canonical",
            CLICHE_CANONICAL_BRAND(brandHintOrName, ctx),
            brandHintOrName,
            (raw) => {
              const r = raw as { brandName?: unknown; confidence?: unknown } | null;
              if (!r || typeof r.brandName !== "string" || !r.brandName.trim()) return null;
              return {
                brandName: r.brandName.trim(),
                confidence: typeof r.confidence === "number" ? r.confidence : 0,
              };
            },
          );
          if (canonical?.brandName) {
            brands = await fetchBrands(canonical.brandName);
          }
        }
        // Re-ask AI to pick from (possibly refreshed) list with web context
        if (brands.length) {
          const retry = await pickBrand(ctx);
          if (retry?.brandId) {
            const candidate = brands.find((b) => b.id === retry.brandId);
            if (candidate && retry.confidence >= brandConf) {
              brand = candidate;
              brandConf = retry.confidence;
              brandReason = retry.reason;
              brandPick = retry;
            }
          }
        }
      }
    }
    if (!brand && brands.length) {
      brand = bestMatch(brands, brandHintOrName);
      brandConf = brand ? 0.4 : 0;
    }
    trace.push({
      step: "brand",
      candidates: brands.length,
      pickedId: brand?.id ?? null,
      confidence: brandConf,
      needsWeb: brandWebUsed,
      reason: brandReason,
    });
    if (!brand) return { ...empty, trace };

    // [2] Model
    const models = await fetchModels(brand.id);
    if (!models.length) {
      return { ...empty, trace, brandName: brand.name };
    }
    let model: ModelRow | undefined;
    let modelConf = 0;
    let modelWebUsed = false;
    let modelReason: string | undefined;

    const pickModel = async (webContext?: string) =>
      aiPick<{
        modelCarId: number | null;
        confidence: number;
        needsWeb: boolean;
        reason?: string;
      }>(
        thread,
        "resolveCar:model",
        CLICHE_PICK_MODEL(userText, brand!.name, modelHintOrName, models, webContext),
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

    let modelPick = await pickModel();
    if (modelPick?.modelCarId) {
      model = models.find((m) => m.id === modelPick!.modelCarId);
      modelConf = modelPick.confidence;
      modelReason = modelPick.reason;
    }
    if (!model || modelConf < LOW_CONF || modelPick?.needsWeb === true) {
      const ctx = await webSearchContext(
        `site:drom.ru ${brand.name} ${modelHintOrName} модель характеристики поколения`,
        5,
      );
      if (ctx) {
        modelWebUsed = true;
        const retry = await pickModel(ctx);
        if (retry?.modelCarId) {
          const candidate = models.find((m) => m.id === retry.modelCarId);
          if (candidate && retry.confidence >= modelConf) {
            model = candidate;
            modelConf = retry.confidence;
            modelReason = retry.reason;
            modelPick = retry;
          }
        }
      }
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
      needsWeb: modelWebUsed,
      reason: modelReason,
    });
    if (!model) return { ...empty, trace, brandName: brand.name };

    const brandImage = pickImageUrl(brand as unknown as Record<string, unknown>);
    const modelImage = pickImageUrl(model as unknown as Record<string, unknown>);

    // Соберём подсказки-чипы при низкой уверенности подбора (опечатки и т.п.).
    const suggestions: CatalogSuggestion[] = [];
    if (brandConf < 0.8) {
      for (const b of topMatches(brands, brandHintOrName, 3, brand.id)) {
        suggestions.push({
          group: "brand",
          label: `Марка: ${b.name}`,
          value: `Марка: ${b.name}`,
        });
      }
    }
    if (modelConf < 0.8) {
      for (const m of topMatches(models, modelHintOrName, 3, model.id)) {
        suggestions.push({
          group: "model",
          label: `Модель: ${m.name}`,
          value: `Модель: ${brand.name} ${m.name}`,
        });
      }
    }

    const partial: ResolvedCar = {
      modelCarId: model.id,
      modelGenerationRestylingFrameId: null,
      brandName: brand.name,
      modelCarName: model.name,
      brandImage,
      modelImage,
      ...(suggestions.length ? { suggestions } : {}),
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
    let frameWebUsed = false;
    let frameReason: string | undefined;

    const pickFrame = async (webContext?: string) =>
      aiPick<{
        frameId: number | null;
        confidence: number;
        needsWeb: boolean;
        reason?: string;
      }>(
        thread,
        "resolveCar:generation",
        CLICHE_PICK_GENERATION(userText, brand!.name, model!.name, year, generationHint, frames, webContext),
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

    // Детерминированный отбор по году + ordinal в подсказке/тексте.
    // «поколение 2», «2 поколение», «II», «рестайлинг 1» → берём N-е по списку
    // из Storage.GetModelGeneration. Если такого нет — не подбираем (не нашли).
    const parseOrdinal = (s: string, keyword: RegExp): number | null => {
      const lc = s.toLowerCase().replace(/ё/g, "е");
      // «поколение 2», «2-е поколение», «2 поколение»
      const re1 = new RegExp(`${keyword.source}\\s*(\\d+)`, "i");
      const re2 = new RegExp(`(\\d+)[-\\s]*(?:е|й|ое|ая)?\\s*${keyword.source}`, "i");
      const roman = new RegExp(`${keyword.source}\\s*(i{1,3}|iv|v|vi{0,3})\\b`, "i");
      const m = re1.exec(lc) ?? re2.exec(lc) ?? roman.exec(lc);
      if (!m) return null;
      const v = m[1];
      if (/^\d+$/.test(v)) return Number(v);
      const map: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8 };
      return map[v.toLowerCase()] ?? null;
    };
    const hintAndText = `${generationHint ?? ""} ${userText}`;
    const genOrd = parseOrdinal(hintAndText, /поколени[еяюй]/);
    const restOrd = parseOrdinal(hintAndText, /рестайлинг[а-я]*/);

    // Группируем frames по фактическому номеру поколения из API (`generation`).
    // Если номера нет — используем имя как ключ; порядок сохраняется (sortedFrames
    // уже отсортированы по возрастанию номера).
    const genGroups: {
      key: string;
      number?: number;
      name: string;
      items: GenerationFrameCandidate[];
    }[] = [];
    for (const f of frames) {
      const key =
        f.generationNumber != null ? `#${f.generationNumber}` : (f.generationName ?? "");
      const g = genGroups.find((x) => x.key === key);
      if (g) g.items.push(f);
      else
        genGroups.push({
          key,
          number: f.generationNumber,
          name: f.generationName ?? key,
          items: [f],
        });
    }

    let notFound = false;
    if (genOrd != null) {
      // Сначала пробуем найти по реальному номеру поколения из API.
      let group = genGroups.find((g) => g.number === genOrd);
      // Фолбэк: N-е по порядку (если API не вернул номер).
      if (!group) group = genGroups[genOrd - 1];
      if (!group) {
        notFound = true;
      } else {
        let picked: GenerationFrameCandidate | undefined;
        if (restOrd != null) {
          picked = group.items.find((f) => f.restylingNumber === restOrd);
          if (!picked) picked = group.items[restOrd];
          if (!picked) {
            notFound = true;
          }
        } else {
          // По умолчанию — базовый (restyling = 0), иначе первый.
          picked =
            group.items.find((f) => f.restylingNumber === 0) ?? group.items[0];
        }
        if (picked) {
          frame = picked;
          frameConf = 0.95;
          frameReason = `Поколение #${genOrd}${restOrd != null ? `, рестайлинг #${restOrd}` : " (базовый)"}`;
        }
      }
    }

    if (!frame && !notFound) {
      // Фолбэк: подсказка по тексту/году.
      const hintNorm = generationHint ? norm(generationHint) : "";
      const byYear = year
        ? frames.filter(
            (f) =>
              (f.yearStart == null || year >= f.yearStart) &&
              (f.yearEnd == null || year <= f.yearEnd),
          )
        : frames.slice();
      const pool = byYear.length ? byYear : frames;
      if (hintNorm) {
        frame = pool.find((f) => {
          const n = norm(`${f.generationName ?? ""} ${f.restylingName ?? ""}`);
          return n.includes(hintNorm) || hintNorm.includes(n);
        });
        if (frame) {
          frameConf = 0.8;
          frameReason = "Подбор по подсказке/году из Storage.GetModelGeneration";
        }
      }
      if (!frame && pool.length === 1) {
        frame = pool[0];
        frameConf = 0.7;
        frameReason = "Единственный кандидат по году";
      }
      if (!frame) {
        const framePick = await pickFrame();
        if (framePick?.frameId) {
          frame = frames.find((f) => f.frameId === framePick.frameId);
          frameConf = framePick.confidence;
          frameReason = framePick.reason;
        }
      }
    }
    trace.push({
      step: "generation",
      candidates: frames.length,
      pickedId: frame?.frameId ?? null,
      confidence: frameConf,
      needsWeb: frameWebUsed,
      reason: frameReason,
    });


    // Сформируем список чипов со всеми поколениями/рестайлингами — пригодится
    // и когда не нашли (показать варианты), и когда нашли (позволить поправить).
    const buildGenChips = (): CatalogSuggestion[] => {
      const out: CatalogSuggestion[] = [];
      for (const group of genGroups) {
        const gNum = group.number;
        const multi = group.items.length > 1;
        for (const f of group.items) {
          const years =
            f.yearStart || f.yearEnd
              ? `${f.yearStart ?? "?"}–${f.yearEnd ?? "н.в."}`
              : "";
          const rNum = f.restylingNumber;
          const genLabel = gNum != null ? `Поколение ${gNum}` : (group.name || "Поколение");
          const restLabel = multi
            ? rNum === 0
              ? " · базовый"
              : rNum != null
                ? ` · рестайлинг ${rNum}`
                : ` · ${f.restylingName ?? ""}`
            : "";
          const value =
            multi && rNum != null
              ? `Поколение ${gNum ?? "?"}, рестайлинг ${rNum}`
              : `Поколение ${gNum ?? "?"}`;
          out.push({
            group: "generation",
            label: `${genLabel}${restLabel}`,
            value,
            image: f.urlImage,
            description: years,
          });
          if (out.length >= 12) return out;
        }
      }
      return out;
    };

    if (!frame) {
      return {
        ...partial,
        generationNotFound: notFound,
        suggestions: [...(partial.suggestions ?? []), ...buildGenChips()],
      };
    }
    const label = [frame.generationName, frame.restylingName]
      .filter(Boolean)
      .join(" / ");
    const years =
      frame.yearStart || frame.yearEnd
        ? ` (${frame.yearStart ?? "?"}–${frame.yearEnd ?? "н.в."})`
        : "";
    const fullLabel = `${label}${years}`.trim();
    return {
      ...partial,
      modelGenerationRestylingFrameId: frame.frameId,
      ...(fullLabel ? { generationLabel: fullLabel } : {}),
      generationImage: frame.urlImage,
      // Покажем все варианты — пользователь может одним кликом поправить выбор.
      suggestions: [...(partial.suggestions ?? []), ...buildGenChips()],
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
