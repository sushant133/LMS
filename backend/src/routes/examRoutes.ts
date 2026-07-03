import { Router } from "express";
import {
  createExam,
  deleteExam,
  getMarksheet,
  listExams,
  listResults,
  updateExam,
  upsertResult
} from "../controllers/examController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);

router.get("/", listExams);
router.post("/", authorize("SCHOOL_ADMIN"), createExam);
router.put("/:id", authorize("SCHOOL_ADMIN"), updateExam);
router.delete("/:id", authorize("SCHOOL_ADMIN"), deleteExam);

router.get("/results/all", listResults);
router.post("/results", authorize("TEACHER"), upsertResult);
router.get("/results/:examId/:studentId/marksheet", getMarksheet);

export default router;
