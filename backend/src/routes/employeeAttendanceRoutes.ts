import { Router } from "express";
import {
  deleteEmployeeAttendance,
  getEmployeeAttendanceById,
  getEmployeeAttendanceDashboard,
  getEmployeeAttendanceMarkContext,
  getEmployeeAttendancePermissions,
  getEmployeeAttendanceRegister,
  getMyEmployeeAttendance,
  listEmployeeAttendance,
  submitEmployeeAttendance,
  unlockEmployeeAttendance,
  updateEmployeeAttendance,
  upsertEmployeeAttendanceEntry
} from "../controllers/employeeAttendanceController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);

const READ = [
  "SUPER_ADMIN",
  "COLLEGE_ADMIN",
  "COLLEGE_VIEWER",
  "COLLEGE_STAFF",
  "TEACHER",
  // Specialist staff with CollegeStaff (or Accountant) HR profiles
  "LIBRARY_STAFF",
  "LABORATORY_STAFF",
  "ACCOUNTANT",
  "CASHIER",
  "AUDITOR",
  "PRINCIPAL"
] as const;

const WRITE = [
  "SUPER_ADMIN",
  "COLLEGE_ADMIN",
  "COLLEGE_STAFF",
  "TEACHER",
  "LIBRARY_STAFF",
  "LABORATORY_STAFF",
  "ACCOUNTANT",
  "CASHIER",
  "AUDITOR",
  "PRINCIPAL"
] as const;

/** Self-service: any employee role that can have a Teacher / CollegeStaff / Accountant link */
const SELF_SERVICE = [
  "SUPER_ADMIN",
  "COLLEGE_ADMIN",
  "COLLEGE_VIEWER",
  "COLLEGE_STAFF",
  "TEACHER",
  "LIBRARY_STAFF",
  "LABORATORY_STAFF",
  "ACCOUNTANT",
  "CASHIER",
  "AUDITOR",
  "PRINCIPAL"
] as const;

// Self-service portal (linked teacher / staff / specialist profiles)
router.get("/me", authorize(...SELF_SERVICE), getMyEmployeeAttendance);
router.get("/permissions", authorize(...SELF_SERVICE), getEmployeeAttendancePermissions);

router.get("/dashboard", authorize(...READ), getEmployeeAttendanceDashboard);
router.get("/context", authorize(...READ), getEmployeeAttendanceMarkContext);
router.get("/register", authorize(...READ), getEmployeeAttendanceRegister);
router.get("/", authorize(...READ), listEmployeeAttendance);
router.get("/:id", authorize(...READ), getEmployeeAttendanceById);

router.post("/", authorize(...WRITE), submitEmployeeAttendance);
/** Save one employee's check-in / check-out on its own (no phase change). */
router.post("/entry", authorize(...WRITE), upsertEmployeeAttendanceEntry);
router.put("/:id", authorize(...WRITE), updateEmployeeAttendance);
router.post("/:id/unlock", authorize(...WRITE), unlockEmployeeAttendance);
/** Delete day sheet: Super Admin / College Admin only */
router.delete(
  "/:id",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN"),
  deleteEmployeeAttendance
);

export default router;
