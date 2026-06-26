// Defensive accessors — never crash on missing nested fields.

import { FLOW_STEPS } from "./flow";
import { INSPECTION_SECTIONS } from "./inspectionSections";
import { sectionProgress } from "./inspectionState";
import type { ReportDraft, StepId } from "./types";


export function isStepFilled(id: StepId, d: ReportDraft): boolean {
  if (!d) return false;
  switch (id) {
    case "car": {
      const c = d.carStep ?? {};
      const ch = d.characteristicsStep ?? {};
      const hasVin = !!c.vin && c.vin.length >= 11;
      return hasVin && !!c.mileage && !!c.dateInspection && !!ch.year
        && !!ch.brandName && !!ch.modelCarName;
    }
    case "characteristics": {
      const c = d.characteristicsStep ?? {};
      return !!c.engineType && !!c.transmission && !!c.driveType && !!c.color;
    }
    case "docs": {
      const c = d.documentReconciliationStep ?? {};
      return typeof c.ownersCount === "number";
    }
    case "inspection": {
      const ins = d.inspectionStep;
      if (!ins?.touched) return false;
      // Считаем шаг готовым, когда у каждого раздела есть хотя бы 1 finding,
      // или явно отмечены все элементы хотя бы одного раздела как "ок".
      // Здесь — мягкий критерий: каждый раздел затронут.
      return INSPECTION_SECTIONS.every(
        (s) => sectionProgress(ins, s).filled > 0,
      );
    }

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

/** Return a human-readable prompt for the next missing required field, or null
 *  if the step is already complete. Used to guide the user step-by-step. */
export function nextMissingPrompt(id: StepId, d: ReportDraft): string | null {
  if (!d) return null;
  switch (id) {
    case "car": {
      const c = d.carStep ?? {};
      const ch = d.characteristicsStep ?? {};
      if (!c.vin) return "Продиктуйте VIN автомобиля (17 символов). Если VIN нечитаемый — назовите госномер, подтянем VIN автоматически. Либо загрузите фото документа (СТС или ПТС) — распознаем VIN и характеристики авто.";
      if (!ch.brandName || !ch.modelCarName) return "Назовите марку и модель автомобиля.";
      if (!c.mileage) return "Какой пробег по одометру? (км)";
      if (!c.dateInspection) return "Выберите дату осмотра (по умолчанию — сегодня).";
      if (!ch.year) return "Какой год выпуска?";
      return null;
    }
    case "docs": {
      const c = d.documentReconciliationStep ?? {};
      if (typeof c.ownersCount !== "number") return "Сколько владельцев по ПТС?";
      if (c.ownerFullNameMatchWithPTSOrSTS === undefined)
        return "Собственник в ПТС/СТС совпадает с продавцом?";
      if (c.vinOnBodyMatchWithPTSOrSTS === undefined)
        return "VIN на кузове совпадает с документами?";
      if (c.engineModelMatchWithPTSOrSTS === undefined)
        return "Номер двигателя совпадает с ПТС?";
      return null;
    }
    case "inspection":
      return d.inspectionStep?.touched
        ? null
        : "Выберите зону осмотра и опишите её состояние (или нажмите «Без замечаний»).";
    case "testDrive": {
      const c = d.testDriveStep ?? {};
      if (!c.notDone && !c.notes && c.testDriveIsIncluded === undefined)
        return "Проводился ли тест-драйв? Если да — опишите поведение авто в движении.";
      return null;
    }
    case "result": {
      const c = d.resultStep ?? {};
      if (!c.summaryInspectionNote) return "Сформулируйте краткое резюме по состоянию авто.";
      if (!c.resultSpecialistNote) return "Добавьте вердикт: рекомендуете ли к покупке?";
      return null;
    }
    default:
      return null;
  }
}

/** Short labels of all still-missing fields for this step (required + optional),
 *  excluding the one already asked via `nextMissingPrompt`. For showing a brief
 *  "осталось: …" hint after each assistant answer. */
export function remainingFieldLabels(id: StepId, d: ReportDraft): string[] {
  if (!d) return [];
  const out: string[] = [];
  switch (id) {
    case "car": {
      const c = d.carStep ?? {};
      const ch = d.characteristicsStep ?? {};
      if (!c.vin) out.push("VIN");
      if (!ch.brandName || !ch.modelCarName) out.push("марка/модель");
      if (!c.mileage) out.push("пробег");
      if (!c.cityInspection) out.push("город");
      if (!c.dateInspection) out.push("дата осмотра");
      if (!ch.year) out.push("год");
      if (!ch.engineType) out.push("двигатель");
      if (!ch.transmission) out.push("КПП");
      if (!ch.driveType) out.push("привод");
      if (!ch.color) out.push("цвет");
      if (!ch.generationLabel) out.push("поколение");
      if (!ch.engineVolume) out.push("объём");
      if (!ch.equipment) out.push("комплектация");
      if (!c.gosNumber) out.push("госномер");
      if (!c.uriListing) out.push("ссылка на объявление");
      break;
    }
    case "docs": {
      const c = d.documentReconciliationStep ?? {};
      if (typeof c.ownersCount !== "number") out.push("кол-во владельцев");
      if (c.ownerFullNameMatchWithPTSOrSTS === undefined) out.push("собственник vs продавец");
      if (c.vinOnBodyMatchWithPTSOrSTS === undefined) out.push("VIN на кузове vs документы");
      if (c.engineModelMatchWithPTSOrSTS === undefined) out.push("№ двигателя vs ПТС");
      if (!c.note) out.push("комментарий");
      break;
    }
    case "inspection": {
      const ins = d.inspectionStep ?? { sectionNotes: {}, photos: [] };
      if (!ins.touched) out.push("первая зона");
      const zonesWithNotes = Object.keys(ins.sectionNotes ?? {}).length;
      if (zonesWithNotes < 8) out.push(`ещё зон: ${8 - zonesWithNotes}`);
      if ((ins.photos?.length ?? 0) === 0) out.push("фото");
      break;
    }
    case "testDrive": {
      const c = d.testDriveStep ?? {};
      if (c.testDriveIsIncluded === undefined && !c.notDone) out.push("проводился ли тест-драйв");
      if (c.testDriveEngineIsWorkingProperly === undefined) out.push("двигатель");
      if (c.testDriveTransmissionIsWorkingProperly === undefined) out.push("КПП");
      if (c.testDriveSteeringWheelIsWorkingProperly === undefined) out.push("руль");
      if (c.testDriveSuspensionInDriveIsWorkingProperly === undefined) out.push("подвеска");
      if (c.testDriveBrakesInDriveIsWorkingProperly === undefined) out.push("тормоза");
      if (!c.notes && !c.testDriveNote) out.push("заметки");
      break;
    }
    case "result": {
      const c = d.resultStep ?? {};
      if (!c.summaryInspectionNote) out.push("резюме");
      if (!c.resultSpecialistNote) out.push("вердикт");
      break;
    }
  }
  return out;
}



/** Return list of optional fields that are NOT filled yet for this step.
 *  Used to suggest the user what else can be added. */
export function missingOptionalFields(id: StepId, d: ReportDraft): string[] {
  if (!d) return [];
  const out: string[] = [];
  switch (id) {
    case "car": {
      const c = d.carStep ?? {};
      const ch = d.characteristicsStep ?? {};
      if (!c.cityInspection) out.push("город осмотра");
      if (!ch.engineType) out.push("тип двигателя");
      if (!ch.transmission) out.push("КПП");
      if (!ch.driveType) out.push("привод");
      if (!ch.color) out.push("цвет");
      if (!c.gosNumber) out.push("госномер");
      if (!c.uriListing) out.push("ссылку на объявление");
      if (!c.visuallyMileageNotMatchCondition) out.push("отметку, если пробег не соответствует состоянию");
      if (!ch.generationLabel) out.push("поколение");
      if (!ch.engineVolume) out.push("объём двигателя");
      if (!ch.equipment) out.push("комплектацию");
      break;
    }
    case "characteristics": {
      const c = d.characteristicsStep ?? {};
      if (!c.generationLabel) out.push("поколение");
      if (!c.engineVolume) out.push("объём двигателя");
      if (!c.equipment) out.push("комплектацию");
      break;
    }
    case "docs": {
      const c = d.documentReconciliationStep ?? {};
      if (!c.note) out.push("комментарий по документам");
      break;
    }
    case "testDrive": {
      const c = d.testDriveStep ?? {};
      if (!c.notes && !c.notDone) out.push("заметки по тест-драйву");
      break;
    }
    case "result": {
      const c = d.resultStep ?? {};
      if (!c.summaryInspectionNote) out.push("краткое резюме осмотра");
      if (!c.resultSpecialistNote) out.push("вердикт специалиста");
      break;
    }
  }
  return out;
}

/** Human-readable sentence suggesting what optional fields can still be added. */
export function optionalHintSentence(id: StepId, d: ReportDraft): string {
  const fields = missingOptionalFields(id, d);
  if (!fields.length) return "Можно нажать «Всё верно, далее».";
  return `Можно ещё добавить: ${fields.join(", ")}. Либо нажмите «Всё верно, далее».`;
}

export function filledCount(d: ReportDraft): number {
  return FLOW_STEPS.slice(0, FLOW_STEPS.length - 1).filter((s) => isStepFilled(s.id, d)).length;
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
