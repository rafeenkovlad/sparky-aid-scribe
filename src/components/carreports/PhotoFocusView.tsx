// Полноэкранный «чат с фотографией»: фото + быстрые действия (элемент,
// вердикт, теги). Заметка пишется через композер чата (см. ChatApp).
//
// Контракт: компонент чистый, никаких сетевых вызовов. Все мутации идут
// через колбэки наверх — родитель оркестрирует updateThread().

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, Plus, Trash2, X } from "lucide-react";
import { getSection, type SectionSnake } from "@/lib/carreports/inspectionSections";
import {
  getFinding,
  photosForSection,
} from "@/lib/carreports/inspectionState";
import type { InspectionStep, PendingTagName } from "@/lib/carreports/types";
import { loadSectionTags, type UserTag } from "@/lib/carreports/inspectionTags";

type Verdict = "ok" | "minor" | "serious";

export interface PhotoFocusViewProps {
  ins: InspectionStep;
  /** Индекс фото в ins.photos. */
  photoIdx: number;
  onChangePhotoIdx: (idx: number) => void;
  onChangeElement: (elementId: string) => void;
  onSetVerdict: (v: Verdict) => void;
  onToggleTag: (tag: UserTag) => void;
  onAddPendingTag: (name: string, severity: "serious" | "non_serious") => void;
  onTogglePendingTag: (name: string, severity: "serious" | "non_serious") => void;
  onDeletePhoto: () => void;
  onClose: () => void;
}

export function PhotoFocusView(props: PhotoFocusViewProps) {
  const {
    ins,
    photoIdx,
    onChangePhotoIdx,
    onChangeElement,
    onSetVerdict,
    onToggleTag,
    onAddPendingTag,
    onTogglePendingTag,
    onDeletePhoto,
    onClose,
  } = props;

  const photo = ins.photos[photoIdx];
  const sectionSnake = (photo?.section ?? "body") as SectionSnake;
  const section = getSection(sectionSnake);

  // Соседние фото того же раздела — для перелистывания.
  const siblings = useMemo(() => photosForSection(ins, sectionSnake), [ins, sectionSnake]);
  const posInSection = siblings.findIndex((p) => p.idx === photoIdx);

  const elementId =
    photo?.elementId ?? section?.elements[0]?.id ?? "generalCondition";
  const elementLabel =
    section?.elements.find((e) => e.id === elementId)?.label ?? "Без элемента";
  const finding = getFinding(ins, sectionSnake, elementId);

  const verdict: Verdict =
    (finding?.seriousDamageTagIds?.length ?? 0) > 0
      ? "serious"
      : (finding?.noSeriousDamageTagIds?.length ?? 0) > 0
        ? "minor"
        : finding?.noDamage === true
          ? "ok"
          : finding?.pendingTagNames?.length || finding?.note
            ? "minor"
            : "ok";

  // Теги раздела (lazy).
  const [tags, setTags] = useState<UserTag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    setTagsLoading(true);
    void loadSectionTags(sectionSnake).then((list) => {
      if (alive) {
        setTags(list);
        setTagsLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [sectionSnake]);

  const serious = tags.filter((t) => t.type === "serious");
  const minor = tags.filter((t) => t.type !== "serious");
  const sIds = new Set(finding?.seriousDamageTagIds ?? []);
  const nsIds = new Set(finding?.noSeriousDamageTagIds ?? []);
  const pending = finding?.pendingTagNames ?? [];

  // Свайп фото.
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const goPrev = () => {
    if (posInSection > 0) onChangePhotoIdx(siblings[posInSection - 1].idx);
  };
  const goNext = () => {
    if (posInSection >= 0 && posInSection < siblings.length - 1)
      onChangePhotoIdx(siblings[posInSection + 1].idx);
  };

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const activeBucket: "serious" | "non_serious" =
    verdict === "serious" ? "serious" : "non_serious";

  if (!photo) {
    return (
      <div className="flex-1 overflow-y-auto px-3 py-6 text-white/60 text-sm">
        Фото не найдено.{" "}
        <button onClick={onClose} className="underline">
          Назад
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Sub-header */}
      <div className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur border-b border-white/10 px-3 py-2 flex items-center gap-2">
        <button
          onClick={onClose}
          aria-label="Назад"
          className="h-8 w-8 rounded-full hover:bg-white/10 flex items-center justify-center text-white/90"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">
            Фото · {section?.label ?? sectionSnake}
          </div>
          <div className="text-[11px] text-white/50 truncate">
            {posInSection >= 0 ? `${posInSection + 1} / ${siblings.length}` : "—"}
            {" · "}
            {elementLabel}
          </div>
        </div>
        <button
          onClick={() => {
            if (confirm("Удалить это фото?")) onDeletePhoto();
          }}
          aria-label="Удалить фото"
          className="h-8 w-8 rounded-full hover:bg-rose-500/15 text-rose-300 flex items-center justify-center"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Photo */}
      <div
        className="relative bg-black/40 select-none"
        onTouchStart={(e) => {
          const t = e.touches[0];
          touchRef.current = { x: t.clientX, y: t.clientY };
        }}
        onTouchEnd={(e) => {
          const start = touchRef.current;
          touchRef.current = null;
          if (!start) return;
          const t = e.changedTouches[0];
          const dx = t.clientX - start.x;
          const dy = t.clientY - start.y;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            if (dx < 0) goNext();
            else goPrev();
          }
        }}
      >
        {photo.dataUrl ? (
          <img
            src={photo.dataUrl}
            alt=""
            className="block w-full max-h-[46dvh] object-contain"
          />
        ) : (
          <div className="h-40 flex items-center justify-center text-white/40 text-sm">
            нет превью
          </div>
        )}
        {siblings.length > 1 && (
          <>
            {posInSection > 0 && (
              <button
                onClick={goPrev}
                aria-label="Предыдущее фото"
                className="absolute left-1 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            {posInSection < siblings.length - 1 && (
              <button
                onClick={goNext}
                aria-label="Следующее фото"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            )}
            <div className="absolute inset-x-0 bottom-1.5 flex justify-center gap-1">
              {siblings.map((s, i) => (
                <span
                  key={s.idx}
                  className={
                    "inline-block h-1.5 rounded-full transition-all " +
                    (i === posInSection ? "w-4 bg-white" : "w-1.5 bg-white/40")
                  }
                />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="p-3 space-y-3">
        {/* Element picker */}
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-white/45">Элемент</div>
          <div className="flex flex-wrap gap-1.5">
            {section?.elements.map((el) => (
              <button
                key={el.id}
                onClick={() => onChangeElement(el.id)}
                className={chip(el.id === elementId)}
              >
                {el.label}
              </button>
            ))}
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
                  onClick={() => onSetVerdict(v)}
                  className={"flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium " + cls}
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
                tone="serious"
                tags={serious}
                selected={sIds}
                onTap={(t) => onToggleTag(t)}
              />
            )}
            {!tagsLoading && minor.length > 0 && (
              <TagGroup
                label="Мелкие"
                tone="minor"
                tags={minor}
                selected={nsIds}
                onTap={(t) => onToggleTag(t)}
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
                      onClick={() => onTogglePendingTag(p.name, (p.severity ?? "non_serious") as "serious" | "non_serious")}
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
                  onAddPendingTag(name, activeBucket);
                  setAddName("");
                  setAddOpen(false);
                }}
              >
                <input
                  autoFocus
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder={activeBucket === "serious" ? "Серьёзный тег" : "Мелкий тег"}
                  className="flex-1 rounded-md bg-white/[0.06] border border-white/15 px-2 py-1 text-xs text-white placeholder:text-white/40 focus:outline-none focus:border-orange-400/60"
                />
                <button
                  type="submit"
                  className="rounded-md bg-orange-500 hover:bg-orange-600 px-2 py-1 text-xs text-white"
                >
                  +
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

        {/* Note preview */}
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-white/45">Заметка</div>
          <div className="rounded-md bg-white/[0.04] border border-white/10 px-2.5 py-2 text-sm text-white/85 min-h-[44px]">
            {finding?.note ? (
              <span className="whitespace-pre-wrap">{finding.note}</span>
            ) : (
              <span className="text-white/40">
                Пишите заметку в композере ниже — отправка стрелкой сохранит её к этому фото.
              </span>
            )}
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

function TagGroup(props: {
  label: string;
  tone: "serious" | "minor";
  tags: UserTag[];
  selected: Set<number>;
  onTap: (t: UserTag) => void;
}) {
  const { label, tone, tags, selected, onTap } = props;
  const dotCls = tone === "serious" ? "bg-rose-400" : "bg-amber-400";
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-white/45">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotCls}`} />
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => {
          const sel = selected.has(t.id);
          const base =
            tone === "serious"
              ? sel
                ? "bg-rose-500 border-rose-500 text-white"
                : "border-rose-400/30 text-rose-100/80 hover:bg-rose-500/10"
              : sel
                ? "bg-amber-500 border-amber-500 text-white"
                : "border-amber-400/30 text-amber-100/80 hover:bg-amber-500/10";
          return (
            <button
              key={t.id}
              onClick={() => onTap(t)}
              className={
                "rounded-full border px-2.5 py-1 text-xs whitespace-nowrap transition-colors " +
                base
              }
            >
              {sel ? "✓ " : ""}
              {t.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
