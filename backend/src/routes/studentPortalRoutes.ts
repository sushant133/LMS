import { Router } from "express";
import { getMyFinancialHistory, getStudentSubjectDetail, listStudentSubjects } from "../controllers/studentPortalController";
import { authorize, protect } from "../middleware/auth";
import { tenantGuard } from "../middleware/tenant";

const router = Router();

router.use(protect, tenantGuard, authorize("STUDENT"));
router.get("/subjects", listStudentSubjects);
router.get("/subjects/:subjectId", getStudentSubjectDetail);
router.get("/financial-history", getMyFinancialHistory);

export default router;