import { Router } from "express";
import {
  addStudentDocument,
  deleteStudentDocument,
  getStudentProfileOverview,
  replaceStudentDocument
} from "../controllers/studentProfileController.js";
import {
  createStudent,
  deleteStudent,
  getStudentById,
  listStudents,
  setStudentLoginAccess,
  updateCtevtExamFee,
  updateCtevtRegistrationFee,
  updateStudent,
  updateStudentBackCount
} from "../controllers/studentController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const profileReaders = authorize(
  "SUPER_ADMIN",
  "COLLEGE_ADMIN",
  "TEACHER",
  "COLLEGE_STAFF",
  "STUDENT",
  "PARENT",
  "ACCOUNTANT"
);

/** List/get: institution staff + scoped parents/students. COLLEGE_VIEWER inherits GET via COLLEGE_ADMIN.
 * LIBRARY_STAFF needs list for issue-book borrower picker.
 * Finance roles (accountant/cashier/auditor/principal) need student roster for fee/refund pickers. */
const studentReaders = authorize(
  "SUPER_ADMIN",
  "COLLEGE_ADMIN",
  "TEACHER",
  "COLLEGE_STAFF",
  "ACCOUNTANT",
  "CASHIER",
  "AUDITOR",
  "PRINCIPAL",
  "PARENT",
  "STUDENT",
  "LIBRARY_STAFF"
);

const router = Router();

router.use(protect, tenantGuard);
router.get("/", studentReaders, listStudents);
/**
 * CTEVT registration / exam fees — must be registered before `/:id` routes.
 * Role list is broad so Module Access grants work; enforceModuleAccess requires
 * examinations-ctevt (and WRITE for PATCH).
 */
const ctevtFeeRoles = authorize(
  "SUPER_ADMIN",
  "COLLEGE_ADMIN",
  "COLLEGE_VIEWER",
  "COLLEGE_STAFF",
  "PRINCIPAL",
  "TEACHER",
  "ACCOUNTANT",
  "CASHIER",
  "AUDITOR"
);
router.patch("/ctevt-registration-fee", ctevtFeeRoles, updateCtevtRegistrationFee);
router.patch("/ctevt-exam-fee", ctevtFeeRoles, updateCtevtExamFee);
router.get("/:id/profile", profileReaders, getStudentProfileOverview);
router.post("/:id/documents", authorize("SUPER_ADMIN", "COLLEGE_ADMIN"), addStudentDocument);
router.put("/:id/documents/replace", authorize("SUPER_ADMIN", "COLLEGE_ADMIN"), replaceStudentDocument);
router.delete("/:id/documents/:documentId", authorize("SUPER_ADMIN", "COLLEGE_ADMIN"), deleteStudentDocument);
router.get("/:id", studentReaders, getStudentById);
/** Enable / disable portal login — before generic PUT */
router.put(
  "/:id/login-access",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN"),
  setStudentLoginAccess
);
/** Examination → Back Students: quick edit remaining back papers */
router.patch(
  "/:id/back-count",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN"),
  updateStudentBackCount
);
router.post("/", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), createStudent);
router.put("/:id", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), updateStudent);
router.delete("/:id", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), deleteStudent);

export default router;
