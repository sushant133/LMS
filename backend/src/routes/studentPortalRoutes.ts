import { Router } from "express";
import {
  getMyFinancialHistory,
  getMyStudentProfile,
  getStudentSubjectDetail,
  listStudentSubjects
} from "../controllers/studentPortalController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard, authorize("STUDENT"));
router.get("/profile", getMyStudentProfile);
router.get("/subjects", listStudentSubjects);
router.get("/subjects/:subjectId", getStudentSubjectDetail);
router.get("/financial-history", getMyFinancialHistory);

export default router;