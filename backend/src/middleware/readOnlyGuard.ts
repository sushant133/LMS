import type { NextFunction, Request, Response } from "express";
import { isCollegeViewer, READ_ONLY_ACCESS_MESSAGE } from "@phit-erp/shared";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const SELF_SERVICE_PATHS: Array<{ method: string; pattern: RegExp }> = [
  { method: "POST", pattern: /^\/api\/auth\/logout$/ },
  { method: "PUT", pattern: /^\/api\/auth\/profile$/ },
  { method: "POST", pattern: /^\/api\/auth\/change-password$/ }
];

const isSelfServiceRequest = (req: Request): boolean =>
  SELF_SERVICE_PATHS.some((entry) => entry.method === req.method && entry.pattern.test(req.originalUrl));

/**
 * Blocks write operations for read-only College Administrator accounts.
 * Must run after `protect` so `req.user` is available.
 */
export const enforceInstitutionReadOnly = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.user || !isCollegeViewer(req.user.role)) {
    return next();
  }

  if (READ_METHODS.has(req.method) || isSelfServiceRequest(req)) {
    return next();
  }

  void recordAudit(req, {
    action: "readonly.unauthorized_write_attempt",
    entity: "Request",
    entityId: req.originalUrl,
    after: {
      method: req.method,
      path: req.originalUrl
    }
  });

  return next(new ApiError(403, READ_ONLY_ACCESS_MESSAGE));
};