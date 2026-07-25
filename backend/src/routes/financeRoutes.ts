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
  listFinanceTransactions,
  updateFinanceCategory,
  updateFinanceTransaction
} from "../controllers/financeController.js";
import { protect } from "../middleware/auth.js";
import { ApiError } from "../utils/apiError.js";
import { tenantGuard } from "../middleware/tenant.js";

/**
 * Strict Admin / Superadmin only — no COLLEGE_VIEWER read-through, no staff module grants.
 * Future: intentionally open selected roles via product update.
 */
const requireFinanceAdmin = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.user) {
    return next(new ApiError(401, "Authentication required"));
  }
  const role = normalizeUserRole(req.user.role);
  if (role === "SUPER_ADMIN" || role === "COLLEGE_ADMIN") {
    return next();
  }
  return next(
    new ApiError(403, "Finance Management is available only to Administrator and System Administrator")
  );
};

const router = Router();

/** Finance Management: Admin & Superadmin only (independent of Accounting). */
router.use(protect, tenantGuard, requireFinanceAdmin);

router.get("/dashboard", getFinanceDashboard);
router.get("/report", getFinanceReport);

router.get("/categories", listFinanceCategories);
router.post("/categories", createFinanceCategory);
router.put("/categories/:id", updateFinanceCategory);
router.delete("/categories/:id", deleteFinanceCategory);

router.get("/transactions", listFinanceTransactions);
router.get("/transactions/:id", getFinanceTransaction);
router.post("/transactions", createFinanceTransaction);
router.put("/transactions/:id", updateFinanceTransaction);
router.delete("/transactions/:id", deleteFinanceTransaction);

export default router;
