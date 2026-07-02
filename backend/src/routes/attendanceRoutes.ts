import { Router } from "express";
import { listAttendance, upsertAttendance } from "../controllers/attendanceController";
import { authorize, protect } from "../middleware/auth";
import { tenantGuard } from "../middleware/tenant";

const router = Router();

router.use(protect, tenantGuard);
router.get("/", listAttendance);
router.post("/", authorize("TEACHER"), upsertAttendance);

export default router;
