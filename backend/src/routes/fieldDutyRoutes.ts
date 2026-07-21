import { Router } from "express";
import {
  assignFieldCoordinators,
  assignFieldStudents,
  createFieldDutySchedule,
  deleteFieldDutySchedule,
  getChildFieldDutyAttendance,
  getFieldDutyAttendanceById,
  getFieldDutyDashboard,
  getFieldDutyMonitoring,
  getFieldDutyReports,
  getFieldDutyRegister,
  getFieldDutyRoster,
  getMyFieldDutyAttendance,
  getTodayFieldDutyContext,
  listAssignableStudents,
  listFieldDutyAttendance,
  listFieldDutySchedules,
  requestFieldAttendanceEdit,
  reviewFieldAttendanceEditRequest,
  submitFieldDutyAttendance,
  unlockFieldDutyAttendance,
  updateFieldDutyAttendance,
  updateFieldDutySchedule
} from "../controllers/fieldDutyController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

// tenantGuard sets req.tenantSchoolId — required by tenantObjectId() in controllers
router.use(protect, tenantGuard);

/**
 * Field coordinators are College Staff (linked via CollegeStaff.user).
 * Teachers use classroom attendance only — not field postings.
 */
const FIELD_READ = [
  "SUPER_ADMIN",
  "COLLEGE_ADMIN",
  "COLLEGE_VIEWER",
  "COLLEGE_STAFF"
] as const;

const FIELD_WRITE_ATTENDANCE = [
  "SUPER_ADMIN",
  "COLLEGE_ADMIN",
  "COLLEGE_STAFF"
] as const;

const FIELD_ADMIN = ["SUPER_ADMIN", "COLLEGE_ADMIN"] as const;

// Student / parent portals
router.get("/portal/me", authorize("STUDENT"), getMyFieldDutyAttendance);
router.get(
  "/portal/child/:studentId",
  authorize("PARENT", "SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER"),
  getChildFieldDutyAttendance
);

// Dashboard & monitoring
router.get("/dashboard", authorize(...FIELD_READ), getFieldDutyDashboard);
router.get("/monitoring", authorize(...FIELD_ADMIN, "COLLEGE_VIEWER"), getFieldDutyMonitoring);
router.get("/today", authorize(...FIELD_WRITE_ATTENDANCE, "COLLEGE_VIEWER"), getTodayFieldDutyContext);
router.get("/reports", authorize(...FIELD_READ), getFieldDutyReports);

// Candidate students for assignment
router.get("/assignable-students", authorize(...FIELD_ADMIN), listAssignableStudents);

// Postings (schedules)
router.get("/schedules", authorize(...FIELD_READ), listFieldDutySchedules);
router.post("/schedules", authorize(...FIELD_ADMIN), createFieldDutySchedule);
router.put("/schedules/:id", authorize(...FIELD_ADMIN), updateFieldDutySchedule);
router.delete("/schedules/:id", authorize(...FIELD_ADMIN), deleteFieldDutySchedule);
router.get("/schedules/:id/roster", authorize(...FIELD_READ), getFieldDutyRoster);
router.put("/schedules/:id/coordinators", authorize(...FIELD_ADMIN), assignFieldCoordinators);
router.put("/schedules/:id/students", authorize(...FIELD_ADMIN), assignFieldStudents);

// Attendance + manual-style register book
router.get("/register", authorize(...FIELD_READ), getFieldDutyRegister);
router.get("/attendance", authorize(...FIELD_READ), listFieldDutyAttendance);
router.get("/attendance/:id", authorize(...FIELD_READ), getFieldDutyAttendanceById);
router.post("/attendance", authorize(...FIELD_WRITE_ATTENDANCE), submitFieldDutyAttendance);
router.put("/attendance/:id", authorize(...FIELD_ADMIN), updateFieldDutyAttendance);
router.post("/attendance/:id/unlock", authorize(...FIELD_ADMIN), unlockFieldDutyAttendance);
router.post(
  "/attendance/:id/edit-request",
  authorize(...FIELD_WRITE_ATTENDANCE),
  requestFieldAttendanceEdit
);
router.post(
  "/attendance/:id/edit-review",
  authorize(...FIELD_ADMIN),
  reviewFieldAttendanceEditRequest
);

export default router;
