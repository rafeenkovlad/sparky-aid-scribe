// Client helper for /api/web-search. Returns a compact text block usable as
// `webContext` in AI clichés. Fails silently with empty string when the
// Firecrawl key is missing or the upstream errors — callers stay functional.

export interface WebSearchResult {
  title: string;
  description: string;
  url: string;
}

export async function webSearch(query: string, limit = 5): Promise<WebSearchResult[]> {
  try {
    const r = await fetch("/api/web-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit }),
    });
    if (!r.ok) return [];
    const data = (await r.json()) as { results?: WebSearchResult[] };
    return data.results ?? [];
  } catch {
    return [];
  }
}

/** Compact text block (title — description) suitable for prompt context. */
export async function webSearchContext(query: string, limit = 5): Promise<string> {
  const results = await webSearch(query, limit);
  if (!results.length) return "";
  return results
    .map((r, i) => `${i + 1}. ${r.title}${r.description ? ` — ${r.description}` : ""}`)
    .join("\n");
}
