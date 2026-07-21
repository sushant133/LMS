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
  updateEmployeeAttendance
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
  "TEACHER"
] as const;

const WRITE = ["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_STAFF", "TEACHER"] as const;

// Self-service portal (any authenticated teacher/staff)
router.get("/me", authorize(...READ), getMyEmployeeAttendance);
router.get("/permissions", authorize(...READ), getEmployeeAttendancePermissions);

router.get("/dashboard", authorize(...READ), getEmployeeAttendanceDashboard);
router.get("/context", authorize(...READ), getEmployeeAttendanceMarkContext);
router.get("/register", authorize(...READ), getEmployeeAttendanceRegister);
router.get("/", authorize(...READ), listEmployeeAttendance);
router.get("/:id", authorize(...READ), getEmployeeAttendanceById);

router.post("/", authorize(...WRITE), submitEmployeeAttendance);
router.put("/:id", authorize(...WRITE), updateEmployeeAttendance);
router.post("/:id/unlock", authorize(...WRITE), unlockEmployeeAttendance);
router.delete("/:id", authorize(...WRITE), deleteEmployeeAttendance);

export default router;
