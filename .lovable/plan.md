## Цель

Сделать так, чтобы приложение AI CARREP можно было «установить» на мобильное устройство (добавить ярлык на главный экран) и запускать в standalone-режиме без браузерной обвязки — как мобильное приложение.

## Что важно понимать

Приложение уже является SPA на TanStack Start с клиентской маршрутизацией — никаких дополнительных «SPA-библиотек» подключать не нужно, иначе сломается текущая навигация. Для возможности «добавить на главный экран» достаточно подключить **web app manifest** и набор иконок. Это стандартный механизм, который поддерживают iOS Safari и Android Chrome без сервис-воркера и без оффлайн-режима.

Оффлайн-работу (service worker, кеширование) в этой задаче **не делаем** — пользователь её не просил, а в чат-приложении с обращениями к ИИ/сети это лишнее и часто ломает обновления.

## План

1. **Сгенерировать иконки приложения** (PNG) и положить в `public/`:
   - `icon-192.png` (192×192)
   - `icon-512.png` (512×512)
   - `apple-touch-icon.png` (180×180) — для iOS-домашнего экрана
   - `favicon.png` (32×32)
   Стилистика — тёмный фон под текущую тему, символ «AI CARREP» (буква/логотип авто-отчёта).

2. **Создать `public/manifest.webmanifest`** со следующими полями:
   - `name`: «AI CARREP»
   - `short_name`: «CARREP»
   - `description`: краткое описание ассистента
   - `start_url`: `/`
   - `scope`: `/`
   - `display`: `standalone`
   - `orientation`: `portrait`
   - `background_color`: `#09090b` (под тёмную тему)
   - `theme_color`: `#09090b`
   - `lang`: `ru`
   - `icons`: ссылки на сгенерированные PNG с правильными `sizes`/`type`/`purpose: "any maskable"`.

3. **Подключить manifest и мета-теги в `src/routes/__root.tsx`** через массив `links` и `meta` в `head()`:
   - `<link rel="manifest" href="/manifest.webmanifest">`
   - `<link rel="icon" href="/favicon.png">`
   - `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`
   - `<meta name="theme-color" content="#09090b">`
   - `<meta name="apple-mobile-web-app-capable" content="yes">`
   - `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`
   - `<meta name="apple-mobile-web-app-title" content="CARREP">`
   - `<meta name="mobile-web-app-capable" content="yes">`

4. **Ничего не менять** в роутинге, в `src/router.tsx`, в `vite.config.ts`. Не подключаем `vite-plugin-pwa`, `workbox`, не создаём `sw.js` — это не нужно для ярлыка на главном экране и противопоказано в Lovable-превью.

## Что получит пользователь

- На Android Chrome появится предложение «Установить приложение» / возможность «Добавить на главный экран» → запуск в полноэкранном standalone-режиме с иконкой и названием «CARREP».
- На iPhone Safari: «Поделиться → На экран Домой» создаст ярлык с правильной иконкой и при запуске откроет приложение без адресной строки.
- Внешний вид и поведение текущего SPA не меняются.

## Технические детали

- Файлы манифеста и иконок размещаются в `public/` и попадают в сборку как статические ассеты по корневым путям.
- `display: standalone` и iOS-метатеги — обязательное условие, чтобы запуск с ярлыка шёл без браузерной обвязки.
- Сервис-воркер сознательно не добавляем (нет требования оффлайн; в Lovable preview SW запрещены правилами проекта).
