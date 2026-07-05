import { Router } from "express";
import { createLeaveRequest, createPayroll, listLeaveRequests, listPayroll, updateLeaveStatus, updatePayroll } from "../controllers/hrController.js";
import { authorize, authorizeInstitutionAdmin, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);
router.get("/leaves", listLeaveRequests);
router.post("/leaves", authorize("COLLEGE_ADMIN", "TEACHER"), createLeaveRequest);
router.put("/leaves/:id/status", authorizeInstitutionAdmin, updateLeaveStatus);
router.get("/payroll", listPayroll);
router.post("/payroll", authorizeInstitutionAdmin, createPayroll);
router.put("/payroll/:id", authorizeInstitutionAdmin, updatePayroll);

export default router;