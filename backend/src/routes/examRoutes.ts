import { Router } from "express";
import {
  createExam,
  deleteExam,
  deleteResult,
  deleteResultMark,
  downloadMarksheetPdf,
  getExamAnalytics,
  getMarksheet,
  listExams,
  listResults,
  lockExamResults,
  publishExamResults,
  unpublishExamResults,
  unlockExamResults,
  updateExam,
  upsertResult
} from "../controllers/examController.js";
import {
  createExamRoutine,
  deleteExamRoutine,
  listExamRoutines,
  publishExamRoutine,
  unpublishExamRoutine,
  updateExamRoutine
} from "../controllers/examRoutineController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);

router.get("/", listExams);
router.post("/", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), createExam);
router.put("/:id", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), updateExam);
router.delete("/:id", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), deleteExam);

router.get("/routines", listExamRoutines);
router.post("/:examId/routines", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), createExamRoutine);
router.put("/:examId/routines/:routineId", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), updateExamRoutine);
router.delete("/:examId/routines/:routineId", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), deleteExamRoutine);
router.post("/:examId/routines/publish", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), publishExamRoutine);
router.post("/:examId/routines/unpublish", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), unpublishExamRoutine);

router.get("/results/all", listResults);
router.post("/results", authorize("TEACHER"), upsertResult);
router.delete("/results/:resultId", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), deleteResult);
router.delete("/results/:examId/:studentId/marks/:subjectId", authorize("COLLEGE_ADMIN", "SUPER_ADMIN", "TEACHER"), deleteResultMark);

router.post("/:examId/results/publish", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), publishExamResults);
router.post("/:examId/results/unpublish", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), unpublishExamResults);
router.post("/:examId/results/lock", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), lockExamResults);
router.post("/:examId/results/unlock", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), unlockExamResults);
router.get("/:examId/analytics", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), getExamAnalytics);

router.get("/results/:examId/:studentId/marksheet", getMarksheet);
router.get("/results/:examId/:studentId/marksheet/pdf", downloadMarksheetPdf);

export default router;