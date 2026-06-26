// Полноэкранный «чат с фотографией»: фото-шапка + последовательные
// сообщения-ассистента (элемент → вердикт → теги) и пузырь-заметки.
// Заметка пишется через композер чата (см. ChatApp).
//
// Контракт: компонент чистый, никаких сетевых вызовов. Все мутации идут
// через колбэки наверх — родитель оркестрирует updateThread().

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { getSection, type SectionSnake } from "@/lib/carreports/inspectionSections";
import {
  getFinding,
  photosForSection,
} from "@/lib/carreports/inspectionState";
import type { InspectionStep } from "@/lib/carreports/types";
import { loadSectionTags, type UserTag } from "@/lib/carreports/inspectionTags";
import logo from "@/assets/cr-logo.png";

type Verdict = "ok" | "minor" | "serious";
type TagTab = "serious" | "minor" | "custom";

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

  const selectedSeriousTags = serious.filter((t) => sIds.has(t.id));
  const selectedMinorTags = minor.filter((t) => nsIds.has(t.id));
  const totalSelected =
    selectedSeriousTags.length + selectedMinorTags.length + pending.length;

  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const goPrev = () => {
    if (posInSection > 0) onChangePhotoIdx(siblings[posInSection - 1].idx);
  };
  const goNext = () => {
    if (posInSection >= 0 && posInSection < siblings.length - 1)
      onChangePhotoIdx(siblings[posInSection + 1].idx);
  };

  const [tab, setTab] = useState<TagTab>("serious");
  useEffect(() => {
    setTab(verdict === "serious" ? "serious" : verdict === "minor" ? "minor" : "serious");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoIdx]);

  const [query, setQuery] = useState("");
  useEffect(() => setQuery(""), [photoIdx, tab]);

  const [addName, setAddName] = useState("");
  const activeBucket: "serious" | "non_serious" =
    tab === "serious" ? "serious" : "non_serious";

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

  const verdictMeta: Record<Verdict, { label: string; dot: string; ring: string }> = {
    ok: {
      label: "Без замечаний",
      dot: "bg-emerald-400",
      ring: "ring-emerald-400/60 bg-emerald-500/15 text-emerald-100",
    },
    minor: {
      label: "Мелкие",
      dot: "bg-amber-400",
      ring: "ring-amber-400/60 bg-amber-500/15 text-amber-100",
    },
    serious: {
      label: "Серьёзные",
      dot: "bg-rose-400",
      ring: "ring-rose-400/60 bg-rose-500/15 text-rose-100",
    },
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Sub-header */}
      <div className="sticky top-0 z-20 bg-zinc-950/95 backdrop-blur border-b border-white/10 px-2.5 py-2 flex items-center gap-2">
        <button
          onClick={onClose}
          aria-label="Назад"
          className="h-8 w-8 rounded-full hover:bg-white/10 flex items-center justify-center text-white/90 shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium truncate text-white">
            {elementLabel}
          </div>
          <div className="text-[11px] text-white/50 truncate">
            {section?.label ?? sectionSnake}
            {posInSection >= 0 && (
              <>
                <span className="text-white/25"> · </span>
                {posInSection + 1}/{siblings.length}
              </>
            )}
          </div>
        </div>
        <button
          onClick={() => {
            if (confirm("Удалить это фото?")) onDeletePhoto();
          }}
          aria-label="Удалить фото"
          className="h-8 w-8 rounded-full hover:bg-rose-500/15 text-rose-300 flex items-center justify-center shrink-0"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Photo as the "pinned" message */}
      <div
        className="relative bg-gradient-to-b from-black to-black/70 select-none"
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
            className="block w-full max-h-[34dvh] object-contain"
          />
        ) : (
          <div className="h-40 flex items-center justify-center text-white/40 text-sm">
            нет превью
          </div>
        )}

        <div
          className={`absolute top-2 right-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 backdrop-blur ${verdictMeta[verdict].ring}`}
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${verdictMeta[verdict].dot}`} />
          {verdictMeta[verdict].label}
        </div>

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
          </>
        )}
      </div>

      {/* Thumbnail strip */}
      {siblings.length > 1 && (
        <div className="px-2 py-1.5 bg-black/40 border-b border-white/5 overflow-x-auto">
          <div className="flex gap-1.5 w-max">
            {siblings.map((s) => {
              const sel = s.idx === photoIdx;
              return (
                <button
                  key={s.idx}
                  onClick={() => onChangePhotoIdx(s.idx)}
                  className={
                    "relative h-11 w-11 rounded-md overflow-hidden border shrink-0 " +
                    (sel
                      ? "border-orange-400 ring-1 ring-orange-400"
                      : "border-white/10 opacity-60 hover:opacity-100")
                  }
                >
                  {s.photo.dataUrl ? (
                    <img src={s.photo.dataUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full bg-white/5" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Chat-like conversation */}
      <div className="px-3 pt-3 pb-5 space-y-3">
        {/* 1. Element picker bubble */}
        <AssistantBubble title="Какой элемент на фото?">
          <div className="-mx-3 px-3 overflow-x-auto">
            <div className="flex gap-1.5 w-max pb-0.5">
              {section?.elements.map((el) => {
                const sel = el.id === elementId;
                return (
                  <button
                    key={el.id}
                    onClick={() => onChangeElement(el.id)}
                    className={
                      "rounded-full border px-3 py-1.5 text-xs whitespace-nowrap transition-colors " +
                      (sel
                        ? "bg-orange-500 text-white border-orange-500"
                        : "bg-white/[0.03] border-white/10 text-white/75 hover:border-orange-400/50 hover:text-white")
                    }
                  >
                    {el.label}
                  </button>
                );
              })}
            </div>
          </div>
        </AssistantBubble>

        {/* User reply bubble: selected element */}
        <UserBubble>{elementLabel}</UserBubble>

        {/* 2. Verdict bubble */}
        <AssistantBubble title="Что с этим элементом?">
          <div className="grid grid-cols-3 gap-1.5">
            {(["ok", "minor", "serious"] as Verdict[]).map((v) => {
              const sel = verdict === v;
              const tone =
                v === "ok"
                  ? sel
                    ? "bg-emerald-500 text-white border-emerald-500"
                    : "border-emerald-400/30 text-emerald-100/85 hover:bg-emerald-500/10"
                  : v === "minor"
                    ? sel
                      ? "bg-amber-500 text-white border-amber-500"
                      : "border-amber-400/30 text-amber-100/85 hover:bg-amber-500/10"
                    : sel
                      ? "bg-rose-500 text-white border-rose-500"
                      : "border-rose-400/30 text-rose-100/85 hover:bg-rose-500/10";
              const icon = v === "ok" ? "✓" : v === "minor" ? "•" : "!";
              return (
                <button
                  key={v}
                  onClick={() => onSetVerdict(v)}
                  className={
                    "rounded-lg border px-2 py-2 text-xs font-medium transition-all flex items-center justify-center gap-1.5 " +
                    tone
                  }
                >
                  <span className="text-sm leading-none">{icon}</span>
                  {v === "ok" ? "OK" : v === "minor" ? "Мелкие" : "Серьёзные"}
                </button>
              );
            })}
          </div>
        </AssistantBubble>

        {/* User reply: verdict */}
        <UserBubble>
          <span className="inline-flex items-center gap-1.5">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${verdictMeta[verdict].dot}`} />
            {verdictMeta[verdict].label}
          </span>
        </UserBubble>

        {/* 3. Tags bubble — only when there can be tags */}
        {verdict === "ok" && totalSelected === 0 ? (
          <AssistantBubble title="Готово">
            <div className="text-[12px] text-emerald-100/85">
              ✓ Без замечаний по «{elementLabel}». Если что-то заметили — переключите вердикт выше.
            </div>
          </AssistantBubble>
        ) : (
          <AssistantBubble title="Что именно заметили? Выберите теги">
            <div className="space-y-2">
              <div className="flex items-center gap-1 rounded-lg bg-white/[0.04] border border-white/10 p-0.5">
                <TabBtn
                  active={tab === "serious"}
                  onClick={() => setTab("serious")}
                  dot="bg-rose-400"
                  label="Серьёзные"
                  count={serious.length}
                />
                <TabBtn
                  active={tab === "minor"}
                  onClick={() => setTab("minor")}
                  dot="bg-amber-400"
                  label="Мелкие"
                  count={minor.length}
                />
                <TabBtn
                  active={tab === "custom"}
                  onClick={() => setTab("custom")}
                  dot="bg-violet-400"
                  label="Свои"
                  count={pending.length}
                />
              </div>

              {tab !== "custom" && tags.length > 6 && (
                <div className="relative">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Поиск тега…"
                    className="w-full rounded-lg bg-white/[0.04] border border-white/10 pl-3 pr-7 py-1.5 text-xs text-white placeholder:text-white/35 focus:outline-none focus:border-orange-400/60"
                  />
                  {query && (
                    <button
                      onClick={() => setQuery("")}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full hover:bg-white/10 flex items-center justify-center text-white/60"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}

              {tagsLoading && tab !== "custom" && (
                <div className="flex items-center gap-1.5 text-[11px] text-white/50">
                  <Loader2 className="h-3 w-3 animate-spin" /> Загружаем теги…
                </div>
              )}

              {!tagsLoading && tab === "serious" && (
                <TagGrid
                  tone="serious"
                  tags={filterTags(serious, query)}
                  selected={sIds}
                  onTap={onToggleTag}
                />
              )}
              {!tagsLoading && tab === "minor" && (
                <TagGrid
                  tone="minor"
                  tags={filterTags(minor, query)}
                  selected={nsIds}
                  onTap={onToggleTag}
                />
              )}

              {tab === "custom" && (
                <div className="space-y-2">
                  {pending.length === 0 && (
                    <div className="text-[11px] text-white/45 italic">
                      Своих тегов ещё нет. Добавьте ниже — они создадутся при отправке.
                    </div>
                  )}
                  {pending.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {pending.map((p) => (
                        <button
                          key={`cp-${p.severity ?? "_"}-${p.name}`}
                          onClick={() =>
                            onTogglePendingTag(
                              p.name,
                              (p.severity ?? "non_serious") as "serious" | "non_serious",
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 border border-violet-400/40 px-2.5 py-1 text-[11px] text-violet-100"
                        >
                          <Check className="h-3 w-3" /> ✨ {p.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <form
                className="flex items-center gap-1.5 pt-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = addName.trim();
                  if (!name) return;
                  onAddPendingTag(name, activeBucket);
                  setAddName("");
                }}
              >
                <div className="flex items-center gap-1 text-[10px] text-white/40 shrink-0">
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      activeBucket === "serious" ? "bg-rose-400" : "bg-amber-400"
                    }`}
                  />
                  {activeBucket === "serious" ? "серьёз." : "мелкий"}
                </div>
                <input
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="Свой тег…"
                  className="flex-1 min-w-0 rounded-lg bg-white/[0.04] border border-white/10 px-2.5 py-1.5 text-xs text-white placeholder:text-white/35 focus:outline-none focus:border-orange-400/60"
                />
                <button
                  type="submit"
                  disabled={!addName.trim()}
                  className="inline-flex items-center gap-1 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-40 px-2.5 py-1.5 text-xs text-white"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </form>
            </div>
          </AssistantBubble>
        )}

        {/* User reply: selected tags */}
        {totalSelected > 0 && (
          <UserBubble>
            <div className="flex flex-wrap gap-1.5 justify-end">
              {selectedSeriousTags.map((t) => (
                <button
                  key={`s-${t.id}`}
                  onClick={() => onToggleTag(t)}
                  className="inline-flex items-center gap-1 rounded-full bg-rose-500/90 hover:bg-rose-500 px-2 py-0.5 text-[11px] text-white"
                >
                  {t.name}
                  <X className="h-3 w-3 opacity-80" />
                </button>
              ))}
              {selectedMinorTags.map((t) => (
                <button
                  key={`n-${t.id}`}
                  onClick={() => onToggleTag(t)}
                  className="inline-flex items-center gap-1 rounded-full bg-amber-500/90 hover:bg-amber-500 px-2 py-0.5 text-[11px] text-white"
                >
                  {t.name}
                  <X className="h-3 w-3 opacity-80" />
                </button>
              ))}
              {pending.map((p) => (
                <button
                  key={`p-${p.severity ?? "_"}-${p.name}`}
                  onClick={() =>
                    onTogglePendingTag(
                      p.name,
                      (p.severity ?? "non_serious") as "serious" | "non_serious",
                    )
                  }
                  className="inline-flex items-center gap-1 rounded-full bg-violet-500/80 hover:bg-violet-500 px-2 py-0.5 text-[11px] text-white"
                >
                  ✨ {p.name}
                  <X className="h-3 w-3 opacity-80" />
                </button>
              ))}
            </div>
          </UserBubble>
        )}

        {/* 4. Note bubble */}
        {finding?.note ? (
          <>
            <AssistantBubble title="Заметка к фото">
              <div className="text-[11px] text-white/45">
                Сохранено · отредактируйте через композер ниже.
              </div>
            </AssistantBubble>
            <UserBubble>
              <div className="whitespace-pre-wrap">{finding.note}</div>
            </UserBubble>
          </>
        ) : (
          <AssistantBubble title="Заметка к фото">
            <div className="text-[12px] text-white/65">
              💬 Напишите заметку в композере ниже — отправка сохранит её к этому фото.
              <br />
              <span className="text-white/45">✨ — ИИ разберёт заметку по тегам.</span>
            </div>
          </AssistantBubble>
        )}
      </div>
    </div>
  );
}

function AssistantBubble(props: { title?: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 items-start">
      <div className="h-7 w-7 shrink-0 rounded-full bg-orange-500/15 border border-orange-500/30 flex items-center justify-center">
        <img src={logo} alt="" className="h-4 w-4 invert" />
      </div>
      <div className="max-w-[88%] space-y-1.5">
        <div className="text-[10px] uppercase tracking-wide text-white/40">ИИ-ассистент</div>
        <div className="rounded-2xl rounded-tl-md bg-white/[0.04] border border-white/10 text-sm px-3 py-2.5 text-white">
          {props.title && (
            <div className="text-[12px] text-white/85 mb-2">{props.title}</div>
          )}
          {props.children}
        </div>
      </div>
    </div>
  );
}

function UserBubble(props: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-orange-500 text-white text-sm px-3 py-2">
        {props.children}
      </div>
    </div>
  );
}

function filterTags(list: UserTag[], q: string): UserTag[] {
  const s = q.trim().toLowerCase();
  if (!s) return list;
  return list.filter((t) => t.name.toLowerCase().includes(s));
}

function TabBtn(props: {
  active: boolean;
  onClick: () => void;
  dot: string;
  label: string;
  count: number;
}) {
  const { active, onClick, dot, label, count } = props;
  return (
    <button
      onClick={onClick}
      className={
        "flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors " +
        (active
          ? "bg-white/10 text-white"
          : "text-white/55 hover:text-white/85")
      }
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
      <span className={"text-[10px] " + (active ? "text-white/55" : "text-white/30")}>
        {count}
      </span>
    </button>
  );
}

function TagGrid(props: {
  tone: "serious" | "minor";
  tags: UserTag[];
  selected: Set<number>;
  onTap: (t: UserTag) => void;
}) {
  const { tone, tags, selected, onTap } = props;
  if (tags.length === 0) {
    return (
      <div className="text-[11px] text-white/40 italic px-0.5">
        Ничего не найдено.
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => {
        const sel = selected.has(t.id);
        const base =
          tone === "serious"
            ? sel
              ? "bg-rose-500 border-rose-500 text-white"
              : "border-rose-400/25 bg-rose-500/[0.04] text-rose-100/85 hover:bg-rose-500/10 hover:border-rose-400/50"
            : sel
              ? "bg-amber-500 border-amber-500 text-white"
              : "border-amber-400/25 bg-amber-500/[0.04] text-amber-100/85 hover:bg-amber-500/10 hover:border-amber-400/50";
        return (
          <button
            key={t.id}
            onClick={() => onTap(t)}
            className={
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] whitespace-nowrap transition-all " +
              base
            }
          >
            {sel && <Check className="h-3 w-3" />}
            {t.name}
          </button>
        );
      })}
    </div>
  );
}
