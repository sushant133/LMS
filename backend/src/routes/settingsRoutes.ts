import { Router } from "express";
import { getSettings, updateSettings } from "../controllers/settingsController";
import { authorize, protect } from "../middleware/auth";
import { tenantGuard } from "../middleware/tenant";

const router = Router();

router.use(protect, tenantGuard);
router.get("/", getSettings);
router.put("/", authorize("SCHOOL_ADMIN"), updateSettings);

export default router;
