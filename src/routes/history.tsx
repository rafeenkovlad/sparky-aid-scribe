import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useThreads } from "@/hooks/useThreads";
import { createThread, deleteThread } from "@/lib/carreports/threadStore";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "История отчётов · carreports" },
      { name: "description", content: "История ваших ИИ-отчётов об автомобиле." },
    ],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  const threads = useThreads();
  const navigate = useNavigate();

  const openNew = () => {
    const t = createThread();
    navigate({ to: "/$threadId", params: { threadId: t.id } });
  };

  const onDelete = (id: string) => {
    if (!confirm("Удалить этот отчёт?")) return;
    deleteThread(id);
  };

  return (
    <div className="min-h-dvh bg-zinc-950 text-white">
      <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-3 border-b border-white/10 bg-zinc-950/95 backdrop-blur">
        <Link to="/" className="inline-flex">
          <Button variant="ghost" size="icon" className="text-white hover:bg-white/10">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <h1 className="text-base font-medium flex-1">История отчётов</h1>
        <Button
          onClick={openNew}
          className="bg-orange-500 hover:bg-orange-600 text-white"
          size="sm"
        >
          <Plus className="h-4 w-4 mr-1" /> Новый
        </Button>
      </div>

      <div className="max-w-2xl mx-auto p-3 space-y-2">
        {threads.length === 0 && (
          <div className="text-center py-16 text-white/50 text-sm">Пока пусто</div>
        )}
        {threads.map((t) => (
          <div
            key={t.id}
            className="group flex items-center rounded-lg px-3 py-3 bg-white/5 hover:bg-white/10 cursor-pointer"
            onClick={() =>
              navigate({ to: "/$threadId", params: { threadId: t.id } })
            }
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{t.title}</div>
              <div className="text-xs text-white/40">
                {new Date(t.updatedAt).toLocaleString("ru-RU", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(t.id);
              }}
              className="text-white/60 hover:text-destructive p-2"
              aria-label="Удалить"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
