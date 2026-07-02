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
} from "../controllers/libraryController";
import { authorize, protect } from "../middleware/auth";
import { tenantGuard } from "../middleware/tenant";

const router = Router();

router.use(protect, tenantGuard);

router.get("/dashboard", authorize("SCHOOL_ADMIN", "LIBRARY_STAFF"), getLibraryDashboard);
router.get("/my-books", authorize("STUDENT", "TEACHER"), listMyBooks);

router.get("/books", authorize("SCHOOL_ADMIN", "LIBRARY_STAFF"), listBooks);
router.post("/books", authorize("SCHOOL_ADMIN", "LIBRARY_STAFF"), createBook);
router.put("/books/:id", authorize("SCHOOL_ADMIN", "LIBRARY_STAFF"), updateBook);
router.delete("/books/:id", authorize("SCHOOL_ADMIN", "LIBRARY_STAFF"), deleteBook);

router.get("/issues", authorize("SCHOOL_ADMIN", "LIBRARY_STAFF"), listIssues);
router.post("/issues", authorize("SCHOOL_ADMIN", "LIBRARY_STAFF"), issueBook);
router.put("/issues/:id/return", authorize("SCHOOL_ADMIN", "LIBRARY_STAFF"), returnBook);

router.get("/staff", authorize("SCHOOL_ADMIN"), listLibraryStaff);
router.post("/staff", authorize("SCHOOL_ADMIN"), createLibraryStaff);
router.put("/staff/:id", authorize("SCHOOL_ADMIN"), updateLibraryStaff);
router.delete("/staff/:id", authorize("SCHOOL_ADMIN"), deleteLibraryStaff);

export default router;