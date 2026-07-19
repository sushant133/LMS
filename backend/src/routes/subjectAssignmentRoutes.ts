import { Router } from "express";
import {
  acceptMigration,
  bulkCreateAssignments,
  copyYear,
  createAssignment,
  deleteAssignment,
  endAssignment,
  getAssignmentById,
  listAssignments,
  migrationReview,
  reassignAssignment,
  rejectMigrationToLegacy,
  updateAssignment,
  workloadReport
} from "../controllers/subjectAssignmentController.js";
import { authorizeInstitutionAdmin, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);

// Static routes BEFORE /:id
router.post("/bulk", authorizeInstitutionAdmin, bulkCreateAssignments);
router.post("/copy-year", authorizeInstitutionAdmin, copyYear);
router.get("/migration-review", authorizeInstitutionAdmin, migrationReview);
router.post("/migration-review/:teacherId/accept", authorizeInstitutionAdmin, acceptMigration);
router.post("/migration-review/:teacherId/reject-to-legacy", authorizeInstitutionAdmin, rejectMigrationToLegacy);
router.get("/reports/workload", authorizeInstitutionAdmin, workloadReport);

// List: admin + viewer (authorizeInstitutionAdmin allows GET for COLLEGE_VIEWER)
router.get("/", authorizeInstitutionAdmin, listAssignments);
router.post("/", authorizeInstitutionAdmin, createAssignment);

router.get("/:id", authorizeInstitutionAdmin, getAssignmentById);
router.put("/:id", authorizeInstitutionAdmin, updateAssignment);
router.delete("/:id", authorizeInstitutionAdmin, deleteAssignment);
router.post("/:id/end", authorizeInstitutionAdmin, endAssignment);
router.post("/:id/reassign", authorizeInstitutionAdmin, reassignAssignment);

export default router;
