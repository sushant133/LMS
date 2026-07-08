import { Router } from "express";
import { getDashboard, getDashboardFeeDues, sendFeeDueReminder } from "../controllers/dashboardController.js";
import { protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.get("/", protect, tenantGuard, getDashboard);
router.get("/fee-dues", protect, tenantGuard, getDashboardFeeDues);
router.post("/fee-dues/:studentId/remind", protect, tenantGuard, sendFeeDueReminder);

export default router;
