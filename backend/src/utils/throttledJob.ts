/**
 * Run `job` at most once per `intervalMs` for a given key, sharing one in-flight
 * run between concurrent callers.
 *
 * For housekeeping sweeps that used to run on every page view (library/lab
 * overdue status + reminders). Those touch every active record in the college,
 * so a busy page fired hundreds of queries per request and starved the shared
 * connection pool. Statuses only change at day boundaries and reminders are
 * deduplicated, so sweeping a few times an hour is equivalent.
 */
const lastRunAt = new Map<string, number>();
const inFlight = new Map<string, Promise<void>>();

export const runThrottled = (key: string, intervalMs: number, job: () => Promise<void>): Promise<void> => {
  const running = inFlight.get(key);
  if (running) return running;

  const last = lastRunAt.get(key);
  if (last !== undefined && Date.now() - last < intervalMs) return Promise.resolve();

  const run = (async () => {
    try {
      await job();
      lastRunAt.set(key, Date.now());
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, run);
  return run;
};
