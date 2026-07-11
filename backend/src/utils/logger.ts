import { env } from "../config/env.js";

type LogLevel = "error" | "warn" | "info" | "debug";

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const shouldLog = (level: LogLevel): boolean =>
  LEVEL_ORDER[level] <= LEVEL_ORDER[env.LOG_LEVEL];

/** Safe production logger — never dumps secrets; skips verbose noise in production. */
export const logger = {
  error: (message: string, meta?: unknown): void => {
    if (!shouldLog("error")) return;
    if (meta !== undefined && env.NODE_ENV !== "production") {
      console.error(`[error] ${message}`, meta);
      return;
    }
    console.error(`[error] ${message}`);
  },
  warn: (message: string, meta?: unknown): void => {
    if (!shouldLog("warn")) return;
    if (meta !== undefined && env.NODE_ENV !== "production") {
      console.warn(`[warn] ${message}`, meta);
      return;
    }
    console.warn(`[warn] ${message}`);
  },
  info: (message: string): void => {
    if (!shouldLog("info")) return;
    console.log(`[info] ${message}`);
  },
  debug: (message: string, meta?: unknown): void => {
    if (!shouldLog("debug")) return;
    if (meta !== undefined) {
      console.log(`[debug] ${message}`, meta);
      return;
    }
    console.log(`[debug] ${message}`);
  }
};
