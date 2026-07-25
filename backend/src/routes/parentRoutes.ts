import { Router } from "express";
import {
  createParentFromStudent,
  createParentLink,
  deleteParentLink,
  getParentPortal,
  getParentPortalAccess,
  getParentUserPortalAccess,
  getStudentParentCandidates,
  listParentLinks,
  listParentUsers,
  updateParentPortalAccess,
  updateParentUserPortalAccess
} from "../controllers/parentController.js";
import {
  approveParentRegistration,
  listPendingParentRegistrations,
  rejectParentRegistration
} from "../controllers/parentRegistrationController.js";
import { authorize, authorizeInstitutionAdmin, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);
router.get("/portal", getParentPortal);
/** Parents: own effective access. Admins: school defaults. */
router.get("/portal-access", getParentPortalAccess);
/** School-wide defaults (used when a parent has no personal override). */
router.put(
  "/portal-access",
  authorizeInstitutionAdmin,
  updateParentPortalAccess
);
/** Per-parent module access (Admin only). */
router.get(
  "/users/:parentUserId/portal-access",
  authorizeInstitutionAdmin,
  getParentUserPortalAccess
);
router.put(
  "/users/:parentUserId/portal-access",
  authorizeInstitutionAdmin,
  updateParentUserPortalAccess
);
router.get("/users", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), listParentUsers);
router.get("/students/:studentId/candidates", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), getStudentParentCandidates);
router.get("/links", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), listParentLinks);
router.get("/registrations/pending", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), listPendingParentRegistrations);
router.post("/registrations/:id/approve", authorizeInstitutionAdmin, approveParentRegistration);
router.post("/registrations/:id/reject", authorizeInstitutionAdmin, rejectParentRegistration);
router.post("/profiles/from-student", authorizeInstitutionAdmin, createParentFromStudent);
router.post("/links", authorizeInstitutionAdmin, createParentLink);
router.delete("/links/:id", authorizeInstitutionAdmin, deleteParentLink);

export default router;