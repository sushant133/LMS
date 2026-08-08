import { Router } from "express";
import {
  createDepartment,
  createDutyCode,
  createHospital,
  createHospitalRoster,
  createShift,
  deleteDepartment,
  deleteDutyCode,
  deleteHospital,
  deleteHospitalRoster,
  deleteShift,
  getHospitalRoster,
  getHospitalRosterDayAssignments,
  getHospitalRosterSummary,
  listDepartments,
  listDutyCodes,
  listHospitalRosters,
  listHospitals,
  listShifts,
  lockHospitalRoster,
  unlockHospitalRoster,
  updateDepartment,
  updateDutyCode,
  updateHospital,
  updateHospitalRoster,
  updateHospitalRosterCells,
  updateHospitalRosterStudents,
  updateShift,
} from "../controllers/hospitalRosterController.js";
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

router.use(protect, tenantGuard);

const FIELD_READ = [
  "SUPER_ADMIN",
  "COLLEGE_ADMIN",
  "COLLEGE_VIEWER",
  "COLLEGE_STAFF",
] as const;

/**
 * Roster / hospital master mutations.
 * COLLEGE_STAFF allowed at route level; controller requires Field Management Manage.
 */
const FIELD_ADMIN = ["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_STAFF"] as const;

// Hospitals (multi-hospital registry — does not alter FieldDutySchedule)
router.get("/hospitals", authorize(...FIELD_READ), listHospitals);
router.post("/hospitals", authorize(...FIELD_ADMIN), createHospital);
router.put("/hospitals/:id", authorize(...FIELD_ADMIN), updateHospital);
router.delete("/hospitals/:id", authorize(...FIELD_ADMIN), deleteHospital);

// Departments
router.get("/departments", authorize(...FIELD_READ), listDepartments);
router.post("/departments", authorize(...FIELD_ADMIN), createDepartment);
router.put("/departments/:id", authorize(...FIELD_ADMIN), updateDepartment);
router.delete("/departments/:id", authorize(...FIELD_ADMIN), deleteDepartment);

// Duty shifts
router.get("/shifts", authorize(...FIELD_READ), listShifts);
router.post("/shifts", authorize(...FIELD_ADMIN), createShift);
router.put("/shifts/:id", authorize(...FIELD_ADMIN), updateShift);
router.delete("/shifts/:id", authorize(...FIELD_ADMIN), deleteShift);

// Free codes (Off / Leave / custom) — same pattern as departments & shifts
router.get("/duty-codes", authorize(...FIELD_READ), listDutyCodes);
router.post("/duty-codes", authorize(...FIELD_ADMIN), createDutyCode);
router.put("/duty-codes/:id", authorize(...FIELD_ADMIN), updateDutyCode);
router.delete("/duty-codes/:id", authorize(...FIELD_ADMIN), deleteDutyCode);

// Hospital rosters (From–To date period)
router.get("/hospital-rosters", authorize(...FIELD_READ), listHospitalRosters);
router.post("/hospital-rosters", authorize(...FIELD_ADMIN), createHospitalRoster);
router.get("/hospital-rosters/:id", authorize(...FIELD_READ), getHospitalRoster);
router.put("/hospital-rosters/:id", authorize(...FIELD_ADMIN), updateHospitalRoster);
router.delete("/hospital-rosters/:id", authorize(...FIELD_ADMIN), deleteHospitalRoster);
router.put(
  "/hospital-rosters/:id/students",
  authorize(...FIELD_ADMIN),
  updateHospitalRosterStudents,
);
router.put(
  "/hospital-rosters/:id/cells",
  authorize(...FIELD_ADMIN),
  updateHospitalRosterCells,
);
router.post(
  "/hospital-rosters/:id/lock",
  authorize(...FIELD_ADMIN),
  lockHospitalRoster,
);
router.post(
  "/hospital-rosters/:id/unlock",
  authorize(...FIELD_ADMIN),
  unlockHospitalRoster,
);
router.get(
  "/hospital-rosters/:id/summary",
  authorize(...FIELD_READ),
  getHospitalRosterSummary,
);
router.get(
  "/hospital-rosters/:id/day-assignments",
  authorize(...FIELD_READ),
  getHospitalRosterDayAssignments,
);

export default router;
