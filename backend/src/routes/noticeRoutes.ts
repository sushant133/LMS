import { Router } from "express";
import { createNotice, deleteNotice, listNotices, updateNotice } from "../controllers/noticeController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);
router.get("/", listNotices);
router.post("/", authorize("COLLEGE_ADMIN", "TEACHER"), createNotice);
router.put("/:id", authorize("COLLEGE_ADMIN", "TEACHER"), updateNotice);
router.delete("/:id", authorize("COLLEGE_ADMIN", "TEACHER"), deleteNotice);

export default router;
