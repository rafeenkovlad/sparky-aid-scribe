// Catalog of 8 inspection sections and their elements, matching the Doc schema
// for Storage.PrepareSpecialistReport (inspectionStep) and Storage.GetUserTags
// (step="inspection", section=<snake_case>).

export type SectionSnake =
  | "body"
  | "body_reinforcement"
  | "glass"
  | "interior"
  | "under_hood"
  | "wheels_and_brakes"
  | "lightning"
  | "computer_diagnostics";

export interface InspectionElement {
  /** stable id, used as map key and shown to AI */
  id: string;
  /** Russian label shown in UI / report */
  label: string;
  /** Exact Doc collection name to which findings should be written */
  collection: string;
}

export interface InspectionSection {
  snake: SectionSnake;
  /** camelCase property name in inspectionStep */
  doc: string;
  label: string;
  /** ordered list of elements (last is GeneralCondition) */
  elements: InspectionElement[];
}

const e = (id: string, label: string, collection: string): InspectionElement => ({
  id,
  label,
  collection,
});

export const INSPECTION_SECTIONS: InspectionSection[] = [
  {
    snake: "body",
    doc: "bodySection",
    label: "Кузов",
    elements: [
      e("hood", "Капот", "bodyElementHoodCollection"),
      e("frontBumper", "Передний бампер", "bodyElementFrontBumperCollection"),
      e("rearBumper", "Задний бампер", "bodyElementRearBumperCollection"),
      e("roof", "Крыша", "bodyElementRoofCollection"),
      e("trunk", "Крышка багажника", "bodyElementTrunkCollection"),
      e("leftFrontWing", "Левое переднее крыло", "bodyElementLeftFrontWingCollection"),
      e("rightFrontWing", "Правое переднее крыло", "bodyElementRightFrontWingCollection"),
      e("rightRearWing", "Правое заднее крыло", "bodyElementRightRearWingCollection"),
      e("leftRearWing", "Левое заднее крыло", "bodyElementLeftRearWingCollection"),
      e("leftFrontDoor", "Левая передняя дверь", "bodyElementLeftFrontDoorCollection"),
      e("leftRearDoor", "Левая задняя дверь", "bodyElementLeftRearDoorCollection"),
      e("rightRearDoor", "Правая задняя дверь", "bodyElementRightRearDoorCollection"),
      e("rightFrontDoor", "Правая передняя дверь", "bodyElementRightFrontDoorCollection"),
      e("underHood", "Подкапотное пространство (кузов)", "bodyElementUnderHoodCollection"),
      e("insideTrunk", "Внутри багажника", "bodyElementInsideTrunkCollection"),
      e("generalCondition", "Общее состояние кузова", "bodyElementGeneralConditionCollection"),
    ],
  },
  {
    snake: "body_reinforcement",
    doc: "bodyReinforcementElementsSection",
    label: "Силовой каркас",
    elements: [
      e(
        "frontLeftPillar",
        "Передняя левая стойка",
        "bodyReinforcementElementFrontLeftPillarCollection",
      ),
      e(
        "frontRightPillar",
        "Передняя правая стойка",
        "bodyReinforcementElementFrontRightPillarCollection",
      ),
      e(
        "centerRightPillar",
        "Центральная правая стойка",
        "bodyReinforcementElementCenterRightPillarCollection",
      ),
      e(
        "centerLeftPillar",
        "Центральная левая стойка",
        "bodyReinforcementElementCenterLeftPillarCollection",
      ),
      e(
        "rearLeftPillar",
        "Задняя левая стойка",
        "bodyReinforcementElementRearLeftPillarCollection",
      ),
      e(
        "rearRightPillar",
        "Задняя правая стойка",
        "bodyReinforcementElementRearRightPillarCollection",
      ),
      e("leftSideBeam", "Левый лонжерон", "bodyReinforcementElementLeftSideBeamCollection"),
      e("rightSideBeam", "Правый лонжерон", "bodyReinforcementElementRightSideBeamCollection"),
      e("leftSill", "Левый порог", "bodyReinforcementElementLeftSillCollection"),
      e("rightSill", "Правый порог", "bodyReinforcementElementRightSillCollection"),
      e(
        "leftFrontMudguard",
        "Левый передний брызговик",
        "bodyReinforcementElementLeftFrontMudguardCollection",
      ),
      e(
        "rightFrontMudguard",
        "Правый передний брызговик",
        "bodyReinforcementElementRightFrontMudguardCollection",
      ),
      e(
        "leftRearMudguard",
        "Левый задний брызговик",
        "bodyReinforcementElementLeftRearMudguardCollection",
      ),
      e(
        "rightRearMudguard",
        "Правый задний брызговик",
        "bodyReinforcementElementRightRearMudguardCollection",
      ),
      e(
        "generalCondition",
        "Общее состояние каркаса",
        "bodyReinforcementElementGeneralConditionCollection",
      ),
    ],
  },
  {
    snake: "glass",
    doc: "glassSection",
    label: "Остекление",
    elements: [
      e("front", "Лобовое стекло", "glassElementFrontCollection"),
      e("frontLeft", "Переднее левое", "glassElementFrontLeftCollection"),
      e("frontRight", "Переднее правое", "glassElementFrontRightCollection"),
      e("rearRight", "Заднее правое", "glassElementRearRightCollection"),
      e("rearLeft", "Заднее левое", "glassElementRearLeftCollection"),
      e("sideLeft", "Боковое левое", "glassElementSideLeftCollection"),
      e("sideRight", "Боковое правое", "glassElementSideRightCollection"),
      e("generalCondition", "Общее состояние стёкол", "glassElementGeneralConditionCollection"),
    ],
  },
  {
    snake: "interior",
    doc: "interiorSection",
    label: "Салон",
    elements: [
      e("frontSeats", "Передние сиденья", "interiorElementFrontSeatsCollection"),
      e("rearSeats", "Задние сиденья", "interiorElementRearSeatsCollection"),
      e("ceiling", "Потолок", "interiorElementCeilingCollection"),
      e("trunkCompartment", "Багажный отсек", "interiorElementTrunkCompartmentCollection"),
      e("steeringWheel", "Руль", "interiorElementSteeringWheelCollection"),
      e("dashboard", "Торпедо", "interiorElementDashboardCollection"),
      e(
        "instrumentCluster",
        "Приборная панель",
        "interiorElementInstrumentClusterCollection",
      ),
      e("centralMonitor", "Мультимедиа", "interiorElementCentralMonitorCollection"),
      e("climateControlUnit", "Блок климата", "interiorElementClimateControlUnitCollection"),
      e("centerConsole", "Центральная консоль", "interiorElementCenterConsoleCollection"),
      e("gearSelectorArea", "Селектор КПП", "interiorElementGearSelectorAreaCollection"),
      e(
        "buttonsLeftOfSteeringWheel",
        "Кнопки слева от руля",
        "interiorElementButtonsLeftOfSteeringWheelCollection",
      ),
      e("generalCondition", "Общее состояние салона", "interiorElementGeneralConditionCollection"),
    ],
  },
  {
    snake: "under_hood",
    doc: "underHoodSpaceSection",
    label: "Подкапотное пространство",
    elements: [
      e("engine", "Двигатель", "underHoodElementEngineCollection"),
      e("attachments", "Навесное", "underHoodElementAttachmentsCollection"),
      e("coolingSystem", "Система охлаждения", "underHoodElementCoolingSystemCollection"),
      e("intakeOrTurbine", "Впуск/турбина", "underHoodElementIntakeOrTurbineCollection"),
      e("releaseOrEcology", "Выпуск/экология", "underHoodElementReleaseOrEcologyCollection"),
      e("electrics", "Электрика", "underHoodElementElectricsCollection"),
      e("brakingSystem", "Тормозная система", "underHoodElementBrakingSystemCollection"),
      e("steeringControl", "Рулевое управление", "underHoodElementSteeringControlCollection"),
      e(
        "generalCondition",
        "Общее состояние подкапотки",
        "underHoodElementGeneralConditionCollection",
      ),
    ],
  },
  {
    snake: "wheels_and_brakes",
    doc: "wheelsAndBrakesSection",
    label: "Колёса и тормоза",
    elements: [
      e(
        "frontLeftWheel",
        "Переднее левое колесо",
        "wheelsAndBrakesElementFrontLeftWheelCollection",
      ),
      e(
        "frontRightWheel",
        "Переднее правое колесо",
        "wheelsAndBrakesElementFrontRightWheelCollection",
      ),
      e("rearLeftWheel", "Заднее левое колесо", "wheelsAndBrakesElementRearLeftWheelCollection"),
      e(
        "rearRightWheel",
        "Заднее правое колесо",
        "wheelsAndBrakesElementRearRightWheelCollection",
      ),
      e("spareWheel", "Запасное колесо", "wheelsAndBrakesElementSpareWheelCollection"),
      e(
        "frontLeftBrake",
        "Передний левый тормоз",
        "wheelsAndBrakesElementFrontLeftBrakeCollection",
      ),
      e(
        "frontRightBrake",
        "Передний правый тормоз",
        "wheelsAndBrakesElementFrontRightBrakeCollection",
      ),
      e("rearLeftBrake", "Задний левый тормоз", "wheelsAndBrakesElementRearLeftBrakeCollection"),
      e(
        "rearRightBrake",
        "Задний правый тормоз",
        "wheelsAndBrakesElementRearRightBrakeCollection",
      ),
      e(
        "generalCondition",
        "Общее состояние колёс/тормозов",
        "wheelsAndBrakesElementGeneralConditionCollection",
      ),
    ],
  },
  {
    snake: "lightning",
    doc: "lightningSection",
    label: "Освещение",
    elements: [
      e("frontLights", "Передние фары", "lightningElementFrontLightsCollection"),
      e("rearLights", "Задние фонари", "lightningElementRearLightsCollection"),
      e(
        "daytimeRunningLights",
        "Дневные ходовые огни",
        "lightningElementDaytimeRunningLightsCollection",
      ),
      e("fogLights", "Противотуманные фары", "lightningElementFogLightsCollection"),
      e("turnSignals", "Поворотники", "lightningElementTurnSignalsCollection"),
      e("brakeLights", "Стоп-сигналы", "lightningElementBrakeLightsCollection"),
      e("numberPlateLights", "Подсветка номера", "lightningElementNumberPlateLightsCollection"),
      e(
        "generalCondition",
        "Общее состояние освещения",
        "lightningElementGeneralConditionCollection",
      ),
    ],
  },
  {
    snake: "computer_diagnostics",
    doc: "computerDiagnosticsSection",
    label: "Компьютерная диагностика",
    elements: [
      e("engine", "Двигатель (диагностика)", "computerDiagnosticsElementEngineCollection"),
      e(
        "transmission",
        "Трансмиссия (диагностика)",
        "computerDiagnosticsElementTransmissionCollection",
      ),
      e("absEspBrake", "ABS/ESP/Тормоза", "computerDiagnosticsElementAbsEspBrakeCollection"),
      e("srsAirbag", "SRS/Подушки", "computerDiagnosticsElementSrsAirbagCollection"),
      e("electrical", "Электрика", "computerDiagnosticsElementElectricalCollection"),
      e(
        "ecologyExhaust",
        "Экология/выпуск",
        "computerDiagnosticsElementEcologyExhaustCollection",
      ),
      e(
        "bodyElectronics",
        "Кузовная электроника",
        "computerDiagnosticsElementBodyElectronicsCollection",
      ),
      e(
        "steeringSuspension",
        "Рулевое/подвеска",
        "computerDiagnosticsElementSteeringSuspensionCollection",
      ),
      e("fourWheelDrive", "Полный привод", "computerDiagnosticsElementFourWheelDriveCollection"),
      e("climate", "Климат", "computerDiagnosticsElementClimateCollection"),
      e("immobilizer", "Иммобилайзер", "computerDiagnosticsElementImmobilizerCollection"),
      e(
        "generalCondition",
        "Общее состояние диагностики",
        "computerDiagnosticsElementGeneralConditionCollection",
      ),
    ],
  },
];

export function getSection(snake: SectionSnake): InspectionSection {
  return INSPECTION_SECTIONS.find((s) => s.snake === snake)!;
}

/** Map our local zone id → server section snake key. */
export const ZONE_TO_SECTION: Record<string, SectionSnake> = {
  body: "body",
  geometry: "body_reinforcement",
  interior: "interior",
  engine: "under_hood",
  transmission: "under_hood",
  suspension: "wheels_and_brakes",
  brakes: "wheels_and_brakes",
  underbody: "body",
};

/** Composite key used in InspectionStep.findings: `${section}.${elementId}`. */
export function findingKey(section: SectionSnake, elementId: string): string {
  return `${section}.${elementId}`;
}
