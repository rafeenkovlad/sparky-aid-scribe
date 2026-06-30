// DuckDuckGo HTML proxy. POST { query, limit? } → { results: [{title, description, url}] }.
// Uses fetch against the lite HTML endpoint — no Node-only deps (Worker-compatible).
import { createFileRoute } from "@tanstack/react-router";

interface SearchResult {
  title: string;
  description: string;
  url: string;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function decodeDdgRedirect(href: string): string {
  // DDG wraps results as //duckduckgo.com/l/?uddg=<encoded>
  try {
    const url = new URL(href.startsWith("//") ? `https:${href}` : href, "https://duckduckgo.com");
    const u = url.searchParams.get("uddg");
    if (u) return decodeURIComponent(u);
    return url.toString();
  } catch {
    return href;
  }
}

async function ddgSearch(query: string, limit: number): Promise<SearchResult[]> {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "ru,en;q=0.8",
    },
    body: new URLSearchParams({ q: query, kl: "ru-ru" }).toString(),
  });
  if (!res.ok) throw new Error(`ddg HTTP ${res.status}`);
  const html = await res.text();

  const results: SearchResult[] = [];
  const blockRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>)?/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) && results.length < limit) {
    const url = decodeDdgRedirect(m[1]);
    const title = stripTags(m[2] ?? "");
    const description = stripTags(m[3] ?? m[4] ?? "");
    if (url && title) results.push({ title, description, url });
  }
  return results;
}

export const Route = createFileRoute("/api/web-search")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { query?: string; limit?: number } = {};
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON", results: [] }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const query = (body.query ?? "").trim();
        if (!query) {
          return new Response(JSON.stringify({ error: "query required", results: [] }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const limit = Math.min(Math.max(body.limit ?? 5, 1), 10);
        try {
          const results = await ddgSearch(query, limit);
          return new Response(JSON.stringify({ results }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          return new Response(
            JSON.stringify({
              error: e instanceof Error ? e.message : "search failed",
              results: [],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
