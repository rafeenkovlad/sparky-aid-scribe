// Vision/OCR via Lovable AI Gateway.
// Accepts multipart/form-data: `file` (image), optional `prompt`, optional `step`.
// Returns { text } — recognized info, ready to prepend to user message.
import { createFileRoute } from "@tanstack/react-router";

const STEP_HINTS: Record<string, string> = {
  car:
    "На фото — документ автомобиля (СТС/ПТС), VIN-таблица, шильдик или объявление. " +
    "Извлеки: VIN (17 символов), госномер, марку, модель, год, объём двигателя, " +
    "мощность, тип топлива, КПП, привод, цвет, пробег. Если виден QR/штрихкод — пропусти.",
  characteristics:
    "Извлеки характеристики авто с фото документа/шильдика: марка, модель, поколение, " +
    "год, объём и мощность двигателя, тип топлива, КПП, привод, цвет, комплектация.",
  docs:
    "На фото — ПТС/СТС или страница договора. Извлеки: ФИО владельца, " +
    "кол-во владельцев, VIN, номер двигателя, серию/номер документа.",
  inspection:
    "На фото — элемент кузова/салона авто. Опиши кратко состояние и видимые дефекты " +
    "(царапины, сколы, ржавчина, вмятины, трещины), укажи деталь, если узнаваема.",
  testDrive:
    "На фото — приборная панель или элементы салона на тест-драйве. Опиши показания " +
    "(пробег, ошибки, ESP/ABS, давление в шинах) и видимые особенности.",
  result: "Опиши, что видно на фото — кратко, по фактам.",
};

const DEFAULT_PROMPT =
  "Внимательно проанализируй фото. Извлеки весь читаемый текст и значимые признаки. " +
  "Ответ — компактный список фактов на русском, без воды.";

export const Route = createFileRoute("/api/analyze-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) {
          return Response.json({ error: "Missing LOVABLE_API_KEY" }, { status: 500 });
        }
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof Blob)) {
          return Response.json({ error: "Missing image file" }, { status: 400 });
        }
        if (file.size > 6 * 1024 * 1024) {
          return Response.json({ error: "Image too large (>6MB)" }, { status: 413 });
        }
        const step = (form.get("step") as string | null) ?? "";
        const userPrompt = (form.get("prompt") as string | null) ?? "";
        const hint = STEP_HINTS[step] ?? DEFAULT_PROMPT;
        const prompt = userPrompt
          ? `${hint}\n\nКонтекст от пользователя: ${userPrompt}`
          : hint;

        const buf = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
        const b64 = btoa(binary);
        const mime = file.type || "image/jpeg";

        const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Lovable-API-Key": key,
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: prompt },
                  { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
                ],
              },
            ],
          }),
        });
        const body = await r.text();
        if (!r.ok) {
          return Response.json(
            { error: `Gateway ${r.status}: ${body.slice(0, 300)}` },
            { status: r.status },
          );
        }
        let text = "";
        try {
          const j = JSON.parse(body) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          text = j.choices?.[0]?.message?.content?.trim() ?? "";
        } catch {
          text = "";
        }
        return Response.json({ text });
      },
    },
  },
});
