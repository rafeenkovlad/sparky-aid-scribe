// Domain types for carreports specialist report DTO.
// Phase 1: only the fields used by car/characteristics/docs steps.

export type StepId =
  | "car"
  | "characteristics"
  | "docs"
  | "inspection"
  | "testDrive"
  | "result"
  | "submit";

export interface CarStep {
  vin?: string;
  unreadableVin?: boolean;
  gosNumber?: string | null;
  uriListing?: string | null;
  mileage?: number;
  visuallyMileageNotMatchCondition?: boolean;
  cityInspection?: string;
  /** YYYY-MM-DD */
  dateInspection?: string;
}

export type EngineType = "Бензин" | "Дизель" | "Гибрид" | "Электро" | "Газ/Бензин";
export type Transmission = "АКПП" | "МКПП" | "Робот" | "Вариатор";
export type DriveType = "Передний" | "Задний" | "Полный";

export interface CharacteristicsStep {
  brandName?: string;
  modelCarName?: string;
  modelCarId?: number | null;
  /** server-side restyling frame id, used by Doc as alt to modelCarId */
  modelGenerationRestylingFrameId?: number | null;
  /** human label like "Tiguan II / FL (2020–2024)" — for UI/recap only */
  generationLabel?: string;
  year?: number;
  engineVolume?: number;
  enginePower?: number;
  engineType?: EngineType;
  transmission?: Transmission;
  driveType?: DriveType;
  color?: string;
  equipment?: string;
}

export interface DocumentReconciliationStep {
  ownersCount?: number;
  /** соответствует Doc: владелец в ПТС/СТС совпадает с продавцом */
  ownerFullNameMatchWithPTSOrSTS?: boolean | null;
  /** соответствует Doc: VIN на кузове совпадает с ПТС/СТС */
  vinOnBodyMatchWithPTSOrSTS?: boolean | null;
  /** соответствует Doc: модель/номер двигателя совпадает с ПТС/СТС */
  engineModelMatchWithPTSOrSTS?: boolean | null;
  /** локальная заметка (в Doc схеме нет — на отправку не пойдёт) */
  note?: string;
}

export interface InspectionPhoto {
  section: string;
  filename: string;
  /** local preview (data: URL). May be absent for server-only photos. */
  dataUrl?: string;
  /** true if uploaded to remote storage via presigned PUT. */
  remote?: boolean;
  addedAt?: number;
}

export interface PendingTagName {
  name: string;
  severity?: "serious" | "non_serious";
}

export interface InspectionElementFinding {
  /** server section id (snake_case) — duplicated for easy lookup */
  section: string;
  elementId: string;
  /** true if element осмотрен без замечаний */
  noDamage?: boolean;
  seriousDamageTagIds?: number[];
  noSeriousDamageTagIds?: number[];
  /** tags AI extracted but did not resolve to server tag IDs */
  pendingTagNames?: PendingTagName[];
  note?: string;
  audioNotes?: string[];
}

export interface InspectionStep {
  // Phase 2: 8 zones. Notes are keyed by zone id.
  sectionNotes: Record<string, string>;
  photos: InspectionPhoto[];
  touched?: boolean;
  /** zone id last interacted with */
  currentZone?: string;
  /** structured findings, keyed by `${section}.${elementId}` */
  findings?: Record<string, InspectionElementFinding>;
}

export interface TestDriveStep {
  notDone?: boolean;
  notes?: string;
  testDriveIsIncluded?: boolean;
  testDriveEngineIsWorkingProperly?: boolean;
  testDriveTransmissionIsWorkingProperly?: boolean;
  testDriveSteeringWheelIsWorkingProperly?: boolean;
  testDriveSuspensionInDriveIsWorkingProperly?: boolean;
  testDriveBrakesInDriveIsWorkingProperly?: boolean;
  testDriveEngineTags?: string[];
  testDriveTransmissionTags?: string[];
  testDriveSteeringWheelTags?: string[];
  testDriveSuspensionInDriveTags?: string[];
  testDriveBrakesInDriveTags?: string[];
  testDriveNote?: string;
}

export interface ResultStep {
  summaryInspectionNote?: string;
  resultSpecialistNote?: string;
}

export interface ReportDraft {
  reportName?: string;
  reportDate?: string;
  carStep: CarStep;
  characteristicsStep: CharacteristicsStep;
  documentReconciliationStep: DocumentReconciliationStep;
  inspectionStep: InspectionStep;
  testDriveStep: TestDriveStep;
  resultStep: ResultStep;
}

export type ChatRole = "user" | "assistant" | "system";

export interface ChatChip {
  /** label shown on the chip */
  label: string;
  /** text inserted into the composer when tapped */
  value: string;
  /** logical group key — chips in the same single-group replace each other */
  group?: string;
  /** if true, only one chip in the group can be selected at a time */
  single?: boolean;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  /** if set, the message belongs to a step and may render chips */
  step?: StepId;
  /** if set, chips are shown inside this assistant message */
  chips?: ChatChip[];
  /** which step's chips this message owns; only the LAST such msg is interactive */
  optionsStep?: StepId;
  /** chip values already selected within this message */
  selectedChipValues?: string[];
  createdAt: number;
}

export interface Thread {
  id: string;
  title: string;
  updatedAt: number;
  stepIndex: number;
  draft: ReportDraft;
  messages: ChatMessage[];
  aiChatIds: Record<string, number>;
}

export function emptyDraft(): ReportDraft {
  return {
    carStep: {},
    characteristicsStep: {},
    documentReconciliationStep: {},
    inspectionStep: { sectionNotes: {}, photos: [], touched: false },
    testDriveStep: {},
    resultStep: {},
  };
}
