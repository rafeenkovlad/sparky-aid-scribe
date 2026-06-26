
## Что говорит API (доки + наш каталог)

Шаг «Осмотр» в `Storage.PrepareSpecialistReport` хранит данные не «по зонам», а строго по DTO:

- **8 разделов** (`INSPECTION_SECTIONS` в `src/lib/carreports/inspectionSections.ts`):
  кузов, силовой каркас, остекление, салон, подкапотка, колёса/тормоза, освещение, компьютерная диагностика.
- Каждый раздел имеет **фиксированный набор элементов** (капот, лонжерон, лобовое, руль…) + всегда последний `generalCondition`. У каждого элемента — своё имя коллекции (`bodyElementHoodCollection`, …).
- Для каждого элемента сервер ждёт **`InspectionElementFinding`**:
  - `noDamage: bool` — вердикт,
  - `seriousDamageTagIds[]`, `noSeriousDamageTagIds[]` — теги из каталога,
  - `pendingTagNames[]` — свободные имена, которых нет в каталоге,
  - `note`, `audioNotes[]`.
- Каталог тегов раздела отдаёт `Storage.GetUserTags(step="inspection", section=<snake>)`, добавить — `Storage.AddUserTag`. Уже завёрнуто в `loadSectionTags` / `addUserTag` / `findTagId`.

Текущий чат-UI оперирует локальными «зонами» (`INSPECTION_ZONES`) и плоской заметкой `sectionNotes[zone]`. Это не покрывает уровень «элемент», а именно он — единица записи в API.

## Цель

Привести чат осмотра к структуре DTO: специалист в одном сообщении выбирает **раздел → элемент**, ставит **вердикт**, тапает **теги** (или диктует заметку), при необходимости прикладывает **фото/аудио**. Всё это копится в `inspectionStep.findings["section.elementId"]` и улетает 1-в-1 в нужный `*Collection`.

## Изменения в модели (`types.ts`)

- `InspectionStep`:
  - `currentSection: SectionSnake` (вместо `currentZone`)
  - `currentElementId: string`
  - `findings` — уже есть, остаётся ключом `${section}.${elementId}`.
- `InspectionPhoto`: добавить `section: SectionSnake`, `elementId: string` (фото привязывается к элементу, а не к «зоне»).
- Удалить `sectionNotes` из активного пути (оставить опциональным «комментарием к разделу» или выпилить совсем).

## UI: карточка `InspectionChipsBlock` (внутри сообщения ассистента)

Заменяем текущий 2-слойный блок на 3 уровня в одной карточке:

1. **Разделы** — горизонтальные чипсы по 8 разделам с бейджем прогресса `N/Total` (сколько элементов имеют finding). Текущий раздел подсвечен оранжевым.
2. **Элементы текущего раздела** — чипсы по элементам, иконка статуса:
   - 🟢 `noDamage=true`,
   - 🟡 есть `noSeriousDamageTagIds`,
   - 🔴 есть `seriousDamageTagIds`,
   - `📷N` / `📝` если есть фото/заметка.
   `generalCondition` всегда последний.
3. **Вердикт + теги текущего элемента**:
   - Сегмент «Без замечаний / Мелкие / Серьёзные» — переключает `noDamage` и активный список тегов.
   - Чипсы тегов из `loadSectionTags(currentSection)`, разделённые `groupLabel` «Серьёзные» / «Мелкие». Тап — добавить/убрать `tagId` из соответствующего массива finding'а.
   - Кнопка `+ Свой тег` — инлайн-ввод; имя сначала ищем в каталоге (`findTagId`), потом либо берём id, либо кладём в `pendingTagNames` и пробуем `addUserTag` в фоне.

Действия в карточке:
- «✅ Раздел без замечаний» — массово ставит `noDamage=true` всем элементам раздела без finding.
- «Следующий элемент» / «Следующий раздел» — навигация без диктовки.
- «Очистить элемент» — сброс finding.

## Composer

- Текст в композере = `finding.note` активного элемента (двусторонняя привязка). Enter сохраняет finding и переходит к следующему элементу без finding'а.
- Placeholder: `Заметка по «Капот» (раздел «Кузов») — Enter сохранит и перейдёт дальше`.
- Камера (уже есть) — прикладывает фото к **текущему `section + elementId`**, сохраняет в `inspectionStep.photos`.
- Голосовой ввод — `audioNotes.push(url)` + расшифровка идёт в `note`.

## Интеграция с ИИ (`orchestrator.ts`)

Существующий путь «свободная реплика → findings» сохраняем, но обогащаем:

- В system-prompt передаём `currentSection`, `currentElementId`, `label` элемента и каталог тегов раздела (`{id, name, type}`), плюс правило «писать finding для активного элемента, если в реплике явно не назван другой элемент того же раздела».
- Ответ ИИ — массив `findings` строго по элементам этого раздела. Имена тегов резолвим через `findTagId`; не нашлось — `pendingTagNames`.
- «Всё ок по капоту» / «без замечаний» → `noDamage=true`, очищаем теги элемента.

## Прогресс шага

- Над композером — компактная полоска: `Кузов 12/16 · Каркас 0/15 · …` (тап = прыжок к разделу).
- В `progress.ts` `isStepFilled("inspection")` = у каждого раздела все элементы имеют finding (либо явный `noDamage=true`).
- `missingOptionalFields` подсказывает следующий пустой элемент: «Осталось: Силовой каркас → Левый лонжерон».

## Сериализация (`storageApi.ts`)

- Перед `PrepareSpecialistReport`: пройтись по всем findings, создать недостающие теги через `Storage.AddUserTag` для `pendingTagNames`, подменить на полученные `id`.
- Каждый finding пишется в `INSPECTION_SECTIONS[section].elements[elementId].collection` (это уже хранится в каталоге, переиспользуем).
- Фото отправляем с `section + elementId` в нужный element collection.

## Что выкидываем

- `INSPECTION_ZONES` и `ZONE_TO_SECTION` (моделирование «зон» больше не нужно — раздел приходит из API-каталога).
- `sectionNotes[zone]` как основное хранилище (по желанию — оставить как «общий комментарий к разделу», но в DTO он не нужен).
- В `ChatApp.tsx`: `currentZoneId`/`zoneStats` пропсы — переименовать в `currentSection`/`sectionStats` + `currentElementId`/`elementStats`.

## Этапы

1. **Модель**: расширить `InspectionStep` (`currentSection`, `currentElementId`) и `InspectionPhoto` (привязка к элементу). Миграция: `currentZone → currentSection` через `ZONE_TO_SECTION`.
2. **UI**: переписать `InspectionChipsBlock` под 3 уровня + теги из каталога (lazy-load с `loadSectionTags`).
3. **Composer ↔ finding**: двусторонняя привязка `note`, авто-переход к следующему элементу.
4. **Orchestrator**: контекст активного элемента + каталог тегов; парсинг ответа строго по элементам.
5. **Progress + сериализация**: пересчёт готовности по элементам, создание `pendingTagNames` перед `PrepareSpecialistReport`, фото с `elementId`.
6. **Чистка**: удалить `INSPECTION_ZONES`, `ZONE_TO_SECTION`, мёртвые ветки `sectionNotes` (или явно пометить как опционально).
