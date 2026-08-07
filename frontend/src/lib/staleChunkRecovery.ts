/**
 * Recovery from stale hashed chunks after a deploy.
 *
 * Every route is lazy-loaded, so a tab that was opened before a deploy keeps asking for
 * the previous build's `/assets/<name>-<hash>.js`. Those files are gone after the new
 * build, and the host answers unknown paths with index.html — the browser then reports
 * "Expected a JavaScript-or-Wasm module script but the server responded with a MIME type
 * of text/html" and the route never renders.
 *
 * The service worker makes this more likely: it calls skipWaiting()/clientsClaim(), so a
 * new worker takes control of the already-loaded old page and drops the old precache.
 *
 * Both cases are fixed by reloading once to fetch the current index.html. The
 * sessionStorage guard keeps a genuinely broken deploy from looping.
 */

const RELOAD_GUARD_KEY = "phit:stale-chunk-reload-at";
const RELOAD_COOLDOWN_MS = 30_000;

/**
 * Reload the tab at most once per cooldown window.
 *
 * Returns false when the guard suppressed the reload — the caller is then responsible
 * for rendering something the user can act on, because no reload is coming.
 */
export const reloadOnce = (): boolean => {
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_GUARD_KEY) ?? "0");
    if (Date.now() - last < RELOAD_COOLDOWN_MS) {
      return false;
    }
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // Private mode / storage disabled — a single reload attempt is still better than a blank screen
  }

  window.location.reload();
  return true;
};

const STALE_CHUNK_PATTERN =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|expected a javascript(-or-wasm)? module script|ChunkLoadError|Loading chunk \d+ failed|dynamically imported module/i;

const isStaleChunkError = (message: string): boolean => STALE_CHUNK_PATTERN.test(message);

/**
 * True when a thrown value is a failed code-split import rather than an app bug.
 *
 * React.lazy swallows the import rejection and re-throws it during render, so a stale
 * chunk reaches an error boundary as a normal render error. The boundary needs this to
 * tell "the deploy moved out from under us" (reload fixes it) apart from a real crash
 * (reloading would just crash again).
 */
export const isChunkLoadError = (error: unknown): boolean => {
  if (!error) return false;
  const candidate = error as { message?: unknown; name?: unknown };
  const message = typeof candidate.message === "string" ? candidate.message : String(error);
  const name = typeof candidate.name === "string" ? candidate.name : "";
  return isStaleChunkError(message) || isStaleChunkError(name);
};

/**
 * During `vite` dev, drop any leftover production/dev service workers.
 * A stale SW can keep controlling localhost and surface Chrome Issues like
 * "CSP blocks eval" or serve outdated shells after config changes.
 */
const unregisterServiceWorkersInDev = (): void => {
  if (!import.meta.env.DEV || !("serviceWorker" in navigator)) return;

  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      void registration.unregister();
    }
  });

  if ("caches" in window) {
    void caches.keys().then((keys) => {
      for (const key of keys) {
        // Only clear workbox / vite-plugin-pwa caches, not unrelated origin caches
        if (/workbox|precache|runtime|pwa|vite/i.test(key)) {
          void caches.delete(key);
        }
      }
    });
  }
};

export const installStaleChunkRecovery = (): void => {
  unregisterServiceWorkersInDev();

  // Vite fires this when a lazy route's chunk (or its preload) cannot be loaded.
  // preventDefault() makes Vite resolve the import with `undefined` instead of rejecting,
  // which only helps if a reload is actually coming — otherwise React renders `undefined`
  // as a component and dies with an unrelated "element type is invalid" message. So we
  // suppress the throw only when reloadOnce() really reloads; when the cooldown blocks it,
  // we let the rejection through so the error boundary can name the problem correctly.
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadOnce()) {
      event.preventDefault();
    }
  });

  window.addEventListener("error", (event) => {
    const target = event.target as HTMLElement | null;
    const isScriptTag = target instanceof HTMLScriptElement;
    if (isScriptTag || isStaleChunkError(String(event.message ?? ""))) {
      reloadOnce();
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as { message?: string } | string | undefined;
    const message = typeof reason === "string" ? reason : (reason?.message ?? "");
    if (isStaleChunkError(message)) {
      reloadOnce();
    }
  });

  // A new service worker took over this tab: its precache no longer holds our chunks.
  // Only an *update* matters — the first install of a worker claims an uncontrolled page
  // whose assets are still being served normally, so reloading there would be noise.
  // Skip in dev — we intentionally keep no SW there.
  if ("serviceWorker" in navigator && !import.meta.env.DEV) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController) {
        reloadOnce();
      }
    });
  }
};
