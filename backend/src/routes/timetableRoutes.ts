import { Router } from "express";
import { createTimetableSlot, deleteTimetableSlot, listTimetable, updateTimetableSlot } from "../controllers/timetableController.js";
import { authorize, authorizeInstitutionAdmin, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);
router.get(
  "/",
  authorize(
    "SUPER_ADMIN",
    "COLLEGE_ADMIN",
    "COLLEGE_VIEWER",
    "TEACHER",
    "STUDENT",
    "PRINCIPAL",
    "PARENT",
    "COLLEGE_STAFF",
    "LIBRARY_STAFF",
    "LABORATORY_STAFF",
    "ACCOUNTANT"
  ),
  listTimetable
);
router.post("/", authorize("COLLEGE_ADMIN", "SUPER_ADMIN", "TEACHER"), createTimetableSlot);
router.put("/:id", authorize("COLLEGE_ADMIN", "SUPER_ADMIN", "TEACHER"), updateTimetableSlot);
// Admin may delete any slot; teachers delete only own (enforced in controller)
router.delete(
  "/:id",
  authorize("COLLEGE_ADMIN", "SUPER_ADMIN", "TEACHER"),
  deleteTimetableSlot
);

export default router;