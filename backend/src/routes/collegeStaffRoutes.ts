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
import {
  addCollegeStaffDocument,
  deleteCollegeStaffDocument,
  getCollegeStaffProfile,
  replaceCollegeStaffDocument,
  setCollegeStaffPhoto
} from "../controllers/collegeStaffDocumentController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();
const admins = authorize("SUPER_ADMIN", "COLLEGE_ADMIN");
const profileReaders = authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER");
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

// Profile + documents (before bare /:id)
router.get("/:id/profile", profileReaders, getCollegeStaffProfile);
router.put("/:id/photo", admins, setCollegeStaffPhoto);
router.post("/:id/documents", admins, addCollegeStaffDocument);
router.put("/:id/documents/replace", admins, replaceCollegeStaffDocument);
router.delete("/:id/documents/:documentId", admins, deleteCollegeStaffDocument);

router.get("/:id", admins, getCollegeStaffById);
router.post("/", admins, createCollegeStaff);
router.put("/:id", admins, updateCollegeStaff);
router.put("/:id/status", admins, setCollegeStaffStatus);
router.post("/:id/reset-password", admins, resetCollegeStaffPassword);
router.post("/:id/resend-credentials", admins, resendCollegeStaffCredentials);
router.delete("/:id", admins, deleteCollegeStaff);

export default router;
