import { Router } from "express";
import {
  activateAdmin,
  createAdmin,
  deactivateAdmin,
  getAdmin,
  getAdminActivityLogs,
  impersonateAdmin,
  listAdmins,
  lockAdmin,
  resetAdminPassword,
  restoreAdmin,
  softDeleteAdmin,
  unlockAdmin,
  updateAdmin
} from "../controllers/adminManagementController.js";
import { protect, requireSystemAdministrator } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, requireSystemAdministrator, tenantGuard);

router.get("/", listAdmins);
router.post("/", createAdmin);
router.get("/:id", getAdmin);
router.put("/:id", updateAdmin);
router.post("/:id/activate", activateAdmin);
router.post("/:id/deactivate", deactivateAdmin);
router.post("/:id/lock", lockAdmin);
router.post("/:id/unlock", unlockAdmin);
router.post("/:id/reset-password", resetAdminPassword);
router.delete("/:id", softDeleteAdmin);
router.post("/:id/restore", restoreAdmin);
router.get("/:id/activity", getAdminActivityLogs);
router.post("/:id/impersonate", impersonateAdmin);

export default router;