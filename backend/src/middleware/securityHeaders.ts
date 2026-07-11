import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

/**
 * Baseline HTTP security headers for production readiness.
 * Does not break existing SPA + cookie-auth flows.
 */
export const securityHeaders = (_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader("X-Download-Options", "noopen");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
  );

  // Avoid caching authenticated API responses by default
  res.setHeader("Cache-Control", "no-store");

  if (env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    // Relaxed CSP for API JSON only — frontend hosts its own CSP if needed
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  }

  next();
};
