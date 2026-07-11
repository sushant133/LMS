import { Router } from "express";
import {
  createFieldDutySchedule,
  deleteFieldDutySchedule,
  getChildFieldDutyAttendance,
  getFieldDutyAttendanceById,
  getFieldDutyDashboard,
  getFieldDutyReports,
  getFieldDutyRoster,
  getMyFieldDutyAttendance,
  getTodayFieldDutyContext,
  listFieldDutyAttendance,
  listFieldDutySchedules,
  submitFieldDutyAttendance,
  unlockFieldDutyAttendance,
  updateFieldDutyAttendance,
  updateFieldDutySchedule
} from "../controllers/fieldDutyController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);

// Portal (must be before :id routes)
router.get("/portal/me", authorize("STUDENT"), getMyFieldDutyAttendance);
router.get(
  "/portal/child/:studentId",
  authorize("PARENT", "SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER"),
  getChildFieldDutyAttendance
);

router.get("/dashboard", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER"), getFieldDutyDashboard);
router.get("/today", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER"), getTodayFieldDutyContext);
router.get("/reports", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER"), getFieldDutyReports);

router.get("/schedules", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER"), listFieldDutySchedules);
router.post("/schedules", authorize("SUPER_ADMIN", "COLLEGE_ADMIN"), createFieldDutySchedule);
router.put("/schedules/:id", authorize("SUPER_ADMIN", "COLLEGE_ADMIN"), updateFieldDutySchedule);
router.delete("/schedules/:id", authorize("SUPER_ADMIN", "COLLEGE_ADMIN"), deleteFieldDutySchedule);
router.get("/schedules/:id/roster", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER"), getFieldDutyRoster);

router.get("/attendance", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER"), listFieldDutyAttendance);
router.get("/attendance/:id", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER"), getFieldDutyAttendanceById);
router.post("/attendance", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER"), submitFieldDutyAttendance);
router.put("/attendance/:id", authorize("SUPER_ADMIN", "COLLEGE_ADMIN"), updateFieldDutyAttendance);
router.post("/attendance/:id/unlock", authorize("SUPER_ADMIN", "COLLEGE_ADMIN"), unlockFieldDutyAttendance);

export default router;
