import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { normalizeUserRole } from "@phit-erp/shared";
import {
  createFinanceCategory,
  createFinanceTransaction,
  deleteFinanceCategory,
  deleteFinanceTransaction,
  getFinanceDashboard,
  getFinanceReport,
  getFinanceTransaction,
  listFinanceCategories,
  listFinanceStaffAccess,
  listFinanceTransactions,
  loadPersonalFinanceAccess,
  setFinanceStaffAccess,
  updateFinanceCategory,
  updateFinanceTransaction
} from "../controllers/financeController.js";
import { protect } from "../middleware/auth.js";
import { ApiError } from "../utils/apiError.js";
import { tenantGuard } from "../middleware/tenant.js";

/**
 * Finance Management access:
 * - SUPER_ADMIN / COLLEGE_ADMIN: full institution + all personal books
 * - COLLEGE_VIEWER: own College Administrator book
 * - Staff with personalFinanceAccess: own STAFF book (create + view only)
 */
const requireFinanceAccess = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    return next(new ApiError(401, "Authentication required"));
  }
  const role = normalizeUserRole(req.user.role);
  if (role === "SUPER_ADMIN" || role === "COLLEGE_ADMIN" || role === "COLLEGE_VIEWER") {
    return next();
  }

  void (async () => {
    try {
      const granted = await loadPersonalFinanceAccess(req.user?.userId);
      if (granted) return next();
      return next(
        new ApiError(
          403,
          "Finance Management is not enabled for your account. Contact Administrator."
        )
      );
    } catch (error) {
      return next(error);
    }
  })();
};

/** Category create/update/delete — institution admins only. */
const requireFinanceCategoryAdmin = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    return next(new ApiError(401, "Authentication required"));
  }
  const role = normalizeUserRole(req.user.role);
  if (role === "SUPER_ADMIN" || role === "COLLEGE_ADMIN") {
    return next();
  }
  return next(
    new ApiError(403, "Only Administrator can manage finance categories")
  );
};

/** Staff access panel — Admin / Superadmin only. */
const requireFinanceInstitutionAdmin = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    return next(new ApiError(401, "Authentication required"));
  }
  const role = normalizeUserRole(req.user.role);
  if (role === "SUPER_ADMIN" || role === "COLLEGE_ADMIN") {
    return next();
  }
  return next(
    new ApiError(403, "Only Administrator can manage staff finance access")
  );
};

const router = Router();

router.use(protect, tenantGuard, requireFinanceAccess);

router.get("/dashboard", getFinanceDashboard);
router.get("/report", getFinanceReport);

router.get("/categories", listFinanceCategories);
router.post("/categories", requireFinanceCategoryAdmin, createFinanceCategory);
router.put("/categories/:id", requireFinanceCategoryAdmin, updateFinanceCategory);
router.delete("/categories/:id", requireFinanceCategoryAdmin, deleteFinanceCategory);

router.get(
  "/staff-access",
  requireFinanceInstitutionAdmin,
  listFinanceStaffAccess
);
router.put(
  "/staff-access/:userId",
  requireFinanceInstitutionAdmin,
  setFinanceStaffAccess
);

router.get("/transactions", listFinanceTransactions);
router.get("/transactions/:id", getFinanceTransaction);
router.post("/transactions", createFinanceTransaction);
router.put("/transactions/:id", updateFinanceTransaction);
router.delete("/transactions/:id", deleteFinanceTransaction);

export default router;
