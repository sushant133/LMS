import { Router } from "express";
import { createLeaveRequest, createPayroll, listLeaveRequests, listPayroll, updateLeaveStatus, updatePayroll } from "../controllers/hrController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);
router.get("/leaves", listLeaveRequests);
router.post("/leaves", authorize("COLLEGE_ADMIN", "TEACHER"), createLeaveRequest);
router.put("/leaves/:id/status", authorize("COLLEGE_ADMIN"), updateLeaveStatus);
router.get("/payroll", listPayroll);
router.post("/payroll", authorize("COLLEGE_ADMIN"), createPayroll);
router.put("/payroll/:id", authorize("COLLEGE_ADMIN"), updatePayroll);

export default router;