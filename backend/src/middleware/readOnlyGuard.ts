import type { NextFunction, Request, Response } from "express";

/**
 * Historically blocked all writes for COLLEGE_VIEWER ("College Administrator")
 * with a global "You have read-only access." message.
 *
 * Write access is now controlled only by Module Access Control
 * (`moduleAccessGuard` + authorize module grants):
 * - WRITE on a module → may create/edit
 * - READ_ONLY → view only for that module
 * - NONE → module hidden / API denied
 *
 * Kept as a no-op so `protect()` call sites stay stable.
 */
export const enforceInstitutionReadOnly = (
  _req: Request,
  _res: Response,
  next: NextFunction
): void => {
  next();
};
