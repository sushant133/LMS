import { Router } from "express";
import {
  activateCollegeAdministrator,
  createCollegeAdministrator,
  deactivateCollegeAdministrator,
  getCollegeAdministrator,
  getCollegeAdministratorActivityLogs,
  listCollegeAdministrators,
  resetCollegeAdministratorPassword,
  restoreCollegeAdministrator,
  softDeleteCollegeAdministrator,
  updateCollegeAdministrator
} from "../controllers/collegeAdministratorController.js";
import { authorizeInstitutionManager, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, authorizeInstitutionManager, tenantGuard);

router.get("/", listCollegeAdministrators);
router.post("/", createCollegeAdministrator);
router.get("/:id", getCollegeAdministrator);
router.put("/:id", updateCollegeAdministrator);
router.post("/:id/activate", activateCollegeAdministrator);
router.post("/:id/deactivate", deactivateCollegeAdministrator);
router.post("/:id/reset-password", resetCollegeAdministratorPassword);
router.delete("/:id", softDeleteCollegeAdministrator);
router.post("/:id/restore", restoreCollegeAdministrator);
router.get("/:id/activity", getCollegeAdministratorActivityLogs);

export default router;