import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who is making the current request, available to deep helpers (file deletion) without
 * passing req through every call. Empty outside a request (scripts, scheduled jobs).
 */
export interface RequestContext {
  userId: string;
  role: string;
  /** The college the request acts for (set by tenantGuard; user's college until then). */
  schoolId: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithRequestContext = <T>(context: RequestContext, fn: () => T): T =>
  storage.run(context, fn);

export const getRequestContext = (): RequestContext | undefined => storage.getStore();
