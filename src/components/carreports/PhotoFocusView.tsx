// «Чат с фотографией»: фото-шапка + быстрые действия в стиле шага осмотра
// (элемент → вердикт → теги: серьёзные и мелкие как отдельные бакеты).
// Заметка пишется через композер чата. После сохранения родитель может
// передать AI-переформулировку — мы покажем выбор «оригинал/AI».
//
// Компонент чистый: все мутации идут через колбэки наверх.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { getSection, type SectionSnake } from "@/lib/carreports/inspectionSections";
import { getFinding, photosForSection } from "@/lib/carreports/inspectionState";
import type { InspectionStep, PendingTagName } from "@/lib/carreports/types";
import { loadSectionTags, type UserTag } from "@/lib/carreports/inspectionTags";

type Verdict = "ok" | "minor" | "serious";

export interface NoteProposal {
  /** Что напечатал пользователь. */
  original: string;
  /** AI-переформулировка; null пока грузится; "" если не удалось. */
  ai: string | null;
  loading: boolean;
  /** Чей вариант сейчас закреплён в finding.note. */
  picked?: "original" | "ai";
}

export interface PhotoFocusViewProps {
  ins: InspectionStep;
  photoIdx: number;
  onChangePhotoIdx: (idx: number) => void;
  onChangeElement: (elementId: string) => void;
  onSetVerdict: (v: Verdict) => void;
  onToggleTag: (tag: UserTag) => void;
  onAddPendingTag: (name: string, severity: "serious" | "non_serious") => void;
  onTogglePendingTag: (name: string, severity: "serious" | "non_serious") => void;
  onDeletePhoto: () => void;
  onClose: () => void;
  /** Активное предложение по заметке (оригинал vs AI). */
  noteProposal?: NoteProposal | null;
  onPickNoteOriginal?: () => void;
  onPickNoteAi?: () => void;
  onDismissNoteProposal?: () => void;
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
    noteProposal,
    onPickNoteOriginal,
    onPickNoteAi,
    onDismissNoteProposal,
  } = props;

  const photo = ins.photos[photoIdx];
  const sectionSnake = (photo?.section ?? "body") as SectionSnake;
  const section = getSection(sectionSnake);

  const siblings = useMemo(
    () => photosForSection(ins, sectionSnake),
    [ins, sectionSnake],
  );
  const posInSection = siblings.findIndex((p) => p.idx === photoIdx);

  const elementId =
    photo?.elementId ?? section?.elements[0]?.id ?? "generalCondition";
  const elementLabel =
    section?.elements.find((e) => e.id === elementId)?.label ?? "Без элемента";
  const finding = getFinding(ins, sectionSnake, elementId);

  // Хранимый вердикт — выводим из finding; пользователь может «переключить»
  // вкладку minor/serious, не теряя теги другой стороны.
  const derivedVerdict: Verdict | null =
    (finding?.seriousDamageTagIds?.length ?? 0) > 0
      ? "serious"
      : (finding?.noSeriousDamageTagIds?.length ?? 0) > 0
        ? "minor"
        : finding?.noDamage === true
          ? "ok"
          : null;
  const [activeTab, setActiveTab] = useState<"minor" | "serious">(
    derivedVerdict === "serious" ? "serious" : "minor",
  );
  useEffect(() => {
    setActiveTab(derivedVerdict === "serious" ? "serious" : "minor");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoIdx, elementId]);

  // Базовый каталог тегов раздела (кэшируется).
  const [tags, setTags] = useState<UserTag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagsError, setTagsError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setTagsLoading(true);
    setTagsError(null);
    loadSectionTags(sectionSnake)
      .then((list) => {
        if (!alive) return;
        setTags(list);
        setTagsLoading(false);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : String(e);
        setTagsError(/unauthorized/i.test(msg) ? "Сессия истекла — обновите токен в меню" : msg);
        setTags([]);
        setTagsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [sectionSnake]);


  const sIds = new Set(finding?.seriousDamageTagIds ?? []);
  const nsIds = new Set(finding?.noSeriousDamageTagIds ?? []);
  const pending = finding?.pendingTagNames ?? [];

  // Релевантная подсказка: запрашиваем с selectedTagIds — сервер вернёт
  // теги, чаще встречающиеся вместе с выбранными, без самих выбранных.
  // Используем порядок этого ответа как приоритет сортировки.
  const selectedIdsKey = useMemo(
    () =>
      [...sIds, ...nsIds]
        .filter((n): n is number => typeof n === "number")
        .sort((a, b) => a - b)
        .join(","),
    [sIds, nsIds],
  );
  const [relevanceOrder, setRelevanceOrder] = useState<number[]>([]);
  useEffect(() => {
    if (!selectedIdsKey) {
      setRelevanceOrder([]);
      return;
    }
    let alive = true;
    const ids = selectedIdsKey.split(",").map((n) => Number(n));
    void loadSectionTags(sectionSnake, ids).then((list) => {
      if (alive) setRelevanceOrder(list.map((t) => t.id));
    });
    return () => {
      alive = false;
    };
  }, [sectionSnake, selectedIdsKey]);

  // Сортировка: выбранные → релевантные (в порядке сервера) → остальные.
  const sortByRelevance = useCallback(
    (list: UserTag[], selected: Set<number>) => {
      if (list.length === 0) return list;
      const sel: UserTag[] = [];
      const rel: UserTag[] = [];
      const rest: UserTag[] = [];
      const relRank = new Map<number, number>();
      relevanceOrder.forEach((id, i) => relRank.set(id, i));
      for (const t of list) {
        if (selected.has(t.id)) sel.push(t);
        else if (relRank.has(t.id)) rel.push(t);
        else rest.push(t);
      }
      rel.sort(
        (a, b) => (relRank.get(a.id) ?? 0) - (relRank.get(b.id) ?? 0),
      );
      return [...sel, ...rel, ...rest];
    },
    [relevanceOrder],
  );

  const serious = useMemo(
    () => sortByRelevance(tags.filter((t) => t.type === "serious"), sIds),
    [tags, sIds, sortByRelevance],
  );
  const minor = useMemo(
    () => sortByRelevance(tags.filter((t) => t.type !== "serious"), nsIds),
    [tags, nsIds, sortByRelevance],
  );

  const goPrev = () => {
    if (posInSection > 0) onChangePhotoIdx(siblings[posInSection - 1].idx);
  };
  const goNext = () => {
    if (posInSection >= 0 && posInSection < siblings.length - 1)
      onChangePhotoIdx(siblings[posInSection + 1].idx);
  };

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

  const verdictDot =
    derivedVerdict === "serious"
      ? "bg-rose-400"
      : derivedVerdict === "minor"
        ? "bg-amber-400"
        : derivedVerdict === "ok"
          ? "bg-emerald-400"
          : "bg-white/30";
  const verdictLabel =
    derivedVerdict === "serious"
      ? "Серьёзные"
      : derivedVerdict === "minor"
        ? "Мелкие"
        : derivedVerdict === "ok"
          ? "Без замечаний"
          : "Не оценено";

  const activeBucket: "serious" | "non_serious" =
    activeTab === "serious" ? "serious" : "non_serious";

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

      {/* Photo */}
      <div className="relative bg-gradient-to-b from-black to-black/70 select-none">
        {photo.dataUrl ? (
          <img
            src={photo.dataUrl}
            alt=""
            className="block w-full max-h-[42dvh] object-contain"
          />
        ) : (
          <div className="h-40 flex items-center justify-center text-white/40 text-sm">
            нет превью
          </div>
        )}
        <div
          className={
            "absolute top-2 right-2 inline-flex items-center gap-1.5 rounded-full bg-black/55 backdrop-blur px-2.5 py-1 text-[11px] font-medium text-white ring-1 ring-white/15"
          }
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${verdictDot}`} />
          {verdictLabel}
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

      {/* Thumbnails */}
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
                    <img
                      src={s.photo.dataUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full bg-white/5" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Quick actions — наследуем интерфейс шага осмотра */}
      <div className="px-3 py-3 space-y-3">
        {/* Элемент */}
        <div>
          <div className="text-[10px] uppercase tracking-wide text-white/45 mb-1.5">
            Элемент
          </div>
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
        </div>

        {/* Вердикт */}
        <div>
          <div className="text-[10px] uppercase tracking-wide text-white/45 mb-1.5">
            Состояние
          </div>
          <div className="flex gap-1.5">
            {(["ok", "minor", "serious"] as Verdict[]).map((v) => {
              const sel =
                v === "ok"
                  ? derivedVerdict === "ok"
                  : activeTab === v;
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
                    if (v === "ok") onSetVerdict("ok");
                    else {
                      setActiveTab(v);
                      onSetVerdict(v);
                    }
                  }}
                  className={
                    "flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors " +
                    cls
                  }
                >
                  {v === "ok" ? "Без замечаний" : v === "minor" ? "Мелкие" : "Серьёзные"}
                </button>
              );
            })}
          </div>
        </div>

        {/* Теги: отдельные бакеты для серьёзных и мелких */}
        {derivedVerdict !== "ok" && (
          <div className="space-y-3">
            {tagsLoading && (
              <div className="flex items-center gap-1.5 text-[11px] text-white/50">
                <Loader2 className="h-3 w-3 animate-spin" /> Загружаем теги…
              </div>
            )}

            {!tagsLoading && (
              <>
                <TagBucket
                  tone="serious"
                  label="Серьёзные дефекты"
                  tags={serious}
                  selected={sIds}
                  pending={pending.filter((p) => p.severity === "serious")}
                  onTap={onToggleTag}
                  onTogglePending={(name) => onTogglePendingTag(name, "serious")}
                />
                <TagBucket
                  tone="minor"
                  label="Мелкие замечания"
                  tags={minor}
                  selected={nsIds}
                  pending={pending.filter((p) => p.severity !== "serious")}
                  onTap={onToggleTag}
                  onTogglePending={(name) => onTogglePendingTag(name, "non_serious")}
                />
              </>
            )}

            <CustomTagInput bucket={activeBucket} onAdd={onAddPendingTag} />
          </div>
        )}

        {/* Заметка */}
        <NoteBlock
          note={finding?.note}
          proposal={noteProposal}
          onPickOriginal={onPickNoteOriginal}
          onPickAi={onPickNoteAi}
          onDismiss={onDismissNoteProposal}
        />
      </div>
    </div>
  );
}

// ─── Подкомпоненты ────────────────────────────────────────────────────────

function TagBucket(props: {
  tone: "serious" | "minor";
  label: string;
  tags: UserTag[];
  selected: Set<number>;
  pending: PendingTagName[];
  onTap: (t: UserTag) => void;
  onTogglePending: (name: string) => void;
}) {
  const { tone, label, tags, selected, pending, onTap, onTogglePending } = props;
  const sorted = useMemo(() => {
    const sel: UserTag[] = [];
    const rest: UserTag[] = [];
    for (const t of tags) (selected.has(t.id) ? sel : rest).push(t);
    return [...sel, ...rest];
  }, [tags, selected]);
  const count = selected.size + pending.length;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wide text-white/45 flex items-center gap-1.5">
          <span
            className={
              "inline-block h-1.5 w-1.5 rounded-full " +
              (tone === "serious" ? "bg-rose-400" : "bg-amber-400")
            }
          />
          {label}
        </div>
        {count > 0 && (
          <span className="text-[10px] text-white/45 tabular-nums">
            выбрано {count}
          </span>
        )}
      </div>
      {sorted.length === 0 && pending.length === 0 ? (
        <div className="text-[11px] text-white/35 italic">
          Каталог пуст. Добавьте свой тег ниже — он создастся при отправке.
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {sorted.map((t) => {
            const sel = selected.has(t.id);
            return (
              <button
                key={t.id}
                onClick={() => onTap(t)}
                className={tagChip(tone, sel)}
              >
                {sel && <Check className="h-3 w-3 -ml-0.5" />}
                {t.name}
              </button>
            );
          })}
          {pending.map((p) => (
            <button
              key={`pending:${p.name}`}
              onClick={() => onTogglePending(p.name)}
              className="inline-flex items-center gap-1 rounded-full border border-violet-400/40 bg-violet-500/15 px-2.5 py-1 text-xs text-violet-100 hover:bg-violet-500/25"
              title="Новый тег — создастся при отправке. Нажмите, чтобы убрать."
            >
              ✨ {p.name}
              <X className="h-3 w-3 opacity-70" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function tagChip(tone: "serious" | "minor", selected: boolean): string {
  const base =
    "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs whitespace-nowrap transition-colors ";
  if (selected) {
    return (
      base +
      (tone === "serious"
        ? "bg-rose-500 border-rose-500 text-white"
        : "bg-amber-500 border-amber-500 text-white")
    );
  }
  return (
    base +
    (tone === "serious"
      ? "border-rose-400/30 text-rose-100/85 hover:bg-rose-500/10 hover:border-rose-400/60"
      : "border-amber-400/30 text-amber-100/85 hover:bg-amber-500/10 hover:border-amber-400/60")
  );
}

function CustomTagInput(props: {
  bucket: "serious" | "non_serious";
  onAdd: (name: string, severity: "serious" | "non_serious") => void;
}) {
  const { bucket, onAdd } = props;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-white/20 px-2.5 py-1 text-xs text-white/65 hover:text-white hover:border-white/40"
      >
        <Plus className="h-3 w-3" /> Свой тег в «{bucket === "serious" ? "серьёзные" : "мелкие"}»
      </button>
    );
  }
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        const n = name.trim();
        if (!n) return;
        onAdd(n, bucket);
        setName("");
        setOpen(false);
      }}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={
          bucket === "serious" ? "Новый серьёзный тег" : "Новый мелкий тег"
        }
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
          setOpen(false);
          setName("");
        }}
        className="rounded-md border border-white/15 px-2 py-1 text-xs text-white/70 hover:text-white"
      >
        <X className="h-3 w-3" />
      </button>
    </form>
  );
}

function NoteBlock(props: {
  note?: string;
  proposal?: NoteProposal | null;
  onPickOriginal?: () => void;
  onPickAi?: () => void;
  onDismiss?: () => void;
}) {
  const { note, proposal, onPickOriginal, onPickAi, onDismiss } = props;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-white/45 mb-1.5">
        Заметка
      </div>
      {note ? (
        <div className="rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2 text-[13px] text-white whitespace-pre-wrap">
          {note}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-white/15 px-3 py-2 text-[12px] text-white/45">
          💬 Напишите заметку в композере ниже — Enter сохранит её к этому фото.
        </div>
      )}

      {proposal && (
        <div className="mt-2 rounded-xl border border-violet-400/30 bg-violet-500/10 px-3 py-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] uppercase tracking-wide text-violet-200/85 flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" /> Вариант ИИ
            </div>
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="h-5 w-5 rounded-full hover:bg-white/10 text-white/60 flex items-center justify-center"
                aria-label="Скрыть"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="grid gap-2">
            <ProposalRow
              kind="original"
              picked={proposal.picked === "original"}
              text={proposal.original}
              onPick={onPickOriginal}
            />
            <ProposalRow
              kind="ai"
              picked={proposal.picked === "ai"}
              text={proposal.ai ?? ""}
              loading={proposal.loading}
              onPick={onPickAi}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ProposalRow(props: {
  kind: "original" | "ai";
  picked: boolean;
  text: string;
  loading?: boolean;
  onPick?: () => void;
}) {
  const { kind, picked, text, loading, onPick } = props;
  const title = kind === "original" ? "Оригинал" : "Сформулировано ИИ";
  const disabled = loading || (kind === "ai" && !text);
  return (
    <div
      className={
        "rounded-lg border px-2.5 py-2 text-[12px] " +
        (picked
          ? "bg-emerald-500/15 border-emerald-400/50 text-white"
          : "bg-black/20 border-white/10 text-white/85")
      }
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="text-[10px] uppercase tracking-wide text-white/50">
          {title}
        </div>
        <button
          disabled={disabled}
          onClick={onPick}
          className={
            "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors " +
            (picked
              ? "bg-emerald-500 text-white"
              : "bg-white/10 hover:bg-white/20 text-white disabled:opacity-40")
          }
        >
          {picked ? "Выбрано" : "Оставить"}
        </button>
      </div>
      {loading && kind === "ai" ? (
        <div className="flex items-center gap-1.5 text-white/55">
          <Loader2 className="h-3 w-3 animate-spin" /> Формулирую…
        </div>
      ) : text ? (
        <div className="whitespace-pre-wrap">{text}</div>
      ) : (
        <div className="text-white/40 italic">пусто</div>
      )}
    </div>
  );
}
