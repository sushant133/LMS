import { Router } from "express";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";
import {
  uploadAccountingHandler,
  uploadBannerImageHandler,
  uploadClassroomAttachmentsHandler,
  uploadAcademicAttachmentsHandler,
  uploadComplaintAttachmentsHandler,
  uploadDocumentsHandler,
  uploadInventoryHandler,
  uploadLaboratoryHandler,
  uploadLibraryBookCoverHandler,
  uploadLibraryDocumentsHandler,
  uploadLibraryEbookHandler,
  uploadProfilePhotoHandler,
  uploadResultsHandler,
  uploadStaffPhotoHandler,
  uploadStudentPhotoHandler,
  uploadTeacherDocumentsHandler,
  uploadTeacherPhotoHandler
} from "../controllers/uploadController.js";
import {
  uploadAcademicAttachments,
  uploadAccountingAttachments,
  uploadAssignmentAttachments,
  uploadBannerImage,
  uploadClassroomAttachments,
  uploadComplaintAttachments,
  uploadInventoryAttachments,
  uploadLaboratoryAttachments,
  uploadLibraryBookCover,
  uploadLibraryDocuments,
  uploadLibraryEbook,
  uploadProfilePhoto,
  uploadResultsAttachments,
  uploadStaffPhoto,
  uploadStudentDocuments,
  uploadStudentPhoto,
  uploadTeacherDocuments,
  uploadTeacherPhoto
} from "../utils/upload.js";

const router = Router();

router.use(protect);
router.use(tenantGuard);

const adminRoles = ["SUPER_ADMIN", "COLLEGE_ADMIN"] as const;
const staffUploadRoles = [
  "SUPER_ADMIN",
  "COLLEGE_ADMIN",
  "TEACHER",
  "LIBRARY_STAFF",
  "LABORATORY_STAFF",
  "ACCOUNTANT"
] as const;

// ─── Students ───────────────────────────────────────────────────────────────
router.post(
  "/students/:studentId/photo",
  authorize(...adminRoles),
  uploadStudentPhoto,
  uploadStudentPhotoHandler
);

router.post(
  "/students/:studentId/documents",
  authorize(...adminRoles),
  uploadStudentDocuments,
  uploadDocumentsHandler
);

// ─── Teachers / staff photos ────────────────────────────────────────────────
router.post(
  "/teachers/photo",
  authorize(...adminRoles),
  uploadTeacherPhoto,
  uploadTeacherPhotoHandler
);

router.post(
  "/teachers/documents",
  authorize(...adminRoles),
  uploadTeacherDocuments,
  uploadTeacherDocumentsHandler
);

// Backward-compatible alias (frontend still calls /uploads/staff/photo)
router.post(
  "/staff/photo",
  authorize(...adminRoles),
  uploadStaffPhoto,
  uploadStaffPhotoHandler
);

// ─── Profile ────────────────────────────────────────────────────────────────
router.post(
  "/profile",
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
    "PRINCIPAL",
    "PARENT"
  ),
  uploadProfilePhoto,
  uploadProfilePhotoHandler
);

// ─── Assignments / classroom (alias) ────────────────────────────────────────
router.post(
  "/assignments",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER", "STUDENT"),
  uploadAssignmentAttachments,
  uploadClassroomAttachmentsHandler
);

// Backward-compatible alias
router.post(
  "/classroom",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER", "STUDENT"),
  uploadClassroomAttachments,
  uploadClassroomAttachmentsHandler
);

// ─── Notices / banners (alias) ──────────────────────────────────────────────
router.post(
  "/notices",
  authorize(...adminRoles),
  uploadBannerImage,
  uploadBannerImageHandler
);

router.post(
  "/banners",
  authorize(...adminRoles),
  uploadBannerImage,
  uploadBannerImageHandler
);

// ─── Library ────────────────────────────────────────────────────────────────
router.post(
  "/library/book-covers",
  authorize(...adminRoles, "LIBRARY_STAFF"),
  uploadLibraryBookCover,
  uploadLibraryBookCoverHandler
);

router.post(
  "/library/ebooks",
  authorize(...adminRoles, "LIBRARY_STAFF"),
  uploadLibraryEbook,
  uploadLibraryEbookHandler
);

router.post(
  "/library/documents",
  authorize(...adminRoles, "LIBRARY_STAFF"),
  uploadLibraryDocuments,
  uploadLibraryDocumentsHandler
);

// ─── Results ────────────────────────────────────────────────────────────────
router.post(
  "/results",
  authorize(...adminRoles, "TEACHER"),
  uploadResultsAttachments,
  uploadResultsHandler
);

// ─── Laboratory ─────────────────────────────────────────────────────────────
router.post(
  "/laboratory",
  authorize(...adminRoles, "LABORATORY_STAFF", "TEACHER"),
  uploadLaboratoryAttachments,
  uploadLaboratoryHandler
);

// ─── Inventory ──────────────────────────────────────────────────────────────
router.post(
  "/inventory",
  authorize(...staffUploadRoles),
  uploadInventoryAttachments,
  uploadInventoryHandler
);

// ─── Accounting ─────────────────────────────────────────────────────────────
router.post(
  "/accounting",
  authorize(...adminRoles, "ACCOUNTANT", "CASHIER", "AUDITOR"),
  uploadAccountingAttachments,
  uploadAccountingHandler
);

// ─── Academic management ────────────────────────────────────────────────────
router.post(
  "/academic-management",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "TEACHER"),
  uploadAcademicAttachments,
  uploadAcademicAttachmentsHandler
);

// ─── Complaints ─────────────────────────────────────────────────────────────
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

export default router;
