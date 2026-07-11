import { Router } from "express";
import {
  createCollegeStaff,
  deleteCollegeStaff,
  getCollegeStaffById,
  getCollegeStaffReports,
  getMyCollegeStaffProfile,
  listCollegeStaff,
  resendCollegeStaffCredentials,
  resetCollegeStaffPassword,
  setCollegeStaffStatus,
  updateCollegeStaff
} from "../controllers/collegeStaffController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();
const admins = authorize("SUPER_ADMIN", "COLLEGE_ADMIN");
const staffSelf = authorize(
  "SUPER_ADMIN",
  "COLLEGE_ADMIN",
  "COLLEGE_STAFF",
  "ACCOUNTANT",
  "LIBRARY_STAFF",
  "LABORATORY_STAFF"
);

router.use(protect, tenantGuard);

router.get("/me", staffSelf, getMyCollegeStaffProfile);
router.get("/reports", admins, getCollegeStaffReports);
router.get("/", admins, listCollegeStaff);
router.get("/:id", admins, getCollegeStaffById);
router.post("/", admins, createCollegeStaff);
router.put("/:id", admins, updateCollegeStaff);
router.put("/:id/status", admins, setCollegeStaffStatus);
router.post("/:id/reset-password", admins, resetCollegeStaffPassword);
router.post("/:id/resend-credentials", admins, resendCollegeStaffCredentials);
router.delete("/:id", admins, deleteCollegeStaff);

export default router;
