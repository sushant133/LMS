import { Router } from "express";
import { createStudent, deleteStudent, getStudentById, listStudents, updateStudent } from "../controllers/studentController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);
router.get("/", listStudents);
router.get("/:id", getStudentById);
router.post("/", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), createStudent);
router.put("/:id", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), updateStudent);
router.delete("/:id", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), deleteStudent);

export default router;
