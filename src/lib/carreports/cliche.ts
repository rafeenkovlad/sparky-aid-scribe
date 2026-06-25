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

Текст эксперта:
{text}`;

export const CLICHE_CHARACTERISTICS = `${COMMON}

Извлеки характеристики автомобиля. Поля:
- brandName, modelCarName, year (целое 4 цифры).
- engineVolume (литры, число), enginePower (л.с., целое).
- engineType: одно из ["Бензин","Дизель","Гибрид","Электро","Газ/Бензин"].
- transmission: одно из ["АКПП","МКПП","Робот","Вариатор"].
- driveType: одно из ["Передний","Задний","Полный"].
- color, equipment (название комплектации).

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
