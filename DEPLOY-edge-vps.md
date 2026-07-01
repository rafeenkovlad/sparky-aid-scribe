# Деплой на edge-vps

Приложение — TanStack Start + Nitro (`node-server`), не чистая статика в `dist/`.

- Сборка: `NITRO_PRESET=node-server` (задано в `vite.config.ts` и в Docker).
- На edge-vps образ запускает `node .output/server/index.mjs` (порт 3000).
- Нужны runtime-переменные для `/api/transcribe`: `LOVABLE_API_KEY` (и при необходимости ключи для web-search).

Клон на VPS (если каталог пуст):

```sh
git clone https://github.com/rafeenkovlad/sparky-aid-scribe.git pages/vindiezel-ai-asistent-pwa
```

Обновление: `git pull` в каталоге, затем `make build-vindiezel` в корне edge-vps.

`nginx.conf` в корне — справочник для будущего static-only билда.