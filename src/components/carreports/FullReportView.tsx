import { useEffect } from "react";
import { Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { INSPECTION_ZONES, zoneById } from "@/lib/carreports/inspectionZones";
import { ZONE_TO_SECTION, getSection } from "@/lib/carreports/inspectionSections";
import type { Thread } from "@/lib/carreports/types";

interface Props {
  thread: Thread;
  onClose: () => void;
}

function row(label: string, value?: string | number | null) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="report-row flex gap-3 py-1 text-sm">
      <div className="w-44 shrink-0 text-zinc-500">{label}</div>
      <div className="flex-1 text-zinc-900 whitespace-pre-wrap break-words">{String(value)}</div>
    </div>
  );
}

export function FullReportView({ thread, onClose }: Props) {
  const d = thread.draft;
  const car = d.carStep;
  const ch = d.characteristicsStep;
  const doc = d.documentReconciliationStep;
  const ins = d.inspectionStep;
  const td = d.testDriveStep ?? {};
  const res = d.resultStep ?? {};

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const title =
    [ch.brandName, ch.modelCarName].filter(Boolean).join(" ") ||
    thread.title ||
    "Отчёт осмотра";

  const carPhotos = ins.photos;

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 print:bg-white print:static">
      {/* Toolbar (hidden in print) */}
      <div className="no-print absolute top-0 inset-x-0 bg-zinc-900 border-b border-white/10 px-4 py-2 flex items-center gap-2 z-10">
        <div className="text-sm font-medium text-white">Предпросмотр отчёта</div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => window.print()}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            <Printer className="h-4 w-4 mr-1.5" />
            Печать / PDF
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} className="text-white hover:bg-white/10">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="absolute inset-0 overflow-y-auto pt-12 print:pt-0 print:overflow-visible print:relative">
        <div className="report-page mx-auto my-6 print:my-0 max-w-[800px] bg-white text-zinc-900 shadow-2xl print:shadow-none p-8 print:p-0">
          {/* Header */}
          <div className="border-b-2 border-orange-500 pb-3 mb-4">
            <div className="text-xs uppercase tracking-wider text-orange-600 font-semibold">
              Отчёт автоэксперта
            </div>
            <h1 className="text-2xl font-bold mt-1">{title}</h1>
            {car.dateInspection && (
              <div className="text-sm text-zinc-500 mt-1">
                Дата осмотра: {car.dateInspection}
                {car.cityInspection ? ` · ${car.cityInspection}` : ""}
              </div>
            )}
          </div>

          {/* Автомобиль */}
          <section className="report-section mb-5">
            <h2 className="text-lg font-semibold text-zinc-800 mb-2">1. Автомобиль</h2>
            {row("VIN", car.unreadableVin ? "не читается" : car.vin)}
            {row("Гос. номер", car.gosNumber)}
            {row("Пробег", car.mileage ? `${car.mileage.toLocaleString("ru-RU")} км` : null)}
            {car.visuallyMileageNotMatchCondition &&
              row("Пробег визуально", "не соответствует состоянию")}
            {row("Объявление", car.uriListing)}
          </section>

          {/* Характеристики */}
          <section className="report-section mb-5">
            <h2 className="text-lg font-semibold text-zinc-800 mb-2">2. Характеристики</h2>
            {row("Марка", ch.brandName)}
            {row("Модель", ch.modelCarName)}
            {row("Год", ch.year)}
            {row("Двигатель", [ch.engineVolume && `${ch.engineVolume} л`, ch.enginePower && `${ch.enginePower} л.с.`, ch.engineType].filter(Boolean).join(" · ") || null)}
            {row("КПП", ch.transmission)}
            {row("Привод", ch.driveType)}
            {row("Цвет", ch.color)}
            {row("Комплектация", ch.equipment)}
          </section>

          {/* Документы */}
          <section className="report-section mb-5">
            <h2 className="text-lg font-semibold text-zinc-800 mb-2">3. Сверка документов</h2>
            {row("Кол-во собственников", doc.ownersCount)}
            {doc.ownerFullNameMatchWithPTSOrSTS !== undefined && doc.ownerFullNameMatchWithPTSOrSTS !== null &&
              row("Собственник совпадает", doc.ownerFullNameMatchWithPTSOrSTS ? "да" : "нет")}
            {doc.vinOnBodyMatchWithPTSOrSTS !== undefined && doc.vinOnBodyMatchWithPTSOrSTS !== null &&
              row("VIN на кузове", doc.vinOnBodyMatchWithPTSOrSTS ? "совпадает" : "не совпадает")}
            {doc.engineModelMatchWithPTSOrSTS !== undefined && doc.engineModelMatchWithPTSOrSTS !== null &&
              row("Номер двигателя", doc.engineModelMatchWithPTSOrSTS ? "совпадает" : "не совпадает")}
            {row("Примечание", doc.note)}
          </section>

          {/* Осмотр */}
          <section className="report-section mb-5">
            <h2 className="text-lg font-semibold text-zinc-800 mb-2">4. Осмотр по зонам</h2>
            {INSPECTION_ZONES.map((z) => {
              const note = ins.sectionNotes[z.id];
              const photos = ins.photos.filter((p) => p.section === z.id);
              const zoneFindings = Object.values(ins.findings ?? {}).filter((f) => {
                const sn = ZONE_TO_SECTION[z.id];
                return sn && f.section === sn;
              });
              if (!note && photos.length === 0 && zoneFindings.length === 0) return null;
              const section = ZONE_TO_SECTION[z.id]
                ? getSection(ZONE_TO_SECTION[z.id])
                : undefined;
              return (
                <div key={z.id} className="report-zone mb-3">
                  <div className="text-sm font-semibold text-zinc-700">
                    {z.emoji} {z.label}
                  </div>
                  {zoneFindings.length > 0 && section && (
                    <ul className="text-sm text-zinc-800 mt-1 space-y-0.5">
                      {zoneFindings.map((f) => {
                        const el = section.elements.find((e) => e.id === f.elementId);
                        if (!el) return null;
                        const mark =
                          f.noDamage === true ? "✅" : f.noDamage === false ? "⚠️" : "•";
                        const pending = (f.pendingTagNames ?? [])
                          .map((p) => (p.severity === "serious" ? `❗${p.name}` : p.name))
                          .join(", ");
                        const serverTagsCount =
                          (f.seriousDamageTagIds?.length ?? 0) +
                          (f.noSeriousDamageTagIds?.length ?? 0);
                        return (
                          <li key={`${f.section}.${f.elementId}`}>
                            <span>{mark}</span> <b>{el.label}</b>
                            {serverTagsCount > 0 && (
                              <span className="text-zinc-500">
                                {" "}
                                · тегов: {serverTagsCount}
                              </span>
                            )}
                            {pending && (
                              <span className="text-zinc-500"> · {pending}</span>
                            )}
                            {f.note && <span> — {f.note}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {note && zoneFindings.length === 0 && (
                    <div className="text-sm text-zinc-800 whitespace-pre-wrap mt-1">{note}</div>
                  )}
                  {photos.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      {photos.map((p, i) => (
                        <div
                          key={i}
                          className="aspect-square overflow-hidden rounded border border-zinc-200 bg-zinc-50"
                        >
                          {p.dataUrl ? (
                            <img
                              src={p.dataUrl}
                              alt={p.filename}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-400 p-1 text-center">
                              {p.filename}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {Object.keys(ins.sectionNotes).length === 0 && carPhotos.length === 0 && (
              <div className="text-sm text-zinc-500">Данные осмотра не заполнены.</div>
            )}
          </section>

          {/* Тест-драйв */}
          <section className="report-section mb-5">
            <h2 className="text-lg font-semibold text-zinc-800 mb-2">5. Тест-драйв</h2>
            {td.notDone ? (
              <div className="text-sm text-zinc-700">Тест-драйв не проводился.</div>
            ) : td.notes ? (
              <div className="text-sm text-zinc-800 whitespace-pre-wrap">{td.notes}</div>
            ) : (
              <div className="text-sm text-zinc-500">—</div>
            )}
          </section>

          {/* Резюме */}
          <section className="report-section mb-5">
            <h2 className="text-lg font-semibold text-zinc-800 mb-2">6. Резюме и вердикт</h2>
            {res.summaryInspectionNote && (
              <div className="text-sm text-zinc-800 whitespace-pre-wrap mb-3">
                {res.summaryInspectionNote}
              </div>
            )}
            {res.resultSpecialistNote && (
              <div className="report-verdict text-sm font-semibold text-zinc-900 border-l-4 border-orange-500 pl-3 py-1 bg-orange-50">
                {res.resultSpecialistNote}
              </div>
            )}
            {!res.summaryInspectionNote && !res.resultSpecialistNote && (
              <div className="text-sm text-zinc-500">Резюме ещё не сформировано.</div>
            )}
          </section>

          <div className="mt-8 pt-4 border-t border-zinc-200 text-[11px] text-zinc-400">
            Документ сформирован carreports · {new Date().toLocaleString("ru-RU")}
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          html, body { background: #fff !important; }
          .no-print { display: none !important; }
          .report-page { box-shadow: none !important; margin: 0 !important; max-width: 100% !important; padding: 0 !important; }
          .report-section, .report-zone { page-break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}
