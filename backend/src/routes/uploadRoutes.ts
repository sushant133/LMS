import { Router } from "express";
import { authorize, protect } from "../middleware/auth";
import { tenantGuard } from "../middleware/tenant";
import { uploadClassroomAttachmentsHandler, uploadDocumentsHandler, uploadStudentPhotoHandler } from "../controllers/uploadController";
import { uploadClassroomAttachments, uploadStudentDocuments, uploadStudentPhoto } from "../utils/upload";

const router = Router();

router.use(protect);
router.use(tenantGuard);

// Student photo upload (SCHOOL_ADMIN, TEACHER)
router.post(
  "/students/:studentId/photo",
  authorize("SUPER_ADMIN", "SCHOOL_ADMIN", "TEACHER"),
  uploadStudentPhoto,
  uploadStudentPhotoHandler
);

// Student document uploads
router.post(
  "/students/:studentId/documents",
  authorize("SUPER_ADMIN", "SCHOOL_ADMIN", "TEACHER"),
  uploadStudentDocuments,
  uploadDocumentsHandler
);

router.post(
  "/classroom",
  authorize("SUPER_ADMIN", "SCHOOL_ADMIN", "TEACHER", "STUDENT"),
  uploadClassroomAttachments,
  uploadClassroomAttachmentsHandler
);

export default router;
