import { Router } from "express";
import { resendCredentials } from "../controllers/credentialController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);

/** Resend login credentials email for any ERP user (generates a new password). */
router.post(
  "/:userId/resend-credentials",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN"),
  resendCredentials
);

export default router;
