import { Router } from "express";
import { getDashboard } from "../controllers/dashboardController.js";
import { protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.get("/", protect, tenantGuard, getDashboard);

export default router;
