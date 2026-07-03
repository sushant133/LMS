import { Router } from "express";
import {
  createEquipment,
  createLaboratory,
  createLaboratoryCategory,
  createLaboratoryStaff,
  deleteEquipment,
  deleteLaboratory,
  deleteLaboratoryCategory,
  deleteLaboratoryStaff,
  getLaboratoryDashboard,
  issueEquipment,
  listEquipment,
  listEquipmentIssues,
  listLaboratories,
  listLaboratoryCategories,
  listLaboratoryStaff,
  listMyEquipment,
  returnEquipment,
  updateEquipment,
  updateLaboratory,
  updateLaboratoryCategory,
  updateLaboratoryStaff
} from "../controllers/laboratoryController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);

router.get("/dashboard", authorize("SCHOOL_ADMIN", "LABORATORY_STAFF"), getLaboratoryDashboard);
router.get("/my-equipment", authorize("TEACHER"), listMyEquipment);

router.get("/labs", authorize("SCHOOL_ADMIN", "LABORATORY_STAFF"), listLaboratories);
router.post("/labs", authorize("SCHOOL_ADMIN", "LABORATORY_STAFF"), createLaboratory);
router.put("/labs/:id", authorize("SCHOOL_ADMIN", "LABORATORY_STAFF"), updateLaboratory);
router.delete("/labs/:id", authorize("SCHOOL_ADMIN", "LABORATORY_STAFF"), deleteLaboratory);

router.get("/labs/:labId/categories", authorize("SCHOOL_ADMIN", "LABORATORY_STAFF"), listLaboratoryCategories);
router.post("/labs/:labId/categories", authorize("SCHOOL_ADMIN", "LABORATORY_STAFF"), createLaboratoryCategory);
router.put("/categories/:id", authorize("SCHOOL_ADMIN", "LABORATORY_STAFF"), updateLaboratoryCategory);
router.delete("/categories/:id", authorize("SCHOOL_ADMIN", "LABORATORY_STAFF"), deleteLaboratoryCategory);

router.get("/equipment", authorize("SCHOOL_ADMIN", "LABORATORY_STAFF"), listEquipment);
router.post("/equipment", authorize("SCHOOL_ADMIN", "LABORATORY_STAFF"), createEquipment);
router.put("/equipment/:id", authorize("SCHOOL_ADMIN", "LABORATORY_STAFF"), updateEquipment);
router.delete("/equipment/:id", authorize("SCHOOL_ADMIN", "LABORATORY_STAFF"), deleteEquipment);

router.get("/issues", authorize("SCHOOL_ADMIN", "LABORATORY_STAFF"), listEquipmentIssues);
router.post("/issues", authorize("SCHOOL_ADMIN", "LABORATORY_STAFF"), issueEquipment);
router.put("/issues/:id/return", authorize("SCHOOL_ADMIN", "LABORATORY_STAFF"), returnEquipment);

router.get("/staff", authorize("SCHOOL_ADMIN"), listLaboratoryStaff);
router.post("/staff", authorize("SCHOOL_ADMIN"), createLaboratoryStaff);
router.put("/staff/:id", authorize("SCHOOL_ADMIN"), updateLaboratoryStaff);
router.delete("/staff/:id", authorize("SCHOOL_ADMIN"), deleteLaboratoryStaff);

export default router;