import { Router } from "express";
import {
  bulkUpdateStaffPeriodTimes,
  createStaffTimetableSlot,
  deleteStaffTimetableSlot,
  listStaffTimetable,
  updateStaffTimetableSlot
} from "../controllers/staffTimetableController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);

/**
 * Staff read their own roster from the same list endpoint (filtered by staffId),
 * so viewing is open to the same roles that may view the academic timetable.
 * Writing is admin-only — a duty roster is set by the office, not self-served.
 */
router.get(
  "/",
  authorize(
    "SUPER_ADMIN",
    "COLLEGE_ADMIN",
    "COLLEGE_VIEWER",
    "PRINCIPAL",
    "TEACHER",
    "COLLEGE_STAFF",
    "LIBRARY_STAFF",
    "LABORATORY_STAFF",
    "ACCOUNTANT",
    "CASHIER",
    "AUDITOR"
  ),
  listStaffTimetable
);

const staffTimetableAdmins = authorize("COLLEGE_ADMIN", "SUPER_ADMIN");

router.post("/", staffTimetableAdmins, createStaffTimetableSlot);
router.put("/period-times", staffTimetableAdmins, bulkUpdateStaffPeriodTimes);
router.put("/:id", staffTimetableAdmins, updateStaffTimetableSlot);
router.delete("/:id", staffTimetableAdmins, deleteStaffTimetableSlot);

export default router;
