import { Router } from "express";
import {
  getPromotion,
  getPromotionPreview,
  listPromotions,
  rollbackPromotion,
  runPromotion
} from "../controllers/academicPromotionController.js";
import { authorizeInstitutionAdmin, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);

// History / preview: institution admins and read-only college viewers (GET allowed via authorizeInstitutionAdmin)
router.get("/preview", authorizeInstitutionAdmin, getPromotionPreview);
router.get("/history", authorizeInstitutionAdmin, listPromotions);
router.get("/history/:id", authorizeInstitutionAdmin, getPromotion);

// Execute / rollback: Super Admin and Admin only (college viewers blocked on write by authorize + readOnlyGuard)
router.post("/execute", authorizeInstitutionAdmin, runPromotion);
router.post("/rollback", authorizeInstitutionAdmin, rollbackPromotion);

export default router;
