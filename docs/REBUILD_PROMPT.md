# Пошаговый промт для пересоздания приложения «AI CARREP»

> Это **цельный набор последовательных промтов** для Lovable (или
> аналогичного агента), который воспроизводит чат-ассистента для технического
> осмотра автомобиля. Каждый шаг — это отдельный промт, который нужно
> отправить агенту **после** того, как предыдущий собран и проверен.
>
> Внутри каждого промта учтены косяки оригинальной разработки, чтобы
> повторно их не наступать (помечены `⚠️ NB`).

---

## Концепция приложения (контракт)

**Что строим.** Чат-ассистент для автоэксперта/автоподборщика. Эксперт
надиктовывает голосом или текстом факты об осматриваемом автомобиле, ИИ
сам раскладывает их по полям отчёта carreports, при необходимости
догружает справочники с сервера и в конце отправляет готовый черновик
отчёта в `Storage.PrepareSpecialistReport`.

**Стек (жёстко).**
- TanStack Start (Vite 7, SSR через `src/server.ts`), React 19, TS strict.
- Tailwind v4 (через `@tailwindcss/vite`, `src/styles.css`).
- shadcn/ui (Radix + tailwind-merge + cva).
- TanStack Router (file-based, `src/routes`).
- TanStack Query — клиент в `src/router.tsx`.
- LocalStorage для тредов/токена/лексикона. Бэкенда **внутри Lovable нет** —
  все данные идут во внешний `https://app.carreports.ru/` (JSON-RPC) и
  `https://ai.carreports.ru/` (JSON-RPC чат-комплишены) через серверный
  прокси.
- Lovable AI Gateway используется **только** для одной задачи —
  speech-to-text (`openai/gpt-4o-mini-transcribe`). Чат-модель — внешняя
  carreports.

**Аутентификация.** Пользователь сам вставляет Bearer-JWT в окно
настроек. Токен хранится в `localStorage` под ключом `carreports.token`,
никуда больше не уходит. Кнопка «Очистить» обнуляет токен.

**Шаги отчёта (FLOW_STEPS).**
1. `car` — Автомобиль (VIN/госномер, пробег, город, дата, марка/модель/год)
2. `docs` — Сверка документов (владельцы, совпадения)
3. `inspection` — Осмотр (8 разделов × множество элементов, фото, теги)
4. `testDrive` — Тест-драйв
5. `result` — Итог + вердикт
6. `submit` — Отправка

> `characteristics` оставлен в типах для обратной совместимости, но как
> отдельный шаг в навигации не показывается — характеристики собираются
> на шаге `car` той же AI-итерацией.

**Принципы UX (важны для всех шагов).**
- Каждое ИИ-действие — асинхронная задача в **очереди по треду**
  (`enqueueAI`). Очереди разных тредов работают параллельно, внутри
  треда — строго последовательно, чтобы заметки одного эксперта не
  перетирали друг друга.
- Каждое сообщение пользователя сразу попадает в чат, плейсхолдер
  ассистента появляется со статусом `queued` → `running` → финальный
  текст. При ошибке статус `error` + сообщение, очередь продолжает.
- Чат хранится **per-step** (`StepMessages`) — между шагами своя лента,
  но шапка-прогресс общая.
- AI-сессия (`aiChatIds[key]`) сохраняется по `(thread, purpose)`, чтобы
  модель помнила контекст внутри одного шага.

---

## Шаг 0 — Инициализация проекта

> ```text
> Создай TanStack Start приложение (React 19 + TS strict + Tailwind v4 +
> shadcn/ui). Минимальная файловая структура:
>
> - src/routes/__root.tsx — корневой layout: HeadContent, Scripts,
>   QueryClientProvider, <Outlet />. dark-режим включить классом "dark"
>   на <html>. Метаданные: title "AI CARREP", description
>   "AI-powered app generates comprehensive technical car reports.",
>   og/twitter теги. Подключить src/styles.css.
> - src/router.tsx — getRouter() с QueryClient и
>   defaultPreloadStaleTime: 0.
> - src/routes/index.tsx — компонент-редиректор: на маунте читает
>   threads из localStorage, если пусто — создаёт новый, и делает
>   navigate({ to: "/$threadId", replace: true }).
> - src/routes/$threadId.tsx — рендерит <ChatApp threadId={threadId} />.
> - src/server.ts — обёртка SSR с try/catch и кастомной error page
>   (см. ниже).
> - vite.config.ts — defineConfig({ tanstackStart: { server: { entry:
>   "server" } } }) поверх @lovable.dev/vite-tanstack-config.
>
> ⚠️ NB: не создавай entry-client.tsx / entry-server.tsx (это pre-1.0).
> ⚠️ NB: не редактируй routeTree.gen.ts — он генерируется плагином.
> ```

---

## Шаг 1 — Типы домена

> ```text
> Создай src/lib/carreports/types.ts. Опиши:
>
> - StepId = "car"|"characteristics"|"docs"|"inspection"|"testDrive"|
>   "result"|"submit".
> - CarStep: vin?, unreadableVin?, gosNumber?, uriListing?, mileage?,
>   visuallyMileageNotMatchCondition?, cityInspection?, dateInspection?
>   (YYYY-MM-DD).
> - EngineType, Transmission, DriveType — конкретные литералы из
>   Doc-схемы carreports: "Бензин"|"Дизель"|"Гибрид"|"Электро"|
>   "Газ/Бензин"; "АКПП"|"МКПП"|"Робот"|"Вариатор"; "Передний"|
>   "Задний"|"Полный".
> - CharacteristicsStep: brandName?, modelCarName?, modelCarId?,
>   modelGenerationRestylingFrameId?, generationLabel?,
>   pendingGenerationHint?, year?, engineVolume?, enginePower?,
>   engineType?, transmission?, driveType?, color?, equipment?.
> - DocumentReconciliationStep: ownersCount?,
>   ownerFullNameMatchWithPTSOrSTS?, vinOnBodyMatchWithPTSOrSTS?,
>   engineModelMatchWithPTSOrSTS?, note?.
> - InspectionPhoto: section, elementId?, filename, dataUrl?, url?,
>   remote?, addedAt?.
> - PendingTagName: name, severity?.
> - InspectionElementFinding: section, elementId, noDamage?,
>   seriousDamageTagIds?: number[], noSeriousDamageTagIds?: number[],
>   pendingTagNames?, note?, audioNotes?.
> - InspectionStep: sectionNotes (legacy zone notes), photos, touched?,
>   currentSection?, currentElementId?, currentZone? (legacy),
>   findings?: Record<`${section}.${elementId}`, InspectionElementFinding>.
> - TestDriveStep: notDone?, notes?, testDriveIsIncluded?,
>   testDrive{Engine|Transmission|SteeringWheel|SuspensionInDrive|
>   BrakesInDrive}IsWorkingProperly?, *Tags?: string[], testDriveNote?.
> - ResultStep: summaryInspectionNote?, resultSpecialistNote?.
> - ReportDraft объединяет всё; emptyDraft() возвращает скелет.
> - ChatChip: label, value, group?, single?, groupLabel?, groupKind?
>   ("yesno"), image?, description?.
> - MessageAttachment: url, label?, kind?: "brand"|"model"|"generation".
> - ChatMessage: id, role, text, step?, chips?, optionsStep?,
>   selectedChipValues?, attachments?, kind? (см. ниже),
>   sectionSnake?, photoIdx?, pendingPhoto?, queueStatus?, createdAt.
>   kind перечисляет варианты доменных карточек:
>     "passport" | "docsPassport" | "inspectionSectionPicker" |
>     "inspectionChips" | "inspectionUploadPrompt" |
>     "inspectionCollage" | "inspectionAttachAssign" |
>     "inspectionElementFocus".
> - StepMessages = Record<StepId, ChatMessage[]>; emptyStepMessages().
> - Thread: id, title, updatedAt, stepIndex, draft, messages, aiChatIds:
>   Record<string, number>.
>
> ⚠️ NB: ВСЕ поля шага опциональные. Никаких NotNull дефолтов внутри
> типов — дефолты ставятся только в момент сборки payload для
> отправки.
> ```

---

## Шаг 2 — Хранилище тредов и токена

> ```text
> Создай:
>
> 1) src/lib/carreports/tokenStore.ts — getToken/setToken/subscribeToken
>    с ключом "carreports.token", кэш в памяти, listener-сет. SSR-safe.
>
> 2) src/lib/carreports/threadStore.ts — loadThreads()/subscribeThreads()/
>    getThread/createThread/updateThread/deleteThread.
>    - Ключ localStorage: "carreports.threads.v1".
>    - loadThreads() возвращает СТАБИЛЬНУЮ замороженную ссылку, пока
>      реально ничего не изменилось — иначе useSyncExternalStore уйдёт
>      в бесконечный ре-рендер. ⚠️ NB критично.
>    - normalizeThread/normalizeMessages — defensive миграция legacy
>      форматов (старые ChatMessage[] → per-step Record).
>    - updateThread(id, mut): глубоко клонирует draft и messages
>      ПЕРЕД мутацией, ставит updatedAt = Date.now(), эмитит
>      listeners.
>
> 3) src/hooks/useThreads.ts — два хука:
>    - useThreads(): useSyncExternalStore над threadStore.
>    - useToken(): useSyncExternalStore над tokenStore.
> ```

---

## Шаг 3 — Прокси к carreports + STT + веб-поиск

> ```text
> Создай server-routes под src/routes/api/:
>
> 1) cr-proxy.ts (POST /api/cr-proxy?target=storage|ai&token=<jwt>):
>    серверный CORS-прокси для https://app.carreports.ru/ и
>    https://ai.carreports.ru/. Bearer-токен берётся из query-параметра
>    и подставляется в Authorization заголовок upstream-запроса.
>    ⚠️ NB: токен НЕ хранить на сервере, только проксировать.
>    ⚠️ NB: для target=ai отсутствие токена → 401.
>
> 2) transcribe.ts (POST /api/transcribe, multipart/form-data, поле
>    file): прокси к Lovable AI Gateway
>    https://ai.gateway.lovable.dev/v1/audio/transcriptions, модель
>    "openai/gpt-4o-mini-transcribe", language по умолчанию "ru".
>    LOVABLE_API_KEY читать из process.env. Возвращает { text }.
>
> 3) web-search.ts (POST /api/web-search, JSON { query, limit? }):
>    обёртка над duck-duck-scrape (search() с MODERATE safe-search).
>    На ошибках — graceful { results: [] }. Лимит 1..10, default 5.
>
> Создай также src/lib/carreports/storageApi.ts с базовой JSON-RPC
> функцией rpc(method, params): отправляет на /api/cr-proxy?target=
> storage&token=<token>, разбирает ответ. Серверная сторона carreports
> возвращает один из двух форматов ошибки:
>   • { error: { code, message } }       — стандарт JSON-RPC,
>   • { response: "error", errors: ... } — кастомный carreports.
> Обработать оба. ⚠️ NB: errors на УСПЕХЕ часто приходит как пустой
> массив `[]` — считать это ошибкой НЕЛЬЗЯ, ориентироваться на
> response === "error" || (errors не пуст).
>
> Экспортировать класс ApiError(message, status?, code?) и обёртки:
> getProfile(), decodeVin(vin), resolveVinFromGosNumber(plate, opts)
> (через Storage.RunBatchLegalReview + polling
> Storage.GetBatchLegalReviewResults, таймаут ~25с, интервал 1.5с,
> ищем VIN 17 символов в responseNormalized/vehicleVin).
> ```

---

## Шаг 4 — AI JSON-RPC клиент и очередь

> ```text
> Создай src/lib/carreports/aiApi.ts:
>
> - chatCompletions({ id, text, cliche, fileUrls?, model? }) →
>   POST на https://ai.carreports.ru/ (прямой fetch, токен в заголовке
>   Authorization: Bearer <jwt>; query-параметр ?token= AI-сервер
>   игнорирует). Тело: { id, method: "AiQueue.ChatCompletions",
>   params: { text, cliche, files?, model? } } — БЕЗ поля "jsonrpc".
>   `id` доубликат — он же session-id чата (передавай тот же id, чтобы
>   модель помнила контекст).
> - aiChatIdFor(thread, key) — стабильный 31-битный id на пару
>   (thread, key); создаёт и кладёт в thread.aiChatIds[key].
>
> ⚠️ NB критично: AI-сервер подставляет `params.text` в плейсхолдер
> {text} ВНУТРИ cliche. Если в клише нет {text}, эксперт «потеряется».
> chatCompletions должен сам убеждаться, что {text} есть; если нет —
> ПРИКЛЕИВАТЬ хвост вида `\n\nТекст эксперта:\n{text}\n`.
>
> ⚠️ NB: AI-сервер на успехе возвращает `errors: []` (truthy в JS).
> Не считать пустой массив ошибкой; проверять `errors[0]?.message`.
>
> Создай src/lib/carreports/aiQueue.ts:
>
> - enqueueAI(threadId, task): добавляет в Map<threadId, Promise>.
>   Задачи внутри одного треда выполняются строго последовательно;
>   разные треды — параллельно. Ошибка одной задачи не ломает цепочку
>   (логируется console.error).
> - getQueueSize(threadId), subscribeQueue(cb).
> - Размер очереди обновляется атомарно перед стартом и после
>   завершения задачи; счётчик 0 → удаление ключа.
> ```

---

## Шаг 5 — Каталог осмотра (8 разделов)

> ```text
> Создай src/lib/carreports/inspectionSections.ts. Тип SectionSnake —
> литералы 8 разделов:
>   body | body_reinforcement | glass | interior | under_hood |
>   wheels_and_brakes | lightning | computer_diagnostics.
>
> INSPECTION_SECTIONS: для каждого раздела { snake, doc, label,
> elements: [{ id, label, collection }, ...] }. Имена collection
> ДОЛЖНЫ точно совпадать с Doc-схемой carreports (например,
> bodyElementHoodCollection,
> bodyReinforcementElementFrontLeftPillarCollection и т.д.).
> Полный список — см. README/Doc carreports; добавь ВСЕ элементы
> каждого раздела, последний — generalCondition.
>
> Дополнительно:
> - ZONE_TO_SECTION: Record<string, SectionSnake> — маппинг для
>   обратной совместимости со старыми тредами (body→body,
>   geometry→body_reinforcement, interior→interior, engine→under_hood,
>   transmission→under_hood, suspension→wheels_and_brakes,
>   brakes→wheels_and_brakes, underbody→body).
> - getSection(snake): InspectionSection.
> - findingKey(section, elementId) = `${section}.${elementId}`.
>
> ⚠️ NB: список collection — это контракт с сервером carreports.
> Любая опечатка → 422 при отправке отчёта.
>
> Также создай src/lib/carreports/inspectionElementHints.ts: для
> каждого `${section}.${elementId}` короткая визуальная подсказка
> (1 предложение) — характерные признаки на фото: «что вокруг», «где
> относительно других деталей». Используется в клише
> CLICHE_INSPECTION_PHOTO для точного выбора elementId.
> ```

---

## Шаг 6 — Каталог тегов осмотра

> ```text
> Создай src/lib/carreports/inspectionTags.ts:
>
> - loadSectionTags(section, selectedTagIds?): кэш в Map<SectionSnake,
>   UserTag[]>, in-flight Map. RPC Storage.GetUserTags с params
>   { step: "inspection", section, [selectedTagIds] }. Запрос
>   с selectedTagIds — мимо кэша (сервер возвращает relevance-sort).
> - subscribeToken(() => cache.clear() + inflight.clear()) — при
>   смене токена сбрасываем, иначе чужой пустой список «отравит»
>   до перезагрузки.
> - findTagId(catalogue, name): нормализованный матчинг (lowercase,
>   ё→е, не-буквы → пробел). Стратегия: exact → startsWith →
>   contains. Возвращает UserTag или null.
> - addUserTag(section, name, type?: "serious"|"non_serious"):
>   Storage.AddUserTag → новый UserTag, инвалидирует кэш.
> - updateUserTag(section, id, name), deleteUserTag(section, id).
> ```

---

## Шаг 7 — AI-клише

> ```text
> Создай src/lib/carreports/cliche.ts.
>
> Общий COMMON-префикс:
>   "Ты — ассистент технического осмотра автомобиля. Извлекай факты
>    строго из текста эксперта ниже. Не выдумывай. Отвечай ТОЛЬКО
>    валидным JSON без пояснений и без markdown-обрамления. Если поле
>    не упомянуто — не включай его в JSON."
>
> Экспортируй клише (все возвращают строку, заканчивающуюся пустыми
> строками — НЕ дублируй сюда {text}, см. ниже):
>
> - CLICHE_CAR — извлечение полей шага «Автомобиль» + brand/model/
>   year + generationHint.
> - CLICHE_CHARACTERISTICS — engineVolume/enginePower/engineType/
>   transmission/driveType/color/equipment + brand/model/year/
>   generationHint.
> - CLICHE_DOCS — ownersCount + 3 совпадения + note.
> - CLICHE_TEST_DRIVE — флаги + tags + testDriveNote.
> - CLICHE_RESULT — summaryInspectionNote + resultSpecialistNote.
> - CLICHE_INSPECTION(zoneLabel, sectionLabel, elements, knownTags) —
>   текстовая заметка по зоне → findings[] по элементам.
> - CLICHE_INSPECTION_PHOTO(sectionLabel, elements, knownTags,
>   existingNote?) — для одного фото; всегда возвращает 5 полей
>   { elementId, noDamage, seriousTags, nonSeriousTags, note }.
>   Если фото общее или элементов в заметке несколько — elementId =
>   "generalCondition".
> - CLICHE_INSPECTION_NOTE(sectionLabel, elements, currentElementId,
>   knownTags, existingNote?) — text-only заметка эксперта (БЕЗ фото).
>   ⚠️ NB критично: НЕ начинай с COMMON. COMMON содержит фразу «если
>   поле не упомянуто — не включай его в JSON», и модель из-за неё
>   возвращает `{}`. В этом клише все 5 полей ОБЯЗАТЕЛЬНЫ всегда,
>   массивы могут быть пустыми. Явно пиши: «Никогда не возвращай {}.»
>   Учитывай синонимы повреждений (притёртость = потёртость, ржа =
>   ржавчина, перекрашен = покраска и т.п.).
> - CLICHE_PICK_BRAND/MODEL/GENERATION(userText, hint, candidates,
>   webContext?) — для AI-резолва справочника carreports.
> - CLICHE_CANONICAL_BRAND(hint, webContext) — нормализация бренда
>   из веб-контекста.
> - CLICHE_INFER_BRAND_FROM_MODEL(modelName, userText, webContext?) —
>   определить марку по модели («тигуан» → Volkswagen).
> - CLICHE_ASK(stepLabel, draftContext) — режим вопросов без
>   извлечения данных. НЕ требует JSON, отвечает кратко.
>
> Утилиты:
> - parseJsonResponse<T>(content): срезает ```json fences, ищет
>   первый блок {...}, возвращает T|null.
> - ENGINE_TYPES/TRANSMISSIONS/DRIVE_TYPES + pickEnum(raw, allowed) —
>   с fuzzy-aliases (бенз→Бензин, акпп→АКПП и т.д.).
>
> ⚠️ NB про существующую заметку: в CLICHE_INSPECTION_PHOTO и
> CLICHE_INSPECTION_NOTE при наличии existingNote добавляй явный блок
> «к этому элементу уже есть СОХРАНЁННАЯ заметка эксперта: ... Новая
> заметка — это ДОПОЛНЕНИЕ, а не замена. Объедини без потерь.» Без
> этого новая запись затирает старую.
>
> ⚠️ NB про цепочку с {text}: НЕ дублируй {text} внутри клише —
> aiApi.chatCompletions сам приклеит хвост, если плейсхолдера нет.
> Но если хочешь явно — поставь `{text}` в конце.
> ```

---

## Шаг 8 — Каталог авто (бренд/модель/поколение)

> ```text
> Создай src/lib/carreports/carCatalog.ts. Это AI-resolver:
>
> - resolveCar(brandName, modelCarName, year?, opts): пайплайн
>   Storage.GetBrand → pick brandId через CLICHE_PICK_BRAND →
>   Storage.GetModelCar(brandId) → pick modelCarId через
>   CLICHE_PICK_MODEL → Storage.GetModelGeneration(modelCarId) →
>   развернуть в плоский список фреймов → pick frameId через
>   CLICHE_PICK_GENERATION.
> - На каждом шаге, если confidence < 0.5 ИЛИ needsWeb=true ИЛИ
>   список кандидатов пуст, делай webSearchContext(query) и
>   повторный AI-pick с webContext.
> - listGenerationChipsForModel(modelCarId) → массив ChatChip групп
>   "generation" из реального ответа сервера. ⚠️ NB: НЕ пытайся
>   реиспользовать "generation"-чипы из resolved.suggestions —
>   они могут быть от другой модели.
> - resolveGenerationByModelId(modelCarId, opts) — частный случай,
>   когда модель уже известна.
> - inferBrandFromModelName(modelName, userText, thread, onTrace?) —
>   CLICHE_INFER_BRAND_FROM_MODEL + опциональный web-fallback.
> - pickImageUrl(row) — нормализатор photo URL: предпочитать size:"s"/
>   "m", потом urlX1 (1x), потом urlX2 (2x). НЕ тянуть тяжёлый
>   ретина-файл просто так.
>
> Возвращай trace[] с { step, candidates, confidence, needsWeb,
> reason } — он стримится в чат через opts.onTrace, чтобы эксперт
> видел «что и почему я уточняю».
> ```

---

## Шаг 9 — Pipeline фото

> ```text
> Создай src/lib/carreports/photo.ts:
>
> - preparePhoto(file, opts): HEIC/HEIF → JPEG через heic2any (lazy
>   import). Декодирование через createImageBitmap (с fallback на
>   HTMLImageElement). Итеративный downscale: max-edge 1600px,
>   quality 0.82 → 0.4, потом edge×0.8 пока blob.size > 2 МБ.
>   Возвращает { filename: `${base}_${Date.now()}.jpg`, blob,
>   dataUrl }.
> - uploadTemporary(photo): Storage RPC
>   ObjectStorage.GetTemporaryUploadUrlBucketTemp → presigned POST
>   (если fields непусто) или PUT (если пусто) → потом
>   ObjectStorage.GetTemporaryViewUrlBucketTemp(filename, 3600) для
>   получения GET-URL. AI ожидает именно presigned GET, а не прямую
>   ссылку на S3.
> - uploadPhoto(photo): обёртка с graceful fallback (если upload не
>   удался — возвращает remote:false и note об ошибке).
> - ensurePhotoAccessible({ url?, dataUrl?, filename? }): проверяет
>   HEAD/Range GET (S3 не всегда поддерживает HEAD). Если URL мёртв
>   и есть dataUrl — повторно заливает через uploadTemporary и
>   возвращает новый presigned URL.
>
> ⚠️ NB про presigned: время жизни ограничено (3600 с). Перед каждым
> AI-vision запросом ВСЕГДА прогоняй URL через ensurePhotoAccessible.
> ```

---

## Шаг 10 — Прогресс, флоу, chip-каталог

> ```text
> Создай:
>
> - src/lib/carreports/flow.ts: FLOW_STEPS (массив без characteristics
>   в навигации), stepIndex, stepById, isConfirmAdvance(text) —
>   regex по нормализованному тексту: "все верно далее", "далее",
>   "следующий шаг", "готово", "пропустить", "skip", "next".
>
> - src/lib/carreports/progress.ts: isStepFilled(step, draft),
>   nextMissingPrompt(step, draft), remainingFieldLabels,
>   missingOptionalFields, optionalHintSentence, filledCount,
>   shortCarSummary/shortCharSummary/shortDocsSummary. Эти функции —
>   единственный источник правды о «что осталось заполнить» — никаких
>   локальных копий в компонентах.
>
> - src/lib/carreports/stepChips.ts: STEP_INTROS — приветствие
>   ассистента + чипсы для каждого шага. Чипсы по группам с
>   single:true для взаимоисключающих, groupLabel — видимый заголовок
>   секции, groupKind:"yesno" — рендерится как пара кнопок «Да/Нет».
>
> - src/lib/carreports/inspectionState.ts:
>   * getCursor(draft) → { section, element } с fallback'ами на
>     legacy currentZone.
>   * getFinding/upsertFinding (mutate-in-place под updateThread)/
>     clearFinding.
>   * elementStatus → "empty"|"ok"|"minor"|"serious"|"noteOnly".
>   * sectionProgress(ins, section) → { filled, total }.
>   * photosFor(ins, section, elementId?), photosForSection.
>   * toggleTag(finding, "serious"|"non_serious", id) — при любом
>     теге автоматически noDamage=false.
>   * togglePendingTag(finding, name, severity) — тоже сбрасывает
>     noDamage при добавлении.
>   * nextEmptyLocation(ins, fromSection, fromElementId) — wrap по
>     разделам.
> ```

---

## Шаг 11 — Orchestrator

> ```text
> Создай src/lib/carreports/orchestrator.ts. Экспорт:
>
> 1) extractForStep(step, text, thread, opts?): главная точка
>    извлечения. Возвращает { patch: Partial<ReportDraft>, reply,
>    attachments?, chips? }.
>    - step="car": вызывает CLICHE_CAR + параллельно
>      CLICHE_CHARACTERISTICS на том же тексте, мерджит результаты.
>      Если упомянуто поколение/рестайлинг, но марки нет — сохраняет
>      pendingGenerationHint и просит уточнить.
>      Если есть только модель — inferBrandFromModelName.
>      Если есть brand+model — resolveCar (отложить поколение, если
>      brand/model только что изменились).
>      Если VIN нет, но есть госномер — resolveVinFromGosNumber.
>      Дата по умолчанию = сегодня (todayIso()).
>    - step="docs": извлечение через CLICHE_DOCS, merge.
>    - step="inspection": СЛОЖНО.
>      * Резолвит cursor (currentSection / legacy currentZone).
>      * Загружает теги раздела (loadSectionTags).
>      * Передаёт в CLICHE_INSPECTION focusedText с явной шапкой
>        «Активный элемент: ... Если эксперт явно не назвал другой —
>        пиши находку для активного.»
>      * Парсит findings[], мерджит в thread.draft.inspectionStep.
>        findings. Имя тега, не нашедшее себя в каталоге, идёт в
>        pendingTagNames с severity.
>      * Заметка КОНКАТЕНИРУЕТСЯ к существующей через "\n", а не
>        заменяет (⚠️ NB критично — этот баг чинили дважды).
>    - step="testDrive"/"result": CLICHE_*, merge с конкатенацией
>      строковых полей.
>
> 2) analyzeInspectionPhoto(thread, photoUrl, sectionSnake,
>    existingNote?): vision-вызов CLICHE_INSPECTION_PHOTO с
>    fileUrls=[photoUrl]. Перед вызовом ОБЯЗАТЕЛЬНО прогоняй URL
>    через ensurePhotoAccessible. Возвращает { elementId, noDamage,
>    seriousTagIds, noSeriousTagIds, pendingTags, note }.
>
> 3) analyzeInspectionNote(thread, sectionSnake, elementId?, noteText,
>    existingNote?): CLICHE_INSPECTION_NOTE, модель "gpt-5.4" (или
>    другой указанный). ⚠️ NB: КОГДА ЕСТЬ existingNote — модель ОБЯЗАНА
>    объединить, а не заменять. Текст приоритетнее картинки, картинка
>    дополняет, если элемент не определён в тексте.
>
> 4) classifyInspectionPhotoSection(thread, photoUrl): vision-роутинг
>    фото к одному из 8 разделов, JSON { section: <snake>|null }.
>
> 5) summarizeStepDraft(step, draft): человекочитаемая сводка
>    («Уже зафиксировано...»). Возвращает "" если шаг пустой.
>
> 6) applyVinDecode(thread): DecodeVin + merge в characteristicsStep
>    непустых полей.
>
> 7) askQuestion(step, question, thread, stepLabel): свободный QA-
>    режим через CLICHE_ASK с context = summarizeStepDraft + remaining
>    + nextMissingPrompt. НЕ модифицирует draft.
>
> 8) Локальные testDriveChips(), resultChips() — фабрики чипов для
>    follow-up сообщений.
> ```

---

## Шаг 12 — Голосовой ввод

> ```text
> Создай src/hooks/useVoiceRecorder.ts (приоритет — браузерный
> Web Speech API):
>
> - useVoiceRecorder({ onText, onLive?, language?="ru-RU" }) →
>   { state: "idle"|"recording"|"transcribing"|"error", error,
>     start, stop, cancel }.
> - getSR(): window.SpeechRecognition || webkitSpeechRecognition.
> - Если API нет — выставить error «Распознавание речи не поддер-
>   живается этим браузером. Используйте Chrome, Edge или Safari.»
> - При запуске сначала request getUserMedia({audio:true}) →
>   немедленно stop tracks, чтобы только получить permission grant.
> - rec.continuous=true, interimResults=true. interim → onLive(live),
>   final → накапливать в finalRef. onend → отдать onText(final),
>   если не cancel.
> - Маппинг ошибок: not-allowed/service-not-allowed/no-speech/
>   audio-capture/network → понятные русские сообщения. no-speech и
>   aborted — НЕ показывать как ошибку.
>
> ⚠️ NB: не делай fallback на /api/transcribe прямо в этом хуке —
> /api/transcribe доступен отдельно для случаев, когда нужен
> серверный whisper (например, на бэкенде после загрузки аудио).
> ```

---

## Шаг 13 — Компоненты чата (ChatApp)

> ```text
> Создай src/components/carreports/ChatApp.tsx — единственный
> «толстый» компонент, агрегирующий всё. Структура:
>
> Layout (mobile-first, но адаптивно):
> - Sticky шапка: логотип, заголовок треда, прогресс-стэппер по
>   FLOW_STEPS, кнопки меню/настроек.
> - Боковой Sheet (left): список тредов, кнопка «Новый отчёт»,
>   удаление треда, переход к настройкам токена (TokenDialog).
> - Лента сообщений per-step: flex-1 overflow-y-auto, авто-скролл
>   к последнему сообщению при добавлении.
> - Композер снизу: textarea с авто-resize, кнопки Mic/Paperclip/
>   Send/Cancel, индикатор очереди (getQueueSize).
> - Боковой Sheet (right): ReportPreview + FullReportView.
>
> Поведение на send:
> 1. Если text начинается с "?" — режим askQuestion (просто чат, без
>    извлечения).
> 2. Если isConfirmAdvance(text) — листает к следующему шагу
>    (stepIndex+1).
> 3. Иначе: добавляет user-сообщение в messages[currentStep],
>    плейсхолдер assistant со статусом queued. enqueueAI(threadId,
>    async () => {
>      обновить статус → running;
>      patch = await extractForStep(step, text, thread, { onClarify });
>      применить patch через updateThread (deep clone, см. Шаг 2);
>      обновить плейсхолдер тексто м reply, attachments, chips.
>    }). При ошибке — статус error + сообщение.
>
> Особые kind сообщений (см. typeguard в render):
> - "passport" — карточка с фактами CarStep+CharacteristicsStep.
> - "docsPassport" — карточка по DocumentReconciliationStep.
> - "inspectionSectionPicker" — выбор раздела.
> - "inspectionChips" — chip-row для раздела (теги).
> - "inspectionUploadPrompt" — кнопка «Загрузить фото».
> - "inspectionCollage" — сетка фото раздела.
> - "inspectionAttachAssign" — карточка для одного загруженного
>   фото, ждущего ручного назначения раздела.
> - "inspectionElementFocus" — ElementFocusCard (см. ниже).
>
> Голос:
> - useVoiceRecorder с onLive → пишет в composer как live, onText →
>   при остановке кладёт финальный текст и автоматически вызывает
>   send().
>
> Фото:
> - Paperclip / Camera → input[type=file][accept="image/*"]
>   multiple. Для каждого файла: preparePhoto → uploadPhoto.
>   Если remote=false (upload не удался) — оставить локально с
>   data:URL и пометить badge’ом в UI.
> - Сразу после upload — classifyInspectionPhotoSection. Если
>   уверенно — добавляет фото в inspectionStep.photos с
>   section и НЕ показывает attach-assign. Если nil — показывает
>   inspectionAttachAssign-сообщение с чипсами разделов для
>   ручного выбора.
> - После выбора раздела — analyzeInspectionPhoto через
>   enqueueAI. Если у элемента уже есть note — передавай как
>   existingNote.
>
> Заметка к фото:
> - Пользователь может написать текст в composer'е, имея открытую
>   карточку ElementFocus с фото. Сценарий: previousNote (из
>   findings) → analyzeInspectionNote(thread, section, elementId,
>   text, existingNote=previousNote). Если в заметке упомянут
>   ДРУГОЙ элемент — он становится новым elementId. Полученные
>   теги/note мерджатся в findings (никогда не затирают старое).
>
> ⚠️ NB про дубликаты заметок: при добавлении заметки к
> существующей ВСЕГДА передавай existingNote. Без этого ИИ
> возвращает только новые факты, старые — теряются.
> ```

---

## Шаг 14 — Подкомпоненты осмотра

> ```text
> Создай:
> - InspectionChipsCard.tsx + SectionPickerCard — карточка выбора
>   раздела и тегов; long-press на теге → меню edit/delete/add.
> - InspectionCollage.tsx + InspectionUploadPrompt — сетка фото с
>   индикатором статуса (ok/minor/serious/empty) и progress-bar
>   раздела.
> - ElementFocusCard.tsx (см. .lovable/plan.md — рендерится как
>   чат-лента из пузырей: фото-пузырь ассистента с prev/next, чип
>   состояния, серьёзные теги, мелкие теги, заметка пользователя,
>   AI-предложение).
> - InspectionDateField.tsx — date-picker для cityInspection /
>   dateInspection с дефолтом «сегодня».
> - SectionPickerButton.tsx, CarChecklist.tsx, DocsChecklist.tsx
>   (с countDocsPassport), LexChips.tsx, ReportPreview.tsx,
>   FullReportView.tsx, TokenDialog.tsx.
>
> ⚠️ NB: НЕ оставляй внутри ElementFocusView собственного
> композера/инпута — композер общий снизу.
> ```

---

## Шаг 15 — Сборка и отправка отчёта

> ```text
> В src/lib/carreports/storageApi.ts добавь:
>
> - buildInspectionStep(draft) — собирает полный
>   inspectionStep payload: для каждого раздела
>   {bodyElementHoodCollection: [], …}, плюс paintworkThicknessFrom/
>   To = 80/200 для body и body_reinforcement. Для каждого finding
>   пушит элемент в соответствующий collection. ⚠️ NB про дефолты:
>     - file: null (для hasFile=false; иначе подставить URL).
>     - noDamage: true дефолт, если hasFile=false.
>     - seriousDamageTags/noSeriousDamageTags: пустые массивы по
>       умолчанию.
>     - audioNotes: []. note: null.
>     - sectionType: SECTION_DOC_TO_TYPE[doc] ?? snake.
>     - elementType: camelToSnake(elementId).
>     - paintworkThicknessFrom/To: 80/200 для body/bodyReinforcement.
> - buildPrepareReportPayload(draft, resolved): полный отчёт,
>   включая обязательные поля Doc-схемы:
>     - reportName (`Отчёт ${YYYY-MM-DD}` если пусто).
>     - carStep: unreadableVin/visuallyMileageNotMatchCondition —
>       NotNull bool.
>     - characteristicsStep: modelCarId ИЛИ
>       modelGenerationRestylingFrameId (хотя бы один).
>     - documentReconciliationStep: 3 NotNull bool с default=true.
>     - legalReviewStep: { otherLegalReviews: [], batchIds: [] }.
>     - testDriveStep: все *IsWorkingProperly — NotNull bool,
>       *Tags — int[].
>     - resultStep: оба поля NotBlank, дефолты «Отчёт по результатам
>       осмотра.» и «Заключение специалиста.»
> - submitReport(draft):
>     1. Перед отправкой пробежать findings и для каждого
>        pendingTagNames вызвать addUserTag → переложить id в
>        нужный bucket. ⚠️ NB: если не удалось — оставить в
>        pending; сервер скажет, если это блокер.
>     2. Если нет modelCarId — резолвить через resolveCar.
>     3. RPC Storage.PrepareSpecialistReport({ report: payload }).
>     4. Возвращать { remote: bool, reportId?, method?, note }.
>        Любые ApiError перехватываются и превращаются в note
>        «Отправка не удалась: ...» — черновик остаётся
>        в localStorage.
> ```

---

## Шаг 16 — AI-резюме итога

> ```text
> Создай src/lib/carreports/aiSummary.ts:
> - generateSummary(thread): собирает компактный prompt из
>   ReportDraft (марка/модель/год, VIN, пробег, найденные дефекты по
>   разделам), отправляет в chatCompletions с SYSTEM_PROMPT_RU:
>     «Ты — автоэксперт carreports. На основе черновых заметок
>      осмотра сформируй короткое профессиональное резюме отчёта для
>      покупателя. Стиль: деловой, без воды, без эмодзи. 5–9
>      предложений. В конце добавь ОТДЕЛЬНОЙ строкой:
>      ВЕРДИКТ: <одна фраза — рекомендация или отказ, при
>      необходимости с торгом>.»
> - Возвращает { summary, verdict?, model, latencyMs }. UI на
>   шаге result заполняет resultStep этими полями.
> ```

---

## Шаг 17 — Лексикон пользовательских чипсов

> ```text
> Создай src/lib/carreports/lexicon.ts: LexEntry { id, step, zone?,
> label, value, weight, updatedAt }, persisted в
> localStorage["cr.lexicon.v1"]. API: addOrBumpEntry(step, label,
> value, zone?), removeEntry(id), useLexicon(step, zone?) →
> отсортированный по weight desc список.
>
> Используется в InspectionChipsCard, чтобы часто употребляемые
> формулировки эксперта (его «голосовые штампы») всплывали наверх.
> ```

---

## Шаг 18 — Финальная проверка

> ```text
> Пройдись по чек-листу косяков, которые встречались в оригинале:
>
> 1. ⚠️ AI возвращает {} вместо JSON: убедись, что в
>    CLICHE_INSPECTION_NOTE нет COMMON-фразы «если поле не упомянуто
>    — не включай его». Все 5 полей обязательны.
>
> 2. ⚠️ «Заметка эксперта не предоставлена»: chatCompletions
>    подмешивает {text}-хвост, если плейсхолдера нет.
>
> 3. ⚠️ Новая заметка затирает старую: orchestrator передаёт
>    existingNote, клише требует merge.
>
> 4. ⚠️ Pendintg tags пропадают: при submitReport — addUserTag и
>    переложить в bucket; при ошибке оставлять в pending.
>
> 5. ⚠️ Бесконечный ре-рендер: threadStore возвращает Object.freeze
>    стабильный массив; useSyncExternalStore сравнит по ссылке.
>
> 6. ⚠️ Битый presigned URL фото: перед каждым AI-vision запросом
>    ensurePhotoAccessible перезаливает из dataUrl.
>
> 7. ⚠️ Поколения от чужой модели: после resolveCar бери чипы
>    поколений ТОЛЬКО через listGenerationChipsForModel(modelCarId).
>
> 8. ⚠️ JSON-RPC carreports на успехе возвращает errors:[]: проверять
>    response==="error" || (errors не пуст по содержимому).
>
> 9. ⚠️ AI errors:[] на успехе — то же самое: errors[0]?.message.
>
> 10. ⚠️ Очередь AI: одна задача на тред в моменте, между тредами —
>     параллельно. enqueueAI обновляет счётчик до/после и
>     уведомляет subscribers.
>
> 11. ⚠️ Бэкенд (Cloudflare Workers): НЕ используй sharp/canvas/
>     child_process/puppeteer. Все image-операции — на клиенте.
>     Никакого native-Node API в server.ts.
>
> 12. ⚠️ HEIC: только heic2any (lazy-import), на iOS.
>
> 13. ⚠️ Web Speech: только Chrome/Edge/Safari. Дай явное сообщение
>     в других браузерах.
>
> 14. ⚠️ characteristics-шаг: в навигации не показывать. Поля
>     заполняются в `car` той же AI-итерацией. Тип CharacteristicsStep
>     оставить — он нужен внутри ReportDraft.
>
> 15. ⚠️ FLOW_STEPS совпадает с тем, что считает progress.ts. Любое
>     изменение списка шагов синхронно правит обе утилиты.
>
> Прогон smoke-теста: открыть приложение → создать тред → вставить
> тестовый JWT через TokenDialog → продиктовать «фольксваген тигуан
> 2 рестайлинг 1, 2020 год, vin XW0ZZZ5NZLG123456, пробег 80
> тысяч, осмотр в Москве сегодня» → проверить что в правой панели
> ReportPreview появились все поля и распознанная модель. Перейти на
> шаг inspection → выбрать раздел body → загрузить фото капота →
> убедиться что AI определил elementId="hood", выставил теги и
> note. Добавить текстовую заметку — убедиться что старая не
> потеряна. Дойти до submit → нажать «Отправить отчёт» → проверить
> что вернулся reportNumber или внятная ошибка.
> ```

---

## Что НЕ делать (антипаттерны из этой кодовой базы)

- Не создавай отдельный шаг `characteristics` в навигации — он только
  в типе. Чипсы и поля едут вместе с `car`.
- Не используй react-router-dom — только `@tanstack/react-router`.
- Не делай `src/pages/`, `App.tsx`-роутер или Next-стиль layout —
  только `src/routes/` flat dot-notation.
- Не оставляй в чате локальный композер внутри карточки осмотра —
  композер в приложении ровно один (внизу `ChatApp`).
- Не присылай в AI прямые S3-ссылки на фото — только presigned GET
  (через `ObjectStorage.GetTemporaryViewUrlBucketTemp`).
- Не клади Lovable AI Gateway-ключ в клиент. `LOVABLE_API_KEY` —
  только в server-route `/api/transcribe`.
- Не используй `sharp`, `canvas`, `child_process`, `puppeteer`,
  `node-cron` и другие native/Node-only пакеты в server.ts —
  Cloudflare Worker их не поддерживает.
- Не пиши `useEffect + fetch` для первичной загрузки — для
  TanStack-данных используй loader + useSuspenseQuery (если будет
  серверный data fetch). Текущее приложение всё хранит локально,
  так что это пока не критично.

---

## Итого: порядок запуска промтов

`0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18`.

Между шагами 11 и 13 удобно делать промежуточный smoke-test:
карты типов и orchestrator уже достаточно, чтобы протестировать
извлечение в node-скрипте до того, как UI собран.
