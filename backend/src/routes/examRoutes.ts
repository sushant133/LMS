import { Router } from "express";
import {
  adminUpsertResult,
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
  approveResultSubmission,
  getResultAuditLog,
  getSubmissionByScope,
  listResultSubmissions,
  returnResultSubmission,
  submitResultForReview
} from "../controllers/resultSubmissionController.js";
import {
  exportPrintResultsCsv,
  getPrintResultsGrid,
  listPublishedExams
} from "../controllers/printResultsController.js";
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

/** COLLEGE_VIEWER inherits GET when COLLEGE_ADMIN is listed. */
const examReaders = authorize("COLLEGE_ADMIN", "TEACHER", "STUDENT", "PARENT");
const resultReaders = authorize("COLLEGE_ADMIN", "TEACHER", "STUDENT", "PARENT");
const submissionReaders = authorize("COLLEGE_ADMIN", "TEACHER");

router.use(protect, tenantGuard);

router.get("/", examReaders, listExams);
router.post("/", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), createExam);
router.put("/:id", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), updateExam);
router.delete("/:id", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), deleteExam);

router.get("/routines", examReaders, listExamRoutines);
router.post("/:examId/routines", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), createExamRoutine);
router.put("/:examId/routines/:routineId", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), updateExamRoutine);
router.delete("/:examId/routines/:routineId", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), deleteExamRoutine);
router.post("/:examId/routines/publish", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), publishExamRoutine);
router.post("/:examId/routines/unpublish", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), unpublishExamRoutine);

router.get("/results/published/exams", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), listPublishedExams);
router.get("/results/published/grid", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), getPrintResultsGrid);
router.get("/results/published/export", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), exportPrintResultsCsv);

router.get("/results/all", resultReaders, listResults);
router.post("/results", authorize("TEACHER"), upsertResult);
router.post("/results/admin", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), adminUpsertResult);
router.delete("/results/:resultId", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), deleteResult);
router.delete("/results/:examId/:studentId/marks/:subjectId", authorize("COLLEGE_ADMIN", "SUPER_ADMIN", "TEACHER"), deleteResultMark);

router.get("/result-submissions", submissionReaders, listResultSubmissions);
router.get("/result-submissions/scope", submissionReaders, getSubmissionByScope);
router.get("/result-submissions/audit-log", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), getResultAuditLog);
router.post("/result-submissions/submit", authorize("TEACHER"), submitResultForReview);
router.post("/result-submissions/:submissionId/approve", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), approveResultSubmission);
router.post("/result-submissions/:submissionId/return", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), returnResultSubmission);
router.post("/result-submissions/:submissionId/reject", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), returnResultSubmission);

router.post("/:examId/results/publish", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), publishExamResults);
router.post("/:examId/results/unpublish", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), unpublishExamResults);
router.post("/:examId/results/lock", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), lockExamResults);
router.post("/:examId/results/unlock", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), unlockExamResults);
router.get("/:examId/analytics", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), getExamAnalytics);

router.get("/results/:examId/:studentId/marksheet", resultReaders, getMarksheet);
router.get("/results/:examId/:studentId/marksheet/pdf", resultReaders, downloadMarksheetPdf);

export default router;