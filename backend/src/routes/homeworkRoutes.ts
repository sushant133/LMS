import { Router } from "express";
import {
  addComment,
  createAssignment,
  deleteAssignment,
  getAssignment,
  gradeSubmission,
  listAssignments,
  listComments,
  listFeed,
  listSubmissions,
  listTopics,
  submitAssignment,
  togglePin,
  updateAssignment
} from "../controllers/homeworkController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

/** Classroom/homework is only for academic roles — not library/lab/accounting staff. */
const homeworkReaders = authorize("COLLEGE_ADMIN", "TEACHER", "STUDENT", "PARENT");
const submissionReaders = authorize("COLLEGE_ADMIN", "TEACHER", "STUDENT", "PARENT");

router.use(protect, tenantGuard);
router.get("/feed", homeworkReaders, listFeed);
router.get("/topics", homeworkReaders, listTopics);
router.get("/", homeworkReaders, listAssignments);
router.post("/", authorize("TEACHER"), createAssignment);
router.post("/submissions", authorize("STUDENT", "PARENT"), submitAssignment);
router.put("/submissions/:id/grade", authorize("TEACHER"), gradeSubmission);
router.get("/:id", homeworkReaders, getAssignment);
router.put("/:id", authorize("TEACHER"), updateAssignment);
router.put("/:id/pin", authorize("TEACHER"), togglePin);
router.delete("/:id", authorize("TEACHER"), deleteAssignment);
router.get("/:id/comments", homeworkReaders, listComments);
router.post("/:id/comments", authorize("TEACHER", "STUDENT", "PARENT"), addComment);
router.get("/:assignmentId/submissions", submissionReaders, listSubmissions);

export default router;