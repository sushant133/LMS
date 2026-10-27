/**
 * Traditional Attendance Register.
 * Reads are granted by module/role; cell edits are Administrator-only.
 */
import { Router } from "express";
import {
  getAttendanceRegisterCellDetail,
  getAttendanceRegisterMeta,
  getStaffAttendanceRegister,
  getStudentAttendanceRegister,
  getTeacherAttendanceRegister,
  updateAttendanceRegisterCell
} from "../controllers/attendanceRegisterController.js";
import { authorize, protect } from "../middleware/auth.js";
import { attachStudentAttendanceGrant } from "../utils/studentAttendanceAccess.js";

const router = Router();

// Load the "Student Attendance" grant once so controllers can honour it
router.use(protect, attachStudentAttendanceGrant);

router.get("/meta", getAttendanceRegisterMeta);
router.get("/students", getStudentAttendanceRegister);
router.get("/teachers", getTeacherAttendanceRegister);
router.get("/staff", getStaffAttendanceRegister);
router.get("/cell-detail", getAttendanceRegisterCellDetail);
router.put(
  "/cell",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN"),
  updateAttendanceRegisterCell
);

export default router;
