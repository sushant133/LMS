import { Router } from "express";
import {
  createBanner,
  deleteBanner,
  dismissBanner,
  listActiveBanners,
  listBanners,
  replaceBannerImage,
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
router.put("/:id/image", admins, replaceBannerImage);
router.post("/:id/toggle-active", admins, toggleBannerActive);
router.post("/:id/dismiss", dismissBanner);
router.delete("/:id", admins, deleteBanner);

export default router;