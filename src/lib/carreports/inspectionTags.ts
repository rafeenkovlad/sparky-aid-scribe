// Fetch + cache user/system tags per inspection section via Storage.GetUserTags.

import { rpc } from "./storageApi";
import { subscribeToken } from "./tokenStore";
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

const cache = new Map<string, UserTag[]>();
const inflight = new Map<string, Promise<UserTag[]>>();

// При смене токена сбрасываем кэш и in-flight, иначе старый пустой список
// (или список чужого пользователя) останется висеть до перезагрузки.
if (typeof window !== "undefined") {
  subscribeToken(() => {
    cache.clear();
    inflight.clear();
  });
}


/**
 * Загрузить теги раздела (по умолчанию шаг — inspection).
 * Если переданы `selectedTagIds`, сервер вернёт релевантно отсортированный
 * список (по co-occurrence), исключив уже выбранные. Такой запрос идёт
 * мимо кэша — каждый набор выбранных тегов даёт свою сортировку, и
 * результат не кэшируется (чтобы не «отравить» базовый список).
 */
export async function loadSectionTags(
  section: SectionSnake,
  selectedTagIds?: number[],
): Promise<UserTag[]> {
  return loadTagsFor("inspection", section, selectedTagIds);
}

/** Универсальная загрузка тегов для произвольного step/section.
 *  `section = null` → запрос на уровне всего step. */
export async function loadTagsFor(
  step: string,
  section: string | null,
  selectedTagIds?: number[],
): Promise<UserTag[]> {
  const selected = Array.isArray(selectedTagIds) ? selectedTagIds : [];
  const useSelected = selected.length > 0;
  const cacheKey = `${step}:${section ?? "*"}`;
  if (!useSelected) {
    const hit = cache.get(cacheKey);
    if (hit) return hit;
    const running = inflight.get(cacheKey);
    if (running) return running;
  }

  const fetcher = (async () => {
    try {
      // Сервер ожидает все три поля: step, section (может быть null),
      // selectedTagIds (всегда массив, пустой если выбранных нет).
      const params: Record<string, unknown> = {
        step,
        section,
        selectedTagIds: selected,
      };
      const r = await rpc<{ result?: UserTag[] } | UserTag[]>(
        "Storage.GetUserTags",
        params,
      );
      const list =
        ((r as { result?: UserTag[] }).result ?? (r as UserTag[])) || [];
      if (!useSelected) cache.set(cacheKey, list);
      return list;
    } finally {
      if (!useSelected) inflight.delete(cacheKey);
    }
  })();
  if (!useSelected) inflight.set(cacheKey, fetcher);
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

/** Create a new user tag in a given step/section and return its id.
 *  `type` обязателен: фронт никогда не должен отправлять AddUserTag без типа. */
export async function addUserTag(
  section: string,
  name: string,
  type: "serious" | "non_serious",
  step: string = "inspection",
): Promise<UserTag | null> {
  try {
    const params: Record<string, unknown> = { step, section, name, type };
    const r = await rpc<{ result?: UserTag } | UserTag>("Storage.AddUserTag", params);
    const tag = (r as { result?: UserTag }).result ?? (r as UserTag);
    if (tag && typeof tag.id === "number") {
      // invalidate cache so the new tag appears next time
      cache.delete(`${step}:${section}`);
      cache.delete(`${step}:*`);
      return tag;
    }
    return null;
  } catch {
    return null;
  }
}


/** Rename an existing user tag. Returns true on success. */
export async function updateUserTag(
  section: SectionSnake,
  id: number,
  name: string,
): Promise<boolean> {
  try {
    await rpc("Storage.UpdateUserTag", { id, name });
    cache.delete(`inspection:${section}`);
    return true;
  } catch {
    return false;
  }
}

/** Delete a user-owned tag. Returns true on success. */
export async function deleteUserTag(
  section: SectionSnake,
  id: number,
): Promise<boolean> {
  try {
    await rpc("Storage.DeleteUserTag", { id });
    cache.delete(section);
    return true;
  } catch {
    return false;
  }
}

/** Remove a user tag (Storage.RemoveUserTag). Returns true on success. */
export async function removeUserTag(id: number): Promise<boolean> {
  try {
    await rpc("Storage.RemoveUserTag", { id });
    return true;
  } catch {
    return false;
  }
}
