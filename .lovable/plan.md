## Цель
После того как пользователь заполнил/обновил заметку в любом шаге, в ответном сообщении предлагать переформулировать её. По согласию AI на основании уже добавленных тегов и текущей заметки пишет новый вариант, а пользователь выбирает — оставить исходный или принять новый.

## Где появляется
- **Осмотр** — заметка `finding.note` любого элемента (учитываются `seriousDamageTagIds + noSeriousDamageTagIds + pendingTagNames` этого элемента).
- **Тест-драйв** — `testDriveStep.testDriveNote` (контекст — все `testDrive*Tags` + флаги исправности).
- **Документы** — `documentReconciliationStep.note` (контекст — флаги совпадения VIN / № двигателя / собственника).
- **Результат** — `resultStep.summaryInspectionNote` и `resultStep.resultSpecialistNote`.

## UX‑контракт
1. Оркестратор (`runStep`/`runInspectionRoute` и пр.) возвращает обычный ответ + новое поле `notePatched?: { kind: NoteKind, key?: string, originalText: string }`.
2. `ChatApp` после patch/reply делает `pushMsg({ kind: "noteProposal", noteRef })` со статусом `loading=true` и пустым `ai`.
3. Сразу же запускается `reformulateNote(noteRef)`:
   - cliche `CLICHE_REFORMULATE_NOTE(stepLabel, contextDescription, tagNames, originalText)`
   - модель та же, что в `analyzeInspectionNote` (`gpt-5.4`), формат `{ "note": string }`.
4. Карточка обновляется (`ai = <текст>`, `loading=false`) и показывает три действия: **Оставить исходную** / **Принять переформулированную** / иконка‑крестик.
5. При выборе AI‑версии — `updateThread` пишет её обратно в тот же путь в `draft` и пушит подтверждающее сообщение «✏️ Заметка обновлена».
6. Если уже есть активная карточка `noteProposal` для того же `noteRef` — заменяем (фильтр по id), не плодим.

## Архитектура
### 1. Типы — `src/lib/carreports/types.ts`
- Расширяем `ChatMessage["kind"]`: добавить `"noteProposal"`.
- Новый интерфейс
  ```ts
  export type NoteRef =
    | { kind: "inspection"; section: string; elementId: string }
    | { kind: "testDrive" }
    | { kind: "docs" }
    | { kind: "resultSummary" }
    | { kind: "resultVerdict" };

  export interface NoteProposalPayload {
    ref: NoteRef;
    original: string;
    ai: string | null;
    loading: boolean;
    picked?: "original" | "ai";
  }
  ```
- В `ChatMessage` добавить `noteProposal?: NoteProposalPayload`.

### 2. Cliche — `src/lib/carreports/cliche.ts`
Новый `CLICHE_REFORMULATE_NOTE(stepLabel, scopeLabel, tagNames: string[], existingNote: string)` — просит:
- сохранить смысл и факты заметки;
- учесть теги из списка как уже фиксированные дефекты (не дублировать словами);
- говорить нейтрально‑деловым языком отчёта;
- вернуть JSON `{ "note": string }`.

### 3. Reformulate API — `src/lib/carreports/orchestrator.ts`
- `export async function reformulateNote(thread, ref, originalText, contextTagNames, scopeLabel)` → `string | null`.
- Реализация: `chatCompletions({ id: aiChatIdFor(thread, 'reformulate:'+key), text: originalText, cliche, model: 'gpt-5.4' })` + `parseJsonResponse`.

### 4. Точки обнаружения заполненной заметки
Каждый блок оркестратора, который пишет заметку, в дополнение к существующему `patch`/`reply` возвращает:
```ts
notePatched?: { ref: NoteRef; originalText: string; tagNames: string[]; scopeLabel: string }
```
- **inspection route**: для каждого элемента, у которого `nextFindings[key].note` изменился или появился, кладём `notePatched` (на первый — самый «свежий» элемент в `touchedElements`). Контекст‑теги — резолвенные имена тегов этого элемента + pending.
- **testDrive**: если новое значение `testDriveNote` != предыдущему — собираем теги из всех `testDrive*Tags` и человекочитаемые имена (имена тегов берём из catalogue по нужным разделам). Если catalogue нет — передаём пустой массив.
- **docs**: при изменении `documentReconciliationStep.note` — контекст‑метки: `["VIN совпадает"|"VIN не совпадает", "Двигатель …", "Собственник …"]` исходя из булевых полей.
- **result** (`summaryInspectionNote` и `resultSpecialistNote`): без тегов; контекст — короткая выжимка из draft (марка/модель/год). Каждое поле — отдельный proposal.

### 5. ChatApp — `src/components/carreports/ChatApp.tsx`
- После обработки результата оркестратора, если в результате есть `notePatched`, вызываем `pushNoteProposal(t, notePatched)`:
  - удаляем прошлый proposal с тем же `ref` (`messages[step].filter(...)`);
  - пушим новое сообщение `{ kind: 'noteProposal', noteProposal: { ref, original, ai:null, loading:true } }` с детерминированным `id = 'note-proposal:' + serialize(ref)`.
- Сразу `void reformulateAndUpdate(threadId, ref, originalText, tagNames, scopeLabel)`:
  - вызывает `reformulateNote(...)` → обновляет тот же message: `loading:false, ai:text`.
- Хендлеры выбора:
  - `acceptOriginal(ref)`: помечает `picked: 'original'`, без записи (исходный уже в draft).
  - `acceptAi(ref, aiText)`: `updateThread` → пишет `aiText` в нужный путь (`finding.note`, `testDriveNote`, `documentReconciliationStep.note`, `resultStep.summaryInspectionNote/resultSpecialistNote`), `picked: 'ai'` и пушит подтверждающее сообщение.
- Делать `setComposer('')` не нужно — выбор в карточке.

### 6. UI — `src/components/carreports/NoteProposalCard.tsx` (новый)
- Компактная карточка в стиле existing `StepPassport` / `NoteProposalContent` из ElementFocusCard.
- Header: «✏️ Переформулировать заметку?», тэг текущего scope (например, «Осмотр · Капот»).
- Body: блок «Исходная» (плашка‑цитата) и блок «AI‑версия» (или skeleton с «Готовлю вариант…»).
- Footer: две кнопки `Оставить исходную` / `Принять AI` и иконка‑крестик; после выбора кнопки заменяются на статус «Выбран: исходная/AI».

### 7. Рендер — `MessageBubble`
- Новый branch `msg.kind === 'noteProposal'` → `<NoteProposalCard payload={msg.noteProposal!} onPickOriginal/onPickAi/onDismiss/>`
- Пробрасываем три новых пропа от ChatApp через тот же props‑bag, что и существующие.

## Лимиты
- В `ChatApp` храним `inflight = new Set<string>()` по ключу ref, чтобы не запускать переформулировку дважды.
- Карточка одна на ref: пере‑заполнение той же заметки заменит существующую карточку.

## Файлы
- create `src/components/carreports/NoteProposalCard.tsx`
- edit `src/lib/carreports/types.ts` (kind + types)
- edit `src/lib/carreports/cliche.ts` (`CLICHE_REFORMULATE_NOTE`)
- edit `src/lib/carreports/orchestrator.ts` (`reformulateNote`, `notePatched` в результатах шагов)
- edit `src/components/carreports/ChatApp.tsx` (хук обработки, рендер, хендлеры, проброс)
