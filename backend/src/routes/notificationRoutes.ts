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

// Static write routes BEFORE parameterized /:id routes
router.put("/read-all", markAllNotificationsRead);
router.post("/send", authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER"), sendManualNotification);
router.put("/:id/read", markNotificationRead);

export default router;
