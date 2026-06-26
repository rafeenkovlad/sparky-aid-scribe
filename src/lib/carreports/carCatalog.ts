// AI-assisted resolver: brand+model+generation hints → modelCarId +
// modelGenerationRestylingFrameId via Storage.GetBrand / Storage.GetModelCar /
// Storage.GetModelGeneration. AI picks one option from real catalog lists at
// each step. When AI is unsure or the catalog list is empty, falls back to a
// Firecrawl web search and re-asks the AI with the web context. Falls back to
// string match if AI is unavailable.

import { aiChatIdFor, chatCompletions } from "./aiApi";
import {
  CLICHE_CANONICAL_BRAND,
  CLICHE_INFER_BRAND_FROM_MODEL,
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
  // photos: [{size:'s'|'m'|'l', urlX1, urlX2}] — берём только МЕНЬШЕЕ
  // изображение: предпочитаем size='s', затем urlX1 (1x). urlX2 (ретина/2x)
  // используем только как последний фолбэк, чтобы не тянуть тяжёлый файл.
  const photos = row["photos"];
  if (Array.isArray(photos) && photos.length) {
    const pickFrom = (p: unknown): string | undefined => {
      const o = p as { urlX1?: unknown; urlX2?: unknown } | null;
      if (!o) return undefined;
      if (typeof o.urlX1 === "string" && /^https?:\/\//.test(o.urlX1)) return o.urlX1;
      if (typeof o.urlX2 === "string" && /^https?:\/\//.test(o.urlX2)) return o.urlX2;
      return undefined;
    };
    const small =
      photos.find((p) => (p as { size?: string } | null)?.size === "s") ??
      photos.find((p) => (p as { size?: string } | null)?.size === "m");
    return pickFrom(small) ?? pickFrom(photos[0]);
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
  /** Alternative catalogue names, e.g. API `modelRus` for Cyrillic input. */
  aliases?: string[];
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
  modelCarId?: number;
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
  const raw = unwrap<Record<string, unknown>>(r);
  // API возвращает имя модели в поле `model` (англ.) и `modelRus` (рус.),
  // а не `name`. Нормализуем к ModelRow с полем `name`, иначе AI-подбор
  // получает список со всеми name=undefined и не может выбрать модель —
  // в итоге fallback `bestMatch` возвращает первую модель (Polo) и далее
  // поколения подгружаются для неё.
  const list: ModelRow[] = raw.map((row) => {
    const name =
      (typeof row.name === "string" && row.name) ||
      (typeof row.model === "string" && row.model) ||
      (typeof row.modelRus === "string" && row.modelRus) ||
      "";
    const aliases = [row.name, row.model, row.modelRus]
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .map((v) => v.trim())
      .filter((v, i, arr) => arr.findIndex((x) => norm(x) === norm(v)) === i);
    const urlImage =
      typeof row.urlImage === "string" ? row.urlImage : undefined;
    return {
      id: Number(row.id),
      name: String(name),
      ...(aliases.length ? { aliases } : {}),
      ...(urlImage ? { urlImage } : {}),
    } as ModelRow;
  });
  modelCache.set(brandId, list);
  return list;
}

async function fetchGenerations(modelCarId: number): Promise<GenerationRow[]> {
  const hit = generationCache.get(modelCarId);
  if (hit) return hit;
  const r = await rpc<unknown>("Storage.GetModelGeneration", { modelCarId });
  // Жёсткая защита от смешивания поколений: даже если API/кэш вернёт лишние
  // строки, дальше проходят только поколения этой модели.
  const list = unwrap<GenerationRow>(r).filter(
    (row) => row.modelCarId == null || Number(row.modelCarId) === modelCarId,
  );
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

function rowNames(row: { name?: string; aliases?: string[] }): string[] {
  return [row.name, ...(row.aliases ?? [])]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .filter((v, i, arr) => arr.findIndex((x) => norm(x) === norm(v)) === i);
}

function bestMatch<T extends { name?: string; aliases?: string[] }>(rows: T[], target: string): T | undefined {
  if (!rows.length) return undefined;
  const t = norm(target);
  if (!t) return rows[0];
  const exact = rows.find((r) => rowNames(r).some((name) => norm(name) === t));
  if (exact) return exact;
  const starts = rows.find((r) => rowNames(r).some((name) => norm(name).startsWith(t)));
  if (starts) return starts;
  const contains = rows.find((r) => {
    return rowNames(r).some((name) => {
      const n = norm(name);
      return n && (n.includes(t) || t.includes(n));
    });
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
function topMatches<T extends { id: number; name?: string; aliases?: string[] }>(
  rows: T[],
  target: string,
  n: number,
  excludeId?: number,
): T[] {
  if (!rows.length) return [];
  const t = norm(target);
  const scored = rows
    .filter((r) => r.id !== excludeId && rowNames(r).length)
    .map((r) => {
      const score = Math.min(
        ...rowNames(r).map((name) => {
          const nm = norm(name);
          let s = editDistance(t, nm);
          if (nm.startsWith(t) || t.startsWith(nm)) s -= 2;
          if (nm.includes(t) || t.includes(nm)) s -= 1;
          return s;
        }),
      );
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
  /** true когда пользователь указал поколение, оно нашлось, но у поколения
   * есть несколько рестайлингов, а пользователь рестайлинг не назвал —
   * нужно показать коллаж рестайлингов и попросить выбрать. */
  restylingChoiceRequired?: boolean;
  /** label выбранного поколения (для подсказки в UI). */
  pendingGenerationLabel?: string;
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
  opts?: {
    thread?: Thread;
    userText?: string;
    generationHint?: string;
    onTrace?: (entry: ClarifyTraceEntry) => void;
  },
): Promise<ResolvedCar> {
  const empty: ResolvedCar = {
    modelCarId: null,
    modelGenerationRestylingFrameId: null,
    trace: [],
  };
  const emitResolved = (t: ResolvedCar["trace"][number]) => {
    try {
      for (const e of resolvedTraceEntryToClarify(t)) opts?.onTrace?.(e);
    } catch { /* ignore */ }
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
    {
      const entry = {
        step: "brand" as const,
        candidates: brands.length,
        pickedId: brand?.id ?? null,
        confidence: brandConf,
        needsWeb: brandWebUsed,
        reason: brandReason,
      };
      trace.push(entry);
      emitResolved(entry);
    }
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

    // Подсказка модели часто приходит «загрязнённой» соседними словами:
    // «tiguan 2 дизель второе поколение 1 рестайлинг». Чистим, чтобы LLM
    // не путался и сначала пробуем детерминированный точный матч.
    const cleanModelHint = (s: string): string => {
      let t = ` ${s.toLowerCase().replace(/ё/g, "е")} `;
      t = t.replace(
        /\b(поколени[еяюйя]?|рестайлинг[а-я]*|дизель|бензин|гибрид|электро|газ|акпп|мкпп|робот|вариатор|передний|задний|полный|седан|универсал|хэтчбек|купе|кроссовер|внедорожник|fl|mqb|b\d(?:\.\d)?|i{1,3}|iv|v|vi{0,3})\b/gi,
        " ",
      );
      // убираем одиночные цифры/года и пунктуацию
      t = t.replace(/\b\d{1,4}\b/g, " ").replace(/[^a-zа-я0-9\s-]/gi, " ");
      return t.replace(/\s+/g, " ").trim();
    };
    const hintClean = modelHintOrName ? cleanModelHint(modelHintOrName) : "";
    const hintNorm = hintClean ? norm(hintClean) : "";
    if (hintNorm) {
      const exact = models.find((m) => rowNames(m).some((name) => norm(name) === hintNorm));
      if (exact) {
        model = exact;
        modelConf = 1;
        modelReason = `Точное совпадение по нормализованному имени «${hintClean}»`;
      }
    }

    const pickModel = async (webContext?: string) =>
      aiPick<{
        modelCarId: number | null;
        confidence: number;
        needsWeb: boolean;
        reason?: string;
      }>(
        thread,
        "resolveCar:model",
        CLICHE_PICK_MODEL(userText, brand!.name, hintClean || modelHintOrName, models, webContext),
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

    let modelPick = model ? null : await pickModel();
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
    {
      const entry = {
        step: "model" as const,
        candidates: models.length,
        pickedId: model?.id ?? null,
        confidence: modelConf,
        needsWeb: modelWebUsed,
        reason: modelReason,
      };
      trace.push(entry);
      emitResolved(entry);
    }
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

    // [3] Generation/restyling/frame — through helper, so the by-id fast-path
    // (resolveGenerationByModelId) can reuse the exact same logic.
    return await pickGenerationForModel(model.id, partial, {
      userText,
      generationHint,
      year,
      thread,
      trace,
      onTrace: opts?.onTrace,
    });
  } catch {
    return empty;
  }
}

/**
 * Generation/restyling/frame resolution for an already-known modelCarId.
 * Used both by `resolveCar` (after it resolves the model) and by
 * `resolveGenerationByModelId` (the fast-path when the model is already
 * chosen and we only need to switch поколение/рестайлинг).
 */
async function pickGenerationForModel(
  modelCarId: number,
  partial: ResolvedCar,
  opts: {
    userText: string;
    generationHint?: string;
    year?: number;
    thread?: Thread;
    trace: ResolvedCar["trace"];
  },
): Promise<ResolvedCar> {
  const { userText, generationHint, year, thread, trace } = opts;

  // Optional: skip entirely if we have nothing to go on (called only from
  // resolveCar's normal path — by-id fast-path always supplies a hint/year).
  if (!year && !generationHint) return partial;

  let frames: GenerationFrameCandidate[] = [];
  try {
    const gens = await fetchGenerations(modelCarId);
    frames = flattenFrames(gens);
  } catch {
    return partial;
  }
  if (!frames.length) return partial;

  let frame: GenerationFrameCandidate | undefined;
  let frameConf = 0;
  const frameWebUsed = false;
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
      CLICHE_PICK_GENERATION(
        userText,
        partial.brandName ?? "",
        partial.modelCarName ?? "",
        year,
        generationHint,
        frames,
        webContext,
      ),
      userText,
      (raw) => {
        const r = raw as {
          frameId?: unknown;
          confidence?: unknown;
          needsWeb?: unknown;
          reason?: unknown;
        } | null;
        if (!r || typeof r.frameId !== "number") return null;
        return {
          frameId: r.frameId,
          confidence: typeof r.confidence === "number" ? r.confidence : 0,
          needsWeb: r.needsWeb === true,
          reason: typeof r.reason === "string" ? r.reason : undefined,
        };
      },
    );

  const parseOrdinal = (s: string, keyword: RegExp): number | null => {
    const lc = s.toLowerCase().replace(/ё/g, "е");
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
  let restylingChoiceGroup:
    | { number?: number; name: string; items: GenerationFrameCandidate[] }
    | undefined;
  if (genOrd != null) {
    let group = genGroups.find((g) => g.number === genOrd);
    if (!group) group = genGroups[genOrd - 1];
    if (!group) {
      notFound = true;
    } else if (restOrd != null) {
      let picked: GenerationFrameCandidate | undefined =
        group.items.find((f) => f.restylingNumber === restOrd);
      if (!picked) picked = group.items[restOrd];
      if (!picked) notFound = true;
      else {
        frame = picked;
        frameConf = 0.95;
        frameReason = `Поколение #${genOrd}, рестайлинг #${restOrd}`;
      }
    } else if (group.items.length === 1) {
      // У поколения один frame — выбирать нечего.
      frame = group.items[0];
      frameConf = 0.95;
      frameReason = `Поколение #${genOrd} (единственный вариант)`;
    } else {
      // Несколько рестайлингов — НЕ выбираем сами. Просим пользователя выбрать.
      restylingChoiceGroup = group;
      frameReason = `Поколение #${genOrd} — нужен выбор рестайлинга`;
    }
  }

  if (!frame && !notFound && !restylingChoiceGroup) {
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

  const buildGenChips = (): CatalogSuggestion[] => {
    const out: CatalogSuggestion[] = [];
    const seen = new Set<string>();
    for (const group of genGroups) {
      const gNum = group.number;
      // Внутри одной пары (поколение, рестайлинг) у API может быть несколько
      // frames (разные кузова) — на чипах они смотрятся как дубликаты.
      // Дедупим по (generationNumber, restylingNumber|restylingName).
      const uniqueByRestyling = new Map<string, GenerationFrameCandidate>();
      for (const f of group.items) {
        const k = `${f.restylingNumber ?? f.restylingName ?? "_"}`;
        if (!uniqueByRestyling.has(k)) uniqueByRestyling.set(k, f);
      }
      const items = Array.from(uniqueByRestyling.values());
      const multi = items.length > 1;
      for (const f of items) {
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
        const label = `${genLabel}${restLabel}`;
        const dedupKey = `${label}|${years}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        out.push({
          group: "generation",
          label,
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
    if (restylingChoiceGroup) {
      // Коллаж только рестайлингов выбранного поколения.
      const gNum = restylingChoiceGroup.number;
      const genLabel =
        gNum != null ? `Поколение ${gNum}` : (restylingChoiceGroup.name || "Поколение");
      // Дедуп по restylingNumber|restylingName — внутри одной пары могут быть
      // несколько frames (разные кузова), они выглядят как дубликаты на чипах.
      const uniqByRest = new Map<string, GenerationFrameCandidate>();
      for (const f of restylingChoiceGroup.items) {
        const k = `${f.restylingNumber ?? f.restylingName ?? "_"}`;
        if (!uniqByRest.has(k)) uniqByRest.set(k, f);
      }
      const restylingChips: CatalogSuggestion[] = Array.from(uniqByRest.values()).map((f) => {
        const years =
          f.yearStart || f.yearEnd
            ? `${f.yearStart ?? "?"}–${f.yearEnd ?? "н.в."}`
            : "";
        const rNum = f.restylingNumber;
        const restLabel =
          rNum === 0
            ? "Базовый"
            : rNum != null
              ? `Рестайлинг ${rNum}`
              : (f.restylingName ?? "Вариант");
        const value =
          rNum != null
            ? `Поколение ${gNum ?? "?"}, рестайлинг ${rNum}`
            : `Поколение ${gNum ?? "?"} ${f.restylingName ?? ""}`.trim();
        return {
          group: "generation" as const,
          label: `${genLabel} · ${restLabel}`,
          value,
          ...(f.urlImage ? { image: f.urlImage } : {}),
          ...(years ? { description: years } : {}),
        };
      });
      return {
        ...partial,
        restylingChoiceRequired: true,
        pendingGenerationLabel: genLabel,
        suggestions: [...(partial.suggestions ?? []), ...restylingChips],
      };
    }
    return {
      ...partial,
      generationNotFound: notFound,
      suggestions: [...(partial.suggestions ?? []), ...buildGenChips()],
    };
  }
  const label = [frame.generationName, frame.restylingName].filter(Boolean).join(" / ");
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
    suggestions: [...(partial.suggestions ?? []), ...buildGenChips()],
  };
}

/**
 * Fast-path: when modelCarId is already chosen, jump straight to
 * Storage.GetModelGeneration and pick поколение/рестайлинг by the user's
 * hint/year. Skips brand/model AI calls entirely.
 */
export async function resolveGenerationByModelId(
  modelCarId: number,
  opts: {
    userText: string;
    generationHint?: string;
    year?: number;
    thread?: Thread;
    brandName?: string;
    modelCarName?: string;
    brandImage?: string;
    modelImage?: string;
  },
): Promise<ResolvedCar> {
  const trace: ResolvedCar["trace"] = [];
  const partial: ResolvedCar = {
    modelCarId,
    modelGenerationRestylingFrameId: null,
    ...(opts.brandName ? { brandName: opts.brandName } : {}),
    ...(opts.modelCarName ? { modelCarName: opts.modelCarName } : {}),
    ...(opts.brandImage ? { brandImage: opts.brandImage } : {}),
    ...(opts.modelImage ? { modelImage: opts.modelImage } : {}),
    trace,
  };
  try {
    return await pickGenerationForModel(modelCarId, partial, {
      userText: opts.userText,
      generationHint: opts.generationHint,
      year: opts.year,
      thread: opts.thread,
      trace,
    });
  } catch {
    return partial;
  }
}

/**
 * Возвращает только список чипов поколений/рестайлингов для модели — без
 * попыток что-либо автоматически выбрать. Используется когда марка/модель
 * только что определились и нужно дать пользователю выбрать вручную.
 */
export async function listGenerationChipsForModel(
  modelCarId: number,
): Promise<CatalogSuggestion[]> {
  try {
    const gens = await fetchGenerations(modelCarId);
    const frames = flattenFrames(gens);
    if (!frames.length) return [];
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
    const out: CatalogSuggestion[] = [];
    const seen = new Set<string>();
    for (const group of genGroups) {
      const gNum = group.number;
      const uniq = new Map<string, GenerationFrameCandidate>();
      for (const f of group.items) {
        const k = `${f.restylingNumber ?? f.restylingName ?? "_"}`;
        if (!uniq.has(k)) uniq.set(k, f);
      }
      const items = Array.from(uniq.values());
      const multi = items.length > 1;
      for (const f of items) {
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
        const label = `${genLabel}${restLabel}`;
        const dedupKey = `${label}|${years}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        out.push({
          group: "generation",
          label,
          value,
          ...(f.urlImage ? { image: f.urlImage } : {}),
          ...(years ? { description: years } : {}),
        });
        if (out.length >= 12) return out;
      }
    }
    return out;
  } catch {
    return [];
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

/**
 * Уточняющий AI-шаг: эксперт назвал только модель («тигуан 2 рестайлинг 1»),
 * марка отсутствует. Спрашиваем у ИИ марку по имени модели; если уверенность
 * низкая — добавляем веб-контекст и переспрашиваем. Возвращаем нормализованные
 * имена бренда и модели (или null).
 */
export interface InferBrandResult {
  brandName: string;
  modelCarName: string;
  /** debug-trace of clarifying AI/web calls */
  trace: ClarifyTraceEntry[];
}

export interface ClarifyTraceEntry {
  kind: "ai" | "web";
  label: string;
  detail?: string;
}

export async function inferBrandFromModelName(
  modelHint: string,
  userText: string,
  thread?: Thread,
  onTrace?: (entry: ClarifyTraceEntry) => void,
): Promise<InferBrandResult | null> {
  if (!thread || !modelHint.trim()) return null;
  const trace: ClarifyTraceEntry[] = [];
  const emit = (e: ClarifyTraceEntry) => {
    trace.push(e);
    try { onTrace?.(e); } catch { /* ignore */ }
  };
  const ask = async (webCtx?: string) =>
    aiPick<{
      brandName: string | null;
      modelCarName: string | null;
      confidence: number;
      needsWeb: boolean;
    }>(
      thread,
      "resolveCar:inferBrandFromModel",
      CLICHE_INFER_BRAND_FROM_MODEL(modelHint, userText, webCtx),
      userText,
      (raw) => {
        const r = raw as {
          brandName?: unknown;
          modelCarName?: unknown;
          confidence?: unknown;
          needsWeb?: unknown;
        } | null;
        if (!r) return null;
        return {
          brandName: typeof r.brandName === "string" ? r.brandName.trim() : null,
          modelCarName:
            typeof r.modelCarName === "string" ? r.modelCarName.trim() : null,
          confidence: typeof r.confidence === "number" ? r.confidence : 0,
          needsWeb: r.needsWeb === true,
        };
      },
    );

  emit({
    kind: "ai",
    label: `Определяю марку по модели «${modelHint}»`,
  });
  let pick = await ask();
  if (!pick?.brandName || pick.confidence < LOW_CONF || pick.needsWeb) {
    emit({
      kind: "web",
      label: `Уточняю в вебе: «какая марка ${modelHint}»`,
    });
    const ctx = await webSearchContext(
      `какая марка автомобиля ${modelHint} производитель`,
      5,
    );
    if (ctx) {
      emit({
        kind: "ai",
        label: `Повторно спрашиваю модель марки с веб-контекстом`,
      });
      const retry = await ask(ctx);
      if (retry?.brandName && retry.confidence >= (pick?.confidence ?? 0)) {
        pick = retry;
      }
    }
  }
  if (!pick?.brandName) return null;
  emit({
    kind: "ai",
    label: `Марка определена: ${pick.brandName} (модель: ${pick.modelCarName || modelHint})`,
  });
  return {
    brandName: pick.brandName,
    modelCarName: pick.modelCarName || modelHint,
    trace,
  };
}

/** Human-readable formatter for trace entries — для показа в чате. */
export function formatClarifyTrace(entries: ClarifyTraceEntry[]): string {
  if (!entries.length) return "";
  const icon = (k: ClarifyTraceEntry["kind"]) => (k === "web" ? "🌐" : "🧠");
  const lines = entries.map((e) => `  ${icon(e.kind)} ${e.label}`);
  return `\n🔁 Уточняющие запросы нейросети:\n${lines.join("\n")}`;
}

/** Convert a single ResolvedCar trace entry to ClarifyTraceEntry list. */
export function resolvedTraceEntryToClarify(
  t: ResolvedCar["trace"][number],
): ClarifyTraceEntry[] {
  const stepLabel: Record<string, string> = {
    brand: "марку",
    model: "модель",
    generation: "поколение/рестайлинг",
  };
  const conf = Math.round(t.confidence * 100);
  const out: ClarifyTraceEntry[] = [
    {
      kind: "ai",
      label: `Подбираю ${stepLabel[t.step] ?? t.step} из каталога (${t.candidates} вариантов, уверенность ${conf}%)`,
      ...(t.reason ? { detail: t.reason } : {}),
    },
  ];
  if (t.needsWeb) {
    out.push({
      kind: "web",
      label: `Веб-фолбэк: уточняю ${stepLabel[t.step] ?? t.step} поиском`,
    });
  }
  return out;
}

/** Trace builder из ResolvedCar.trace (steps brand/model/generation). */
export function resolvedTraceToClarify(
  resolved: ResolvedCar,
): ClarifyTraceEntry[] {
  return resolved.trace.flatMap(resolvedTraceEntryToClarify);
}


