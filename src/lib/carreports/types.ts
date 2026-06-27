// Domain types for carreports specialist report DTO.
// Phase 1: only the fields used by car/characteristics/docs steps.

export type StepId =
  | "car"
  | "characteristics"
  | "docs"
  | "inspection"
  | "legalMaterials"
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
  /** Сохранённая фраза вроде «поколение 2 рестайлинг 1», когда пользователь
   * назвал поколение раньше марки/модели. После того как модель будет указана,
   * оркестратор применит этот hint к resolveCar и очистит поле. */
  pendingGenerationHint?: string | null;
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
  /** server section snake (например, "body"). Для legacy-фото может содержать
   *  локальный zone id — оркестратор и сериализатор учитывают оба варианта. */
  section: string;
  /** element id раздела, к которому привязано фото (см. INSPECTION_SECTIONS). */
  elementId?: string;
  filename: string;
  /** local preview (data: URL). May be absent for server-only photos. */
  dataUrl?: string;
  /** presigned view URL (для отправки в AI vision). */
  url?: string;
  /** true if uploaded to remote storage via presigned PUT. */
  remote?: boolean;
  addedAt?: number;
}


export interface PendingTagName {
  name: string;
  /**
   * Серьёзность тега. Обязательное поле — счётчики паспорта/сводки фильтруют
   * по `severity === "serious"`; без явного значения тег молча уезжает в minor.
   */
  severity: "serious" | "non_serious";
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
  /** Legacy: свободные заметки по локальной «зоне». Остаются для совместимости,
   *  основным хранилищем теперь является `findings` (per-element). */
  sectionNotes: Record<string, string>;
  photos: InspectionPhoto[];
  touched?: boolean;
  /** snake_case раздел из INSPECTION_SECTIONS, на котором сейчас фокус. */
  currentSection?: string;
  /** id элемента активного раздела (например, "hood"). */
  currentElementId?: string;
  /** legacy: id локальной «зоны». Сохраняем для миграции старых тредов. */
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
  /** optional preview image (e.g. generation/restyling photo) */
  image?: string;
  /** optional sub-label (e.g. years range) */
  description?: string;
  /** optional visible section header — chips with the same groupLabel render together under it */
  groupLabel?: string;
  /** if "yesno", the group renders as a question with two answer buttons
   *  (the chip's `label` is used as the answer text, e.g. "Да" / "Нет"). */
  groupKind?: "yesno";
}


export interface MessageAttachment {
  url: string;
  label?: string;
  kind?: "brand" | "model" | "generation";
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
  /** image attachments (brand/model/generation pictures, etc.) */
  attachments?: MessageAttachment[];
  /** custom message variants rendered with a domain-specific card */
  kind?:
    | "passport"
    | "docsPassport"
    | "inspectionSectionPicker"
    | "inspectionChips"
    | "inspectionUploadPrompt"
    | "inspectionCollage"
    | "inspectionAttachAssign"
    | "inspectionElementFocus";
  /** инспекционный раздел (snake) для kind=inspectionUploadPrompt/inspectionCollage */
  sectionSnake?: string;
  /** индекс фото в inspectionStep.photos для kind=inspectionElementFocus */
  photoIdx?: number;
  /** медиа, ожидающее ручного выбора раздела (kind=inspectionAttachAssign) */
  pendingPhoto?: {
    url: string;
    dataUrl: string;
    filename: string;
    remote?: boolean;
    /** если уже закреплено — сюда пишем snake-раздел, чтобы скрыть чипы */
    assignedSection?: string;
  };
  /** статус задачи в очереди ИИ (для плейсхолдер-сообщений) */
  queueStatus?: "queued" | "running" | "error";
  createdAt: number;

}


export type StepMessages = Record<StepId, ChatMessage[]>;

export function emptyStepMessages(): StepMessages {
  return {
    car: [],
    characteristics: [],
    docs: [],
    inspection: [],
    testDrive: [],
    result: [],
    submit: [],
  };
}

export interface Thread {
  id: string;
  title: string;
  updatedAt: number;
  stepIndex: number;
  draft: ReportDraft;
  /** Messages stored per-step so each step has its own conversation. */
  messages: StepMessages;
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
