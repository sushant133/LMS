import { Router } from "express";
import { getSettings, updateSettings } from "../controllers/settingsController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);
router.get("/", getSettings);
router.put("/", authorize("COLLEGE_ADMIN"), updateSettings);

export default router;
