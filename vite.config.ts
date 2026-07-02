// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  nitro: { preset: "node-server" },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      VitePWA({
        // We register the SW ourselves via a guarded wrapper (src/lib/pwa/register-sw.ts).
        injectRegister: null,
        // "prompt" — не включает skipWaiting/clientsClaim автоматически,
        // чтобы новый SW ждал в waiting и мы могли показать пользователю
        // диалог «Доступна новая версия».
        registerType: "prompt",
        filename: "sw.js",
        // Use the manifest already shipped at public/manifest.webmanifest.
        manifest: false,
        devOptions: { enabled: false },
        workbox: {
          // Явно выключаем — иначе новый SW сразу активируется и prompt никогда
          // не показывается пользователю.
          skipWaiting: false,
          clientsClaim: false,
          // HTML navigations are handled via NetworkFirst below so the app
          // can still open offline once it's been visited at least once.
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [/^\/api\//, /^\/~oauth/],
          navigationPreload: true,
          cleanupOutdatedCaches: true,
          globPatterns: ["**/*.{js,css,woff,woff2,png,svg,ico}"],
          globIgnores: ["**/index.html", "**/*.webmanifest", "**/sw.js", "**/workbox-*.js"],
          runtimeCaching: [
            {
              // Same-origin hashed JS/CSS chunks built by Vite (under /assets/).
              urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/assets/"),
              handler: "CacheFirst",
              options: {
                cacheName: "static-assets-v1",
                expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
            {
              // HTML navigations: try network first, fall back to cached shell.
              urlPattern: ({ request, url }) =>
                request.mode === "navigate" &&
                !url.pathname.startsWith("/api/") &&
                !url.pathname.startsWith("/~oauth"),
              handler: "NetworkFirst",
              options: {
                cacheName: "html-shell-v1",
                networkTimeoutSeconds: 5,
                expiration: { maxEntries: 10 },
              },
            },
          ],
        },
      }),
    ],
  },
});
