import { Router } from "express";
import {
  activateDepartmentAccount,
  changeDepartmentAccountPassword,
  createDepartmentAccount,
  deactivateDepartmentAccount,
  deleteDepartmentAccount,
  listDepartmentAccounts,
  requireDepartmentAccountManager,
  updateDepartmentAccount
} from "../controllers/departmentAccountController.js";
import { protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

/** Settings → Department Accounts (Accounting / Examination / Academics logins). */
const router = Router();

router.use(protect, requireDepartmentAccountManager, tenantGuard);

router.get("/", listDepartmentAccounts);
router.post("/", createDepartmentAccount);
router.put("/:id", updateDepartmentAccount);
router.post("/:id/password", changeDepartmentAccountPassword);
router.post("/:id/activate", activateDepartmentAccount);
router.post("/:id/deactivate", deactivateDepartmentAccount);
router.delete("/:id", deleteDepartmentAccount);

export default router;
