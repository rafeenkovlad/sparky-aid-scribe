// Inline-карточка фокуса на одном элементе осмотра: рендерится прямо в
// ленте чата (не отдельным экраном). Фото + выбор элемента + вердикт +
// теги (серьёзные/мелкие) + AI-предложения. Заметка пишется через общий
// композер чата.
//
// Компонент чистый: все мутации идут через колбэки наверх.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { getSection, type SectionSnake } from "@/lib/carreports/inspectionSections";
import { getFinding, photosForSection } from "@/lib/carreports/inspectionState";
import type { InspectionStep, NoteProposalPayload, PendingTagName } from "@/lib/carreports/types";
import { deleteUserTag, loadSectionTags, updateUserTag, type UserTag } from "@/lib/carreports/inspectionTags";
import { NoteProposalInline } from "./NoteProposalInline";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { subscribeToken } from "@/lib/carreports/tokenStore";


type Verdict = "ok" | "minor" | "serious";

export interface NoteProposal {
  /** Что напечатал пользователь. */
  original: string;
  /** AI-сформулированная заметка специалиста (без рекомендаций). */
  ai: string | null;
  loading: boolean;
  /** Чей вариант сейчас закреплён в finding.note. */
  picked?: "original" | "ai";
  /** Предложения тегов от ИИ — пользователь подтверждает вручную. */
  proposedSeriousIds?: number[];
  proposedNonSeriousIds?: number[];
  proposedPending?: PendingTagName[];
  /** Предложение по элементу (если AI распознал другой). */
  proposedElementId?: string;
}

export interface ElementFocusCardProps {
  ins: InspectionStep;
  photoIdx: number;
  onChangePhotoIdx: (idx: number) => void;
  onChangeElement: (elementId: string) => void;
  onSetVerdict: (v: Verdict) => void;
  onToggleTag: (tag: UserTag) => void;
  onAddPendingTag: (name: string, severity: "serious" | "non_serious") => void;
  onTogglePendingTag: (name: string, severity: "serious" | "non_serious") => void;
  /** Удалить фото; кнопка показывается только если передан колбэк. */
  onDeletePhoto?: () => void;
  noteProposal?: NoteProposal | null;
  onPickNoteOriginal?: () => void;
  onPickNoteAi?: () => void;
  onDismissNoteProposal?: () => void;
  /** ИИ сейчас анализирует заметку — подсвечиваем поля паспорта. */
  aiUpdating?: boolean;
  /** Inline-предложение переформулировать заметку из чат-пайплайна. */
  chatNoteProposal?: {
    payload: NoteProposalPayload;
    onPickOriginal: () => void;
    onPickAi: () => void;
    onDismiss: () => void;
  };
  /** Открыть редактор: префилл композера шаблоном правки этого элемента. */
  onEdit?: (template: string) => void;
}

export function ElementFocusCard(props: ElementFocusCardProps) {
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
    noteProposal,
    onPickNoteOriginal,
    onPickNoteAi,
    onDismissNoteProposal,
    aiUpdating,
    chatNoteProposal,
    onEdit,
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
  // (Раньше здесь был activeTab serious/minor — теперь оба ряда тегов
  // отображаются одновременно, так что переключатель не нужен.)


  const sIds = new Set(finding?.seriousDamageTagIds ?? []);
  const nsIds = new Set(finding?.noSeriousDamageTagIds ?? []);
  const pending = finding?.pendingTagNames ?? [];

  // Ключ выбранных tagId — стабильная строка, используется как зависимость
  // для перезагрузки списка тегов через Storage.GetUserTags. Сервер вернёт
  // список, релевантный набору уже выбранных тегов.
  const sIdsKey = (finding?.seriousDamageTagIds ?? []).slice().sort((a, b) => a - b).join(",");
  const nsIdsKey = (finding?.noSeriousDamageTagIds ?? []).slice().sort((a, b) => a - b).join(",");
  const selectedIdsKey = useMemo(
    () => {
      const all = [
        ...(finding?.seriousDamageTagIds ?? []),
        ...(finding?.noSeriousDamageTagIds ?? []),
      ].filter((n): n is number => typeof n === "number");
      return all.sort((a, b) => a - b).join(",");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sIdsKey, nsIdsKey],
  );

  // Базовый каталог тегов раздела. Перезапрашиваем при изменении набора
  // выбранных tagId — сервер возвращает более релевантный список.
  const [tags, setTags] = useState<UserTag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagsError, setTagsError] = useState<string | null>(null);
  // Тик, который обновляется при смене токена / каталога — заставляет перезапросить теги.
  const [tokenTick, setTokenTick] = useState(0);
  useEffect(() => subscribeToken(() => setTokenTick((t) => t + 1)), []);
  useEffect(() => {
    let alive = true;
    setTagsLoading(true);
    setTagsError(null);
    const ids = selectedIdsKey ? selectedIdsKey.split(",").map(Number) : [];
    loadSectionTags(sectionSnake, ids)
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
  }, [sectionSnake, tokenTick, selectedIdsKey]);

  // Порядок ответа сервера = приоритет релевантности; выбранные → остальные.
  const sortByRelevance = useCallback(
    (list: UserTag[], selected: Set<number>) => {
      if (list.length === 0) return list;
      const sel: UserTag[] = [];
      const rest: UserTag[] = [];
      for (const t of list) {
        if (selected.has(t.id)) sel.push(t);
        else rest.push(t);
      }
      return [...sel, ...rest];
    },
    [],
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
      <div className="rounded-2xl rounded-tl-md bg-white/[0.04] border border-white/10 px-3 py-3 text-white/60 text-sm">
        Фото не найдено.
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

  // ─── Паспортная сводка по элементу (как «Паспорт авто» в 1 шаге) ──────
  const seriousCount = sIds.size + pending.filter((p) => p.severity === "serious").length;
  const minorCount = nsIds.size + pending.filter((p) => p.severity !== "serious").length;
  const hasNote = !!finding?.note?.trim();

  const remarksCount = seriousCount + minorCount;
  const passportRows: { label: string; filled: boolean; value?: string }[] = [
    { label: "Элемент", filled: true, value: elementLabel },
    {
      label: "Состояние",
      filled: derivedVerdict !== null,
      value: derivedVerdict !== null ? verdictLabel : undefined,
    },
    {
      label: "Замечания",
      filled: remarksCount > 0 || derivedVerdict === "ok",
      value:
        remarksCount > 0
          ? String(remarksCount)
          : derivedVerdict === "ok"
            ? "нет"
            : undefined,
    },
    {
      label: "Заметка",
      filled: hasNote,
      value: hasNote ? "есть" : undefined,
    },
  ];

  const filledCount = passportRows.filter((r) => r.filled).length;
  const allFilled = filledCount === passportRows.length;

  // Подсветка строк, значение которых только что изменилось (после ответа ИИ).
  const prevValuesRef = useRef<Record<string, string>>({});
  const [flashed, setFlashed] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (aiUpdating) return; // ждём окончания запроса
    const changed = new Set<string>();
    for (const r of passportRows) {
      const v = r.value ?? "";
      if (prevValuesRef.current[r.label] !== undefined && prevValuesRef.current[r.label] !== v) {
        changed.add(r.label);
      }
      prevValuesRef.current[r.label] = v;
    }
    if (changed.size === 0) return;
    setFlashed(changed);
    const t = window.setTimeout(() => setFlashed(new Set()), 1400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiUpdating, passportRows.map((r) => r.value ?? "").join("|")]);

  return (
    <div className="rounded-2xl rounded-tl-md bg-white/[0.04] border border-white/10 overflow-hidden">
      {/* Паспорт-стайл шапка */}
      <div className="px-3 pt-2.5 pb-2 border-b border-white/[0.06]">
        <div className="flex items-baseline justify-between mb-0.5 gap-2">
          {onEdit ? (
            <button
              type="button"
              onClick={() =>
                onEdit(buildElementEditTemplate({
                  sectionLabel: section?.label ?? sectionSnake,
                  elementLabel,
                  verdictLabel: derivedVerdict !== null ? verdictLabel : null,
                  serious: tags.filter((t) => sIds.has(t.id)).map((t) => t.name),
                  seriousPending: pending.filter((p) => p.severity === "serious").map((p) => p.name),
                  minor: tags.filter((t) => nsIds.has(t.id)).map((t) => t.name),
                  minorPending: pending.filter((p) => p.severity !== "serious").map((p) => p.name),
                  note: finding?.note ?? "",
                }))
              }
              className="text-white/70 font-medium text-[13px] inline-flex items-center gap-1.5 hover:text-white transition-colors"
              title="Открыть редактор в композере"
            >
              Паспорт элемента
              <Pencil className="h-3 w-3 text-white/40" />
              {aiUpdating && (
                <span className="inline-flex items-center gap-1 text-[10px] font-normal text-orange-300/80">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  ИИ обновляет…
                </span>
              )}
            </button>
          ) : (
            <span className="text-white/70 font-medium text-[13px] inline-flex items-center gap-1.5">
              Паспорт элемента
              {aiUpdating && (
                <span className="inline-flex items-center gap-1 text-[10px] font-normal text-orange-300/80">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  ИИ обновляет…
                </span>
              )}
            </span>
          )}
          <span
            className={
              "text-[11px] tabular-nums shrink-0 " +
              (allFilled ? "text-emerald-400/80" : "text-white/40")
            }
          >
            {filledCount}/{passportRows.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[10px] uppercase tracking-[0.08em] text-white/40 truncate min-w-0 flex-1">
            {section?.label ?? sectionSnake}
            {posInSection >= 0 && siblings.length > 1 && (
              <span className="text-white/25"> · фото {posInSection + 1}/{siblings.length}</span>
            )}
          </div>
          {onDeletePhoto && (
            <button
              onClick={() => {
                if (confirm("Удалить это фото?")) onDeletePhoto();
              }}
              aria-label="Удалить фото"
              className="h-6 w-6 rounded-full hover:bg-rose-500/15 text-rose-300/70 hover:text-rose-300 flex items-center justify-center shrink-0 transition-colors"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>


      {/* Hero-фото умеренной высоты, чтобы карточка вписывалась в ленту чата */}
      <div className="relative select-none bg-black/40">
        {photo.dataUrl ? (
          <img
            src={photo.dataUrl}
            alt=""
            className="block w-full max-h-[28dvh] object-contain"
          />
        ) : (
          <div className="h-32 flex items-center justify-center text-white/30 text-sm">
            нет превью
          </div>
        )}

        <div className="absolute top-2 right-2 inline-flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur-md px-2.5 py-1 text-[11px] font-medium text-white ring-1 ring-white/15">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${verdictDot}`} />
          {verdictLabel}
        </div>

        {siblings.length > 1 && (
          <>
            {posInSection > 0 && (
              <button
                onClick={goPrev}
                aria-label="Предыдущее"
                className="absolute left-1.5 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-md text-white flex items-center justify-center ring-1 ring-white/10 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {posInSection < siblings.length - 1 && (
              <button
                onClick={goNext}
                aria-label="Следующее"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-md text-white flex items-center justify-center ring-1 ring-white/10 transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/40 backdrop-blur-md ring-1 ring-white/10">
              {siblings.map((s) => {
                const sel = s.idx === photoIdx;
                return (
                  <button
                    key={s.idx}
                    onClick={() => onChangePhotoIdx(s.idx)}
                    aria-label={`Фото ${siblings.indexOf(s) + 1}`}
                    className={
                      "h-1.5 rounded-full transition-all " +
                      (sel ? "w-5 bg-white" : "w-1.5 bg-white/40 hover:bg-white/70")
                    }
                  />
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Паспортная сводка по элементу */}
      <div className="px-3 pt-3 pb-2 border-b border-white/[0.06]">
        <ul className="space-y-0.5 text-[13px] leading-tight">
          {passportRows.map((it) =>
            it.label === "Элемент" && section ? (
              <ElementPickerRow
                key={it.label}
                elements={section.elements}
                selectedId={elementId}
                onChange={onChangeElement}
                updating={!!aiUpdating}
                flashing={flashed.has(it.label)}
              />
            ) : (
              <PassportRow
                key={it.label}
                item={it}
                updating={!!aiUpdating}
                flashing={flashed.has(it.label)}
              />
            ),
          )}
        </ul>
      </div>

      {/* Тело: интерактивный выбор тегов вручную */}
      <div className="px-3 pt-3 pb-3 space-y-3">
        {tagsLoading && (
          <div className="flex items-center gap-2 text-[12px] text-white/45">
            <Loader2 className="h-3 w-3 animate-spin" /> Загружаем теги…
          </div>
        )}
        {tagsError && (
          <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">
            {tagsError}
          </div>
        )}
        {!tagsLoading && !tagsError && (
          <>
            <InspectionTagPickerRow
              tone="serious"
              label="Серьёзные"
              tags={serious}
              selected={sIds}
              pending={pending.filter((p) => p.severity === "serious")}
              onToggleTag={onToggleTag}
              onTogglePending={(name) => onTogglePendingTag(name, "serious")}
            />
            <InspectionTagPickerRow
              tone="minor"
              label="Мелкие"
              tags={minor}
              selected={nsIds}
              pending={pending.filter((p) => p.severity !== "serious")}
              onToggleTag={onToggleTag}
              onTogglePending={(name) => onTogglePendingTag(name, "non_serious")}
            />
          </>
        )}



        {/* Заметка эксперта — длинный текст, отображаем в конце для удобного чтения */}
        {finding?.note?.trim() && (
          <div className="pt-3 border-t border-white/[0.06]">
            <div className="text-[10px] uppercase tracking-[0.1em] text-white/40 font-medium mb-1.5">
              Заметка
            </div>
            <div className="text-[13.5px] leading-relaxed text-white/85 whitespace-pre-wrap">
              {finding.note}
            </div>
            {chatNoteProposal &&
              chatNoteProposal.payload.ref.kind === "inspection" &&
              chatNoteProposal.payload.ref.section === sectionSnake &&
              chatNoteProposal.payload.ref.elementId === elementId && (
                <NoteProposalInline
                  payload={chatNoteProposal.payload}
                  onPickOriginal={chatNoteProposal.onPickOriginal}
                  onPickAi={chatNoteProposal.onPickAi}
                  onDismiss={chatNoteProposal.onDismiss}
                />
              )}
          </div>
        )}
      </div>
    </div>
  );
}

function ReadOnlyTagRow(props: {
  label: string;
  dotClass: string;
  chipClass: string;
  tags: string[];
  pending: string[];
}) {
  const all = [...props.tags, ...props.pending];
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-white/40 font-medium">
        <span className={"inline-block h-1.5 w-1.5 rounded-full " + props.dotClass} />
        {props.label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {all.map((name, i) => (
          <span
            key={`${name}-${i}`}
            className={"rounded-full px-2.5 py-1 text-[12px] border " + props.chipClass}
          >
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Унифицированный раздел: маленький label + контент ───────────────────
function Section(props: {
  label: React.ReactNode;
  dotClass?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-white/40 font-medium">
        {props.dotClass && (
          <span className={"inline-block h-1.5 w-1.5 rounded-full " + props.dotClass} />
        )}
        {props.label}
      </div>
      {props.children}
    </div>
  );
}
function PassportRow({
  item,
  updating,
  flashing,
}: {
  item: { label: string; filled: boolean; value?: string };
  updating?: boolean;
  flashing?: boolean;
}) {
  return (
    <li
      className={
        "flex items-baseline gap-2 min-w-0 -mx-1 px-1 rounded-md transition-colors duration-700 " +
        (flashing ? "bg-orange-400/15" : "")
      }
    >
      {updating ? (
        <Loader2 className="h-3 w-3 shrink-0 translate-y-0.5 animate-spin text-orange-300/80" />
      ) : item.filled ? (
        <Check className="h-3 w-3 shrink-0 translate-y-0.5 text-emerald-400/80" />
      ) : (
        <span className="h-3 w-3 shrink-0 translate-y-0.5 rounded-full border border-white/15" />
      )}
      <span className="shrink-0 text-white/55">{item.label}</span>
      <span className="flex-1 border-b border-dashed border-white/5 translate-y-[-3px]" />
      <span
        className={
          "text-right break-all min-w-0 " +
          (updating
            ? "text-white/40 animate-pulse"
            : flashing
              ? "text-orange-100"
              : item.filled
                ? "text-white/85"
                : "text-white/30")
        }
        title={item.value ?? ""}
      >
        {item.value ?? "—"}
      </span>
    </li>
  );
}

function ElementPickerRow({
  elements,
  selectedId,
  onChange,
  updating,
  flashing,
}: {
  elements: { id: string; label: string }[];
  selectedId: string;
  onChange: (id: string) => void;
  updating?: boolean;
  flashing?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = elements.find((e) => e.id === selectedId);
  const others = elements.filter((e) => e.id !== selectedId);
  return (
    <li
      className={
        "flex items-baseline gap-2 min-w-0 -mx-1 px-1 rounded-md transition-colors duration-700 " +
        (flashing ? "bg-orange-400/15" : "")
      }
    >
      {updating ? (
        <Loader2 className="h-3 w-3 shrink-0 translate-y-0.5 animate-spin text-orange-300/80" />
      ) : (
        <Check className="h-3 w-3 shrink-0 translate-y-0.5 text-emerald-400/80" />
      )}
      <span className="shrink-0 text-white/55">Элемент</span>
      <span className="flex-1 border-b border-dashed border-white/5 translate-y-[-3px]" />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-right text-white/85 text-[13px] hover:text-white max-w-[200px]"
            title="Сменить элемент"
          >
            <span className="truncate">{current?.label ?? "—"}</span>
            <ChevronRight className="h-3 w-3 rotate-90 text-white/50 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={4}
          className="w-64 max-h-72 overflow-auto p-1 bg-neutral-900 border border-white/10 text-white"
        >
          {others.length === 0 ? (
            <div className="px-2 py-1.5 text-[12px] text-white/50">Других элементов нет</div>
          ) : (
            <ul className="space-y-0.5">
              {others.map((el) => (
                <li key={el.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(el.id);
                      setOpen(false);
                    }}
                    className="w-full text-left px-2 py-1 rounded text-[12px] hover:bg-white/10 flex items-center gap-2"
                  >
                    <span className="flex-1 truncate">{el.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>
    </li>
  );
}


function ChipScroller(props: { children: React.ReactNode }) {
  return (
    <div className="-mx-4 px-4 overflow-x-auto scrollbar-none">
      <div className="flex gap-1.5 w-max pb-0.5">{props.children}</div>
    </div>
  );
}

// ─── Подкомпоненты ────────────────────────────────────────────────────────

function TagRow(props: {
  tone: "serious" | "minor";
  section: SectionSnake;
  tags: UserTag[];
  selected: Set<number>;
  pending: PendingTagName[];
  onTap: (t: UserTag) => void;
  onTogglePending: (name: string) => void;
  onAdd: (name: string) => void;
  onCatalogChanged: () => void;
}) {
  const {
    tone, section, tags, selected, pending,
    onTap, onTogglePending, onAdd, onCatalogChanged,
  } = props;
  const sorted = useMemo(() => {
    const sel: UserTag[] = [];
    const rest: UserTag[] = [];
    for (const t of tags) (selected.has(t.id) ? sel : rest).push(t);
    return [...sel, ...rest];
  }, [tags, selected]);
  const count = selected.size + pending.length;
  const dotCls = tone === "serious" ? "bg-rose-400" : "bg-amber-400";

  // Меню «по долгому нажатию»: либо для выбранного тега (edit/delete + add),
  // либо просто «добавить» (mode === "addOnly").
  type MenuState =
    | { kind: "tag"; tag: UserTag }
    | { kind: "addOnly" }
    | null;
  const [menu, setMenu] = useState<MenuState>(null);
  const [mode, setMode] = useState<"none" | "add" | "edit">("none");
  const [editingTag, setEditingTag] = useState<UserTag | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Long-press: запоминаем pointerdown и срабатываем через 450мс,
  // если палец/мышь не сдвинулись и не отпустились раньше.
  const pressTimer = useRef<number | null>(null);
  const longFired = useRef(false);
  const clearPress = () => {
    if (pressTimer.current) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };
  const startPress = (t: UserTag) => {
    longFired.current = false;
    clearPress();
    pressTimer.current = window.setTimeout(() => {
      longFired.current = true;
      setMenu({ kind: "tag", tag: t });
    }, 450);
  };

  const closeMenu = () => {
    setMenu(null);
    setMode("none");
    setEditingTag(null);
    setDraft("");
    setError(null);
  };

  const submitDraft = async () => {
    const n = draft.trim();
    if (!n) {
      closeMenu();
      return;
    }
    if (mode === "add") {
      onAdd(n);
      closeMenu();
      return;
    }
    if (mode === "edit" && editingTag) {
      setBusy(true);
      const ok = await updateUserTag(section, editingTag.id, n);
      setBusy(false);
      if (!ok) {
        setError("Не удалось переименовать");
        return;
      }
      onCatalogChanged();
      closeMenu();
    }
  };

  const doDelete = async (t: UserTag) => {
    if (!confirm(`Удалить тег «${t.name}»?`)) return;
    setBusy(true);
    const ok = await deleteUserTag(section, t.id);
    setBusy(false);
    if (!ok) {
      setError("Не удалось удалить");
      return;
    }
    onCatalogChanged();
    closeMenu();
  };

  return (
    <div>
      {count > 0 && (
        <div className="flex items-center gap-1.5 mb-1.5 text-[10px] uppercase tracking-wide text-white/45">
          <span className={"inline-block h-1.5 w-1.5 rounded-full " + dotCls} />
          <span className="normal-case tracking-normal text-white/55">выбрано {count}</span>
        </div>
      )}
      <div className="-mx-1 px-1 overflow-x-auto">
        <div className="flex gap-1.5 w-max pb-0.5 items-center">
          {sorted.map((t) => {
            const sel = selected.has(t.id);
            return (
              <button
                key={t.id}
                onClick={() => {
                  if (longFired.current) {
                    longFired.current = false;
                    return;
                  }
                  onTap(t);
                }}
                onPointerDown={() => startPress(t)}
                onPointerUp={clearPress}
                onPointerLeave={clearPress}
                onPointerCancel={clearPress}
                onContextMenu={(e) => {
                  e.preventDefault();
                  longFired.current = true;
                  setMenu({ kind: "tag", tag: t });
                }}
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
              className="inline-flex items-center gap-1 rounded-full border border-violet-400/40 bg-violet-500/15 px-2.5 py-1 text-xs text-violet-100 whitespace-nowrap hover:bg-violet-500/25"
              title="Новый тег — создастся при отправке. Нажмите, чтобы убрать."
            >
              ✨ {p.name}
              <X className="h-3 w-3 opacity-70" />
            </button>
          ))}
          {sorted.length === 0 && pending.length === 0 && (
            <button
              type="button"
              onClick={() => {
                setMenu({ kind: "addOnly" });
                setMode("add");
              }}
              className={
                "inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs whitespace-nowrap transition-colors " +
                (tone === "serious"
                  ? "border-rose-400/40 text-rose-100/80 hover:bg-rose-500/10"
                  : "border-amber-400/40 text-amber-100/80 hover:bg-amber-500/10")
              }
            >
              <Plus className="h-3 w-3" /> добавить тег
            </button>
          )}
        </div>
      </div>

      {menu && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={closeMenu}
        >
          <div
            className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl border border-white/10 bg-zinc-900 p-3 space-y-2"
            onClick={(e) => e.stopPropagation()}
          >
            {menu.kind === "tag" && (
              <div className="flex items-center gap-2 px-1 pb-1 text-[12px] text-white/70">
                <span className={"inline-block h-1.5 w-1.5 rounded-full " + dotCls} />
                <span className="truncate">{menu.tag.name}</span>
                {menu.tag.userId == null && (
                  <span className="ml-auto text-[10px] uppercase tracking-wide text-white/35">
                    системный
                  </span>
                )}
              </div>
            )}

            {mode === "none" && (
              <div className="grid gap-1.5">
                {menu.kind === "tag" && menu.tag.userId != null && (
                  <>
                    <button
                      type="button"
                      className="w-full text-left rounded-lg px-3 py-2.5 text-[13px] text-white hover:bg-white/10"
                      onClick={() => {
                        setEditingTag(menu.tag);
                        setDraft(menu.tag.name);
                        setMode("edit");
                      }}
                    >
                      ✏️ Редактировать
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="w-full text-left rounded-lg px-3 py-2.5 text-[13px] text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
                      onClick={() => doDelete(menu.tag)}
                    >
                      🗑 Удалить
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="w-full text-left rounded-lg px-3 py-2.5 text-[13px] text-white hover:bg-white/10"
                  onClick={() => {
                    setDraft("");
                    setMode("add");
                  }}
                >
                  ➕ Добавить новый тег
                </button>
                <button
                  type="button"
                  className="w-full rounded-lg px-3 py-2 text-[12px] text-white/55 hover:bg-white/5"
                  onClick={closeMenu}
                >
                  Отмена
                </button>
              </div>
            )}

            {(mode === "add" || mode === "edit") && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitDraft();
                }}
                className="space-y-2"
              >
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={
                    mode === "add"
                      ? (tone === "serious" ? "новый серьёзный" : "новый мелкий")
                      : "название тега"
                  }
                  className={
                    "w-full rounded-lg border bg-white/[0.06] px-3 py-2 text-[13px] text-white placeholder:text-white/40 focus:outline-none " +
                    (tone === "serious"
                      ? "border-rose-400/50 focus:border-rose-400"
                      : "border-amber-400/50 focus:border-amber-400")
                  }
                />
                {error && (
                  <div className="text-[11px] text-rose-300">{error}</div>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={closeMenu}
                    className="flex-1 rounded-lg px-3 py-2 text-[12px] text-white/70 hover:bg-white/10"
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    disabled={busy || !draft.trim()}
                    className={
                      "flex-1 rounded-lg px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50 " +
                      (tone === "serious" ? "bg-rose-500 hover:bg-rose-600" : "bg-amber-500 hover:bg-amber-600")
                    }
                  >
                    {busy ? "…" : mode === "add" ? "Добавить" : "Сохранить"}
                  </button>
                </div>
              </form>
            )}
          </div>
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


// ─── Чат-обёртки ──────────────────────────────────────────────────────────




function NoteProposalContent(props: {
  proposal: NoteProposal;
  onPickOriginal?: () => void;
  onPickAi?: () => void;
  onDismiss?: () => void;
}) {
  const { proposal, onPickOriginal, onPickAi, onDismiss } = props;
  return (
    <div className="space-y-2">
      {onDismiss && (
        <div className="flex justify-end">
          <button
            onClick={onDismiss}
            className="h-5 w-5 rounded-full hover:bg-white/10 text-white/60 flex items-center justify-center"
            aria-label="Скрыть"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
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

/**
 * Строка выбора тегов в стиле тест-драйва: чипы выбранных + "+" с поповером.
 * Список в поповере — уже отсортированный сервером каталог (с учётом
 * selectedTagIds) минус уже выбранные.
 */
function InspectionTagPickerRow({
  tone,
  label,
  tags,
  selected,
  pending,
  onToggleTag,
  onTogglePending,
}: {
  tone: "serious" | "minor";
  label: string;
  tags: UserTag[];
  selected: Set<number>;
  pending: PendingTagName[];
  onToggleTag: (t: UserTag) => void;
  onTogglePending: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const dotCls = tone === "serious" ? "bg-rose-400" : "bg-amber-400";
  const chipCls =
    tone === "serious"
      ? "border-rose-400/30 bg-rose-500/10 text-rose-100"
      : "border-amber-400/30 bg-amber-500/10 text-amber-100";

  const selectedTags = tags.filter((t) => selected.has(t.id));
  const suggestions = tags.filter((t) => !selected.has(t.id));

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-white/40 font-medium">
        <span className={"inline-block h-1.5 w-1.5 rounded-full " + dotCls} />
        {label}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {selectedTags.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onToggleTag(t)}
            className={"inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] border " + chipCls}
            title="Убрать тег"
          >
            <Check className="h-3 w-3 -ml-0.5" />
            {t.name}
          </button>
        ))}
        {pending.map((p) => (
          <button
            key={`pending:${p.name}`}
            type="button"
            onClick={() => onTogglePending(p.name)}
            className="inline-flex items-center gap-1 rounded-full border border-violet-400/40 bg-violet-500/15 px-2.5 py-1 text-[12px] text-violet-100 hover:bg-violet-500/25"
            title="Новый тег — создастся при отправке. Нажмите, чтобы убрать."
          >
            ✨ {p.name}
            <X className="h-3 w-3 opacity-70" />
          </button>
        ))}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Добавить тег"
              title="Добавить тег"
              className={
                "inline-flex items-center justify-center rounded-full border border-dashed h-[26px] w-[26px] transition-colors " +
                (tone === "serious"
                  ? "border-rose-400/40 text-rose-100/70 hover:bg-rose-500/10"
                  : "border-amber-400/40 text-amber-100/70 hover:bg-amber-500/10")
              }
            >
              <Plus className="h-3 w-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={4}
            className="w-64 max-h-72 overflow-auto p-1 bg-neutral-900 border border-white/10 text-white"
          >
            {suggestions.length === 0 ? (
              <div className="px-2 py-1.5 text-[12px] text-white/50">Нет подходящих тегов</div>
            ) : (
              <ul className="space-y-0.5">
                {suggestions.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onToggleTag(t);
                        // не закрываем — даём добавить несколько подряд
                      }}
                      className="w-full text-left px-2 py-1 rounded text-[12px] hover:bg-white/10 flex items-center gap-2"
                    >
                      <span className="flex-1 truncate">{t.name}</span>
                      <span
                        className={
                          t.type === "serious"
                            ? "text-[10px] text-rose-300"
                            : "text-[10px] text-amber-300"
                        }
                      >
                        {t.type === "serious" ? "серьёзный" : "несерьёзный"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

/** Префилл композера для правки одного элемента осмотра. */
export function buildElementEditTemplate(args: {
  sectionLabel: string;
  elementLabel: string;
  verdictLabel: string | null;
  serious: string[];
  seriousPending: string[];
  minor: string[];
  minorPending: string[];
  note: string;
}): string {
  const join = (xs: string[]) => xs.filter((x) => x && x.trim()).join(", ");
  const serious = join([...args.serious, ...args.seriousPending]);
  const minor = join([...args.minor, ...args.minorPending]);
  return [
    `Осмотр (правка) — ${args.sectionLabel} / ${args.elementLabel}:`,
    `Состояние: ${args.verdictLabel ?? "—"}`,
    `Серьёзные: ${serious || "—"}`,
    `Мелкие: ${minor || "—"}`,
    "",
    `Заметка: ${args.note.trim()}`,
  ].join("\n");
}
