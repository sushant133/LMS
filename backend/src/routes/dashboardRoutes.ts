import { Router } from "express";
import { getDashboard } from "../controllers/dashboardController";
import { protect } from "../middleware/auth";
import { tenantGuard } from "../middleware/tenant";

const router = Router();

router.get("/", protect, tenantGuard, getDashboard);

export default router;
