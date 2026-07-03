import { Router } from "express";
import { createTeacher, deleteTeacher, getTeacherById, listTeachers, updateTeacher } from "../controllers/teacherController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);
router.get("/", listTeachers);
router.get("/:id", getTeacherById);
router.post("/", authorize("COLLEGE_ADMIN"), createTeacher);
router.put("/:id", authorize("COLLEGE_ADMIN"), updateTeacher);
router.delete("/:id", authorize("COLLEGE_ADMIN"), deleteTeacher);

export default router;
