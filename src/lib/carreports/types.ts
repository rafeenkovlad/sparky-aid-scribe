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
  /** id записи в IndexedDB-кеше с полным blob'ом (см. lib/carreports/photoCache). */
  photoId?: string;
  /** thumb (≤256px) data: URL для UI-превью. Может отсутствовать у server-only фото. */
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
  /** ЛКП (мкм): нижняя/верхняя граница диапазона толщины окраса.
   *  Применимо к разделам кузова и силового каркаса. Если не задано — на бэк
   *  уходит дефолт 80–200 (см. `storageApi.ts`). */
  paintworkThicknessFrom?: number;
  paintworkThicknessTo?: number;
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
  /** true → пользователь сам выбрал раздел/элемент: AI-роутер не переопределяет цель. */
  manualCursor?: boolean;
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
  /** Тип (serious/non_serious) для тегов, заведённых через AI-классификацию.
   *  Ключ — имя тега (lowercased trim). Используется для фильтрации отображения
   *  и для гарантии, что AddUserTag никогда не уходит с type=null. */
  testDriveTagTypes?: Record<string, "serious" | "non_serious">;
}


export interface ResultStep {
  summaryInspectionNote?: string;
  resultSpecialistNote?: string;
}

/** Файл, прикреплённый к шагу «Дополнительные материалы проверки».
 *  Соответствует FileDTO бэкенда (filename / key / type / stepType). */
export interface LegalReviewMaterial {
  /** Имя файла с расширением. */
  filename: string;
  /** id записи в IndexedDB-кеше (если файл готовился через preparePhoto). */
  photoId?: string;
  /** id записи в IndexedDB для произвольных файлов (видео/документы),
   *  которые не сжимаем и держим локально до финальной выгрузки. */
  localFileId?: string;
  /** Файл ещё не выгружен в S3 — будет загружен multipart'ом при «Завершить». */
  pending?: boolean;
  /** S3-ключ во временном бакете (возвращает ObjectStorage). */
  key?: string;
  /** Категория файла (по mime/расширению). */
  type: "image" | "video" | "document";
  /** Presigned GET URL (для предпросмотра, временно). */
  url?: string;
  /** Локальное thumb-превью (data: URL) — только для картинок, ≤256 px. */
  dataUrl?: string;
  /** Исходный размер в байтах. */
  size?: number;
  /** Mime-тип, как сообщил браузер. */
  mimeType?: string;
  addedAt?: number;
}



export interface LegalReviewStep {
  /** Дополнительные материалы проверки (otherLegalReviews в DTO). */
  otherMaterials: LegalReviewMaterial[];
}

export interface ReportDraft {
  reportName?: string;
  reportDate?: string;
  carStep: CarStep;
  characteristicsStep: CharacteristicsStep;
  documentReconciliationStep: DocumentReconciliationStep;
  inspectionStep: InspectionStep;
  legalReviewStep: LegalReviewStep;
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

/**
 * Ссылка на конкретное поле заметки в draft. Используется для карточки
 * «переформулировать заметку» и для последующей записи AI‑версии обратно.
 */
export type NoteRef =
  | { kind: "inspection"; section: string; elementId: string }
  | { kind: "testDrive" }
  | { kind: "docs" }
  | { kind: "resultSummary" }
  | { kind: "resultVerdict" };

export interface NoteProposalPayload {
  ref: NoteRef;
  /** короткая подпись scope: «Осмотр · Капот», «Тест‑драйв», … */
  scopeLabel: string;
  original: string;
  ai: string | null;
  loading: boolean;
  picked?: "original" | "ai";
  /** Имена тегов на момент создания proposal — используются для регенерации. */
  tagNames?: string[];
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
    | "stepPassport"
    | "noteProposal"
    | "missingFields"
    | "inspectionSectionPicker"
    
    | "inspectionFullPassport"
    | "inspectionChips"
    | "inspectionUploadPrompt"
    | "inspectionCollage"
    | "inspectionAttachAssign"
    | "inspectionElementFocus"
    | "legalMaterialsCollage"
    | "uploadProgress"
    | "finishConfirm"
    | "finishComplete";
  /** payload for kind=uploadProgress — финальная выгрузка отчёта */
  uploadProgress?: {
    phase: "preparing" | "uploading" | "finalizing" | "done" | "error";
    percent: number;
    uploaded?: number;
    total?: number;
    reportId?: string | number;
    note?: string;
  };
  /** payload for kind=finishComplete — успешная выгрузка с кнопкой «Поделиться» */
  finishComplete?: {
    reportId?: string | number;
    shareUrl?: string;
    /** если задано — финализация не удалась, показать кнопку «Повторить» */
    retryFinalizeId?: string | number;
    /** числовой id отчёта — нужен для CreateSpecialistReportShareUrl на ретрае */
    retryNumericId?: string | number;

  };

  /** payload for kind=missingFields — required-field gate before AI summary */
  missingFields?: { label: string; step: StepId; sectionSnake?: string }[];

  /** инспекционный раздел (snake) для kind=inspectionUploadPrompt/inspectionCollage */
  sectionSnake?: string;
  /** индекс фото в inspectionStep.photos для kind=inspectionElementFocus */
  photoIdx?: number;
  /** медиа, ожидающее ручного выбора раздела (kind=inspectionAttachAssign) */
  pendingPhoto?: {
    url: string;
    dataUrl: string;
    filename: string;
    /** id записи в IndexedDB-кеше (для перезалива в случае истечения URL). */
    photoId?: string;
    remote?: boolean;
    /** если уже закреплено — сюда пишем snake-раздел, чтобы скрыть чипы */
    assignedSection?: string;
  };

  /** статус задачи в очереди ИИ (для плейсхолдер-сообщений) */
  queueStatus?: "queued" | "running" | "error";
  /** payload for kind=noteProposal — reformulation card state */
  noteProposal?: NoteProposalPayload;
  createdAt: number;

}


export type StepMessages = Record<StepId, ChatMessage[]>;

export function emptyStepMessages(): StepMessages {
  return {
    car: [],
    characteristics: [],
    docs: [],
    inspection: [],
    legalMaterials: [],
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
    legalReviewStep: { otherMaterials: [] },
    testDriveStep: {},
    resultStep: {},
  };
}

