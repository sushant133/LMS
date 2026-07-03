import { Router } from "express";
import { protect, authorize } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";
import {
  exportStudentMasterCsv,
  exportTeacherMasterCsv,
  exportInfrastructure,
  exportFlashII,
  exportEnrollmentSummary
} from "../controllers/exportController.js";

const router = Router();

router.use(protect);
router.use(tenantGuard);

// IEMIS / Government Compliance Exports (College Admin + Super Admin)
router.get("/iemis/student-master", authorize("SUPER_ADMIN", "COLLEGE_ADMIN"), exportStudentMasterCsv);
router.get("/iemis/teacher-master", authorize("SUPER_ADMIN", "COLLEGE_ADMIN"), exportTeacherMasterCsv);
router.get("/iemis/infrastructure", authorize("SUPER_ADMIN", "COLLEGE_ADMIN"), exportInfrastructure);
router.get("/iemis/flash-ii", authorize("SUPER_ADMIN", "COLLEGE_ADMIN"), exportFlashII);
router.get("/iemis/enrollment-summary", authorize("SUPER_ADMIN", "COLLEGE_ADMIN"), exportEnrollmentSummary);

export default router;
