import { Router } from "express";
import {
  createEvent,
  deleteEvent,
  getAcademicCalendarDashboard,
  getEvent,
  listAcademicCalendarYears,
  listEvents,
  updateEvent
} from "../controllers/academicCalendarController.js";
import { authorize, authorizeInstitutionAdmin, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

const calendarViewRoles = [
  "SUPER_ADMIN",
  "COLLEGE_ADMIN",
  "COLLEGE_VIEWER",
  "TEACHER",
  "STUDENT",
  "PARENT",
  "COLLEGE_STAFF",
  "LIBRARY_STAFF",
  "LABORATORY_STAFF",
  "ACCOUNTANT",
  "CASHIER",
  "AUDITOR",
  "PRINCIPAL"
] as const;

router.use(protect, tenantGuard);

router.get("/dashboard", authorize(...calendarViewRoles), getAcademicCalendarDashboard);
router.get("/years", authorize(...calendarViewRoles), listAcademicCalendarYears);
router.get("/events", authorize(...calendarViewRoles), listEvents);
router.get("/events/:id", authorize(...calendarViewRoles), getEvent);
router.post("/events", authorizeInstitutionAdmin, createEvent);
router.put("/events/:id", authorizeInstitutionAdmin, updateEvent);
router.delete("/events/:id", authorizeInstitutionAdmin, deleteEvent);

export default router;