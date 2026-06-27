// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
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
        registerType: "autoUpdate",
        filename: "sw.js",
        // Use the manifest already shipped at public/manifest.webmanifest.
        manifest: false,
        devOptions: { enabled: false },
        workbox: {
          // Never serve HTML from cache — always go to network. This avoids
          // showing a stale page after deploy. No offline app shell.
          navigateFallback: null,
          navigationPreload: true,
          cleanupOutdatedCaches: true,
          // Do NOT skipWaiting/clientsClaim: keep the new SW in "waiting" so
          // the UI can prompt the user to reload into the new version.

          // Only precache hashed static assets emitted by Vite. Skip HTML and
          // the manifest so navigations stay network-first.
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
          ],
        },
      }),
    ],
  },
});
