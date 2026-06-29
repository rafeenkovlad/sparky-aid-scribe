# План: «паспорт заполненности» при возврате в заполненный шаг

## Цель
При входе в любой шаг (через `advanceStep` или `jumpTo`), если шаг **уже был заполнен ранее** (`isStepFilled(step, draft) === true`), вместо обычного intro-сообщения + «➡️ ask» показывать карточку-паспорт с тем, что уже введено, и кнопкой действия («Изменить» / «Всё верно, далее»).

Сейчас такой паспорт есть только для `car` (`CarChecklist`, `msg.kind === "passport"`) и `docs` (`DocsChecklist`, `msg.kind === "docsPassport"`). Распространить логику на остальные шаги.

## Шаги

### 1. Универсальный компонент паспорта
Создать `src/components/carreports/StepPassport.tsx` — единый рендер «паспорта» для произвольного шага:
- принимает `step: StepId`, `draft: ReportDraft`, `onEdit`, `onConfirm`;
- внутри переключается на специализированный рендер:
  - `car` → существующий `CarChecklist`
  - `docs` → существующий `DocsChecklist`
  - `inspection` → краткая сводка по `INSPECTION_SECTIONS` (счётчики `sectionProgress` + кол-во фото), кнопка «Открыть осмотр»
  - `legalMaterials` → список файлов (имена + размер) из `legalReviewStep.otherMaterials`
  - `testDrive` → `notDone` / заметки + флаги (двигатель/КПП/руль/подвеска/тормоза)
  - `result` → `summaryInspectionNote` + `resultSpecialistNote`
- общий каркас: заголовок «Уже заполнено», кнопки «Изменить» и «Всё верно, далее».

### 2. Новый тип сообщения
В `src/lib/carreports/types.ts` добавить `kind: "stepPassport"` к `ChatMessage` (поле `step` уже есть).

### 3. Хелпер выбора intro
В `src/components/carreports/ChatApp.tsx` ввести `makeStepEntryMessage(step, draft)`:
- если `isStepFilled(step, draft)` → возвращает сообщение `{ kind: "stepPassport", step }` без `ask`;
- иначе → текущий `makeIntroMessage(step)` + `nextMissingPrompt`.

### 4. Применить в точках входа в шаг
- `advanceStep` (≈ строка 1361): заменить пуш intro + ask на `makeStepEntryMessage`.
- `jumpTo` (≈ строка 1996): то же самое. Для `jumpTo` показывать паспорт даже если `changed === false`, чтобы повторный клик по шагу из превью тоже подтягивал актуальный паспорт (по желанию — обсудить).

### 5. Рендер `stepPassport` в чате
В блоке рендера ассистента (≈ строка 2975) добавить ветку `msg.kind === "stepPassport"` → `<StepPassport step={msg.step} draft={draft} onEdit={...} onConfirm={advanceStep} />`. Существующие `passport` / `docsPassport` оставляем для обратной совместимости (или мигрируем — отдельным проходом).

### 6. Поведение кнопок
- «Изменить» — снимает паспорт-режим, открывает композер с подсказкой `nextMissingPrompt` (как сейчас при незаполненном шаге).
- «Всё верно, далее» — вызывает существующий `advanceStep`.

## Что НЕ меняем
- Логику `isStepFilled`, `nextMissingPrompt`, `optionalHintSentence`.
- Существующие карточки `CarChecklist` / `DocsChecklist` — переиспользуем внутри `StepPassport`.
- Поведение для пустого шага — остаётся прежним (intro + ask).

## Файлы
- create `src/components/carreports/StepPassport.tsx`
- edit `src/lib/carreports/types.ts` (новый `kind`)
- edit `src/components/carreports/ChatApp.tsx` (`makeStepEntryMessage`, `advanceStep`, `jumpTo`, рендер сообщения)

Подтверди — приступаю.
