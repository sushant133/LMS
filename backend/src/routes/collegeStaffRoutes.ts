import { Router } from "express";
import {
  createCollegeStaff,
  deleteCollegeStaff,
  listCollegeStaff,
  updateCollegeStaff
} from "../controllers/collegeStaffController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();
const admins = authorize("SUPER_ADMIN", "COLLEGE_ADMIN");

router.use(protect, tenantGuard);
router.get("/", admins, listCollegeStaff);
router.post("/", admins, createCollegeStaff);
router.put("/:id", admins, updateCollegeStaff);
router.delete("/:id", admins, deleteCollegeStaff);

export default router;