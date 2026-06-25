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
- ownerMatches: true/false (собственник в ПТС/СТС совпадает с продавцом).
- vinOnBodyMatches: true/false (VIN на кузове совпадает с документами).
- engineNumberMatches: true/false (номер двигателя совпадает с ПТС).
- note: краткая заметка про расхождения, если есть.

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
