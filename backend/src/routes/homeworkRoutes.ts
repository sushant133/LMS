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
} from "../controllers/homeworkController";
import { authorize, protect } from "../middleware/auth";
import { tenantGuard } from "../middleware/tenant";

const router = Router();

router.use(protect, tenantGuard);
router.get("/feed", listFeed);
router.get("/topics", listTopics);
router.get("/", listAssignments);
router.post("/", authorize("TEACHER"), createAssignment);
router.post("/submissions", authorize("STUDENT", "PARENT"), submitAssignment);
router.put("/submissions/:id/grade", authorize("TEACHER"), gradeSubmission);
router.get("/:id", getAssignment);
router.put("/:id", authorize("TEACHER"), updateAssignment);
router.put("/:id/pin", authorize("TEACHER"), togglePin);
router.delete("/:id", authorize("TEACHER"), deleteAssignment);
router.get("/:id/comments", listComments);
router.post("/:id/comments", authorize("TEACHER", "STUDENT", "PARENT"), addComment);
router.get("/:assignmentId/submissions", listSubmissions);

export default router;