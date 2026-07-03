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
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);
router.get("/routes", listRoutes);
router.post("/routes", authorize("SCHOOL_ADMIN"), createRoute);
router.put("/routes/:id", authorize("SCHOOL_ADMIN"), updateRoute);
router.delete("/routes/:id", authorize("SCHOOL_ADMIN"), deleteRoute);
router.get("/assignments", listAssignments);
router.post("/assignments", authorize("SCHOOL_ADMIN"), assignStudent);
router.delete("/assignments/:id", authorize("SCHOOL_ADMIN"), removeAssignment);

export default router;