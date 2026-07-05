import { Router } from "express";
import {
  assignStudent,
  createRoute,
  deleteRoute,
  listAssignments,
  listRoutes,
  removeAssignment,
  updateRoute
} from "../controllers/transportController.js";
import { authorizeInstitutionAdmin, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);
router.get("/routes", listRoutes);
router.post("/routes", authorizeInstitutionAdmin, createRoute);
router.put("/routes/:id", authorizeInstitutionAdmin, updateRoute);
router.delete("/routes/:id", authorizeInstitutionAdmin, deleteRoute);
router.get("/assignments", listAssignments);
router.post("/assignments", authorizeInstitutionAdmin, assignStudent);
router.delete("/assignments/:id", authorizeInstitutionAdmin, removeAssignment);

export default router;