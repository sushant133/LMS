import { Router } from "express";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";
import {
  uploadBannerImageHandler,
  uploadClassroomAttachmentsHandler,
  uploadAcademicAttachmentsHandler,
  uploadComplaintAttachmentsHandler,
  uploadDocumentsHandler,
  uploadStaffPhotoHandler,
  uploadStudentPhotoHandler
} from "../controllers/uploadController.js";
import {
  uploadAcademicAttachments,
  uploadBannerImage,
  uploadClassroomAttachments,
  uploadComplaintAttachments,
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
  "/academic-management",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER"),
  uploadAcademicAttachments,
  uploadAcademicAttachmentsHandler
);

router.post(
  "/complaints",
  authorize(
    "SUPER_ADMIN",
    "COLLEGE_ADMIN",
    "TEACHER",
    "STUDENT",
    "COLLEGE_STAFF",
    "LIBRARY_STAFF",
    "LABORATORY_STAFF",
    "ACCOUNTANT",
    "CASHIER",
    "AUDITOR",
    "PRINCIPAL"
  ),
  uploadComplaintAttachments,
  uploadComplaintAttachmentsHandler
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
