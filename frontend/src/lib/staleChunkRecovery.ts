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

const reloadOnce = (): void => {
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_GUARD_KEY) ?? "0");
    if (Date.now() - last < RELOAD_COOLDOWN_MS) {
      return;
    }
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // Private mode / storage disabled — a single reload attempt is still better than a blank screen
  }

  window.location.reload();
};

const isStaleChunkError = (message: string): boolean =>
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|expected a javascript(-or-wasm)? module script/i.test(
    message
  );

export const installStaleChunkRecovery = (): void => {
  // Vite fires this when a lazy route's chunk (or its preload) cannot be loaded
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reloadOnce();
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
  if ("serviceWorker" in navigator) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController) {
        reloadOnce();
      }
    });
  }
};
