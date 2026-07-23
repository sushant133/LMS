import { Router } from "express";
import {
  addComment,
  approveLessonPlan,
  approveSessionPlan,
  approveSyllabus,
  createLessonPlan,
  createLogBookEntry,
  createSessionPlan,
  createSyllabus,
  deleteLessonPlan,
  deleteLogBookEntry,
  deleteSessionPlan,
  deleteSyllabus,
  exportAcademicReport,
  getAcademicDashboard,
  getAcademicReport,
  getSessionAttendance,
  getSessionPlan,
  getSyllabus,
  getSyllabusCoverage,
  getTodayTimetableSlots,
  listComments,
  listLessonPlans,
  listLogBookEntries,
  listSessionPlans,
  listSessionPlanUnits,
  listSyllabi,
  rejectLessonPlan,
  rejectSessionPlan,
  rejectSyllabus,
  reviewLogBookEntry,
  submitLessonPlan,
  submitSessionPlan,
  submitSyllabus,
  unlockLessonPlan,
  unlockSessionPlan,
  unlockSyllabus,
  updateLessonPlan,
  updateLogBookEntry,
  updateSessionPlan,
  updateSyllabus,
  updateSyllabusSubUnitProgress,
  reorderSyllabusHierarchy
} from "../controllers/academicManagementController.js";
import { authorize, authorizeInstitutionAdmin, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);

router.get("/dashboard", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER"), getAcademicDashboard);

router.get("/syllabi", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER"), listSyllabi);
router.get("/syllabi/:id", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER"), getSyllabus);
// Syllabus structure is admin-only; teachers view + progress only
router.post("/syllabi", authorize("SUPER_ADMIN", "COLLEGE_ADMIN"), createSyllabus);
router.put("/syllabi/:id", authorize("SUPER_ADMIN", "COLLEGE_ADMIN"), updateSyllabus);
router.delete("/syllabi/:id", authorize("SUPER_ADMIN", "COLLEGE_ADMIN"), deleteSyllabus);
router.post("/syllabi/:id/submit", authorize("SUPER_ADMIN", "COLLEGE_ADMIN"), submitSyllabus);
router.post("/syllabi/:id/approve", authorizeInstitutionAdmin, approveSyllabus);
router.post("/syllabi/:id/reject", authorizeInstitutionAdmin, rejectSyllabus);
router.post("/syllabi/:id/unlock", authorizeInstitutionAdmin, unlockSyllabus);
router.patch(
  "/syllabi/:id/sub-units/:subUnitId/progress",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER"),
  updateSyllabusSubUnitProgress
);
router.post(
  "/syllabi/:id/reorder",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN"),
  reorderSyllabusHierarchy
);

router.get("/session-plans", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER"), listSessionPlans);
router.get("/session-plans/:id", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER"), getSessionPlan);
router.post("/session-plans", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER"), createSessionPlan);
router.put("/session-plans/:id", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER"), updateSessionPlan);
router.delete("/session-plans/:id", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER"), deleteSessionPlan);
router.post("/session-plans/:id/submit", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER"), submitSessionPlan);
router.post("/session-plans/:id/approve", authorizeInstitutionAdmin, approveSessionPlan);
router.post("/session-plans/:id/reject", authorizeInstitutionAdmin, rejectSessionPlan);
router.post("/session-plans/:id/unlock", authorizeInstitutionAdmin, unlockSessionPlan);
router.get("/session-plan-units", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER"), listSessionPlanUnits);
router.get("/syllabus-coverage", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER"), getSyllabusCoverage);
router.get(
  "/session-plans/:sessionPlanId/coverage",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER"),
  getSyllabusCoverage
);

router.get("/lesson-plans", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER"), listLessonPlans);
router.post("/lesson-plans", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER"), createLessonPlan);
router.put("/lesson-plans/:id", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER"), updateLessonPlan);
router.delete("/lesson-plans/:id", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER"), deleteLessonPlan);
router.post("/lesson-plans/:id/submit", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER"), submitLessonPlan);
router.post("/lesson-plans/:id/approve", authorizeInstitutionAdmin, approveLessonPlan);
router.post("/lesson-plans/:id/reject", authorizeInstitutionAdmin, rejectLessonPlan);

router.get("/log-book-entries", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER"), listLogBookEntries);
router.post("/log-book-entries", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER"), createLogBookEntry);
router.put("/log-book-entries/:id", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER"), updateLogBookEntry);
router.delete("/log-book-entries/:id", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER"), deleteLogBookEntry);
router.post("/log-book-entries/:id/review", authorizeInstitutionAdmin, reviewLogBookEntry);

router.get("/timetable/today", authorize("TEACHER"), getTodayTimetableSlots);
router.get("/attendance/summary", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER"), getSessionAttendance);

router.get("/comments", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER"), listComments);
router.post("/comments", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER"), addComment);

router.post("/lesson-plans/:id/unlock", authorizeInstitutionAdmin, unlockLessonPlan);

router.get("/reports/:type", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER"), getAcademicReport);
router.get("/reports/:type/export", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER"), exportAcademicReport);

export default router;