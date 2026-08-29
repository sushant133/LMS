import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/apiError.js";

interface Bucket {
  count: number;
  resetAt: number;
  lockUntil?: number;
}

const buckets = new Map<string, Bucket>();

/** Soft ceiling: above this we sweep expired buckets on the next request. */
const PRUNE_THRESHOLD = 5000;
/** Hard ceiling: above this we also evict the oldest live buckets. */
const MAX_BUCKETS = 20000;

const prune = (now: number): void => {
  if (buckets.size < PRUNE_THRESHOLD) return;

  for (const [key, value] of buckets) {
    if (value.resetAt < now && (!value.lockUntil || value.lockUntil < now)) {
      buckets.delete(key);
    }
  }

  /**
   * Some bucket keys are attacker-chosen (the login limiter keys by submitted
   * login ID), so a scripted run with fresh IDs could grow this map without
   * bound between window rollovers. Once expired entries are gone and the map
   * is still oversized, drop the oldest live buckets — Map preserves insertion
   * order, and any bucket still holding a lockout is kept.
   */
  if (buckets.size <= MAX_BUCKETS) return;
  const excess = buckets.size - MAX_BUCKETS;
  let removed = 0;
  for (const [key, value] of buckets) {
    if (removed >= excess) break;
    if (value.lockUntil && value.lockUntil > now) continue;
    buckets.delete(key);
    removed += 1;
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
  /**
   * Refund the attempt when the request succeeds (< 400), so only *failures*
   * count towards the limit.
   *
   * Essential on login: a whole campus shares one public IP, so counting
   * successful sign-ins locked everyone out after the tenth person of the day
   * signed in normally.
   */
  countOnlyFailures?: boolean;
}

/**
 * Client IP for throttling.
 *
 * Never read X-Forwarded-For directly: the header is attacker-supplied, so
 * trusting it let anyone reset their own bucket on every request (send a new
 * fake IP each time) and completely bypass the login flood guard. Express
 * already derives `req.ip` from X-Forwarded-* using the configured
 * `trust proxy` hop count, which is the only trustworthy reading of it, and
 * ignores the header entirely when TRUST_PROXY is 0.
 */
const clientIp = (req: Request): string => req.ip || req.socket.remoteAddress || "unknown";

/**
 * In-memory rate limiter for sensitive auth routes.
 * Suitable for single-instance deployments; use Redis for multi-instance production scale.
 */
/** "in 3 minutes" / "in 45 seconds" — never a fixed number the user cannot trust. */
const waitPhrase = (ms: number): string => {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 90) return `${seconds} seconds`;
  return `${Math.ceil(seconds / 60)} minutes`;
};

export const rateLimit =
  (options: RateLimitOptions) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    prune(now);

    const identity = options.keyGenerator?.(req) ?? `${clientIp(req)}:${req.path}`;
    const key = `${options.name}:${identity}`;
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      // Carry an unexpired lock across the window roll — recreating the bucket
      // used to clear it, releasing a lockout early.
      const carriedLock =
        bucket?.lockUntil && bucket.lockUntil > now ? bucket.lockUntil : undefined;
      bucket = { count: 0, resetAt: now + options.windowMs, lockUntil: carriedLock };
      buckets.set(key, bucket);
    }

    if (bucket.lockUntil && bucket.lockUntil > now) {
      return next(
        new ApiError(
          429,
          `${options.message ?? "Too many attempts."} Try again in ${waitPhrase(bucket.lockUntil - now)}.`
        )
      );
    }

    bucket.count += 1;

    if (bucket.count > options.max) {
      if (options.lockMs && options.lockMs > 0) {
        bucket.lockUntil = now + options.lockMs;
      }
      const waitMs = bucket.lockUntil ? bucket.lockUntil - now : bucket.resetAt - now;
      return next(
        new ApiError(
          429,
          `${options.message ?? "Too many requests."} Try again in ${waitPhrase(waitMs)}.`
        )
      );
    }

    // Refund on success so only failed attempts accumulate.
    if (options.countOnlyFailures) {
      res.on("finish", () => {
        if (res.statusCode >= 400) return;
        const current = buckets.get(key);
        if (current) current.count = Math.max(0, current.count - 1);
      });
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
