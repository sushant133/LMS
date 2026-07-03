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

router.get("/dashboard", authorize("COLLEGE_ADMIN", "LABORATORY_STAFF"), getLaboratoryDashboard);
router.get("/my-equipment", authorize("TEACHER"), listMyEquipment);

router.get("/labs", authorize("COLLEGE_ADMIN", "LABORATORY_STAFF"), listLaboratories);
router.post("/labs", authorize("COLLEGE_ADMIN", "LABORATORY_STAFF"), createLaboratory);
router.put("/labs/:id", authorize("COLLEGE_ADMIN", "LABORATORY_STAFF"), updateLaboratory);
router.delete("/labs/:id", authorize("COLLEGE_ADMIN", "LABORATORY_STAFF"), deleteLaboratory);

router.get("/labs/:labId/categories", authorize("COLLEGE_ADMIN", "LABORATORY_STAFF"), listLaboratoryCategories);
router.post("/labs/:labId/categories", authorize("COLLEGE_ADMIN", "LABORATORY_STAFF"), createLaboratoryCategory);
router.put("/categories/:id", authorize("COLLEGE_ADMIN", "LABORATORY_STAFF"), updateLaboratoryCategory);
router.delete("/categories/:id", authorize("COLLEGE_ADMIN", "LABORATORY_STAFF"), deleteLaboratoryCategory);

router.get("/equipment", authorize("COLLEGE_ADMIN", "LABORATORY_STAFF"), listEquipment);
router.post("/equipment", authorize("COLLEGE_ADMIN", "LABORATORY_STAFF"), createEquipment);
router.put("/equipment/:id", authorize("COLLEGE_ADMIN", "LABORATORY_STAFF"), updateEquipment);
router.delete("/equipment/:id", authorize("COLLEGE_ADMIN", "LABORATORY_STAFF"), deleteEquipment);

router.get("/issues", authorize("COLLEGE_ADMIN", "LABORATORY_STAFF"), listEquipmentIssues);
router.post("/issues", authorize("COLLEGE_ADMIN", "LABORATORY_STAFF"), issueEquipment);
router.put("/issues/:id/return", authorize("COLLEGE_ADMIN", "LABORATORY_STAFF"), returnEquipment);

router.get("/staff", authorize("COLLEGE_ADMIN"), listLaboratoryStaff);
router.post("/staff", authorize("COLLEGE_ADMIN"), createLaboratoryStaff);
router.put("/staff/:id", authorize("COLLEGE_ADMIN"), updateLaboratoryStaff);
router.delete("/staff/:id", authorize("COLLEGE_ADMIN"), deleteLaboratoryStaff);

export default router;