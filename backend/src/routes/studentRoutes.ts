import { Router } from "express";
import { createStudent, deleteStudent, getStudentById, listStudents, updateStudent } from "../controllers/studentController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);
router.get("/", listStudents);
router.get("/:id", getStudentById);
router.post("/", authorize("SCHOOL_ADMIN"), createStudent);
router.put("/:id", authorize("SCHOOL_ADMIN"), updateStudent);
router.delete("/:id", authorize("SCHOOL_ADMIN"), deleteStudent);

export default router;
