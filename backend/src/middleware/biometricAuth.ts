import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { ApiError } from "../utils/apiError.js";

/**
 * Length-independent constant-time comparison.
 *
 * A plain `!==` on the shared device key leaks how many leading characters
 * matched through response timing, which is enough to recover the key one
 * character at a time. Both sides are hashed first so `timingSafeEqual` always
 * gets equal-length buffers and the length itself is not a side channel.
 */
const secretsMatch = (provided: string, expected: string): boolean => {
  const a = crypto.createHash("sha256").update(provided, "utf8").digest();
  const b = crypto.createHash("sha256").update(expected, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
};

/**
 * Device / integration auth for biometric punch ingest.
 * Accepts X-API-Key or Authorization: Bearer <key>.
 * Not used for browser sessions.
 */
export const biometricApiKeyAuth = (req: Request, _res: Response, next: NextFunction): void => {
  if (!env.BIOMETRIC_ATTENDANCE_ENABLED) {
    next(
      new ApiError(
        503,
        "Biometric attendance is disabled. Set BIOMETRIC_ATTENDANCE_ENABLED=true when devices are ready."
      )
    );
    return;
  }

  const expected = env.BIOMETRIC_API_KEY;
  if (!expected) {
    next(new ApiError(503, "BIOMETRIC_API_KEY is not configured on the server"));
    return;
  }

  const headerKey = typeof req.headers["x-api-key"] === "string" ? req.headers["x-api-key"] : "";
  const auth = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
  const bearer =
    auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";

  const provided = (headerKey || bearer).trim();
  if (!provided || !secretsMatch(provided, expected)) {
    next(new ApiError(401, "Invalid or missing biometric API key"));
    return;
  }

  next();
};
