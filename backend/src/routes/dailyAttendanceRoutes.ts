import { Router } from "express";
import {
  deleteDailyAttendance,
  getDailyAttendanceById,
  getDailyAttendanceContext,
  getDailyAttendanceDashboard,
  getDailyAttendanceReports,
  listDailyAttendance,
  listDailyAttendanceAssignments,
  listDailyAttendanceLogs,
  submitDailyAttendance,
  unlockDailyAttendance,
  updateDailyAttendance
} from "../controllers/dailyAttendanceController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);

router.get("/assignments", listDailyAttendanceAssignments);
router.get("/dashboard", getDailyAttendanceDashboard);
router.get("/context", getDailyAttendanceContext);
router.get("/reports", getDailyAttendanceReports);
router.get("/", listDailyAttendance);
router.get("/:id/logs", listDailyAttendanceLogs);
router.get("/:id", getDailyAttendanceById);
router.post("/", authorize("TEACHER", "COLLEGE_ADMIN"), submitDailyAttendance);
router.put("/:id", authorize("COLLEGE_ADMIN"), updateDailyAttendance);
router.post("/:id/unlock", authorize("COLLEGE_ADMIN"), unlockDailyAttendance);
router.delete("/:id", authorize("SUPER_ADMIN"), deleteDailyAttendance);

export default router;