// Speech-to-text via Lovable AI Gateway.
// Accepts multipart/form-data with a `file` field (audio blob).
// Returns { text: string }.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) {
          return new Response(JSON.stringify({ error: "Missing LOVABLE_API_KEY" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof Blob)) {
          return new Response(JSON.stringify({ error: "Missing audio file" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const language = (form.get("language") as string | null) ?? "ru";

        const upstreamForm = new FormData();
        // gpt-4o-mini-transcribe accepts common audio mimes — webm/opus from
        // MediaRecorder works directly.
        const ext = (file.type.split("/")[1] || "webm").split(";")[0];
        upstreamForm.append("file", file, `audio.${ext}`);
        upstreamForm.append("model", "openai/gpt-4o-mini-transcribe");
        upstreamForm.append("language", language);

        const r = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
          },
          body: upstreamForm,
        });

        const body = await r.text();
        if (!r.ok) {
          return new Response(
            JSON.stringify({ error: `Gateway ${r.status}: ${body.slice(0, 300)}` }),
            { status: r.status, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
