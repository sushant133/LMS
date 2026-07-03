import { Router } from "express";
import {
  collectFee,
  createFeeStructure,
  deleteFeeCollection,
  deleteFeeStructure,
  listFeeCollections,
  listFeeStructures,
  updateFeeStructure
} from "../controllers/feeController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);

router.get("/structures", authorize("SUPER_ADMIN", "SCHOOL_ADMIN", "ACCOUNTANT"), listFeeStructures);
router.post("/structures", authorize("SUPER_ADMIN", "SCHOOL_ADMIN"), createFeeStructure);
router.put("/structures/:id", authorize("SUPER_ADMIN", "SCHOOL_ADMIN"), updateFeeStructure);
router.delete("/structures/:id", authorize("SUPER_ADMIN", "SCHOOL_ADMIN"), deleteFeeStructure);

router.get("/collections", authorize("SUPER_ADMIN", "SCHOOL_ADMIN", "ACCOUNTANT"), listFeeCollections);
router.post("/collections", authorize("SUPER_ADMIN", "SCHOOL_ADMIN", "ACCOUNTANT"), collectFee);
router.delete("/collections/:id", authorize("SUPER_ADMIN", "SCHOOL_ADMIN"), deleteFeeCollection);

export default router;
