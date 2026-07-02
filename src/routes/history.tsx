import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useThreads, useToken } from "@/hooks/useThreads";
import { createThread, deleteThread } from "@/lib/carreports/threadStore";
import { createShareUrl } from "@/lib/carreports/storageApi";
import type { Thread } from "@/lib/carreports/types";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Share2, Loader2 } from "lucide-react";


export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "История отчётов · Vindiezel ассистент" },
      { name: "description", content: "История ваших ИИ-отчётов об автомобиле." },
    ],
  }),
  component: HistoryPage,
});

/** Ищет последний finishComplete в потоке шага "result". */
function extractShareInfo(t: Thread): {
  reportId?: string | number;
  numericId?: string | number;
  shareUrl?: string;
} | null {
  const result = t.messages?.result ?? [];
  for (let i = result.length - 1; i >= 0; i--) {
    const m = result[i];
    if (m.kind === "finishComplete" && m.finishComplete) {
      const fc = m.finishComplete;
      if (fc.reportId || fc.shareUrl || fc.numericId) {
        return { reportId: fc.reportId, numericId: fc.numericId, shareUrl: fc.shareUrl };
      }
    }
  }
  return null;
}


async function shareLink(url: string, title: string) {
  const nav = navigator as Navigator & {
    share?: (data: { title?: string; url?: string; text?: string }) => Promise<void>;
  };
  if (typeof nav.share === "function") {
    try {
      await nav.share({ title, url });
      return;
    } catch {
      /* fallthrough to clipboard */
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Ссылка скопирована");
  } catch {
    window.prompt("Ссылка на отчёт:", url);
  }
}

function HistoryPage() {
  const threads = useThreads();
  const navigate = useNavigate();
  const token = useToken();
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) navigate({ to: "/" });
  }, [token, navigate]);


  const openNew = () => {
    const t = createThread();
    navigate({ to: "/$threadId", params: { threadId: t.id } });
  };

  const onDelete = (id: string) => {
    if (!confirm("Удалить этот отчёт?")) return;
    deleteThread(id);
  };

  const onShare = async (t: Thread) => {
    const info = extractShareInfo(t);
    if (!info) {
      toast.error("Отчёт ещё не выгружен");
      return;
    }
    setBusyId(t.id);
    try {
      let url = info.shareUrl;
      const idForShare = info.numericId ?? info.reportId;
      if (!url && idForShare != null) {
        const s = await createShareUrl(idForShare);
        url = s.url;
        if (!url && s.note) toast.error(s.note);
      }
      if (!url) {
        toast.error("Отчёт ещё не выгружен на сервер. Откройте отчёт и завершите выгрузку.");
        return;
      }
      await shareLink(url, t.title || "Отчёт");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось поделиться");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="h-full flex flex-col bg-zinc-950 text-white overflow-y-auto overscroll-contain">
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

      <div className="w-full max-w-5xl mx-auto p-3 space-y-2">
        {threads.length === 0 && (
          <div className="text-center py-16 text-white/50 text-sm">Пока пусто</div>
        )}
        {threads.map((t) => {
          const shareable = extractShareInfo(t) !== null;
          return (
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
                  void onShare(t);
                }}
                disabled={!shareable || busyId === t.id}
                className="text-white/60 hover:text-orange-400 disabled:hover:text-white/60 disabled:opacity-40 p-2"
                aria-label="Поделиться отчётом"
                title={shareable ? "Поделиться отчётом" : "Отчёт ещё не выгружен"}
              >
                {busyId === t.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Share2 className="h-4 w-4" />
                )}
              </button>
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
          );
        })}
      </div>
    </div>
  );
}
