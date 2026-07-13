import { Router } from "express";
import { createTeacher, deleteTeacher, getTeacherById, listTeachers, updateTeacher } from "../controllers/teacherController.js";
import {
  createTeacherLabAssignment,
  deactivateTeacherLabAssignment,
  listTeacherLabAssignments,
  updateTeacherLabAssignment
} from "../controllers/teacherLabAssignmentController.js";
import { authorize, authorizeInstitutionAdmin, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

/** COLLEGE_VIEWER inherits GET when COLLEGE_ADMIN is listed.
 * Teachers/lab/library staff need list for issue workflows. */
const teacherReaders = authorize(
  "COLLEGE_ADMIN",
  "TEACHER",
  "LABORATORY_STAFF",
  "LIBRARY_STAFF"
);

router.use(protect, tenantGuard);
router.get("/", teacherReaders, listTeachers);

// Multi-lab assignments (must be before /:id)
router.get("/lab-assignments", authorizeInstitutionAdmin, listTeacherLabAssignments);
router.post("/lab-assignments", authorizeInstitutionAdmin, createTeacherLabAssignment);
router.put("/lab-assignments/:id", authorizeInstitutionAdmin, updateTeacherLabAssignment);
router.delete("/lab-assignments/:id", authorizeInstitutionAdmin, deactivateTeacherLabAssignment);

router.get("/:id", teacherReaders, getTeacherById);
router.post("/", authorizeInstitutionAdmin, createTeacher);
router.put("/:id", authorizeInstitutionAdmin, updateTeacher);
router.delete("/:id", authorizeInstitutionAdmin, deleteTeacher);

export default router;
