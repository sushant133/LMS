import { Router } from "express";
import {
  getTeacherAssignments,
  getTeacherLabAccess
} from "../controllers/teacherPortalController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard, authorize("TEACHER"));
router.get("/scope", getTeacherAssignments);
router.get("/lab-access", getTeacherLabAccess);

export default router;