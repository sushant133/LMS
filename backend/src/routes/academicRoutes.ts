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
import {
  createMasterSubject,
  deleteMasterSubject,
  listMasterSubjects,
  reconcileMasterSubjects,
  updateMasterSubject
} from "../controllers/masterSubjectController.js";
import { authorizeInstitutionAdmin, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);

router.get("/classes", listClasses);
router.post("/classes", authorizeInstitutionAdmin, createClass);
router.put("/classes/:id", authorizeInstitutionAdmin, updateClass);
router.delete("/classes/:id", authorizeInstitutionAdmin, deleteClass);

router.get("/sections", listSections);
router.post("/sections", authorizeInstitutionAdmin, createSection);
router.put("/sections/:id", authorizeInstitutionAdmin, updateSection);
router.delete("/sections/:id", authorizeInstitutionAdmin, deleteSection);

router.get("/subjects", listSubjects);
router.post("/subjects", authorizeInstitutionAdmin, createSubject);
router.put("/subjects/:id", authorizeInstitutionAdmin, updateSubject);
router.delete("/subjects/:id", authorizeInstitutionAdmin, deleteSubject);

router.get("/master-subjects", listMasterSubjects);
router.post("/master-subjects/reconcile", authorizeInstitutionAdmin, reconcileMasterSubjects);
router.post("/master-subjects", authorizeInstitutionAdmin, createMasterSubject);
router.put("/master-subjects/:id", authorizeInstitutionAdmin, updateMasterSubject);
router.delete("/master-subjects/:id", authorizeInstitutionAdmin, deleteMasterSubject);

router.get("/batches", listBatches);
router.post("/batches", authorizeInstitutionAdmin, createBatch);
router.put("/batches/:id", authorizeInstitutionAdmin, updateBatch);
router.delete("/batches/:id", authorizeInstitutionAdmin, deleteBatch);

router.get("/years", listYears);

export default router;
