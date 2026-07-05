import { Router } from "express";
import { getSettings, updateSettings } from "../controllers/settingsController.js";
import { authorizeInstitutionAdmin, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);
router.get("/", getSettings);
router.put("/", authorizeInstitutionAdmin, updateSettings);

export default router;
