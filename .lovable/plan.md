## Цель

В шаге **Характеристики** (а не «Автомобиль» — там VIN/госномер; модель/поколение живут в характеристиках) при вводе вроде «vw tiguan, поколение 2, 2016 г.» система должна сама подобрать `modelCarId` и `modelGenerationRestylingFrameId` через серверные методы каталога, при необходимости уточняя выбор веб-поиском.

## Текущее состояние

- Есть резолвер `resolveCar()` в `carCatalog.ts` (Brand → ModelCar → Generation → Restyling → Frame), но он работает «вслепую» — берёт первое подходящее по строковому совпадению/году.
- ИИ-клише `CLICHE_CHARACTERISTICS` извлекает только `brandName/modelCarName/year`, ничего не знает про каталог и не видит реальных вариантов.
- `AiQueue.ChatCompletions` — однораундовый JSON, без нативного tool-calling, поэтому многошаговый «диалог с инструментами» нужно оркестровать на клиенте.

## Архитектура: цикл «AI ↔ каталог»

Клиент управляет циклом и на каждом шаге задаёт ИИ узкий выбор из реального списка с сервера. ИИ возвращает только индекс/id выбранного варианта + флаг «нужно уточнить вебом».

```text
user text
   │
   ▼
[1] AI extract: brandHint, modelHint, generationHint, year, bodyHint
   │
   ▼
[2] Storage.GetBrand(search=brandHint) → brands[]
   │   AI pick: { brandId, confidence, needsWeb }
   ▼
[3] Storage.GetModelCar(brandId) → models[]
   │   AI pick: { modelCarId, confidence, needsWeb }
   ▼
[4] Storage.GetModelGeneration(modelCarId) → generations[]
   │   AI pick generation/restyling/frame по году + подсказкам
   │   при needsWeb=true → Firecrawl search "<brand> <model> поколение X годы"
   │   → AI повторно выбирает с учётом найденного периода
   ▼
[5] patch characteristicsStep: { modelCarId, modelGenerationRestylingFrameId,
                                  brandName, modelCarName, year }
```

## Что меняется в коде

### 1. `src/lib/carreports/cliche.ts`
Добавить три новых клише — узких, по одному на шаг подбора:

- `CLICHE_PICK_BRAND(userText, brands)` — на вход список `{id,name,country}`, ответ `{ brandId, confidence: 0–1, needsWeb: boolean, reason }`.
- `CLICHE_PICK_MODEL(userText, brandName, models)` — список `{id,name}`, ответ аналогично.
- `CLICHE_PICK_GENERATION(userText, year, generations)` — нормализованный плоский список вариантов `{frameId, generationName, restylingName, yearStart, yearEnd}`, ответ `{ frameId, confidence, needsWeb, reason }`.

В каждое клише вшить инструкцию: «выбирай ТОЛЬКО из списка; если совпадение слабое — `needsWeb=true`».

`CLICHE_CHARACTERISTICS` оставить как есть для остальных полей (двигатель/КПП/комплектация).

### 2. `src/lib/carreports/carCatalog.ts`
Переписать `resolveCar` на ИИ-ассистируемый подбор:

```ts
resolveCar(userText, hints, opts) → {
  modelCarId, modelGenerationRestylingFrameId,
  brandName, modelCarName, generationLabel,
  trace: [{ step, candidatesCount, picked, confidence, webUsed }]
}
```

- Шаги 2/3/4 — это новый внутренний хелпер `aiPickFromList(cliche, items, key)`.
- Если AI вернул `needsWeb=true` или `confidence<0.5`:
  - дернуть Firecrawl `search('<brand> <model> поколение N годы выпуска')` (server-side в `api/cr-proxy` уже есть прокси для AI; для Firecrawl добавить отдельный proxy-роут под коннектор).
  - повторно прогнать тот же `CLICHE_PICK_*`, добавив `webContext` строкой.
- Кэш на уровне `(brandId, modelCarId)` остаётся.

### 3. `src/lib/carreports/orchestrator.ts`
В ветке `step === "characteristics"`:

1. Сначала, как сейчас, прогон `CLICHE_CHARACTERISTICS` → достать `brandName/modelCarName/year/generation hint`.
2. Если пришёл бренд+модель и в драфте ещё нет `modelCarId` (или поменялся бренд/модель) — асинхронно запустить `resolveCar(text, hints)`.
3. Сохранить в `characteristicsStep`:
   - `modelCarId`, `modelGenerationRestylingFrameId`
   - читаемое поле `generationLabel` (для UI) — добавить в `CharacteristicsStep`.
4. Ответ ассистента дополнить блоком «🔎 Подобрано в каталоге: Tiguan II (2016–2024), frameId=…». При `confidence<0.5` спросить пользователя на подтверждение перед переходом к следующему шагу.

### 4. Firecrawl-прокси (только если ставим веб-фолбэк)
Добавить серверный роут `routes/api/cr-fc.ts` который проксирует `firecrawl.search` с серверным `FIRECRAWL_API_KEY`. Без коннектора — фича включается опционально (если ключа нет, `needsWeb` мягко игнорируется, берётся лучший вариант с пометкой «низкая уверенность»).

### 5. Сообщение ИИ-ассистента
В summary шага характеристик добавить строку с реальной генерацией/рестайлингом и явным `frameId`, чтобы юзер видел, что именно поедет в `Storage.PrepareSpecialistReport`.

## Технические детали

- Все вызовы каталога идут через `rpc()` в `storageApi.ts` — уже работает.
- Дополнительные раунды AI считаются по AI-кредитам пользователя; ставим лимит «не более 3 AI-вызовов на резолв» + кэш.
- Если каталог вернул пустые `generations` — пропускаем шаг 4, оставляем только `modelCarId` (как сейчас).
- Все ошибки сети/AI глушим, fallback на старое поведение (best-string-match без AI).

## Открытые вопросы

1. **Firecrawl веб-фолбэк** — подключать коннектор сейчас или оставить заглушкой `needsWeb=true` → просто понизить уверенность и спросить пользователя?
2. **UX при низкой уверенности** — ассистент шлёт сообщение «Я нашёл 3 варианта генерации, выбери: [chips]» с кнопками, или просто берёт лучший и помечает «уточните при необходимости»?
3. Нужно ли резолвить каталог уже в шаге **Автомобиль** после VIN-декода (если VIN дал brand/model), или только в шаге Характеристики?