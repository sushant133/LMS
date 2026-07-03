import { Router } from "express";
import { createTimetableSlot, deleteTimetableSlot, listTimetable, updateTimetableSlot } from "../controllers/timetableController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);
router.get("/", listTimetable);
router.post("/", authorize("SCHOOL_ADMIN", "TEACHER"), createTimetableSlot);
router.put("/:id", authorize("SCHOOL_ADMIN", "TEACHER"), updateTimetableSlot);
router.delete("/:id", authorize("SCHOOL_ADMIN"), deleteTimetableSlot);

export default router;