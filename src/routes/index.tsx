import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createThread, loadThreads } from "@/lib/carreports/threadStore";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Vindiezel ассистент" },
      {
        name: "description",
        content:
          "Голосовой ИИ-ассистент для автоподборщика: соберите технический отчёт об автомобиле прямо в чате — без форм.",
      },
      { property: "og:title", content: "Vindiezel ассистент" },
      {
        property: "og:description",
        content: "Чат-ассистент для эксперта: 7 шагов отчёта, чипы клише, авто-извлечение фактов.",
      },
    ],
  }),
  component: IndexRoute,
});

function IndexRoute() {
  const navigate = useNavigate();
  useEffect(() => {
    if (typeof window === "undefined") return;
    const existing = loadThreads();
    const t = existing[0] ?? createThread();
    void navigate({ to: "/$threadId", params: { threadId: t.id }, replace: true });
  }, [navigate]);
  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950 text-white">
      <div className="text-sm text-white/60">Загружаю…</div>
    </div>
  );
}
