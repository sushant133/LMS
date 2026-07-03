import { Router } from "express";
import { createParentLink, deleteParentLink, getParentPortal, listParentLinks, listParentUsers } from "../controllers/parentController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);
router.get("/portal", getParentPortal);
router.get("/users", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), listParentUsers);
router.get("/links", authorize("COLLEGE_ADMIN", "SUPER_ADMIN"), listParentLinks);
router.post("/links", authorize("COLLEGE_ADMIN"), createParentLink);
router.delete("/links/:id", authorize("COLLEGE_ADMIN"), deleteParentLink);

export default router;