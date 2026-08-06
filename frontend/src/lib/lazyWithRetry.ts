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

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

// Mirrors React.lazy's own signature so any component shape can be wrapped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const lazyWithRetry = <T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) =>
  lazy(async () => {
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
