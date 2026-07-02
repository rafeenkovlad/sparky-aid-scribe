import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "../components/ui/sonner";


function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" },
      { title: "AI CARREP" },
      { name: "description", content: "AI-powered app generates comprehensive technical car reports." },
      { name: "author", content: "Lovable" },
      { name: "theme-color", content: "#09090b" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "CARREP" },
      { name: "application-name", content: "CARREP" },
      { property: "og:title", content: "AI CARREP" },
      { property: "og:description", content: "AI-powered app generates comprehensive technical car reports." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "AI CARREP" },
      { name: "twitter:description", content: "AI-powered app generates comprehensive technical car reports." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/84f3f70a-cc72-41fb-916a-e8c717065fa5/id-preview-fd774eb0--c1a6e2b2-8859-4731-a1a9-6621e6865be6.lovable.app-1782463659924.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/84f3f70a-cc72-41fb-916a-e8c717065fa5/id-preview-fd774eb0--c1a6e2b2-8859-4731-a1a9-6621e6865be6.lovable.app-1782463659924.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const [pendingActivate, setPendingActivate] = useState<null | (() => Promise<void>)>(null);
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    void import("../lib/pwa/register-sw").then((m) =>
      m.registerServiceWorker((activate) => {
        // Оборачиваем в функцию-обёртку, иначе useState вызовет activate как updater.
        setPendingActivate(() => activate);
      }),
    );
  }, []);

  // Синхронизируем реальную видимую высоту (visualViewport) с CSS-переменной,
  // чтобы приложение и композер оставались над клавиатурой на iOS и не
  // оставляли пустой полосы снизу.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = document.documentElement;
    const vv = window.visualViewport;
    let raf = 0;
    let lastH = -1;
    let lastOffset = -1;
    let lastKbOpen = -1;
    const apply = () => {
      raf = 0;
      const h = Math.round(vv?.height ?? window.innerHeight);
      // На iOS visualViewport.offsetTop может быть дробным и «дышать» на
      // 1px при инерции — округляем и игнорируем микро-сдвиги, чтобы body
      // не подпрыгивал при каждом кадре скролла клавиатуры.
      const rawOffset = vv?.offsetTop ?? 0;
      const offsetTop = Math.max(0, Math.round(rawOffset));
      const winH = window.innerHeight;
      const keyboardBottom = vv ? Math.max(0, winH - h - offsetTop) : 0;
      const kbOpen = winH - h > 80 ? 1 : 0;

      if (h !== lastH) {
        root.style.setProperty("--app-h", `${h}px`);
        lastH = h;
      }
      if (offsetTop !== lastOffset) {
        root.style.setProperty("--vv-offset-top", `${offsetTop}px`);
        lastOffset = offsetTop;
      }
      root.style.setProperty("--keyboard-bottom", `${keyboardBottom}px`);
      if (kbOpen !== lastKbOpen) {
        root.style.setProperty("--kb-open", String(kbOpen));
        root.style.setProperty("--kb-open-inv", kbOpen ? "0" : "1");
        lastKbOpen = kbOpen;
      }

      // iOS иногда пытается «доскроллить» layout-viewport при фокусе поля,
      // хотя body у нас fixed. Если layout-скролл всё-таки уехал — вернём его
      // на место одним движением, а offsetTop компенсируем через CSS-переменную.
      if (window.scrollY !== 0 || window.scrollX !== 0) {
        window.scrollTo(0, 0);
      }
    };
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(apply);
    };
    apply();
    vv?.addEventListener("resize", schedule);
    vv?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      vv?.removeEventListener("resize", schedule);
      vv?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
    };
  }, []);


  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster position="bottom-center" />
      {pendingActivate && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-zinc-950/90 backdrop-blur-sm px-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-update-title"
        >
          <div className="w-full max-w-sm rounded-2xl bg-zinc-900 border border-white/10 p-6 text-center text-white shadow-2xl">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-orange-500/20 flex items-center justify-center text-2xl">
              ⟳
            </div>
            <h2 id="pwa-update-title" className="text-lg font-semibold">
              Доступна новая версия
            </h2>
            <p className="mt-2 text-sm text-white/70">
              Чтобы продолжить работу, обновите приложение до последней версии.
            </p>
            <button
              type="button"
              disabled={activating}
              onClick={() => {
                if (activating) return;
                setActivating(true);
                void pendingActivate().catch(() => {
                  setActivating(false);
                });
              }}
              className="mt-5 w-full rounded-full bg-orange-500 hover:bg-orange-600 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 transition-colors"
            >
              {activating ? "Обновление…" : "Обновить приложение"}
            </button>
          </div>
        </div>
      )}
    </QueryClientProvider>
  );
}


