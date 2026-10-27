import { Router } from "express";
import { listAttendance, upsertAttendance } from "../controllers/attendanceController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";
import { attachStudentAttendanceGrant } from "../utils/studentAttendanceAccess.js";

const router = Router();

/** COLLEGE_VIEWER inherits GET when COLLEGE_ADMIN is listed. */
const attendanceReaders = authorize("COLLEGE_ADMIN", "TEACHER", "STUDENT", "PARENT");

// Load the "Student Attendance" grant once so controllers can honour it
router.use(protect, tenantGuard, attachStudentAttendanceGrant);
router.get("/", attendanceReaders, listAttendance);
router.post("/", authorize("TEACHER"), upsertAttendance);

export default router;
