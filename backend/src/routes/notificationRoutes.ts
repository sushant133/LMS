import { Router } from "express";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  sendManualNotification
} from "../controllers/notificationController";
import { authorize, protect } from "../middleware/auth";
import { tenantGuard } from "../middleware/tenant";

const router = Router();

router.use(protect, tenantGuard);
router.get("/", listNotifications);
router.post("/send", authorize("SCHOOL_ADMIN", "TEACHER"), sendManualNotification);
router.put("/:id/read", markNotificationRead);
router.put("/read-all", markAllNotificationsRead);

export default router;