import { Check, X, Sparkles, ShieldCheck } from "lucide-react";
import type { ReportDraft } from "@/lib/carreports/types";

type TriState = "match" | "mismatch" | "unknown";

interface Item {
  label: string;
  state: TriState;
  /** Текстовое значение в правой колонке. */
  value?: string;
  /** Имя поля в шаблоне «Заполнить недостающее». */
  template: string;
}

interface Props {
  draft: ReportDraft;
  /** Подставить шаблон по незаполненным полям в композер. */
  onFillMissing?: (template: string) => void;
  /** Отметить все три «совпадения» как совпадающие. */
  onAllMatch?: () => void;
}

/**
 * Чат-карточка «Сверка документов».
 * Несовпадения подсвечены красным, незаполненные обязательные — янтарным.
 */
export function DocsChecklist({ draft, onFillMissing, onAllMatch }: Props) {
  const d = draft.documentReconciliationStep ?? {};

  const ownersFilled = typeof d.ownersCount === "number";

  const required: Item[] = [
    {
      label: "Владельцев по ПТС",
      state: ownersFilled ? "match" : "unknown",
      value: ownersFilled ? String(d.ownersCount) : undefined,
      template: "Владельцев по ПТС: ",
    },
    {
      label: "Собственник = продавец",
      state: triFromBool(d.ownerFullNameMatchWithPTSOrSTS ?? null),
      value: labelFromBool(d.ownerFullNameMatchWithPTSOrSTS ?? null),
      template: "Собственник совпадает с продавцом (да/нет): ",
    },
    {
      label: "VIN на кузове = ПТС/СТС",
      state: triFromBool(d.vinOnBodyMatchWithPTSOrSTS ?? null),
      value: labelFromBool(d.vinOnBodyMatchWithPTSOrSTS ?? null),
      template: "VIN на кузове совпадает с документами (да/нет): ",
    },
    {
      label: "№ двигателя = ПТС",
      state: triFromBool(d.engineModelMatchWithPTSOrSTS ?? null),
      value: labelFromBool(d.engineModelMatchWithPTSOrSTS ?? null),
      template: "Номер двигателя совпадает с ПТС (да/нет): ",
    },
  ];

  const optional: Item[] = [
    {
      label: "Заметка",
      state: d.note ? "match" : "unknown",
      value: d.note,
      template: "Заметка: ",
    },
  ];

  const filledReq = required.filter((i) => i.state !== "unknown").length;
  const missingReq = required.filter((i) => i.state === "unknown");
  const mismatchCount = required.filter((i) => i.state === "mismatch").length;
  const filledOpt = optional.filter((i) => i.state !== "unknown").length;

  function handleFill() {
    if (!onFillMissing || missingReq.length === 0) return;
    onFillMissing(missingReq.map((i) => i.template).join("\n"));
  }

  return (
    <div className="text-[13px] leading-tight">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-white/70 font-medium">Сверка документов</span>
        <span
          className={
            "text-[11px] tabular-nums " +
            (mismatchCount > 0
              ? "text-rose-300/90"
              : missingReq.length > 0
                ? "text-amber-300/90"
                : "text-emerald-400/80")
          }
        >
          {filledReq}/{required.length}
          {mismatchCount > 0 ? ` · ⚠️${mismatchCount}` : ""}
        </span>
      </div>

      <SectionLabel>Обязательные</SectionLabel>
      <ul className="space-y-0.5">
        {required.map((it) => (
          <Row key={it.label} item={it} />
        ))}
      </ul>

      <div className="mt-2 pt-2 border-t border-white/5">
        <SectionLabel>
          Необязательные
          <span className="ml-1 text-white/30 tabular-nums">
            {filledOpt}/{optional.length}
          </span>
        </SectionLabel>
        <ul className="space-y-0.5">
          {optional.map((it) => (
            <Row key={it.label} item={it} muted />
          ))}
        </ul>
      </div>

      <div className="mt-3 flex flex-col gap-1.5">
        {onAllMatch && (
          <button
            type="button"
            onClick={onAllMatch}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-400/10 hover:bg-emerald-400/15 text-emerald-200 text-[12px] font-medium px-3 py-1.5 transition-colors"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Всё совпадает
          </button>
        )}
        {onFillMissing && missingReq.length > 0 && (
          <button
            type="button"
            onClick={handleFill}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/10 hover:bg-amber-400/15 text-amber-200 text-[12px] font-medium px-3 py-1.5 transition-colors"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Заполнить недостающее ({missingReq.length})
          </button>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-wide text-white/40 mb-1">
      {children}
    </div>
  );
}

function Row({ item, muted }: { item: Item; muted?: boolean }) {
  const mismatch = item.state === "mismatch";
  const missing = !muted && item.state === "unknown";
  const ok = item.state === "match";
  return (
    <li className="flex items-baseline gap-2 min-w-0">
      {ok ? (
        <Check className="h-3 w-3 shrink-0 translate-y-0.5 text-emerald-400/80" />
      ) : mismatch ? (
        <X className="h-3 w-3 shrink-0 translate-y-0.5 text-rose-400" />
      ) : (
        <span
          className={
            "h-3 w-3 shrink-0 translate-y-0.5 rounded-full border " +
            (missing ? "border-amber-400/70 bg-amber-400/15" : "border-white/15")
          }
        />
      )}
      <span
        className={
          "shrink-0 " +
          (mismatch
            ? "text-rose-200/90"
            : missing
              ? "text-amber-200/90"
              : muted
                ? "text-white/40"
                : "text-white/55")
        }
      >
        {item.label}
      </span>
      <span
        className={
          "flex-1 border-b border-dashed translate-y-[-3px] " +
          (mismatch
            ? "border-rose-400/25"
            : missing
              ? "border-amber-400/20"
              : "border-white/5")
        }
      />
      <span
        className={
          "text-right break-all min-w-0 " +
          (ok
            ? muted
              ? "text-white/65"
              : "text-white/85"
            : mismatch
              ? "text-rose-300"
              : missing
                ? "text-amber-300/60"
                : "text-white/30")
        }
        title={item.value ?? ""}
      >
        {item.value ?? "—"}
      </span>
    </li>
  );
}

function triFromBool(v: boolean | null | undefined): TriState {
  if (v === true) return "match";
  if (v === false) return "mismatch";
  return "unknown";
}

function labelFromBool(v: boolean | null | undefined): string | undefined {
  if (v === true) return "совпадает";
  if (v === false) return "НЕ совпадает";
  return undefined;
}

export function countDocsPassport(draft: ReportDraft): number {
  const d = draft.documentReconciliationStep ?? {};
  const checks: boolean[] = [
    typeof d.ownersCount === "number",
    typeof d.ownerFullNameMatchWithPTSOrSTS === "boolean",
    typeof d.vinOnBodyMatchWithPTSOrSTS === "boolean",
    typeof d.engineModelMatchWithPTSOrSTS === "boolean",
  ];
  return checks.filter(Boolean).length;
}
