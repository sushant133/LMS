import { Router } from "express";
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  sendManualNotification
} from "../controllers/notificationController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);
router.get("/", listNotifications);
router.get("/unread-count", getUnreadNotificationCount);
router.post("/send", authorize("COLLEGE_ADMIN", "TEACHER"), sendManualNotification);
router.put("/:id/read", markNotificationRead);
router.put("/read-all", markAllNotificationsRead);

export default router;