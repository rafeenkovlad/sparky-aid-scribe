// Prompt templates passed to AiQueue.ChatCompletions as the `cliche` param.
// The backend substitutes a literal `{text}` placeholder with the user text.
// Keep prompts short, demand strict JSON.

const COMMON = `Ты — ассистент технического осмотра автомобиля. Извлекай факты
строго из текста эксперта ниже. Не выдумывай. Отвечай ТОЛЬКО валидным JSON
без пояснений и без markdown-обрамления. Если поле не упомянуто — не
включай его в JSON.`;

export const CLICHE_CAR = `${COMMON}

Извлеки данные шага «Автомобиль». Поля:
- vin: строка из 17 символов A-Z/0-9 (если упомянут).
- gosNumber: госномер.
- uriListing: ссылка на объявление (URL).
- mileage: пробег в км, целое.
- cityInspection: город осмотра.
- dateInspection: YYYY-MM-DD, если эксперт назвал дату.
- unreadableVin: true если эксперт сказал, что VIN не читается.
- visuallyMileageNotMatchCondition: true если пробег не соответствует состоянию.
- brandName: марка автомобиля, нормализованная (например "VW"/"вольксваген" → "Volkswagen").
- modelCarName: модель (например "Tiguan", "Camry").
- year: год выпуска (целое 4 цифры), если назван.
- generationHint: поколение/модификация как назвал эксперт
  (например "2 поколение", "II", "FL", "рестайлинг", "MQB", "B8.5"). Любая строка.

Текст эксперта:
{text}`;

export const CLICHE_CHARACTERISTICS = `${COMMON}

Извлеки характеристики автомобиля. Поля:
- brandName, modelCarName, year (целое 4 цифры).
- generationHint: подсказка о поколении/модификации, как её назвал эксперт
  (например "2 поколение", "II", "FL", "рестайлинг", "MQB", "B8.5"). Любая строка.
- engineVolume (литры, число), enginePower (л.с., целое).
- engineType: одно из ["Бензин","Дизель","Гибрид","Электро","Газ/Бензин"].
- transmission: одно из ["АКПП","МКПП","Робот","Вариатор"].
- driveType: одно из ["Передний","Задний","Полный"].
- color, equipment (название комплектации).

Текст эксперта:
{text}`;

/**
 * Подбор справочника карreports: бренд → модель → поколение/рестайлинг.
 * Сервер отдаёт реальные списки методами Storage.GetBrand / Storage.GetModelCar /
 * Storage.GetModelGeneration, а ИИ выбирает ОДИН вариант из списка.
 */
export const CLICHE_PICK_BRAND = (
  userText: string,
  hint: string | undefined,
  brands: Array<{ id: number; name: string; country?: string | null }>,
  webContext?: string,
) => `${COMMON}

Тебе дан список брендов автомобилей из каталога carreports
(метод Storage.GetBrand). Выбери ОДИН id, который лучше всего подходит
к подсказке эксперта. Не придумывай свой id, только из списка.

Подсказка эксперта по бренду: ${JSON.stringify(hint ?? "")}
Исходный текст эксперта: ${JSON.stringify(userText)}
${webContext ? `\nКонтекст из веб-поиска (используй для нормализации сокращений вроде «VW» → «Volkswagen»):\n${webContext}\n` : ""}
Кандидаты (id — name [country]):
${brands.slice(0, 80).map((b) => `  • ${b.id} — ${b.name}${b.country ? ` [${b.country}]` : ""}`).join("\n") || "  (пусто)"}

Верни ТОЛЬКО JSON:
{
  "brandId": <число из списка или null>,
  "confidence": <0..1>,
  "needsWeb": <true если уверенность низкая и стоит уточнить веб-поиском>,
  "reason": "короткое пояснение"
}

Текст эксперта:
{text}`;


export const CLICHE_PICK_MODEL = (
  userText: string,
  brandName: string,
  modelHint: string | undefined,
  models: Array<{ id: number; name: string }>,
  webContext?: string,
) => `${COMMON}

Тебе дан список моделей бренда «${brandName}» из каталога carreports
(метод Storage.GetModelCar по brandId). Выбери ОДИН id, который лучше
всего соответствует ПОДСКАЗКЕ ПО МОДЕЛИ. Только из списка.

КРИТИЧНО:
- Подсказка по модели — ГЛАВНЫЙ сигнал. Сравнивай с полем name кандидатов.
- Цифры/слова вроде «2», «II», «поколение», «рестайлинг», «FL», «MQB»,
  «дизель», «бензин», «АКПП», год — это НЕ часть имени модели. Игнорируй их
  при подборе модели; они относятся к поколению, типу двигателя и т.п.
- Если в подсказке есть слово, которое точно совпадает с одним из name из
  списка (например «Tiguan» → «Tiguan»), выбирай именно его, даже если рядом
  есть другие цифры/слова.

Подсказка эксперта по модели: ${JSON.stringify(modelHint ?? "")}
Исходный текст эксперта: ${JSON.stringify(userText)}
${webContext ? `\nКонтекст из веб-поиска (используй чтобы понять, какая модель имеется в виду):\n${webContext}\n` : ""}
Кандидаты (id — name):
${models.slice(0, 120).map((m) => `  • ${m.id} — ${m.name}`).join("\n") || "  (пусто)"}

Верни ТОЛЬКО JSON:
{
  "modelCarId": <число из списка или null>,
  "confidence": <0..1>,
  "needsWeb": <true если стоит уточнить веб-поиском>,
  "reason": "короткое пояснение"
}

Текст эксперта:
{text}`;


export interface GenerationFrameCandidate {
  frameId: number;
  generationName?: string;
  restylingName?: string;
  /** numeric generation index from API (`generation` field) */
  generationNumber?: number;
  /** numeric restyling index from API (`restyling` field), 0 = базовый */
  restylingNumber?: number;
  yearStart?: number | null;
  yearEnd?: number | null;
  urlImage?: string;
}

export const CLICHE_PICK_GENERATION = (
  userText: string,
  brandName: string,
  modelName: string,
  year: number | undefined,
  generationHint: string | undefined,
  frames: GenerationFrameCandidate[],
  webContext?: string,
) => `${COMMON}

Тебе дан плоский список рестайлинг-фреймов модели «${brandName} ${modelName}»
из каталога carreports (метод Storage.GetModelGeneration по modelCarId,
раскрытый по рестайлингам и фреймам). Выбери ОДИН frameId, который лучше
всего подходит по году и подсказке эксперта. Только из списка.

Год выпуска авто: ${year ?? "не указан"}
Подсказка по поколению/рестайлингу: ${JSON.stringify(generationHint ?? "")}
Исходный текст эксперта: ${JSON.stringify(userText)}
${webContext ? `\nКонтекст из веб-поиска (годы выпуска поколений, кодовые имена и т.п.):\n${webContext}\n` : ""}


Кандидаты (frameId — поколение / рестайлинг / годы):
${
  frames
    .slice(0, 60)
    .map(
      (f) =>
        `  • ${f.frameId} — ${f.generationName ?? "?"}${
          f.restylingName ? ` / ${f.restylingName}` : ""
        } [${f.yearStart ?? "?"}–${f.yearEnd ?? "н.в."}]`,
    )
    .join("\n") || "  (пусто)"
}

Верни ТОЛЬКО JSON:
{
  "frameId": <число из списка или null>,
  "confidence": <0..1>,
  "needsWeb": <true если стоит уточнить веб-поиском>,
  "reason": "короткое пояснение"
}

Текст эксперта:
{text}`;

export const CLICHE_DOCS = `${COMMON}

Извлеки данные сверки документов. Поля:
- ownersCount: целое (число владельцев по ПТС).
- ownerFullNameMatchWithPTSOrSTS: true/false (собственник в ПТС/СТС совпадает с продавцом).
- vinOnBodyMatchWithPTSOrSTS: true/false (VIN на кузове совпадает с документами).
- engineModelMatchWithPTSOrSTS: true/false (номер двигателя совпадает с ПТС).
- note: краткая заметка про расхождения, если есть.

Текст эксперта:
{text}`;

export const CLICHE_INSPECTION = (
  zoneLabel: string,
  sectionLabel: string,
  elements: Array<{ id: string; label: string }>,
  knownTags: Array<{ name: string; type?: string | null }>,
) => {
  const elList = elements.map((el) => `  • ${el.id} — ${el.label}`).join("\n");
  const tagList = knownTags.length
    ? knownTags
        .slice(0, 60)
        .map(
          (t) => `  • ${t.name}${t.type ? ` [${t.type === "serious" ? "серьёзный" : "не серьёзный"}]` : ""}`,
        )
        .join("\n")
    : "  (каталог пуст — извлекай теги свободным текстом)";

  return `${COMMON}

Это заметка эксперта по зоне «${zoneLabel}» (серверная секция «${sectionLabel}»).
Раздели её на находки по конкретным элементам секции. Для каждого упомянутого
элемента укажи: дефекты есть или нет, какие теги повреждений (серьёзные —
сквозная коррозия, перекрас, замена силового элемента, ДТП; не серьёзные —
сколы, царапины, локальные подкрасы, потёртости), и краткую техническую
заметку.

Элементы секции (используй ИМЕННО эти id):
${elList}

Каталог тегов секции (приоритет — выбирать из него; если не подходит — придумай короткое название):
${tagList}

Верни ТОЛЬКО валидный JSON:
{
  "note": "очищенная общая заметка по зоне (1–3 предложения)",
  "findings": [
    {
      "elementId": "<id из списка выше>",
      "noDamage": true|false,
      "seriousTags": ["имя_тега", ...],     // только серьёзные дефекты
      "nonSeriousTags": ["имя_тега", ...],  // мелкие дефекты
      "note": "краткая заметка по элементу"
    }
  ]
}
Если элемент явно не упомянут — не добавляй его. Если эксперт сказал по зоне
в общем («кузов в норме», «салон без замечаний») — добавь одну находку с
elementId="generalCondition" и noDamage=true.

Текст эксперта:
{text}`;
};

export const CLICHE_TEST_DRIVE = `${COMMON}

Извлеки данные тест-драйва из текста эксперта. Поля (все опциональные —
включай только то, что упомянуто):
- testDriveIsIncluded: false если эксперт сказал, что тест-драйв НЕ проводился, иначе true.
- testDriveEngineIsWorkingProperly: true/false по двигателю в движении.
- testDriveTransmissionIsWorkingProperly: true/false по КПП.
- testDriveSteeringWheelIsWorkingProperly: true/false по рулевому.
- testDriveSuspensionInDriveIsWorkingProperly: true/false по подвеске.
- testDriveBrakesInDriveIsWorkingProperly: true/false по тормозам.
- testDriveEngineTags / testDriveTransmissionTags / testDriveSteeringWheelTags /
  testDriveSuspensionInDriveTags / testDriveBrakesInDriveTags: массивы коротких
  меток с конкретными замечаниями (например ["вибрация на 80","пинок 2-3"]).
- testDriveNote: общая заметка по тест-драйву (1–3 предложения).

Текст эксперта:
{text}`;

export const CLICHE_RESULT = `${COMMON}

Эксперт диктует итог осмотра. Раздели его на два поля:
- summaryInspectionNote: краткое резюме текущего состояния авто
  (что нашли, ключевые дефекты, общее впечатление).
- resultSpecialistNote: вердикт/рекомендация специалиста
  (брать/торговаться/отказаться/рекомендовать и т.п.).

Если эксперт сказал только одно — заполни только соответствующее поле.

Верни ТОЛЬКО валидный JSON с этими двумя полями (любое можно опустить).

Текст эксперта:
{text}`;

/** Parse a strict-JSON model response, tolerating ```json fences. */
export function parseJsonResponse<T = unknown>(content: string | null | undefined): T | null {
  if (!content) return null;
  let s = content.trim();
  // strip ```json ... ``` fence
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fence) s = fence[1].trim();
  // grab first {...} block as fallback
  if (!s.startsWith("{") && !s.startsWith("[")) {
    const m = s.match(/[{[][\s\S]*[}\]]/);
    if (m) s = m[0];
  }
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

const ENGINE_TYPES = ["Бензин", "Дизель", "Гибрид", "Электро", "Газ/Бензин"] as const;
const TRANSMISSIONS = ["АКПП", "МКПП", "Робот", "Вариатор"] as const;
const DRIVE_TYPES = ["Передний", "Задний", "Полный"] as const;

export function pickEnum<T extends readonly string[]>(
  raw: unknown,
  allowed: T,
): T[number] | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim().toLowerCase().replace(/ё/g, "е");
  for (const v of allowed) {
    if (v.toLowerCase().replace(/ё/g, "е") === s) return v;
  }
  // fuzzy aliases
  if (/бенз/.test(s)) return allowed.includes("Бензин" as T[number]) ? ("Бензин" as T[number]) : undefined;
  if (/диз/.test(s)) return allowed.includes("Дизель" as T[number]) ? ("Дизель" as T[number]) : undefined;
  if (/гибр/.test(s)) return allowed.includes("Гибрид" as T[number]) ? ("Гибрид" as T[number]) : undefined;
  if (/электр/.test(s)) return allowed.includes("Электро" as T[number]) ? ("Электро" as T[number]) : undefined;
  if (/(акпп|автомат)/.test(s)) return allowed.includes("АКПП" as T[number]) ? ("АКПП" as T[number]) : undefined;
  if (/(мкпп|механик)/.test(s)) return allowed.includes("МКПП" as T[number]) ? ("МКПП" as T[number]) : undefined;
  if (/робот/.test(s)) return allowed.includes("Робот" as T[number]) ? ("Робот" as T[number]) : undefined;
  if (/вариатор|cvt/.test(s)) return allowed.includes("Вариатор" as T[number]) ? ("Вариатор" as T[number]) : undefined;
  if (/передн/.test(s)) return allowed.includes("Передний" as T[number]) ? ("Передний" as T[number]) : undefined;
  if (/задн/.test(s)) return allowed.includes("Задний" as T[number]) ? ("Задний" as T[number]) : undefined;
  if (/полн|4wd|awd|4x4/.test(s)) return allowed.includes("Полный" as T[number]) ? ("Полный" as T[number]) : undefined;
  return undefined;
}

export { ENGINE_TYPES, TRANSMISSIONS, DRIVE_TYPES };

/**
 * Из веб-контекста (выдачи поиска) определи каноническое имя автобренда.
 * Используется когда каталог не нашёл совпадений по подсказке эксперта
 * (например, эксперт написал «VW» → каноническое имя «Volkswagen»).
 */
export const CLICHE_CANONICAL_BRAND = (
  hint: string,
  webContext: string,
) => `${COMMON}

Из текста ниже определи каноническое (полное) название автомобильного бренда.
Это нужно чтобы потом найти бренд в справочнике carreports по точному имени.

Подсказка эксперта: ${JSON.stringify(hint)}

Веб-контекст:
${webContext}

Верни ТОЛЬКО JSON:
{
  "brandName": "<каноническое имя бренда, например Volkswagen, BMW, Lada>",
  "confidence": <0..1>
}

Текст эксперта:
{text}`;

/**
 * Уточняющий шаг: эксперт назвал только модель («тигуан», «camry», «x5»),
 * а бренд не указал. Просим ИИ определить бренд по имени модели.
 */
export const CLICHE_INFER_BRAND_FROM_MODEL = (
  modelName: string,
  userText: string,
  webContext?: string,
) => `${COMMON}

Эксперт назвал только модель автомобиля без указания марки. Определи марку
(производителя) по имени модели. Это нужно, чтобы дальше найти марку в
каталоге carreports.

Имя модели как назвал эксперт: ${JSON.stringify(modelName)}
Исходный текст эксперта: ${JSON.stringify(userText)}
${webContext ? `\nКонтекст из веб-поиска:\n${webContext}\n` : ""}

Примеры:
- «тигуан»/«tiguan» → Volkswagen
- «камри»/«camry» → Toyota
- «x5»/«икс пять» → BMW
- «логан»/«logan» → Renault

Верни ТОЛЬКО JSON:
{
  "brandName": "<каноническое имя марки, например Volkswagen, Toyota, BMW>",
  "modelCarName": "<нормализованное имя модели, например Tiguan, Camry, X5>",
  "confidence": <0..1>,
  "needsWeb": <true если уверенности нет и стоит уточнить веб-поиском>
}

Текст эксперта:
{text}`;

/**
 * Свободный режим вопросов. ИИ отвечает кратко и по делу, опираясь
 * на текущее заполнение черновика — НЕ извлекает данные и НЕ изменяет шаг.
 */
export const CLICHE_ASK = (
  stepLabel: string,
  draftContext: string,
) => `Ты — ассистент-эксперт по техническому осмотру автомобилей.
Эксперт задаёт тебе уточняющий вопрос на шаге «${stepLabel}». Дай краткий
и полезный ответ. Не возвращай JSON, не извлекай поля — это режим диалога.
Если вопрос касается машины из черновика — используй контекст ниже.

Текущий черновик отчёта (для контекста, можно ссылаться):
${draftContext || "(черновик пуст)"}

Вопрос эксперта:
{text}`;


