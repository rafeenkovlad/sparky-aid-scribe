// Firecrawl-backed web search proxy. POST { query, limit? } → { results: [{title, description, url}] }.
// Requires FIRECRAWL_API_KEY. Returns 503 with { error } if not configured so client can fall back gracefully.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/web-search")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.FIRECRAWL_API_KEY;
        if (!apiKey) {
          return new Response(
            JSON.stringify({ error: "FIRECRAWL_API_KEY is not configured", results: [] }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          );
        }
        let body: { query?: string; limit?: number } = {};
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON" }), {
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
          const r = await fetch("https://api.firecrawl.dev/v2/search", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ query, limit }),
          });
          if (!r.ok) {
            const text = await r.text().catch(() => "");
            return new Response(
              JSON.stringify({ error: `firecrawl ${r.status}: ${text.slice(0, 200)}`, results: [] }),
              { status: 502, headers: { "Content-Type": "application/json" } },
            );
          }
          const data = (await r.json()) as {
            data?: { web?: Array<{ title?: string; description?: string; url?: string }> };
            web?: Array<{ title?: string; description?: string; url?: string }>;
          };
          const list = data.web ?? data.data?.web ?? [];
          const results = list.slice(0, limit).map((x) => ({
            title: x.title ?? "",
            description: x.description ?? "",
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
