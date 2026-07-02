import { Router } from "express";
import { createStudent, deleteStudent, getStudentById, listStudents, updateStudent } from "../controllers/studentController";
import { authorize, protect } from "../middleware/auth";
import { tenantGuard } from "../middleware/tenant";

const router = Router();

router.use(protect, tenantGuard);
router.get("/", listStudents);
router.get("/:id", getStudentById);
router.post("/", authorize("SCHOOL_ADMIN"), createStudent);
router.put("/:id", authorize("SCHOOL_ADMIN"), updateStudent);
router.delete("/:id", authorize("SCHOOL_ADMIN"), deleteStudent);

export default router;
