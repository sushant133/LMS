import { Router } from "express";
import { createTeacher, deleteTeacher, getTeacherById, listTeachers, updateTeacher } from "../controllers/teacherController";
import { authorize, protect } from "../middleware/auth";
import { tenantGuard } from "../middleware/tenant";

const router = Router();

router.use(protect, tenantGuard);
router.get("/", listTeachers);
router.get("/:id", getTeacherById);
router.post("/", authorize("SCHOOL_ADMIN"), createTeacher);
router.put("/:id", authorize("SCHOOL_ADMIN"), updateTeacher);
router.delete("/:id", authorize("SCHOOL_ADMIN"), deleteTeacher);

export default router;
