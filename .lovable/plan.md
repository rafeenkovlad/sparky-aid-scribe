## Проблема

Сейчас каждое прикреплённое фото живёт в приложении тремя «копиями»:

1. полный JPEG-blob в `PreparedPhoto.blob` (≤ 2 МБ);
2. **полный base64 `dataUrl`** (тот же blob, но +33% размера) — кладётся в `pendingAttachments`, в `thread.draft.inspectionStep.photos[].dataUrl`, в `ChatMessage.pendingPhoto.dataUrl`, в `LegalReviewMaterial.dataUrl` и в `<img src={a.dataUrl}>`;
3. этот же `dataUrl` сериализуется через `JSON.stringify(thread)` в `localStorage` (`threadStore`), раздувая квоту и нагружая основной поток на каждое сохранение.

Из-за этого RAM-нагрузка растёт линейно от количества фото, а `localStorage` рискует упереться в лимит (~5 МБ) после 3–5 снимков.

## Решение

Вынести байты фото в отдельный **IndexedDB-кеш** (`photo-blob-cache`), а в состоянии треда и в `localStorage` хранить только лёгкую ссылку (`photoId` + метаданные + опциональный `remoteUrl`). Превью в UI создаётся `URL.createObjectURL(blob)` лениво и освобождается при размонтировании.

### Архитектура

```text
                  ┌────────────────────────┐
add file ─────►   │   preparePhoto()       │
                  │  blob + thumbBlob      │
                  └──────────┬─────────────┘
                             ▼
                  ┌────────────────────────┐
                  │ photoCache.put(id,…)   │  IndexedDB store:
                  │   { full, thumb }      │   key = photoId (uuid)
                  └──────────┬─────────────┘   value = { fullBlob, thumbBlob,
                             ▼                            filename, mime, size }
                  ┌────────────────────────┐
state / LS  ◄──── │ PhotoRef               │
                  │  { photoId, filename,  │
                  │    mime, size,         │
                  │    remoteUrl?, key?,   │
                  │    remoteExpiresAt? }  │
                  └──────────┬─────────────┘
                             ▼
                  ┌────────────────────────┐
render <img> ◄─── │ usePhotoObjectUrl(id)  │  читает thumb из IDB → blob: URL
                  └────────────────────────┘
```

### Что меняем

1. **Новый модуль `src/lib/carreports/photoCache.ts`**
   - `openDB()` — обёртка над `indexedDB` (один store `photos`, ключ — `photoId`).
   - `putPhoto(id, { fullBlob, thumbBlob, filename, mimeType, size })`.
   - `getThumb(id)` / `getFull(id)` — возвращают `Blob | null`.
   - `deletePhoto(id)` / `deleteMany(ids)` — для GC.
   - `listIds()` — для очистки сирот при старте.

2. **Хук `src/hooks/usePhotoObjectUrl.ts`**
   - принимает `photoId` (или `null`), достаёт thumb-blob из IDB, отдаёт `objectUrl: string | null`;
   - на размонтировании / смене id вызывает `URL.revokeObjectURL`, чтобы blob-URL не текли.

3. **`src/lib/carreports/photo.ts`**
   - `preparePhoto` дополнительно генерирует thumb-blob (≤ 256 px) и возвращает оба blob'а; `dataUrl` больше не считаем.
   - Добавляем `storePreparedPhoto(prepared)` — кладёт оба blob'а в IDB и возвращает `PhotoRef { photoId, filename, mimeType, size }`.
   - `ensurePhotoAccessible` берёт байты не из `dataUrl`, а из `photoCache.getFull(photoId)`; сохраняет полученный `remoteUrl` обратно в ref (через колбэк, чтобы вызывающий мог сохранить в thread).

4. **Типы (`src/lib/carreports/types.ts`)**
   - `InspectionPhoto`: убрать `dataUrl?`, добавить `photoId: string`, оставить `url?`, `remote?`, `addedAt?`. Поле `dataUrl?` помечаем `@deprecated` и оставляем оптично для миграции старых драфтов.
   - То же для `LegalReviewMaterial` (для картинок) и для `ChatMessage.pendingPhoto`.
   - `pendingAttachments` в `ChatApp` переезжает на `{ photoId, filename, mimeType, size }`.

5. **Миграция старых тредов (`src/lib/carreports/threadStore.ts`)**
   - В нормализаторе при загрузке из `localStorage`: для каждого фото с устаревшим `dataUrl` без `photoId` — конвертируем `dataUrl → Blob`, сохраняем в IDB, проставляем `photoId`, удаляем `dataUrl`. После миграции сохраняем тред обратно — `localStorage` сразу худеет.
   - Опционально (если миграция тяжёлая) — делаем её ленивой при первом обращении к фото.

6. **`ChatApp.tsx`**
   - Все `<img src={a.dataUrl}>` / `<img src={photoFocus.dataUrl}>` / `<img src={photo.dataUrl}>` заменяем на `<PhotoThumb photoId={a.photoId} />` (тонкий обёрточный компонент над `usePhotoObjectUrl`).
   - `addAttachment` сохраняет blob'ы в IDB и кладёт в state только ref. Дальнейшие места, где раньше передавался `dataUrl` (`uploadTemporary`, отправка сообщений, `pendingPhoto`), берут blob из IDB через `getFull(photoId)`.
   - Удаление фото/треда вызывает `photoCache.deletePhoto(id)`.

7. **`InspectionCollage.tsx`** — `photo.dataUrl` заменяется на ленивый `objectUrl` из хука; при отсутствии превью показываем существующий fallback «нет превью».

8. **GC «сирот»**
   - На старте `ChatApp` собираем все `photoId` из всех тредов, сравниваем с `photoCache.listIds()` и удаляем лишние записи (например, после удаления треда в другой вкладке).

### Что НЕ трогаем

- Серверную часть, presigned-URL, `uploadTemporary`, `cr-proxy`, оркестратор — формат отправки в AI не меняется (он и так использует `url`, а не `dataUrl`).
- Существующий компрессор изображений (`preparePhoto`) — только расширяем результатом.
- Логику истечения presigned-URL — `ensurePhotoAccessible` остаётся, источник blob меняется с `dataUrl` на IDB.

### Результат

- RAM-footprint фото в JS-heap ≈ только активно отрисованные thumbnail blob URLs (десятки КБ × видимые ячейки коллажа).
- `localStorage` хранит компактный JSON со ссылками — десятки байт на фото вместо ~1.5–3 МБ base64.
- При деплое нового SW и перезагрузке вкладки фото остаются в IndexedDB и доступны офлайн как раньше.
- Старые треды мигрируют автоматически при первой загрузке.

### Технические детали

- **IndexedDB store name**: `carreports` / object store `photos`, key `photoId` (uuid v4 из `crypto.randomUUID()`).
- **Thumb size**: 256 px long edge, JPEG q=0.7 — это ~10–30 КБ против ~150 КБ полного.
- **Object URL revoke**: `useEffect`-cleanup в `usePhotoObjectUrl`, плюс единая `revokeAll()` на `beforeunload`.
- **SSR safety**: модуль `photoCache` лениво `await import` в браузерных коллбэках, на сервере не используется.
- **Fallback**: если `indexedDB` недоступен (приватный режим Safari старых версий) — деградируем до in-memory `Map<photoId, Blob>` без `localStorage`-персистентности.
