import { Router } from "express";
import { listAttendance, upsertAttendance } from "../controllers/attendanceController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

/** COLLEGE_VIEWER inherits GET when COLLEGE_ADMIN is listed. */
const attendanceReaders = authorize("COLLEGE_ADMIN", "TEACHER", "STUDENT", "PARENT");

router.use(protect, tenantGuard);
router.get("/", attendanceReaders, listAttendance);
router.post("/", authorize("TEACHER"), upsertAttendance);

export default router;
