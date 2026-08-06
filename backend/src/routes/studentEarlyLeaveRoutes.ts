import { Router } from "express";
import {
  createStudentEarlyLeave,
  deleteStudentEarlyLeave,
  listEarlyLeavesForDate,
  listStudentEarlyLeaves,
  updateStudentEarlyLeave
} from "../controllers/studentEarlyLeaveController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

const earlyLeaveRoles = authorize(
  "SUPER_ADMIN",
  "COLLEGE_ADMIN",
  "COLLEGE_VIEWER",
  "TEACHER",
  "COLLEGE_STAFF",
  "PRINCIPAL",
  "ACCOUNTANT",
  "LIBRARY_STAFF",
  "LABORATORY_STAFF",
  "CASHIER",
  "AUDITOR"
);

router.use(protect, tenantGuard);

router.get("/", earlyLeaveRoles, listStudentEarlyLeaves);
router.get("/by-date", earlyLeaveRoles, listEarlyLeavesForDate);
router.post(
  "/",
  authorize(
    "SUPER_ADMIN",
    "COLLEGE_ADMIN",
    "TEACHER",
    "COLLEGE_STAFF",
    "PRINCIPAL"
  ),
  createStudentEarlyLeave
);
router.put(
  "/:id",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER", "COLLEGE_STAFF", "PRINCIPAL"),
  updateStudentEarlyLeave
);
router.delete(
  "/:id",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN"),
  deleteStudentEarlyLeave
);

export default router;
