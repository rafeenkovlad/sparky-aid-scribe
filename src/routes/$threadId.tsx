import { createFileRoute } from "@tanstack/react-router";
import { ChatApp } from "@/components/carreports/ChatApp";

export const Route = createFileRoute("/$threadId")({
  head: ({ params }) => ({
    meta: [
      { title: `Отчёт · carreports` },
      {
        name: "description",
        content: "ИИ-чат-ассистент для сборки технического отчёта об автомобиле.",
      },
      { property: "og:title", content: `Отчёт ${params.threadId} · carreports` },
    ],
  }),
  component: ThreadRoute,
});

function ThreadRoute() {
  const { threadId } = Route.useParams();
  return <ChatApp threadId={threadId} />;
}
