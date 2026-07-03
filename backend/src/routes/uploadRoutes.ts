import { Router } from "express";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";
import { uploadClassroomAttachmentsHandler, uploadDocumentsHandler, uploadStudentPhotoHandler } from "../controllers/uploadController.js";
import { uploadClassroomAttachments, uploadStudentDocuments, uploadStudentPhoto } from "../utils/upload.js";

const router = Router();

router.use(protect);
router.use(tenantGuard);

// Student photo upload (COLLEGE_ADMIN, TEACHER)
router.post(
  "/students/:studentId/photo",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER"),
  uploadStudentPhoto,
  uploadStudentPhotoHandler
);

// Student document uploads
router.post(
  "/students/:studentId/documents",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER"),
  uploadStudentDocuments,
  uploadDocumentsHandler
);

router.post(
  "/classroom",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER", "STUDENT"),
  uploadClassroomAttachments,
  uploadClassroomAttachmentsHandler
);

export default router;
