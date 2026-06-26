## Что меняем в шаге «Осмотр»

Сейчас выбор раздела/элемента и теги живут в карточке внутри сообщения ИИ. Переносим начало флоу в композер и делаем медиа главной единицей записи: фото → элемент → теги + заметка.

## 1) Композер: кнопка «Раздел» рядом с «?»

В нижней панели слева от иконок 📎/📷 (только на шаге `inspection`) — пилюля с активным разделом, например `Кузов ▾`. По тапу — bottom-sheet со списком из 8 разделов (`INSPECTION_SECTIONS`) и прогрессом `N/Total`. Выбор раздела:

- обновляет `currentSection` + сбрасывает `currentElementId` на первый элемент
- кидает в чат новое assistant-сообщение со специальной карточкой `UploadCollagePrompt`: «Раздел «Кузов». Загрузите фото элементов — соберём коллаж и проставим теги.» с кнопками 📷 «Снять» и 🖼 «Из галереи» (input multiple).

## 2) Коллаж из медиа в чат-сообщении

Новое assistant-сообщение `kind: "inspectionCollage"` с полем `sectionSnake`. Рендер — `CollageCard`:

- сетка превью 3×N для всех `inspectionStep.photos`, у которых `section === sectionSnake`
- бейдж на превью: иконка элемента (если назначен) + 🟢/🟡/🔴 (вердикт) + `📝N` (кол-во тегов/заметка)
- + кнопка «Добавить ещё» (тот же input)
- тап по превью открывает sheet `PhotoAnnotator`

Коллаж — единственный (per section): при повторном выборе того же раздела поднимаем существующее сообщение в конец, а не создаём новое.

## 3) Аннотация фото (PhotoAnnotator)

Bottom-sheet на одно фото:

1. Превью фото в максимальном размере
2. Чипсы элементов раздела (выбор → `photo.elementId`)
3. Сегмент «Без замечаний / Мелкие / Серьёзные» → `finding.noDamage` + бакет тегов
4. Чипсы тегов из `loadSectionTags(section)` + «Свой тег» (как в `InspectionChipsCard`)
5. Поле заметки (`finding.note`, добавляется к существующей)
6. Кнопка **🪄 Распознать ИИ** — отправляет фото в `vision`-эндпоинт с новым клише `CLICHE_INSPECTION_PHOTO`:
   - возвращает `{elementId, noDamage, seriousTags[], nonSeriousTags[], note}`
   - подставляет в поля, теги маппятся через `findTagId` / `pendingTagNames`
   - пользователь правит и сохраняет

Сохранение — `upsertFinding` (один photo → один elementId; теги/note из аннотатора сливаются в `finding`).

## 4) Типы и хранилище

В `types.ts`:
- `ChatMessage.kind`: добавить `"inspectionUploadPrompt"` и `"inspectionCollage"`, с полем `sectionSnake: string`
- `InspectionPhoto`: уже есть `elementId`. Добавить опц. `verdict?: "ok"|"minor"|"serious"` для быстрого бейджа (производное от finding, но кэшируем для сетки).

В `inspectionState.ts`:
- `setPhotoElement(ins, photoIdx, elementId)`
- `photosForSection(ins, section)`

## 5) Старая карточка `InspectionChipsCard`

Оставляем для ручного режима (без фото) — она по-прежнему рендерится во вступительном сообщении, но описание упрощаем: «или работайте через коллаж — кнопка раздела снизу».

## 6) Клише для ИИ (`cliche.ts`)

```
CLICHE_INSPECTION_PHOTO(sectionLabel, elements[], knownTags[])
```

Возвращает строго JSON одной находки для активного фото:
```json
{
  "elementId": "<id из списка>",
  "noDamage": true|false,
  "seriousTags": ["..."],
  "nonSeriousTags": ["..."],
  "note": "что видно на фото, 1–2 предложения"
}
```

В `aiApi.chatCompletions` уже есть `fileUrls` — отправляем туда presigned URL фото из `uploadTemporary`/`uploadPhoto`.

## 7) Что выкидываем

- Кнопка 📷 в нижней панели для шага inspection (теперь живёт в карточке загрузки/коллаже).
- Текстовый плейсхолдер «Заметка по элементу…» в композере — для inspection меняем на «Напишите вопрос ИИ или выберите раздел снизу».

## Этапы реализации

1. Типы (`types.ts`, `inspectionState.ts`) + рендеры новых kind.
2. Кнопка `SectionPicker` в композере + bottom-sheet.
3. `UploadCollagePrompt` карточка + bridge с input multiple.
4. `CollageCard` (сетка фото) + `PhotoAnnotator` sheet (ручные поля).
5. Клише + `analyzePhotoForInspection()` в `orchestrator`, кнопка «Распознать ИИ» в аннотаторе.
6. Чистка: убрать 📷 из композера для inspection, обновить плейсхолдеры/тексты.
