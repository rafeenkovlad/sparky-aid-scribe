// Defensive accessors — never crash on missing nested fields.

import { FLOW_STEPS } from "./flow";
import type { ReportDraft, StepId } from "./types";

export function isStepFilled(id: StepId, d: ReportDraft): boolean {
  if (!d) return false;
  switch (id) {
    case "car": {
      const c = d.carStep ?? {};
      const hasVin = !!c.vin && c.vin.length >= 11;
      return (hasVin || !!c.unreadableVin) && !!c.mileage && !!c.cityInspection && !!c.dateInspection;
    }
    case "characteristics": {
      const c = d.characteristicsStep ?? {};
      return !!c.engineType && !!c.transmission && !!c.driveType && !!c.color;
    }
    case "docs": {
      const c = d.documentReconciliationStep ?? {};
      return typeof c.ownersCount === "number";
    }
    case "inspection":
      return !!d.inspectionStep?.touched;
    case "testDrive": {
      const c = d.testDriveStep ?? {};
      return !!c.notDone || !!c.notes;
    }
    case "result": {
      const c = d.resultStep ?? {};
      return !!c.summaryInspectionNote || !!c.resultSpecialistNote;
    }
    case "submit":
      return false;
  }
}

export function filledCount(d: ReportDraft): number {
  return FLOW_STEPS.slice(0, 6).filter((s) => isStepFilled(s.id, d)).length;
}

export function shortCarSummary(d: ReportDraft): string {
  const c = d.carStep ?? {};
  const bits: string[] = [];
  if (c.vin) bits.push(`VIN ${c.vin.slice(-6)}`);
  if (c.gosNumber) bits.push(c.gosNumber);
  if (c.mileage) bits.push(`${c.mileage.toLocaleString("ru-RU")} км`);
  if (c.cityInspection) bits.push(c.cityInspection);
  if (c.dateInspection) bits.push(c.dateInspection);
  return bits.join(" · ") || "—";
}

export function shortCharSummary(d: ReportDraft): string {
  const c = d.characteristicsStep ?? {};
  const bits: string[] = [];
  if (c.brandName || c.modelCarName) bits.push([c.brandName, c.modelCarName].filter(Boolean).join(" "));
  if (c.year) bits.push(String(c.year));
  if (c.engineVolume) bits.push(`${c.engineVolume} л`);
  if (c.engineType) bits.push(c.engineType);
  if (c.transmission) bits.push(c.transmission);
  if (c.driveType) bits.push(c.driveType);
  if (c.color) bits.push(c.color);
  return bits.join(" · ") || "—";
}

export function shortDocsSummary(d: ReportDraft): string {
  const c = d.documentReconciliationStep ?? {};
  const bits: string[] = [];
  if (typeof c.ownersCount === "number") bits.push(`Владельцев: ${c.ownersCount}`);
  if (c.ownerFullNameMatchWithPTSOrSTS === false) bits.push("Собственник не совпадает");
  if (c.vinOnBodyMatchWithPTSOrSTS === false) bits.push("VIN не совпадает");
  if (c.engineModelMatchWithPTSOrSTS === false) bits.push("№ двигателя не совпадает");
  if (c.note) bits.push(c.note);
  return bits.join(" · ") || "—";
}
