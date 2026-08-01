/**
 * Traditional Attendance Register — read-only routes.
 * Does not alter existing attendance marking APIs.
 */
import { Router } from "express";
import {
  getAttendanceRegisterCellDetail,
  getAttendanceRegisterMeta,
  getStaffAttendanceRegister,
  getStudentAttendanceRegister,
  getTeacherAttendanceRegister
} from "../controllers/attendanceRegisterController.js";
import { protect } from "../middleware/auth.js";

const router = Router();

router.use(protect);

router.get("/meta", getAttendanceRegisterMeta);
router.get("/students", getStudentAttendanceRegister);
router.get("/teachers", getTeacherAttendanceRegister);
router.get("/staff", getStaffAttendanceRegister);
router.get("/cell-detail", getAttendanceRegisterCellDetail);

export default router;
