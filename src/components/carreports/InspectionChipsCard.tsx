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
  photosForSection,
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
  const derivedVerdict: Verdict | null = finding
    ? (finding.seriousDamageTagIds?.length ?? 0) > 0
      ? "serious"
      : (finding.noSeriousDamageTagIds?.length ?? 0) > 0
        ? "minor"
        : finding.noDamage === true
          ? "ok"
          : null
    : null;

  // Explicit user choice via the verdict segment overrides the derived value
  // (e.g. they tapped "Мелкие" but the finding still has serious tags from
  // a previous classification — show the minor bucket regardless).
  const [verdictOverride, setVerdictOverride] = useState<Verdict | null>(null);
  useEffect(() => {
    setVerdictOverride(null);
  }, [section.snake, element.id]);
  const verdict: Verdict | null = verdictOverride ?? derivedVerdict;

  const handleSetVerdict = (v: Verdict) => {
    setVerdictOverride(v);
    onSetVerdict(v);
  };


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

      {/* Layer 2: Element selector — single column list */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-white/45 mb-1.5 flex items-center justify-between gap-2">
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
        <div className="rounded-xl border border-white/10 overflow-hidden">
          {section.elements.map((el, i) => {
            const sel = el.id === element.id;
            const st = elementStatus(ins, section.snake, el.id);
            const ph = photosFor(ins, section.snake, el.id);
            const done = st !== "empty";
            return (
              <button
                key={el.id}
                disabled={!interactive}
                onClick={() => onSelectElement(el.id)}
                className={
                  "group w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors " +
                  (i > 0 ? "border-t border-white/[0.06] " : "") +
                  (sel
                    ? "bg-white/[0.06] text-white"
                    : interactive
                      ? "text-white/85 hover:bg-white/[0.04] active:bg-white/[0.06]"
                      : "text-white/40 cursor-default")
                }
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className={
                      "h-1.5 w-1.5 rounded-full shrink-0 " +
                      (st === "serious"
                        ? "bg-rose-400"
                        : st === "minor"
                          ? "bg-amber-400"
                          : st === "ok"
                            ? "bg-emerald-400"
                            : st === "noteOnly"
                              ? "bg-sky-400"
                              : "bg-white/20")
                    }
                  />
                  <span className="text-[13px] leading-tight truncate">
                    {el.label}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-[11px] text-white/45 tabular-nums shrink-0">
                  {ph > 0 && <span>📷 {ph}</span>}
                  {done && STATUS_ICON[st] && (
                    <span className="text-[11px]">{STATUS_ICON[st]}</span>
                  )}
                  <span className="text-white/30 group-hover:text-white/60">›</span>
                </span>
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
        onSetVerdict={handleSetVerdict}
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
    <div className="rounded-2xl rounded-tl-md bg-white/[0.04] border border-white/10 px-2 py-2">
      <div className="px-1.5 pb-1.5 text-[11px] uppercase tracking-wide text-white/45">
        Выберите раздел
      </div>
      <div className="flex flex-col">
        {INSPECTION_SECTIONS.map((s, i) => {
          const sel = s.snake === currentSection;
          const prog = sectionProgress(ins, s);
          const photos = photosForSection(ins, s.snake).length;
          const done = prog.filled === prog.total && prog.total > 0;
          return (
            <button
              key={s.snake}
              disabled={!interactive}
              onClick={() => onPick(s.snake)}
              className={
                "group flex items-center justify-between gap-3 px-3 py-3 text-left transition-colors " +
                (i > 0 ? "border-t border-white/[0.06] " : "") +
                (sel
                  ? "bg-white/[0.06] text-white"
                  : interactive
                    ? "text-white/85 hover:bg-white/[0.04] active:bg-white/[0.06]"
                    : "text-white/40 cursor-default")
              }
            >
              <span className="flex items-center gap-2 min-w-0">
                <span
                  className={
                    "h-1.5 w-1.5 rounded-full shrink-0 " +
                    (done
                      ? "bg-emerald-400"
                      : prog.filled > 0
                        ? "bg-orange-400"
                        : "bg-white/20")
                  }
                />
                <span className="text-[14px] font-medium leading-tight truncate">
                  {s.label}
                </span>
              </span>
              <span className="flex items-center gap-2 text-[11px] text-white/45 tabular-nums shrink-0">
                {photos > 0 && <span>📷 {photos}</span>}
                <span>{prog.filled}/{prog.total}</span>
                <span className="text-white/30 group-hover:text-white/60">›</span>
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
  const [activeTab, setActiveTab] = useState<"minor" | "serious">(
    verdict === "serious" ? "serious" : "minor",
  );

  // When element/section changes, reset tab to match the derived verdict.
  useEffect(() => {
    setActiveTab(verdict === "serious" ? "serious" : "minor");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionSnake, elementLabel]);

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

  // Decide which bucket the active tab expects new tags to go into.
  const activeBucket: "serious" | "non_serious" =
    activeTab === "serious" ? "serious" : "non_serious";

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
        <TagsArea
          loading={loading}
          verdict={verdict}
          serious={serious}
          minor={minor}
          selectedSerious={selectedSerious}
          selectedMinor={selectedMinor}
          pending={pending}
          interactive={interactive}
          activeBucket={activeBucket}
          addOpen={addOpen}
          addName={addName}
          setAddOpen={setAddOpen}
          setAddName={setAddName}
          onToggleTag={onToggleTag}
          onAddPendingTag={onAddPendingTag}
        />
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

// ─── Tags area ────────────────────────────────────────────────────────────
// Verdict-driven: shows the bucket matching the active verdict; the opposite
// bucket is collapsed behind a small "+ also show …" toggle to keep the view
// focused. Sorted: selected first. Severity-colored fills replace the ✓ glyph.

interface TagsAreaProps {
  loading: boolean;
  verdict: Verdict | null;
  serious: UserTag[];
  minor: UserTag[];
  selectedSerious: Set<number>;
  selectedMinor: Set<number>;
  pending: PendingTagName[];
  interactive: boolean;
  activeBucket: "serious" | "non_serious";
  addOpen: boolean;
  addName: string;
  setAddOpen: (v: boolean) => void;
  setAddName: (v: string) => void;
  onToggleTag: (tag: UserTag) => void;
  onAddPendingTag: (name: string, severity: "serious" | "non_serious") => void;
}

type PendingTagName = { name: string; severity?: "serious" | "non_serious" };

function TagsArea({
  loading,
  verdict,
  serious,
  minor,
  selectedSerious,
  selectedMinor,
  pending,
  interactive,
  activeBucket,
  addOpen,
  addName,
  setAddOpen,
  setAddName,
  onToggleTag,
  onAddPendingTag,
}: TagsAreaProps) {
  // Show only the bucket matching the active verdict — no cross-severity reveal.
  const primaryIsSerious = verdict === "serious";
  const primary = primaryIsSerious ? serious : minor;
  const primarySelected = primaryIsSerious ? selectedSerious : selectedMinor;
  const primaryPending = pending.filter((p) =>
    primaryIsSerious ? p.severity === "serious" : p.severity !== "serious",
  );


  if (loading) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-white/50">
        <Loader2 className="h-3 w-3 animate-spin" />
        Загружаем теги…
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <TagBucket
        label={primaryIsSerious ? "Серьёзные дефекты" : "Мелкие замечания"}
        tone={primaryIsSerious ? "serious" : "minor"}
        tags={primary}
        selected={primarySelected}
        pending={primaryPending}
        interactive={interactive}
        onTap={onToggleTag}
      />

      {/* Inline custom-tag composer for the active bucket */}
      {interactive && (
        <CustomTagInput
          open={addOpen}
          name={addName}
          bucket={activeBucket}
          setOpen={setAddOpen}
          setName={setAddName}
          onAdd={onAddPendingTag}
        />
      )}

    </div>
  );
}


// ─── Tag bucket ───────────────────────────────────────────────────────────

type Tone = "serious" | "minor";

function TagBucket({
  label,
  tone,
  tags,
  selected,
  pending,
  interactive,
  onTap,
}: {
  label: string;
  tone: Tone;
  tags: UserTag[];
  selected: Set<number>;
  pending: PendingTagName[];
  interactive: boolean;
  onTap: (t: UserTag) => void;
}) {
  // selected first
  const sorted = useMemo(() => {
    const sel: UserTag[] = [];
    const rest: UserTag[] = [];
    for (const t of tags) (selected.has(t.id) ? sel : rest).push(t);
    return [...sel, ...rest];
  }, [tags, selected]);

  const selectedCount = selected.size + pending.length;

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
        {selectedCount > 0 && (
          <span className="text-[10px] text-white/45 tabular-nums">
            выбрано {selectedCount}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {sorted.map((t) => {
          const sel = selected.has(t.id);
          return (
            <button
              key={t.id}
              disabled={!interactive}
              onClick={() => onTap(t)}
              className={tagChip(tone, sel, interactive)}
            >
              {sel && <Check className="h-3 w-3 -ml-0.5" />}
              {t.name}
            </button>
          );
        })}
        {pending.map((p) => (
          <span
            key={`pending:${p.name}`}
            className="inline-flex items-center gap-1 rounded-full border border-violet-400/40 bg-violet-500/15 px-2.5 py-1 text-xs text-violet-100"
            title="Новый тег — создастся при отправке"
          >
            ✨ {p.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function tagChip(tone: Tone, selected: boolean, interactive: boolean): string {
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
  if (!interactive) {
    return base + "border-white/10 text-white/40 cursor-default";
  }
  return (
    base +
    (tone === "serious"
      ? "border-rose-400/30 text-rose-100/85 hover:bg-rose-500/10 hover:border-rose-400/60"
      : "border-amber-400/30 text-amber-100/85 hover:bg-amber-500/10 hover:border-amber-400/60")
  );
}

// ─── Custom tag input ─────────────────────────────────────────────────────

function CustomTagInput({
  open,
  name,
  bucket,
  setOpen,
  setName,
  onAdd,
}: {
  open: boolean;
  name: string;
  bucket: "serious" | "non_serious";
  setOpen: (v: boolean) => void;
  setName: (v: string) => void;
  onAdd: (name: string, severity: "serious" | "non_serious") => void;
}) {
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-white/20 px-2.5 py-1 text-xs text-white/65 hover:text-white hover:border-white/40"
      >
        <Plus className="h-3 w-3" /> Свой тег
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

