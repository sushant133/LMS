import { Router } from "express";
import { createTimetableSlot, deleteTimetableSlot, listTimetable, updateTimetableSlot } from "../controllers/timetableController";
import { authorize, protect } from "../middleware/auth";
import { tenantGuard } from "../middleware/tenant";

const router = Router();

router.use(protect, tenantGuard);
router.get("/", listTimetable);
router.post("/", authorize("SCHOOL_ADMIN", "TEACHER"), createTimetableSlot);
router.put("/:id", authorize("SCHOOL_ADMIN", "TEACHER"), updateTimetableSlot);
router.delete("/:id", authorize("SCHOOL_ADMIN"), deleteTimetableSlot);

export default router;