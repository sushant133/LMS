import { Router } from "express";
import { getTeacherAssignments } from "../controllers/teacherPortalController";
import { authorize, protect } from "../middleware/auth";
import { tenantGuard } from "../middleware/tenant";

const router = Router();

router.use(protect, tenantGuard, authorize("TEACHER"));
router.get("/scope", getTeacherAssignments);

export default router;