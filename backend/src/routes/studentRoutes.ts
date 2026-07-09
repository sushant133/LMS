import { Router } from "express";
import {
  addStudentDocument,
  deleteStudentDocument,
  getStudentProfileOverview,
  replaceStudentDocument
} from "../controllers/studentProfileController.js";
import { createStudent, deleteStudent, getStudentById, listStudents, updateStudent } from "../controllers/studentController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const profileReaders = authorize(
  "SUPER_ADMIN",
  "COLLEGE_ADMIN",
  "TEACHER",
  "STUDENT",
  "PARENT",
  "ACCOUNTANT"
);

/** List/get: institution staff + scoped parents/students. COLLEGE_VIEWER inherits GET via COLLEGE_ADMIN. */
const studentReaders = authorize(
  "COLLEGE_ADMIN",
  "TEACHER",
  "ACCOUNTANT",
  "PARENT",
  "STUDENT"
);

const router = Router();

router.use(protect, tenantGuard);
router.get("/", studentReaders, listStudents);
router.get("/:id/profile", profileReaders, getStudentProfileOverview);
router.post("/:id/documents", authorize("SUPER_ADMIN", "COLLEGE_ADMIN"), addStudentDocument);
router.put("/:id/documents/replace", authorize("SUPER_ADMIN", "COLLEGE_ADMIN"), replaceStudentDocument);
router.delete("/:id/documents/:documentId", authorize("SUPER_ADMIN", "COLLEGE_ADMIN"), deleteStudentDocument);
router.get("/:id", studentReaders, getStudentById);
router.post("/", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), createStudent);
router.put("/:id", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), updateStudent);
router.delete("/:id", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), deleteStudent);

export default router;
