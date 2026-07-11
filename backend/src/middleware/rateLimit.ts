import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/apiError.js";

interface Bucket {
  count: number;
  resetAt: number;
  lockUntil?: number;
}

const buckets = new Map<string, Bucket>();

const prune = (now: number): void => {
  if (buckets.size < 5000) return;
  for (const [key, value] of buckets) {
    if (value.resetAt < now && (!value.lockUntil || value.lockUntil < now)) {
      buckets.delete(key);
    }
  }
};

export interface RateLimitOptions {
  /** Unique name for this limiter (e.g. login). */
  name: string;
  /** Max attempts within the window. */
  max: number;
  /** Window length in ms. */
  windowMs: number;
  /** Optional lockout after max exceeded (ms). */
  lockMs?: number;
  /** Build key from request (default IP + path). */
  keyGenerator?: (req: Request) => string;
  message?: string;
}

const clientIp = (req: Request): string => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]!.trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
};

/**
 * In-memory rate limiter for sensitive auth routes.
 * Suitable for single-instance deployments; use Redis for multi-instance production scale.
 */
export const rateLimit =
  (options: RateLimitOptions) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const now = Date.now();
    prune(now);

    const identity = options.keyGenerator?.(req) ?? `${clientIp(req)}:${req.path}`;
    const key = `${options.name}:${identity}`;
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }

    if (bucket.lockUntil && bucket.lockUntil > now) {
      const seconds = Math.ceil((bucket.lockUntil - now) / 1000);
      return next(
        new ApiError(
          429,
          options.message ?? `Too many attempts. Try again in ${seconds} seconds.`
        )
      );
    }

    bucket.count += 1;

    if (bucket.count > options.max) {
      if (options.lockMs && options.lockMs > 0) {
        bucket.lockUntil = now + options.lockMs;
      }
      return next(
        new ApiError(
          429,
          options.message ?? "Too many requests. Please try again later."
        )
      );
    }

    return next();
  };

/** Record an explicit failed auth attempt (optional extra weight). */
export const penalizeRateLimit = (name: string, req: Request, weight = 1): void => {
  const key = `${name}:${clientIp(req)}:${req.path}`;
  const now = Date.now();
  const bucket = buckets.get(key) ?? { count: 0, resetAt: now + 15 * 60 * 1000 };
  bucket.count += weight;
  buckets.set(key, bucket);
};
