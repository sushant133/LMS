import { Router } from "express";
import { createParentLink, deleteParentLink, getParentPortal, listParentLinks, listParentUsers } from "../controllers/parentController";
import { authorize, protect } from "../middleware/auth";
import { tenantGuard } from "../middleware/tenant";

const router = Router();

router.use(protect, tenantGuard);
router.get("/portal", getParentPortal);
router.get("/users", authorize("SCHOOL_ADMIN", "SUPER_ADMIN"), listParentUsers);
router.get("/links", authorize("SCHOOL_ADMIN", "SUPER_ADMIN"), listParentLinks);
router.post("/links", authorize("SCHOOL_ADMIN"), createParentLink);
router.delete("/links/:id", authorize("SCHOOL_ADMIN"), deleteParentLink);

export default router;