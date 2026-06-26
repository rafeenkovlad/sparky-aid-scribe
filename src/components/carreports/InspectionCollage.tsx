// Коллаж фото раздела + bottom-sheet аннотации одного фото.
// Используется в сообщении ассистента с kind="inspectionCollage" и в карточке
// upload-приглашения kind="inspectionUploadPrompt".

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, Image as ImageIcon, Loader2, Plus, Sparkles, X } from "lucide-react";
import {
  getSection,
  type SectionSnake,
} from "@/lib/carreports/inspectionSections";
import {
  elementStatus,
  getFinding,
  photosForSection,
} from "@/lib/carreports/inspectionState";
import type { InspectionPhoto, InspectionStep, PendingTagName } from "@/lib/carreports/types";
import { loadSectionTags, type UserTag } from "@/lib/carreports/inspectionTags";

type Verdict = "ok" | "minor" | "serious";

// ─── Upload prompt card ────────────────────────────────────────────────────

export function InspectionUploadPrompt(props: {
  sectionSnake: SectionSnake;
  onPick: (files: File[]) => void;
  interactive: boolean;
}) {
  const { sectionSnake, onPick, interactive } = props;
  const section = getSection(sectionSnake);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-2xl rounded-tl-md bg-white/[0.04] border border-white/10 px-3 py-3 space-y-2.5">
      <div className="text-sm text-white">
        Раздел <span className="font-medium text-orange-300">«{section?.label ?? sectionSnake}»</span>.
        Загрузите фото элементов — соберём коллаж, на каждом сможете поставить теги и заметку (вручную или ИИ).
      </div>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*,.heic,.heif"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onPick(files);
          e.target.value = "";
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onPick(files);
          e.target.value = "";
        }}
      />
      <div className="flex gap-2">
        <button
          disabled={!interactive}
          onClick={() => cameraRef.current?.click()}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm py-2"
        >
          <Camera className="h-4 w-4" /> Снять
        </button>
        <button
          disabled={!interactive}
          onClick={() => galleryRef.current?.click()}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-40 text-white text-sm py-2"
        >
          <ImageIcon className="h-4 w-4" /> Из галереи
        </button>
      </div>
    </div>
  );
}

// ─── Collage card ──────────────────────────────────────────────────────────

export function InspectionCollage(props: {
  ins: InspectionStep;
  sectionSnake: SectionSnake;
  interactive: boolean;
  onPick: (files: File[]) => void;
  onOpenPhoto: (photoIdx: number) => void;
}) {
  const { ins, sectionSnake, interactive, onPick, onOpenPhoto } = props;
  const section = getSection(sectionSnake);
  const list = useMemo(() => photosForSection(ins, sectionSnake), [ins, sectionSnake]);
  const moreRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-2xl rounded-tl-md bg-white/[0.04] border border-white/10 px-3 py-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] text-white">
          Коллаж · <span className="text-white/70">{section?.label ?? sectionSnake}</span>
        </div>
        <div className="text-[11px] text-white/45">{list.length} фото</div>
      </div>

      {list.length === 0 && (
        <div className="text-[12px] text-white/55">
          Пока пусто. Добавьте фото — коллаж появится здесь.
        </div>
      )}

      {list.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5">
          {list.map(({ idx, photo }) => {
            const elId = photo.elementId;
            const status = elId
              ? elementStatus(ins, sectionSnake, elId)
              : "empty";
            const finding = elId ? getFinding(ins, sectionSnake, elId) : undefined;
            const tagCount =
              (finding?.seriousDamageTagIds?.length ?? 0) +
              (finding?.noSeriousDamageTagIds?.length ?? 0) +
              (finding?.pendingTagNames?.length ?? 0);
            const elLabel = elId
              ? section?.elements.find((e) => e.id === elId)?.label
              : null;
            const dot =
              status === "serious"
                ? "bg-rose-500"
                : status === "minor"
                  ? "bg-amber-500"
                  : status === "ok"
                    ? "bg-emerald-500"
                    : status === "noteOnly"
                      ? "bg-sky-500"
                      : "bg-white/30";
            return (
              <button
                key={`${idx}:${photo.filename}`}
                disabled={!interactive}
                onClick={() => onOpenPhoto(idx)}
                className="relative aspect-square rounded-lg overflow-hidden border border-white/10 bg-white/5 group"
                title={elLabel ?? "Без элемента"}
              >
                {photo.dataUrl ? (
                  <img
                    src={photo.dataUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-white/40 text-xs">
                    нет превью
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/80 to-transparent">
                  <div className="flex items-center gap-1">
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
                    <span className="text-[10px] text-white truncate">
                      {elLabel ?? "—"}
                    </span>
                    {tagCount > 0 && (
                      <span className="ml-auto text-[10px] text-white/85">
                        🏷{tagCount}
                      </span>
                    )}
                    {finding?.note && (
                      <span className="text-[10px] text-white/85">📝</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}

          {interactive && (
            <>
              <input
                ref={moreRef}
                type="file"
                accept="image/*,.heic,.heif"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length) onPick(files);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => moreRef.current?.click()}
                className="aspect-square rounded-lg border border-dashed border-white/20 text-white/60 hover:text-white hover:border-white/40 flex flex-col items-center justify-center gap-0.5 text-[11px]"
              >
                <Plus className="h-4 w-4" />
                Добавить
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Photo annotator ───────────────────────────────────────────────────────

export interface PhotoAnnotatorProps {
  open: boolean;
  onClose: () => void;
  photo: InspectionPhoto | null;
  sectionSnake: SectionSnake;
  ins: InspectionStep;
  onApply: (patch: {
    elementId: string;
    verdict: Verdict;
    seriousTagIds: number[];
    noSeriousTagIds: number[];
    pendingTags: PendingTagName[];
    note: string;
  }) => void;
  onAnalyze: () => Promise<{
    elementId: string;
    noDamage: boolean;
    seriousTagIds: number[];
    noSeriousTagIds: number[];
    pendingTags: PendingTagName[];
    note: string;
  }>;
  onDelete: () => void;
}

export function PhotoAnnotator(props: PhotoAnnotatorProps) {
  const { open, onClose, photo, sectionSnake, ins, onApply, onAnalyze, onDelete } = props;
  const section = getSection(sectionSnake);

  const [elementId, setElementId] = useState<string>("");
  const [verdict, setVerdict] = useState<Verdict>("ok");
  const [sIds, setSIds] = useState<Set<number>>(new Set());
  const [nsIds, setNsIds] = useState<Set<number>>(new Set());
  const [pending, setPending] = useState<PendingTagName[]>([]);
  const [note, setNote] = useState("");
  const [tags, setTags] = useState<UserTag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");

  // Reset state when opening a (different) photo.
  useEffect(() => {
    if (!open || !photo) return;
    const initialEl = photo.elementId ?? section?.elements[0]?.id ?? "generalCondition";
    setElementId(initialEl);
    const existing = getFinding(ins, sectionSnake, initialEl);
    const sis = new Set(existing?.seriousDamageTagIds ?? []);
    const nis = new Set(existing?.noSeriousDamageTagIds ?? []);
    setSIds(sis);
    setNsIds(nis);
    setPending(existing?.pendingTagNames ?? []);
    setNote(existing?.note ?? "");
    setVerdict(
      sis.size > 0 ? "serious" : nis.size > 0 ? "minor" : existing?.noDamage === false ? "minor" : "ok",
    );
    setAiError(null);
    setAddOpen(false);
    setAddName("");
  }, [open, photo, sectionSnake, ins, section]);

  // Load tags lazily once opened.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setTagsLoading(true);
    void loadSectionTags(sectionSnake).then((list) => {
      if (!alive) return;
      setTags(list);
      setTagsLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [open, sectionSnake]);

  if (!open || !photo) return null;

  const elementLabel =
    section?.elements.find((e) => e.id === elementId)?.label ?? elementId;

  const serious = tags.filter((t) => t.type === "serious");
  const minor = tags.filter((t) => t.type !== "serious");

  const toggle = (bucket: "s" | "n", id: number) => {
    const setFn = bucket === "s" ? setSIds : setNsIds;
    setFn((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (verdict === "ok") setVerdict(bucket === "s" ? "serious" : "minor");
  };

  const togglePending = (name: string, severity: "serious" | "non_serious") => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setPending((prev) => {
      const i = prev.findIndex((p) => p.name.toLowerCase() === trimmed.toLowerCase());
      if (i >= 0) {
        const cp = [...prev];
        cp.splice(i, 1);
        return cp;
      }
      return [...prev, { name: trimmed, severity }];
    });
    if (verdict === "ok") setVerdict(severity === "serious" ? "serious" : "minor");
  };

  const applyAi = async () => {
    setAnalyzing(true);
    setAiError(null);
    try {
      const r = await onAnalyze();
      setElementId(r.elementId);
      setSIds(new Set(r.seriousTagIds));
      setNsIds(new Set(r.noSeriousTagIds));
      setPending(r.pendingTags);
      setNote((prev) => (prev ? `${prev}\n${r.note}` : r.note));
      setVerdict(
        r.seriousTagIds.length > 0
          ? "serious"
          : r.noSeriousTagIds.length > 0 || r.pendingTags.length > 0
            ? "minor"
            : "ok",
      );
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Ошибка ИИ");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSave = () => {
    onApply({
      elementId,
      verdict,
      seriousTagIds: [...sIds],
      noSeriousTagIds: [...nsIds],
      pendingTags: pending,
      note: note.trim(),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/70" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[92dvh] overflow-y-auto bg-zinc-950 border-t sm:border border-white/10 sm:rounded-2xl rounded-t-2xl text-white"
      >
        <div className="sticky top-0 bg-zinc-950/95 backdrop-blur border-b border-white/10 px-3 py-2 flex items-center gap-2">
          <div className="font-medium text-sm flex-1 truncate">
            Фото · {section?.label ?? sectionSnake}
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full hover:bg-white/10 flex items-center justify-center"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {photo.dataUrl && (
          <img
            src={photo.dataUrl}
            alt=""
            className="block w-full max-h-[40dvh] object-contain bg-black/40"
          />
        )}

        <div className="p-3 space-y-3">
          {/* AI button */}
          <button
            onClick={applyAi}
            disabled={analyzing || !photo.url}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-sm py-2"
            title={photo.url ? "Распознать ИИ" : "Фото ещё не загружено на сервер"}
          >
            {analyzing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {analyzing ? "Распознаю…" : "Распознать ИИ"}
          </button>
          {aiError && (
            <div className="text-[12px] text-rose-300">⚠️ {aiError}</div>
          )}

          {/* Element picker */}
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wide text-white/45">
              Элемент
            </div>
            <div className="flex flex-wrap gap-1.5">
              {section?.elements.map((el) => {
                const sel = el.id === elementId;
                return (
                  <button
                    key={el.id}
                    onClick={() => setElementId(el.id)}
                    className={chip(sel)}
                  >
                    {el.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Verdict */}
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wide text-white/45">
              Вердикт по «{elementLabel}»
            </div>
            <div className="flex gap-1.5">
              {(["ok", "minor", "serious"] as Verdict[]).map((v) => {
                const sel = verdict === v;
                const cls =
                  v === "ok"
                    ? sel
                      ? "bg-emerald-500 border-emerald-500 text-white"
                      : "border-emerald-500/30 text-emerald-200/80 hover:bg-emerald-500/10"
                    : v === "minor"
                      ? sel
                        ? "bg-amber-500 border-amber-500 text-white"
                        : "border-amber-500/30 text-amber-200/80 hover:bg-amber-500/10"
                      : sel
                        ? "bg-rose-500 border-rose-500 text-white"
                        : "border-rose-500/30 text-rose-200/80 hover:bg-rose-500/10";
                return (
                  <button
                    key={v}
                    onClick={() => {
                      setVerdict(v);
                      if (v === "ok") {
                        setSIds(new Set());
                        setNsIds(new Set());
                        setPending([]);
                      }
                    }}
                    className={
                      "flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium " +
                      cls
                    }
                  >
                    {v === "ok" ? "Без замечаний" : v === "minor" ? "Мелкие" : "Серьёзные"}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tags */}
          {verdict !== "ok" && (
            <div className="space-y-2">
              {tagsLoading && (
                <div className="flex items-center gap-1.5 text-[11px] text-white/50">
                  <Loader2 className="h-3 w-3 animate-spin" /> Загружаем теги…
                </div>
              )}
              {!tagsLoading && serious.length > 0 && (
                <TagGroup
                  label="Серьёзные"
                  tags={serious}
                  selected={sIds}
                  onTap={(t) => toggle("s", t.id)}
                />
              )}
              {!tagsLoading && minor.length > 0 && (
                <TagGroup
                  label="Мелкие"
                  tags={minor}
                  selected={nsIds}
                  onTap={(t) => toggle("n", t.id)}
                />
              )}
              {pending.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wide text-white/45">
                    Новые теги (создадутся при отправке)
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {pending.map((p) => (
                      <button
                        key={`${p.severity ?? "_"}:${p.name}`}
                        onClick={() =>
                          togglePending(p.name, p.severity ?? "non_serious")
                        }
                        className="rounded-full border border-violet-400/40 bg-violet-500/10 px-2.5 py-1 text-xs text-violet-100"
                      >
                        ✨ {p.name} ×
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {!addOpen ? (
                <button
                  onClick={() => setAddOpen(true)}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-white/20 px-2.5 py-1 text-xs text-white/70 hover:text-white"
                >
                  <Plus className="h-3 w-3" /> Свой тег
                </button>
              ) : (
                <form
                  className="flex items-center gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = addName.trim();
                    if (!name) return;
                    togglePending(name, verdict === "serious" ? "serious" : "non_serious");
                    setAddName("");
                    setAddOpen(false);
                  }}
                >
                  <input
                    autoFocus
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    placeholder={verdict === "serious" ? "Серьёзный тег" : "Мелкий тег"}
                    className="flex-1 rounded-md bg-white/[0.06] border border-white/15 px-2 py-1 text-xs text-white placeholder:text-white/40 focus:outline-none focus:border-orange-400/60"
                  />
                  <button
                    type="submit"
                    className="rounded-md bg-orange-500 hover:bg-orange-600 px-2 py-1 text-xs text-white"
                  >
                    <Check className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddOpen(false);
                      setAddName("");
                    }}
                    className="rounded-md border border-white/15 px-2 py-1 text-xs text-white/70"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </form>
              )}
            </div>
          )}

          {/* Note */}
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wide text-white/45">
              Заметка
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Что видно на фото, локализация, степень…"
              className="w-full min-h-[64px] rounded-md bg-white/[0.06] border border-white/15 px-2 py-1.5 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-orange-400/60"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => {
                onDelete();
                onClose();
              }}
              className="rounded-xl border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 text-sm px-3 py-2"
            >
              Удалить
            </button>
            <button
              onClick={handleSave}
              className="flex-1 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm py-2 font-medium"
            >
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function chip(selected: boolean): string {
  return (
    "rounded-full border px-2.5 py-1 text-xs whitespace-nowrap transition-colors " +
    (selected
      ? "bg-orange-500 text-white border-orange-500"
      : "border-white/15 text-white/80 hover:border-orange-400/60 hover:text-white")
  );
}

function TagGroup({
  label,
  tags,
  selected,
  onTap,
}: {
  label: string;
  tags: UserTag[];
  selected: Set<number>;
  onTap: (t: UserTag) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wide text-white/45">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => {
          const sel = selected.has(t.id);
          return (
            <button key={t.id} onClick={() => onTap(t)} className={chip(sel)}>
              {sel ? "✓ " : ""}
              {t.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
