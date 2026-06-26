// Inspection chat card — sections → elements → verdict + tags.
// Three nested layers inside a single assistant-message bubble, matching the
// API DTO structure (`InspectionElementFinding` per element).

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Plus, X } from "lucide-react";
import {
  INSPECTION_SECTIONS,
  type SectionSnake,
} from "@/lib/carreports/inspectionSections";
import {
  elementStatus,
  getFinding,
  photosFor,
  sectionProgress,
  type InspectionCursor,
} from "@/lib/carreports/inspectionState";
import type { InspectionStep } from "@/lib/carreports/types";
import { loadSectionTags, type UserTag } from "@/lib/carreports/inspectionTags";

type Verdict = "ok" | "minor" | "serious";

export interface InspectionChipsCardProps {
  ins: InspectionStep;
  cursor: InspectionCursor;
  interactive: boolean;
  onSelectSection: (section: SectionSnake) => void;
  onSelectElement: (elementId: string) => void;
  onSetVerdict: (v: Verdict) => void;
  onToggleTag: (tag: UserTag) => void;
  onAddPendingTag: (name: string, severity: "serious" | "non_serious") => void;
  onClearElement: () => void;
  onAllNoDamage: () => void;
  onNextElement: () => void;
}

const STATUS_ICON: Record<string, string> = {
  ok: "🟢",
  minor: "🟡",
  serious: "🔴",
  noteOnly: "📝",
  empty: "",
};

export function InspectionChipsCard(props: InspectionChipsCardProps) {
  const {
    ins,
    cursor,
    interactive,
    onSelectSection,
    onSelectElement,
    onSetVerdict,
    onToggleTag,
    onAddPendingTag,
    onClearElement,
    onAllNoDamage,
    onNextElement,
  } = props;

  const { section, element } = cursor;
  const finding = getFinding(ins, section.snake, element.id);
  const verdict: Verdict | null = finding
    ? (finding.seriousDamageTagIds?.length ?? 0) > 0
      ? "serious"
      : (finding.noSeriousDamageTagIds?.length ?? 0) > 0
        ? "minor"
        : finding.noDamage === true
          ? "ok"
          : null
    : null;

  const elementPhotos = photosFor(ins, section.snake, element.id);

  return (
    <div className="rounded-2xl rounded-tl-md bg-white/[0.04] border border-white/10 px-3 py-2.5 space-y-3">
      {/* Layer 1: Section selector */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-white/45 mb-1">
          Раздел
        </div>
        <div className="flex flex-wrap gap-1.5">
          {INSPECTION_SECTIONS.map((s) => {
            const sel = s.snake === section.snake;
            const prog = sectionProgress(ins, s);
            return (
              <button
                key={s.snake}
                disabled={!interactive}
                onClick={() => onSelectSection(s.snake)}
                className={chip(sel, interactive)}
              >
                {s.label}
                <span className="ml-1 text-[10px] opacity-70">
                  {prog.filled}/{prog.total}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Layer 2: Element selector */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-white/45 mb-1 flex items-center justify-between gap-2">
          <span>Элемент · {section.label}</span>
          {interactive && (
            <button
              onClick={onAllNoDamage}
              className="text-[10px] text-emerald-300/80 hover:text-emerald-200"
              title="Пометить все элементы раздела как «Без замечаний»"
            >
              ✅ Весь раздел без замечаний
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {section.elements.map((el) => {
            const sel = el.id === element.id;
            const st = elementStatus(ins, section.snake, el.id);
            const ph = photosFor(ins, section.snake, el.id);
            return (
              <button
                key={el.id}
                disabled={!interactive}
                onClick={() => onSelectElement(el.id)}
                className={chip(sel, interactive)}
                title={el.label}
              >
                {STATUS_ICON[st] && (
                  <span className="mr-1">{STATUS_ICON[st]}</span>
                )}
                {el.label}
                {ph > 0 && (
                  <span className="ml-1 text-[10px] opacity-80">📷{ph}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Layer 3: Verdict + tags for active element */}
      <ElementBlock
        sectionSnake={section.snake}
        elementLabel={element.label}
        verdict={verdict}
        finding={finding ?? null}
        interactive={interactive}
        photosCount={elementPhotos}
        onSetVerdict={onSetVerdict}
        onToggleTag={onToggleTag}
        onAddPendingTag={onAddPendingTag}
        onClearElement={onClearElement}
        onNextElement={onNextElement}
      />
    </div>
  );
}

// ─── Lightweight section picker (greeting / pencil entry point) ────────────

export function SectionPickerCard(props: {
  ins: InspectionStep;
  currentSection?: SectionSnake;
  interactive: boolean;
  onPick: (s: SectionSnake) => void;
}) {
  const { ins, currentSection, interactive, onPick } = props;
  return (
    <div className="rounded-2xl rounded-tl-md bg-white/[0.04] border border-white/10 px-3 py-2.5 space-y-2">
      <div className="text-[10px] uppercase tracking-wide text-white/45">
        Выберите раздел для осмотра
      </div>
      <div className="flex flex-wrap gap-1.5">
        {INSPECTION_SECTIONS.map((s) => {
          const sel = s.snake === currentSection;
          const prog = sectionProgress(ins, s);
          const done = prog.filled === prog.total && prog.total > 0;
          return (
            <button
              key={s.snake}
              disabled={!interactive}
              onClick={() => onPick(s.snake)}
              className={chip(sel, interactive)}
              title={s.label}
            >
              {done && <span className="mr-1">✅</span>}
              {s.label}
              <span className="ml-1 text-[10px] opacity-70">
                {prog.filled}/{prog.total}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function chip(selected: boolean, interactive: boolean): string {
  return (
    "rounded-full border px-2.5 py-1 text-xs whitespace-nowrap transition-colors " +
    (selected
      ? "bg-orange-500 text-white border-orange-500"
      : interactive
        ? "border-white/15 text-white/80 hover:border-orange-400/60 hover:text-white"
        : "border-white/10 text-white/40 cursor-default")
  );
}

interface ElementBlockProps {
  sectionSnake: SectionSnake;
  elementLabel: string;
  verdict: Verdict | null;
  finding: NonNullable<InspectionStep["findings"]>[string] | null;
  interactive: boolean;
  photosCount: number;
  onSetVerdict: (v: Verdict) => void;
  onToggleTag: (tag: UserTag) => void;
  onAddPendingTag: (name: string, severity: "serious" | "non_serious") => void;
  onClearElement: () => void;
  onNextElement: () => void;
}

function ElementBlock({
  sectionSnake,
  elementLabel,
  verdict,
  finding,
  interactive,
  photosCount,
  onSetVerdict,
  onToggleTag,
  onAddPendingTag,
  onClearElement,
  onNextElement,
}: ElementBlockProps) {
  const [tags, setTags] = useState<UserTag[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void loadSectionTags(sectionSnake).then((list) => {
      if (!alive) return;
      setTags(list);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [sectionSnake]);

  const selectedSerious = new Set(finding?.seriousDamageTagIds ?? []);
  const selectedMinor = new Set(finding?.noSeriousDamageTagIds ?? []);
  const pending = finding?.pendingTagNames ?? [];

  const { serious, minor } = useMemo(() => {
    const s: UserTag[] = [];
    const m: UserTag[] = [];
    for (const t of tags ?? []) {
      if (t.type === "serious") s.push(t);
      else m.push(t);
    }
    return { serious: s, minor: m };
  }, [tags]);

  // Decide which bucket the active verdict expects new tags to go into.
  const activeBucket: "serious" | "non_serious" =
    verdict === "serious" ? "serious" : "non_serious";

  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/10 p-2.5 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] font-medium text-white">
          {elementLabel}
          {photosCount > 0 && (
            <span className="ml-1.5 text-[10px] text-white/55">📷{photosCount}</span>
          )}
        </div>
        {finding && interactive && (
          <button
            onClick={onClearElement}
            className="text-[10px] text-white/40 hover:text-rose-300 inline-flex items-center gap-1"
            title="Очистить запись по элементу"
          >
            <X className="h-3 w-3" /> Сбросить
          </button>
        )}
      </div>

      {/* Verdict segment */}
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
              disabled={!interactive}
              onClick={() => onSetVerdict(v)}
              className={
                "flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors " +
                (interactive ? cls : "border-white/10 text-white/40 cursor-default")
              }
            >
              {v === "ok"
                ? "Без замечаний"
                : v === "minor"
                  ? "Мелкие"
                  : "Серьёзные"}
            </button>
          );
        })}
      </div>

      {/* Tags */}
      {verdict !== "ok" && (
        <div className="space-y-2">
          {loading && (
            <div className="flex items-center gap-1.5 text-[11px] text-white/50">
              <Loader2 className="h-3 w-3 animate-spin" />
              Загружаем теги раздела…
            </div>
          )}
          {!loading && (serious.length > 0 || minor.length > 0) && (
            <>
              {serious.length > 0 && (
                <TagGroup
                  label="Серьёзные"
                  tags={serious}
                  selected={selectedSerious}
                  interactive={interactive}
                  onTap={onToggleTag}
                />
              )}
              {minor.length > 0 && (
                <TagGroup
                  label="Мелкие"
                  tags={minor}
                  selected={selectedMinor}
                  interactive={interactive}
                  onTap={onToggleTag}
                />
              )}
            </>
          )}
          {pending.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-white/45">
                Новые теги (создадутся при отправке)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {pending.map((p) => (
                  <span
                    key={`${p.severity ?? "_"}:${p.name}`}
                    className="rounded-full border border-violet-400/40 bg-violet-500/10 px-2.5 py-1 text-xs text-violet-100"
                  >
                    ✨ {p.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {interactive && (
            <div>
              {!addOpen ? (
                <button
                  onClick={() => setAddOpen(true)}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-white/20 px-2.5 py-1 text-xs text-white/70 hover:text-white hover:border-white/40"
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
                    placeholder={
                      activeBucket === "serious"
                        ? "Новый тег (серьёзный)"
                        : "Новый тег (мелкий)"
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
                      setAddOpen(false);
                      setAddName("");
                    }}
                    className="rounded-md border border-white/15 px-2 py-1 text-xs text-white/70 hover:text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      )}

      {interactive && (
        <div className="pt-1 flex justify-end">
          <button
            onClick={onNextElement}
            className="text-[11px] text-white/55 hover:text-white inline-flex items-center gap-1"
          >
            Следующий элемент →
          </button>
        </div>
      )}
    </div>
  );
}

function TagGroup({
  label,
  tags,
  selected,
  interactive,
  onTap,
}: {
  label: string;
  tags: UserTag[];
  selected: Set<number>;
  interactive: boolean;
  onTap: (t: UserTag) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wide text-white/45">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => {
          const sel = selected.has(t.id);
          return (
            <button
              key={t.id}
              disabled={!interactive}
              onClick={() => onTap(t)}
              className={chip(sel, interactive)}
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
