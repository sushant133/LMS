import { Router } from "express";
import { createTeacher, deleteTeacher, getTeacherById, listTeachers, updateTeacher } from "../controllers/teacherController.js";
import { authorize, authorizeInstitutionAdmin, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

/** COLLEGE_VIEWER inherits GET when COLLEGE_ADMIN is listed. Teachers need list for academic workflows. */
const teacherReaders = authorize("COLLEGE_ADMIN", "TEACHER");

router.use(protect, tenantGuard);
router.get("/", teacherReaders, listTeachers);
router.get("/:id", teacherReaders, getTeacherById);
router.post("/", authorizeInstitutionAdmin, createTeacher);
router.put("/:id", authorizeInstitutionAdmin, updateTeacher);
router.delete("/:id", authorizeInstitutionAdmin, deleteTeacher);

export default router;
