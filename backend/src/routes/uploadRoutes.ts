import { Router } from "express";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";
import {
  uploadBannerImageHandler,
  uploadClassroomAttachmentsHandler,
  uploadDocumentsHandler,
  uploadStaffPhotoHandler,
  uploadStudentPhotoHandler
} from "../controllers/uploadController.js";
import {
  uploadBannerImage,
  uploadClassroomAttachments,
  uploadStaffPhoto,
  uploadStudentDocuments,
  uploadStudentPhoto
} from "../utils/upload.js";

const router = Router();

router.use(protect);
router.use(tenantGuard);

// Student photo upload (admin only)
router.post(
  "/students/:studentId/photo",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN"),
  uploadStudentPhoto,
  uploadStudentPhotoHandler
);

// Student document uploads (admin only)
router.post(
  "/students/:studentId/documents",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN"),
  uploadStudentDocuments,
  uploadDocumentsHandler
);

router.post(
  "/classroom",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER", "STUDENT"),
  uploadClassroomAttachments,
  uploadClassroomAttachmentsHandler
);

router.post(
  "/banners",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN"),
  uploadBannerImage,
  uploadBannerImageHandler
);

router.post(
  "/staff/photo",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN"),
  uploadStaffPhoto,
  uploadStaffPhotoHandler
);

export default router;
