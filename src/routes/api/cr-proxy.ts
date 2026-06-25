// Server-side CORS proxy for carreports JSON-RPC APIs.
// The user's Bearer token is forwarded from the client — never stored server-side.
import { createFileRoute } from "@tanstack/react-router";

const TARGETS: Record<string, string> = {
  storage: "https://app.carreports.ru/",
  ai: "https://ai.carreports.ru/",
};

export const Route = createFileRoute("/api/cr-proxy")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const target = url.searchParams.get("target") ?? "";
        const upstream = TARGETS[target];
        if (!upstream) return new Response("Unknown target", { status: 400 });

        const token = url.searchParams.get("token") ?? "";
        const body = await request.text();

        if (target === "ai") {
          // AI API auth: ?token=<jwt>. Despite docs mentioning text/plain,
          // the live server enforces application/json.
          const u = token ? `${upstream}?token=${encodeURIComponent(token)}` : upstream;
          const r = await fetch(u, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          });
          return new Response(await r.text(), {
            status: r.status,
            headers: { "Content-Type": r.headers.get("Content-Type") ?? "application/json" },
          });
        }


        // storage: Bearer header, content-type application/json
        const r = await fetch(upstream, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body,
        });
        return new Response(await r.text(), {
          status: r.status,
          headers: { "Content-Type": r.headers.get("Content-Type") ?? "application/json" },
        });
      },
    },
  },
});
