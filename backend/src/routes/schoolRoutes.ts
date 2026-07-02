import { Router } from "express";
import { createSchool, deleteSchool, listAccessibleSchools, listPublicSchools, listSchools, updateSchool } from "../controllers/schoolController";
import { authorize, protect } from "../middleware/auth";

const router = Router();

router.get("/public", listPublicSchools);
router.get("/accessible", protect, listAccessibleSchools);
router.get("/", protect, authorize("SUPER_ADMIN"), listSchools);
router.post("/", protect, authorize("SUPER_ADMIN"), createSchool);
router.put("/:id", protect, authorize("SUPER_ADMIN"), updateSchool);
router.delete("/:id", protect, authorize("SUPER_ADMIN"), deleteSchool);

export default router;