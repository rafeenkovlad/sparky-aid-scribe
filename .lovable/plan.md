## Цель

Добавить service worker (без оффлайн-кеширования контента), чтобы:
- Chrome/Edge на Android показывал системный промпт «Установить приложение».
- Приложение проходило формальные критерии PWA (manifest + SW с fetch-обработчиком + HTTPS).
- Запуск с ярлыка ощущался быстрее.

При этом **не показывать устаревший HTML** после деплоя — это критично для чат-приложения с обращениями к ИИ.

## Подход

Используем `vite-plugin-pwa` с `generateSW` (Workbox) — это правильный путь по правилам проекта, без ручного `sw.js`.

Ключевые настройки:
- `registerType: "autoUpdate"` — новый SW устанавливается автоматически.
- `injectRegister: null` — регистрацию делаем своим guarded-модулем, а не плагином.
- `devOptions.enabled: false` — никакого SW в dev.
- `workbox.navigateFallback: null` — **HTML-навигации идут в сеть напрямую**, никакого кеша страниц. Это и есть «без оффлайна», и это исключает риск устаревшей страницы.
- `workbox.runtimeCaching`: только same-origin хешированные ассеты (`.js`, `.css`, иконки) через `CacheFirst`. Никакого кеширования API/Supabase/S3/transcribe.
- `workbox.navigationPreload: true` — для скорости.

## Файлы

1. **`bun add -d vite-plugin-pwa`** — установка плагина.

2. **`vite.config.ts`** — добавить `VitePWA({...})` в массив плагинов (через `vite.plugins` опцию `@lovable.dev/vite-tanstack-config`). Указать manifest (можно ссылкой на уже существующий `public/manifest.webmanifest` через `manifest: false` + `injectManifest` отключён — оставляем наш файл как есть; плагин только генерирует `sw.js`).

3. **`src/lib/pwa/register-sw.ts`** — обёртка-регистратор с жёсткими guard-ами. Регистрирует `/sw.js` ТОЛЬКО если:
   - `import.meta.env.PROD === true`
   - `window.top === window.self` (не в iframe)
   - hostname НЕ начинается с `id-preview--` или `preview--`
   - hostname НЕ заканчивается на `.lovableproject.com`, `.lovableproject-dev.com`, `.beta.lovable.dev`
   - URL НЕ содержит `?sw=off`
   В любом отказе — вызвать `unregister()` для существующих регистраций `/sw.js`, чтобы вычистить старые SW при превью.

4. **`src/routes/__root.tsx`** — в `RootComponent` добавить `useEffect`, который динамически импортирует и вызывает `register-sw.ts` на клиенте (через `if (typeof window !== "undefined")`), чтобы не сломать SSR.

## Что НЕ делаем

- Не кешируем HTML, API, ответы ИИ, картинки из S3, временные файлы.
- Не подключаем `workbox-window` UI «доступно обновление» — `autoUpdate` всё сделает молча.
- Не трогаем существующий `public/manifest.webmanifest` и иконки.
- Не регистрируем SW в Lovable preview / dev / iframe.
- Не добавляем push-уведомления — это отдельная задача.

## Что получит пользователь

- На опубликованном сайте (`*.lovable.app` или кастомный домен) в Chrome на Android появится промпт «Установить приложение» / иконка «+» в адресной строке.
- На iOS — установка через «Поделиться → На экран Домой» (как сейчас).
- После деплоя новой версии: новый SW активируется при следующей навигации, HTML всегда свежий (сетевой), пользователи **не залипают на старой версии**.
- В Lovable-превью ничего не меняется — SW туда не попадает.

## Технические детали (для проверки)

- После сборки в `dist/` появятся `sw.js` и `workbox-*.js`.
- Аварийный выключатель: если что-то пойдёт не так в проде, открыть `?sw=off` — guard вызовет `unregister()` и снимет SW.
- Если в будущем понадобится полностью убрать SW — менять `sw.js` на kill-switch worker по правилам Lovable PWA skill.
