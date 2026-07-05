import { Router } from "express";
import { createTeacher, deleteTeacher, getTeacherById, listTeachers, updateTeacher } from "../controllers/teacherController.js";
import { authorizeInstitutionAdmin, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);
router.get("/", listTeachers);
router.get("/:id", getTeacherById);
router.post("/", authorizeInstitutionAdmin, createTeacher);
router.put("/:id", authorizeInstitutionAdmin, updateTeacher);
router.delete("/:id", authorizeInstitutionAdmin, deleteTeacher);

export default router;
