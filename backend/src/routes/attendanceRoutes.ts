import { Router } from "express";
import { listAttendance, upsertAttendance } from "../controllers/attendanceController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);
router.get("/", listAttendance);
router.post("/", authorize("TEACHER"), upsertAttendance);

export default router;
