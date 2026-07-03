import { Router } from "express";
import {
  createBatch,
  createClass,
  createSection,
  createSubject,
  deleteBatch,
  deleteClass,
  deleteSection,
  deleteSubject,
  listBatches,
  listClasses,
  listSections,
  listSubjects,
  listYears,
  updateBatch,
  updateClass,
  updateSection,
  updateSubject
} from "../controllers/academicController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);

router.get("/classes", listClasses);
router.post("/classes", authorize("COLLEGE_ADMIN"), createClass);
router.put("/classes/:id", authorize("COLLEGE_ADMIN"), updateClass);
router.delete("/classes/:id", authorize("COLLEGE_ADMIN"), deleteClass);

router.get("/sections", listSections);
router.post("/sections", authorize("COLLEGE_ADMIN"), createSection);
router.put("/sections/:id", authorize("COLLEGE_ADMIN"), updateSection);
router.delete("/sections/:id", authorize("COLLEGE_ADMIN"), deleteSection);

router.get("/subjects", listSubjects);
router.post("/subjects", authorize("COLLEGE_ADMIN"), createSubject);
router.put("/subjects/:id", authorize("COLLEGE_ADMIN"), updateSubject);
router.delete("/subjects/:id", authorize("COLLEGE_ADMIN"), deleteSubject);

router.get("/batches", listBatches);
router.post("/batches", authorize("COLLEGE_ADMIN"), createBatch);
router.put("/batches/:id", authorize("COLLEGE_ADMIN"), updateBatch);
router.delete("/batches/:id", authorize("COLLEGE_ADMIN"), deleteBatch);

router.get("/years", listYears);

export default router;
