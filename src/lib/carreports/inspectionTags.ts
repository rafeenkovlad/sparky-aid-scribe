// Fetch + cache user/system tags per inspection section via Storage.GetUserTags.

import { rpc } from "./storageApi";
import type { SectionSnake } from "./inspectionSections";

export interface UserTag {
  id: number;
  userId: number | null;
  name: string;
  slug: string;
  step: string | null;
  section: string | null;
  /** "serious" | "non_serious" | null */
  type: string | null;
}

const cache = new Map<SectionSnake, UserTag[]>();
const inflight = new Map<SectionSnake, Promise<UserTag[]>>();

/**
 * Загрузить теги раздела.
 * Если переданы `selectedTagIds`, сервер вернёт релевантно отсортированный
 * список (по co-occurrence), исключив уже выбранные. Такой запрос идёт
 * мимо кэша — каждый набор выбранных тегов даёт свою сортировку, и
 * результат не кэшируется (чтобы не «отравить» базовый список).
 */
export async function loadSectionTags(
  section: SectionSnake,
  selectedTagIds?: number[],
): Promise<UserTag[]> {
  const useSelected = !!(selectedTagIds && selectedTagIds.length > 0);
  if (!useSelected) {
    const hit = cache.get(section);
    if (hit) return hit;
    const running = inflight.get(section);
    if (running) return running;
  }

  const fetcher = (async () => {
    try {
      const params: Record<string, unknown> = {
        step: "inspection",
        section,
      };
      if (useSelected) params.selectedTagIds = selectedTagIds;
      const r = await rpc<{ result?: UserTag[] } | UserTag[]>(
        "Storage.GetUserTags",
        params,
      );
      const list =
        ((r as { result?: UserTag[] }).result ?? (r as UserTag[])) || [];
      if (!useSelected) cache.set(section, list);
      return list;
    } finally {
      if (!useSelected) inflight.delete(section);
    }
  })();
  if (!useSelected) inflight.set(section, fetcher);
  return fetcher;
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Match a free-form tag name against the section catalogue.
 * Returns the existing tag id or null. Never throws.
 */
export function findTagId(catalogue: UserTag[], name: string): UserTag | null {
  if (!name || !catalogue.length) return null;
  const n = norm(name);
  if (!n) return null;
  const exact = catalogue.find((t) => norm(t.name) === n || norm(t.slug) === n);
  if (exact) return exact;
  const starts = catalogue.find((t) => norm(t.name).startsWith(n) || n.startsWith(norm(t.name)));
  if (starts) return starts;
  const contains = catalogue.find((t) => norm(t.name).includes(n) || n.includes(norm(t.name)));
  return contains ?? null;
}

/** Create a new user tag in a given section and return its id. */
export async function addUserTag(
  section: SectionSnake,
  name: string,
  type?: "serious" | "non_serious",
): Promise<UserTag | null> {
  try {
    const params: Record<string, unknown> = { step: "inspection", section, name };
    if (type) params.type = type;
    const r = await rpc<{ result?: UserTag } | UserTag>("Storage.AddUserTag", params);
    const tag = (r as { result?: UserTag }).result ?? (r as UserTag);
    if (tag && typeof tag.id === "number") {
      // invalidate cache so the new tag appears next time
      cache.delete(section);
      return tag;
    }
    return null;
  } catch {
    return null;
  }
}
