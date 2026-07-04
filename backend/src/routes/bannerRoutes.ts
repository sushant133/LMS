import { Router } from "express";
import {
  createBanner,
  deleteBanner,
  dismissBanner,
  duplicateBanner,
  listActiveBanners,
  listBanners,
  toggleBannerActive,
  updateBanner
} from "../controllers/bannerController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();
const admins = authorize("SUPER_ADMIN", "COLLEGE_ADMIN");

router.use(protect, tenantGuard);
router.get("/active", listActiveBanners);
router.get("/", admins, listBanners);
router.post("/", admins, createBanner);
router.put("/:id", admins, updateBanner);
router.post("/:id/duplicate", admins, duplicateBanner);
router.post("/:id/toggle-active", admins, toggleBannerActive);
router.post("/:id/dismiss", dismissBanner);
router.delete("/:id", admins, deleteBanner);

export default router;