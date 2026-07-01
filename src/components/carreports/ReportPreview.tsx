import { FLOW_STEPS } from "@/lib/carreports/flow";
import { isStepFilled } from "@/lib/carreports/progress";
import { INSPECTION_SECTIONS } from "@/lib/carreports/inspectionSections";
import type { StepId, Thread, ReportDraft } from "@/lib/carreports/types";
import { Check, ChevronRight, Eye, FileText } from "lucide-react";

interface Props {
  thread: Thread;
  onJump: (step: StepId) => void;
  onOpenFullReport?: () => void;
}

// Обязательные разделы осмотра (соответствует summaryGate).
const REQUIRED_INSPECTION_SNAKES = ["body", "interior", "under_hood", "glass"] as const;
const REQUIRED_INSPECTION_LABELS: Record<string, string> = {
  body: "Кузов",
  interior: "Салон",
  under_hood: "Подкапотное",
  glass: "Остекление",
};

interface Bit {
  key: string;
  text: string;
  tone?: "default" | "muted" | "warn" | "danger" | "ok";
}

function bit(key: string, text: string, tone: Bit["tone"] = "default"): Bit {
  return { key, text, tone };
}

const toneClass: Record<NonNullable<Bit["tone"]>, string> = {
  default: "bg-white/[0.06] text-white/85 border-white/10",
  muted: "bg-white/[0.03] text-white/55 border-white/10",
  warn: "bg-amber-500/12 text-amber-200 border-amber-400/25",
  danger: "bg-rose-500/12 text-rose-200 border-rose-400/25",
  ok: "bg-emerald-500/12 text-emerald-200 border-emerald-400/25",
};

function fmtDateInput(d: string): string {
  // YYYY-MM-DD → DD.MM.YYYY
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const [y, m, day] = d.split("-");
  return `${day}.${m}.${y}`;
}

function summaryBits(step: StepId, d: ReportDraft): Bit[] {
  switch (step) {
    case "car": {
      const c = d.carStep ?? {};
      const ch = d.characteristicsStep ?? {};
      const out: Bit[] = [];
      const model = [ch.brandName, ch.modelCarName].filter(Boolean).join(" ");
      if (model) out.push(bit("model", model));
      if (ch.year) out.push(bit("year", `${ch.year} г.`));
      if (ch.engineType) out.push(bit("eng", ch.engineType));
      if (ch.transmission) out.push(bit("trans", ch.transmission));
      if (ch.driveType) out.push(bit("drv", ch.driveType));
      if (ch.color) out.push(bit("clr", ch.color));
      if (c.vin) out.push(bit("vin", `VIN …${c.vin.slice(-6)}`, "muted"));
      if (c.gosNumber) out.push(bit("gos", c.gosNumber, "muted"));
      if (c.mileage) out.push(bit("mi", `${c.mileage.toLocaleString("ru-RU")} км`));
      if (c.cityInspection) out.push(bit("city", c.cityInspection, "muted"));
      if (c.dateInspection) out.push(bit("date", fmtDateInput(c.dateInspection), "muted"));
      return out;
    }
    case "docs": {
      const c = d.documentReconciliationStep ?? {};
      const out: Bit[] = [];
      if (typeof c.ownersCount === "number") {
        out.push(bit("own", `Владельцев: ${c.ownersCount}`));
      }
      const rows: Array<[unknown, string, string]> = [
        [c.ownerFullNameMatchWithPTSOrSTS, "Собственник", "own-match"],
        [c.vinOnBodyMatchWithPTSOrSTS, "VIN на кузове", "vin-match"],
        [c.engineModelMatchWithPTSOrSTS, "№ двигателя", "eng-match"],
      ];
      for (const [val, label, key] of rows) {
        if (val === true) out.push(bit(key, `${label}: совпадает`, "ok"));
        else if (val === false) out.push(bit(key, `${label}: не совпадает`, "danger"));
      }
      if (c.note) out.push(bit("note", c.note, "muted"));
      return out;
    }
    case "inspection": {
      const ins = d.inspectionStep;
      const out: Bit[] = [];
      if (!ins) return out;
      const photos = ins.photos ?? [];
      // required coverage
      const covered = REQUIRED_INSPECTION_SNAKES.filter((s) =>
        photos.some((p) => p.section === s),
      );
      const missing = REQUIRED_INSPECTION_SNAKES.filter((s) => !covered.includes(s));
      out.push(
        bit(
          "req",
          `Разделы: ${covered.length}/${REQUIRED_INSPECTION_SNAKES.length}`,
          missing.length === 0 ? "ok" : "warn",
        ),
      );
      if (photos.length) out.push(bit("pho", `${photos.length} медиа`, "muted"));
      // defects
      let serious = 0;
      let minor = 0;
      const findings = ins.findings ?? {};
      for (const f of Object.values(findings)) {
        serious += (f.seriousDamageTagIds?.length ?? 0) +
          (f.pendingTagNames?.filter((p) => p.severity === "serious").length ?? 0);
        minor += (f.noSeriousDamageTagIds?.length ?? 0) +
          (f.pendingTagNames?.filter((p) => p.severity === "non_serious").length ?? 0);
      }
      if (serious) out.push(bit("ser", `Серьёзных: ${serious}`, "danger"));
      if (minor) out.push(bit("min", `Незначительных: ${minor}`, "warn"));
      if (!serious && !minor && photos.length > 0) {
        out.push(bit("noDef", "Дефекты не отмечены", "ok"));
      }
      if (missing.length) {
        out.push(
          bit(
            "miss",
            `Нет медиа: ${missing.map((s) => REQUIRED_INSPECTION_LABELS[s]).join(", ")}`,
            "warn",
          ),
        );
      }
      return out;
    }
    case "legalMaterials": {
      const files = d.legalReviewStep?.otherMaterials ?? [];
      if (!files.length) return [bit("empty", "Не добавлено", "muted")];
      const counts: Record<string, number> = {};
      for (const f of files) counts[f.type] = (counts[f.type] ?? 0) + 1;
      const labels: Record<string, string> = { image: "фото", video: "видео", document: "документ" };
      const out: Bit[] = [bit("total", `${files.length} файл(ов)`)];
      for (const [t, n] of Object.entries(counts)) {
        out.push(bit(`t-${t}`, `${labels[t] ?? t}: ${n}`, "muted"));
      }
      return out;
    }
    case "testDrive": {
      const td = d.testDriveStep ?? {};
      if (td.notDone || td.testDriveIsIncluded === false) {
        return [bit("skip", "Не проводился", "muted")];
      }
      const subs: Array<[unknown, string]> = [
        [td.testDriveEngineIsWorkingProperly, "Двигатель"],
        [td.testDriveTransmissionIsWorkingProperly, "КПП"],
        [td.testDriveSteeringWheelIsWorkingProperly, "Руль"],
        [td.testDriveSuspensionInDriveIsWorkingProperly, "Подвеска"],
        [td.testDriveBrakesInDriveIsWorkingProperly, "Тормоза"],
      ];
      const out: Bit[] = [];
      for (const [val, label] of subs) {
        if (val === true) out.push(bit(label, label, "ok"));
        else if (val === false) out.push(bit(label, label, "danger"));
      }
      const note = td.notes || td.testDriveNote;
      if (note) out.push(bit("note", note.split("\n")[0], "muted"));
      return out;
    }
    case "result": {
      const r = d.resultStep ?? {};
      const out: Bit[] = [];
      if (r.summaryInspectionNote) out.push(bit("sum", r.summaryInspectionNote));
      if (r.resultSpecialistNote) out.push(bit("verd", r.resultSpecialistNote, "ok"));
      return out;
    }
    default:
      return [];
  }
}

function findUpload(t: Thread): { reportId?: string | number; at?: number } | null {
  const msgs = t.messages.result ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.kind === "finishComplete" && m.finishComplete) {
      return { reportId: m.finishComplete.reportId, at: m.createdAt };
    }
  }
  return null;
}

function fmtDate(ts: number): string {
  try {
    return new Date(ts).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return "";
  }
}

export function ReportPreview({ thread, onJump, onOpenFullReport }: Props) {
  const uploaded = findUpload(thread);
  const isUploaded = !!uploaded;

  const filledCount = FLOW_STEPS.filter((s) => isStepFilled(s.id, thread.draft)).length;
  const totalSteps = FLOW_STEPS.length;
  const progressPct = Math.round((filledCount / totalSteps) * 100);

  const titleText = isUploaded
    ? `Отчёт${uploaded?.reportId ? ` №${uploaded.reportId}` : ""}`
    : "Черновик отчёта";
  const subtitle = isUploaded
    ? `Выгружен · ${uploaded?.at ? fmtDate(uploaded.at) : ""}`
    : `${filledCount}/${totalSteps} шагов заполнено`;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-white">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-orange-500/15 text-orange-400 flex items-center justify-center shrink-0">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{titleText}</div>
            <div className="text-[11px] text-white/50 truncate">{subtitle}</div>
          </div>
        </div>
        {!isUploaded && (
          <div className="mt-3 h-1 rounded-full bg-white/8 overflow-hidden">
            <div
              className="h-full bg-orange-500 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
      </div>

      {/* Actions */}
      {onOpenFullReport && (
        <div className="px-3 pt-3 space-y-2">
          <button
            onClick={onOpenFullReport}
            className={
              "w-full rounded-xl text-white text-sm font-medium py-2.5 flex items-center justify-center gap-2 transition-colors " +
              (isUploaded
                ? "bg-emerald-500 hover:bg-emerald-600"
                : "bg-orange-500 hover:bg-orange-600")
            }
          >
            <Eye className="h-4 w-4" />
            {isUploaded ? "Открыть отчёт" : "Предпросмотр"}
          </button>
        </div>
      )}

      {/* Steps */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {FLOW_STEPS.map((step, idx) => {
          const done = isStepFilled(step.id, thread.draft);
          const isCurrent = idx === thread.stepIndex;
          const bits = summaryBits(step.id, thread.draft);
          return (
            <button
              key={step.id}
              onClick={() => onJump(step.id)}
              className={
                "w-full text-left rounded-xl border p-3 transition-colors " +
                (isCurrent
                  ? "border-orange-400/60 bg-orange-500/10"
                  : "border-white/10 hover:border-white/20 bg-white/[0.02]")
              }
            >
              <div className="flex items-center gap-2">
                <div
                  className={
                    "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 " +
                    (done
                      ? "bg-emerald-500 text-white"
                      : isCurrent
                        ? "bg-orange-500 text-white"
                        : "bg-white/10 text-white/60")
                  }
                >
                  {done ? <Check className="h-3 w-3" /> : idx + 1}
                </div>
                <div className="text-sm font-medium truncate">{step.label}</div>
                <ChevronRight className="h-4 w-4 text-white/40 ml-auto shrink-0" />
              </div>

              {bits.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {bits.map((b) => (
                    <span
                      key={b.key}
                      className={
                        "inline-flex items-center max-w-full rounded-md border px-1.5 py-0.5 text-[11px] leading-tight " +
                        toneClass[b.tone ?? "default"]
                      }
                    >
                      <span className="truncate">{b.text}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-white/40 mt-1.5">Пока пусто</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
