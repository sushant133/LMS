import { Router } from "express";
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  registerDeviceToken,
  sendManualNotification,
  unregisterDeviceToken
} from "../controllers/notificationController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect);

/** Personal FCM token — session user only. No tenant school required (SUPER_ADMIN schoolId is null). */
router.post("/device-token", registerDeviceToken);
router.delete("/device-token", unregisterDeviceToken);

router.use(tenantGuard);

router.get("/", listNotifications);
router.get("/unread-count", getUnreadNotificationCount);

// Static write routes BEFORE parameterized /:id routes
router.put("/read-all", markAllNotificationsRead);
router.post("/send", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER"), sendManualNotification);
router.put("/:id/read", markNotificationRead);

export default router;
