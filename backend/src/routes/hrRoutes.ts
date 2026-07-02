import { Router } from "express";
import { createLeaveRequest, createPayroll, listLeaveRequests, listPayroll, updateLeaveStatus, updatePayroll } from "../controllers/hrController";
import { authorize, protect } from "../middleware/auth";
import { tenantGuard } from "../middleware/tenant";

const router = Router();

router.use(protect, tenantGuard);
router.get("/leaves", listLeaveRequests);
router.post("/leaves", authorize("SCHOOL_ADMIN", "TEACHER"), createLeaveRequest);
router.put("/leaves/:id/status", authorize("SCHOOL_ADMIN"), updateLeaveStatus);
router.get("/payroll", listPayroll);
router.post("/payroll", authorize("SCHOOL_ADMIN"), createPayroll);
router.put("/payroll/:id", authorize("SCHOOL_ADMIN"), updatePayroll);

export default router;