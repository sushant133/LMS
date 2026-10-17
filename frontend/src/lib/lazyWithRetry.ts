import { lazy, type ComponentType } from "react";
import { isChunkLoadError } from "lib/staleChunkRecovery";

/**
 * `React.lazy` that survives a failed chunk fetch.
 *
 * Two problems with plain `lazy(() => import(...))` here:
 *
 * 1. React caches the *rejected* promise. One flaky chunk request poisons that route for
 *    the rest of the session — navigating away and back re-throws the same rejection, so
 *    the section stays blank until a full page reload. Calling the factory again on each
 *    retry gives the import a genuine second chance.
 * 2. A single dropped request (spotty wifi, a backend restart, a service-worker swap
 *    mid-navigation) is usually transient. Retrying twice with a short backoff clears
 *    almost all of them without the user seeing anything.
 *
 * Errors that are not chunk-load failures are re-thrown immediately — those are real bugs
 * and retrying only delays the error boundary.
 */
const RETRY_DELAYS_MS = [350, 1200];

/** Every lazily loaded page, so they can be warmed up in the background. */
const routeChunkFactories = new Set<() => Promise<unknown>>();
let prefetchStarted = false;

/**
 * Download every page's code in the background once the app is idle, so the
 * first click on any section renders immediately instead of waiting for its
 * chunk. Chunks are content-hashed and cached by the browser / service worker,
 * so this costs one download per deploy. Runs one chunk at a time, pauses
 * between them, and is skipped on data-saver or 2G connections.
 */
export const prefetchRouteChunks = (): void => {
  if (prefetchStarted || typeof window === "undefined") return;
  prefetchStarted = true;

  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? "")) {
    return;
  }

  const whenIdle = (callback: () => void) => {
    const idle = (
      window as Window & {
        requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    if (idle) idle(callback, { timeout: 2000 });
    else window.setTimeout(callback, 300);
  };

  const queue = [...routeChunkFactories];
  const next = () => {
    const factory = queue.shift();
    if (!factory) return;
    factory()
      .catch(() => undefined) // a failed warm-up is harmless; the real click retries
      .finally(() => window.setTimeout(() => whenIdle(next), 150));
  };
  // Let the current page finish loading its own data first.
  window.setTimeout(() => whenIdle(next), 2500);
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

// Mirrors React.lazy's own signature so any component shape can be wrapped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const lazyWithRetry = <T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) => {
  routeChunkFactories.add(factory);
  return lazy(async () => {
    let lastError: unknown;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        return await factory();
      } catch (error) {
        lastError = error;

        // A genuine module-evaluation bug will fail identically every time.
        if (!isChunkLoadError(error)) {
          throw error;
        }

        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined) {
          break;
        }
        await sleep(delay);
      }
    }

    throw lastError;
  });
};
