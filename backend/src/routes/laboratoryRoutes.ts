import { Router } from "express";
import {
  adjustEquipmentStock,
  createEquipment,
  createLaboratory,
  createLaboratoryCategory,
  createLaboratoryStaff,
  createStockRequest,
  deleteEquipment,
  deleteLaboratory,
  deleteLaboratoryCategory,
  deleteLaboratoryStaff,
  getLaboratoryDashboard,
  getLaboratoryReports,
  issueEquipment,
  listEquipment,
  listEquipmentIssues,
  listLaboratories,
  listLaboratoryCategories,
  listLaboratoryStaff,
  listMyEquipment,
  listStockMovements,
  listStockRequests,
  returnEquipment,
  updateEquipment,
  updateLaboratory,
  updateLaboratoryCategory,
  updateLaboratoryStaff,
  updateStockRequestStatus
} from "../controllers/laboratoryController.js";
import { authorize, authorizeInstitutionAdmin, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

const labRoles = ["COLLEGE_ADMIN", "LABORATORY_STAFF", "TEACHER"] as const;

router.use(protect, tenantGuard);

router.get("/dashboard", authorize(...labRoles), getLaboratoryDashboard);
router.get("/my-equipment", authorize("TEACHER"), listMyEquipment);

router.get("/labs", authorize(...labRoles), listLaboratories);
router.post("/labs", authorize("COLLEGE_ADMIN", "LABORATORY_STAFF"), createLaboratory);
router.put("/labs/:id", authorize("COLLEGE_ADMIN", "LABORATORY_STAFF", "TEACHER"), updateLaboratory);
router.delete("/labs/:id", authorize("COLLEGE_ADMIN"), deleteLaboratory);

router.get("/labs/:labId/categories", authorize(...labRoles), listLaboratoryCategories);
router.post("/labs/:labId/categories", authorize(...labRoles), createLaboratoryCategory);
router.put("/categories/:id", authorize(...labRoles), updateLaboratoryCategory);
router.delete("/categories/:id", authorize(...labRoles), deleteLaboratoryCategory);

router.get("/equipment", authorize(...labRoles), listEquipment);
router.post("/equipment", authorize(...labRoles), createEquipment);
router.put("/equipment/:id", authorize(...labRoles), updateEquipment);
router.delete("/equipment/:id", authorize(...labRoles), deleteEquipment);
router.post("/equipment/:id/stock", authorize(...labRoles), adjustEquipmentStock);

router.get("/issues", authorize(...labRoles), listEquipmentIssues);
router.post("/issues", authorize(...labRoles), issueEquipment);
router.put("/issues/:id/return", authorize(...labRoles), returnEquipment);

router.get("/movements", authorize(...labRoles), listStockMovements);

router.get("/stock-requests", authorize(...labRoles), listStockRequests);
router.post("/stock-requests", authorize(...labRoles), createStockRequest);
router.put(
  "/stock-requests/:id/status",
  authorize("COLLEGE_ADMIN"),
  updateStockRequestStatus
);

router.get("/reports", authorize(...labRoles), getLaboratoryReports);

router.get("/staff", authorizeInstitutionAdmin, listLaboratoryStaff);
router.post("/staff", authorizeInstitutionAdmin, createLaboratoryStaff);
router.put("/staff/:id", authorizeInstitutionAdmin, updateLaboratoryStaff);
router.delete("/staff/:id", authorizeInstitutionAdmin, deleteLaboratoryStaff);

export default router;
