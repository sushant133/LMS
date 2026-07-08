import { Router } from "express";
import {
  createComplaint,
  deleteComplaint,
  getComplaint,
  listComplaints,
  updateComplaintStatus
} from "../controllers/complaintController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);

router.get("/", listComplaints);
router.get("/:id", getComplaint);
router.post("/", createComplaint);
router.patch("/:id/status", authorize("COLLEGE_ADMIN"), updateComplaintStatus);
router.delete("/:id", authorize("COLLEGE_ADMIN"), deleteComplaint);

export default router;