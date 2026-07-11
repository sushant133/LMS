import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/apiError.js";
import { isOriginAllowed } from "../utils/allowedOrigins.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Cookie-based CSRF mitigation for browser clients:
 * reject state-changing requests whose Origin is not allowed.
 * Non-browser clients (no Origin) are allowed for tools/scripts.
 */
export const originCheck = (req: Request, _res: Response, next: NextFunction): void => {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  if (!origin) {
    return next();
  }

  if (!isOriginAllowed(origin)) {
    return next(
      new ApiError(
        403,
        `Request origin is not allowed (${origin}). Add it to CORS_ORIGINS in backend/.env and restart the backend.`
      )
    );
  }

  return next();
};
