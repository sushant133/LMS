import type { NextFunction, Request, Response } from "express";
import {
  canAccessModule,
  canWriteModule,
  hasAccountingPermission,
  normalizeUserRole,
  type AccountingPermission
} from "@phit-erp/shared";
import { ApiError } from "../utils/apiError.js";
import {
  getUserModuleAccessMap,
  getUserSecondaryRoles
} from "../utils/moduleAccessService.js";

const isReadOnlyAccountingPermission = (permission: AccountingPermission): boolean =>
  permission === "read" || permission === "view_audit" || permission === "print_receipt";

const roleHasAnyPermission = (role: string, permissions: AccountingPermission[]): boolean =>
  permissions.some((permission) => hasAccountingPermission(role, permission));

/**
 * Gate accounting actions by role matrix, secondary finance roles, or Accounts
 * module grant (so staff with module-access-only finance rights still work).
 */
export const requireAccountingPermission =
  (...permissions: AccountingPermission[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new ApiError(401, "Authentication required"));
    }

    const role = normalizeUserRole(req.user.role);
    if (role === "SUPER_ADMIN" || role === "COLLEGE_ADMIN") {
      return next();
    }

    if (roleHasAnyPermission(role, permissions)) {
      return next();
    }

    void (async () => {
      try {
        const secondary = await getUserSecondaryRoles(req.user!.userId);
        if (secondary.some((secondaryRole) => roleHasAnyPermission(normalizeUserRole(secondaryRole), permissions))) {
          return next();
        }

        // COLLEGE_VIEWER alone is read-only; fall through only if secondary/module grant exists
        if (role === "COLLEGE_VIEWER") {
          const readOnlyAllowed = permissions.every(isReadOnlyAccountingPermission);
          if (readOnlyAllowed && roleHasAnyPermission(role, permissions)) {
            return next();
          }
          // Continue to module-grant check below (e.g. secondary ACCOUNTANT)
        }

        // Module Access Control: Accounts grant unlocks operational finance APIs
        const accessMap = await getUserModuleAccessMap(req.user!.userId);
        if (!canAccessModule(accessMap, "accounts")) {
          return next(new ApiError(403, "You do not have permission to perform this accounting action"));
        }

        const onlyRead = permissions.every(isReadOnlyAccountingPermission);
        if (onlyRead) {
          return next();
        }

        // WRITE accounts ≈ accountant operational permissions (not settings/COA admin)
        if (
          canWriteModule(accessMap, "accounts") &&
          permissions.every((permission) => hasAccountingPermission("ACCOUNTANT", permission))
        ) {
          return next();
        }

        return next(new ApiError(403, "You do not have permission to perform this accounting action"));
      } catch (error) {
        return next(error);
      }
    })();
  };