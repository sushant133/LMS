import { Router } from "express";
import { createNotice, deleteNotice, listNotices, updateNotice } from "../controllers/noticeController";
import { authorize, protect } from "../middleware/auth";
import { tenantGuard } from "../middleware/tenant";

const router = Router();

router.use(protect, tenantGuard);
router.get("/", listNotices);
router.post("/", authorize("SCHOOL_ADMIN", "TEACHER"), createNotice);
router.put("/:id", authorize("SCHOOL_ADMIN", "TEACHER"), updateNotice);
router.delete("/:id", authorize("SCHOOL_ADMIN", "TEACHER"), deleteNotice);

export default router;
