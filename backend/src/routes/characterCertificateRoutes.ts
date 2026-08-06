import { Router } from "express";
import {
  createCertificateTemplate,
  deleteCertificateTemplate,
  downloadCertificatePdf,
  getCertificateRecord,
  issueCertificate,
  issueDuplicateCertificate,
  listCertificateRecords,
  listCertificateTemplates,
  listPassedOutStudents,
  previewCertificate,
  updateCertificateTemplate
} from "../controllers/characterCertificateController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

/**
 * Character certificates are restricted to Admin / Super Admin — issuance,
 * reissue, and duplicates are not delegable through the Module Access matrix.
 */
const certificateAdmins = authorize("COLLEGE_ADMIN", "SUPER_ADMIN");

router.use(protect, tenantGuard, certificateAdmins);

router.get("/passed-out-students", listPassedOutStudents);

router.get("/templates", listCertificateTemplates);
router.post("/templates", createCertificateTemplate);
router.put("/templates/:templateId", updateCertificateTemplate);
router.delete("/templates/:templateId", deleteCertificateTemplate);

router.post("/preview", previewCertificate);
router.post("/issue", issueCertificate);

router.get("/", listCertificateRecords);
router.get("/:certificateId", getCertificateRecord);
router.get("/:certificateId/pdf", downloadCertificatePdf);
router.post("/:certificateId/duplicate", issueDuplicateCertificate);

export default router;
