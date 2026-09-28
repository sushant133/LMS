import type { NextFunction, Request, Response } from "express";
import { canDepartmentAccessApi, DEPARTMENT_ACCOUNT_LABELS } from "@phit-erp/shared";
import { ApiError } from "../utils/apiError.js";
import { isModuleAccessBypassPath, resolveRequestPath } from "../utils/moduleAccessService.js";

/**
 * Department Accounts are Administrator logins confined to one department.
 * Regular accounts pass straight through, so nothing changes for them.
 * Must run after `protect` has attached req.user.
 */
export const enforceDepartmentAccountScope = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  const department = req.user?.departmentAccount;
  if (!department) return next();

  const path = resolveRequestPath(req.method, req.originalUrl, req.baseUrl, req.url, req.path);

  // Managing other users' permissions is institution administration, even though
  // the generic bypass list lets that path through for the module matrix.
  const managesOtherUser =
    /\/api\/users\/[^/]+\/module-access$/i.test(path) && !/\/api\/users\/me\//i.test(path);

  // Own session, profile, password, notifications, shared academic lists, GET settings
  if (!managesOtherUser && isModuleAccessBypassPath(req.method, path)) return next();

  if (canDepartmentAccessApi(department, req.method, path)) return next();

  return next(
    new ApiError(
      403,
      `This ${DEPARTMENT_ACCOUNT_LABELS[department]} account does not have access to this section.`
    )
  );
};
