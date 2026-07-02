import { Router } from "express";
import {
  createClass,
  createSection,
  createSubject,
  deleteClass,
  deleteSection,
  deleteSubject,
  listClasses,
  listSections,
  listSubjects,
  updateClass,
  updateSection,
  updateSubject
} from "../controllers/academicController";
import { authorize, protect } from "../middleware/auth";
import { tenantGuard } from "../middleware/tenant";

const router = Router();

router.use(protect, tenantGuard);

router.get("/classes", listClasses);
router.post("/classes", authorize("SCHOOL_ADMIN"), createClass);
router.put("/classes/:id", authorize("SCHOOL_ADMIN"), updateClass);
router.delete("/classes/:id", authorize("SCHOOL_ADMIN"), deleteClass);

router.get("/sections", listSections);
router.post("/sections", authorize("SCHOOL_ADMIN"), createSection);
router.put("/sections/:id", authorize("SCHOOL_ADMIN"), updateSection);
router.delete("/sections/:id", authorize("SCHOOL_ADMIN"), deleteSection);

router.get("/subjects", listSubjects);
router.post("/subjects", authorize("SCHOOL_ADMIN"), createSubject);
router.put("/subjects/:id", authorize("SCHOOL_ADMIN"), updateSubject);
router.delete("/subjects/:id", authorize("SCHOOL_ADMIN"), deleteSubject);

export default router;
