import { Router } from "express";
import {
  createBook,
  createLibraryStaff,
  deleteBook,
  deleteLibraryStaff,
  getLibraryDashboard,
  issueBook,
  listBooks,
  listIssues,
  listLibraryStaff,
  listMyBooks,
  returnBook,
  updateBook,
  updateLibraryStaff
} from "../controllers/libraryController.js";
import { authorize, authorizeInstitutionAdmin, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);

router.get("/dashboard", authorize("COLLEGE_ADMIN", "LIBRARY_STAFF"), getLibraryDashboard);
router.get("/my-books", authorize("STUDENT", "TEACHER"), listMyBooks);

router.get("/books", authorize("COLLEGE_ADMIN", "LIBRARY_STAFF"), listBooks);
router.post("/books", authorize("COLLEGE_ADMIN", "LIBRARY_STAFF"), createBook);
router.put("/books/:id", authorize("COLLEGE_ADMIN", "LIBRARY_STAFF"), updateBook);
router.delete("/books/:id", authorize("COLLEGE_ADMIN", "LIBRARY_STAFF"), deleteBook);

router.get("/issues", authorize("COLLEGE_ADMIN", "LIBRARY_STAFF"), listIssues);
router.post("/issues", authorize("COLLEGE_ADMIN", "LIBRARY_STAFF"), issueBook);
router.put("/issues/:id/return", authorize("COLLEGE_ADMIN", "LIBRARY_STAFF"), returnBook);

router.get("/staff", authorizeInstitutionAdmin, listLibraryStaff);
router.post("/staff", authorizeInstitutionAdmin, createLibraryStaff);
router.put("/staff/:id", authorizeInstitutionAdmin, updateLibraryStaff);
router.delete("/staff/:id", authorizeInstitutionAdmin, deleteLibraryStaff);

export default router;