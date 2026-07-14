import { Router } from "express";
import { resendCredentials } from "../controllers/credentialController.js";
import {
  getMyModuleAccess,
  getUserModuleAccess,
  listErpModules,
  previewPermissionPreset,
  putUserModuleAccess
} from "../controllers/moduleAccessController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);

/** Catalog of ERP modules for Module Access Control UI. */
router.get("/modules", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER", "LIBRARY_STAFF", "LABORATORY_STAFF", "ACCOUNTANT", "CASHIER", "COLLEGE_STAFF", "PRINCIPAL", "AUDITOR"), listErpModules);

/** Preset preview (Full Access / Read Only / No Access). */
router.get("/permission-presets/preview", authorize("SUPER_ADMIN", "COLLEGE_ADMIN"), previewPermissionPreset);

/** Current user's resolved module access (for client-side UI guards). */
router.get("/me/module-access", getMyModuleAccess);

/** Resend login credentials email for any ERP user (generates a new password). */
router.post(
  "/:userId/resend-credentials",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN"),
  resendCredentials
);

/** Per-user Department Access & Permission Management (admin). */
router.get("/:userId/module-access", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER"), getUserModuleAccess);
router.put("/:userId/module-access", authorize("SUPER_ADMIN", "COLLEGE_ADMIN"), putUserModuleAccess);

export default router;
