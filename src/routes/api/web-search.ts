// DuckDuckGo-backed web search proxy. POST { query, limit? } → { results: [{title, description, url}] }.
// No API key required. Falls back gracefully with empty results on upstream errors.
import { createFileRoute } from "@tanstack/react-router";
import { search, SafeSearchType } from "duck-duck-scrape";

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
          const res = await search(query, { safeSearch: SafeSearchType.MODERATE });
          const list = res.noResults ? [] : res.results.slice(0, limit);
          const results = list.map((x) => ({
            title: x.title ?? "",
            description: (x.description ?? "").replace(/<[^>]+>/g, ""),
            url: x.url ?? "",
          }));
          return new Response(JSON.stringify({ results }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          return new Response(
            JSON.stringify({ error: e instanceof Error ? e.message : "search failed", results: [] }),
            { status: 502, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
