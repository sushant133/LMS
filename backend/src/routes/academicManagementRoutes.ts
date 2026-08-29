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

router.get(
  "/dashboard",
  authorize(
    "SUPER_ADMIN",
    "COLLEGE_ADMIN",
    "COLLEGE_VIEWER",
    "TEACHER",
    "PRINCIPAL",
    "COLLEGE_STAFF"
  ),
  getAcademicDashboard
);

router.get("/syllabi", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER", "COLLEGE_STAFF"), listSyllabi);
router.get("/syllabi/:id", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER", "COLLEGE_STAFF"), getSyllabus);
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
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER", "COLLEGE_STAFF"),
  updateSyllabusSubUnitProgress
);
router.post(
  "/syllabi/:id/reorder",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN"),
  reorderSyllabusHierarchy
);

router.get("/session-plans", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER", "COLLEGE_STAFF"), listSessionPlans);
router.get("/session-plans/:id", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER", "COLLEGE_STAFF"), getSessionPlan);
router.post("/session-plans", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER", "COLLEGE_STAFF"), createSessionPlan);
router.put("/session-plans/:id", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER", "COLLEGE_STAFF"), updateSessionPlan);
router.delete("/session-plans/:id", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER", "COLLEGE_STAFF"), deleteSessionPlan);
router.post("/session-plans/:id/submit", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER", "COLLEGE_STAFF"), submitSessionPlan);
router.post("/session-plans/:id/approve", authorizeInstitutionAdmin, approveSessionPlan);
router.post("/session-plans/:id/reject", authorizeInstitutionAdmin, rejectSessionPlan);
router.post("/session-plans/:id/unlock", authorizeInstitutionAdmin, unlockSessionPlan);
router.get("/session-plan-units", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER", "COLLEGE_STAFF"), listSessionPlanUnits);
router.get("/syllabus-coverage", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER", "COLLEGE_STAFF"), getSyllabusCoverage);
router.get(
  "/session-plans/:sessionPlanId/coverage",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER", "COLLEGE_STAFF"),
  getSyllabusCoverage
);

router.get("/lesson-plans", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER", "COLLEGE_STAFF"), listLessonPlans);
router.post("/lesson-plans", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER", "COLLEGE_STAFF"), createLessonPlan);
router.put("/lesson-plans/:id", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER", "COLLEGE_STAFF"), updateLessonPlan);
router.delete("/lesson-plans/:id", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER", "COLLEGE_STAFF"), deleteLessonPlan);
router.post("/lesson-plans/:id/submit", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER", "COLLEGE_STAFF"), submitLessonPlan);
router.post("/lesson-plans/:id/approve", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER", "COLLEGE_STAFF"), approveLessonPlan);
router.post("/lesson-plans/:id/reject", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER", "COLLEGE_STAFF"), rejectLessonPlan);

router.get("/log-book-entries", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER", "COLLEGE_STAFF"), listLogBookEntries);
router.post("/log-book-entries", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER", "COLLEGE_STAFF"), createLogBookEntry);
router.put("/log-book-entries/:id", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER", "COLLEGE_STAFF"), updateLogBookEntry);
router.delete("/log-book-entries/:id", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER", "COLLEGE_STAFF"), deleteLogBookEntry);
router.post("/log-book-entries/:id/review", authorizeInstitutionAdmin, reviewLogBookEntry);

router.get("/timetable/today", authorize("TEACHER"), getTodayTimetableSlots);
router.get("/attendance/summary", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER", "COLLEGE_STAFF"), getSessionAttendance);

router.get("/comments", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER", "COLLEGE_STAFF"), listComments);
router.post("/comments", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER", "COLLEGE_STAFF"), addComment);

router.post("/lesson-plans/:id/unlock", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER", "COLLEGE_STAFF"), unlockLessonPlan);

router.get("/reports/:type", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER", "COLLEGE_STAFF"), getAcademicReport);
router.get("/reports/:type/export", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER", "COLLEGE_STAFF"), exportAcademicReport);

export default router;