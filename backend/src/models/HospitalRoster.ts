import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { softDeletePlugin } from "../plugins/softDeletePlugin.js";

const rosterCellSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    /**
     * Day index within the roster period (1 = startDateBs).
     * Legacy month-only rosters used calendar day-of-month.
     */
    day: { type: Number, required: true, min: 1, max: 93 },
    shiftId: { type: Schema.Types.ObjectId, ref: "DutyShift" },
    departmentId: { type: Schema.Types.ObjectId, ref: "HospitalDepartment" },
    code: { type: String, default: "", trim: true },
    remarks: { type: String, default: "", trim: true },
  },
  { _id: false },
);

/**
 * Hospital clinical duty roster (student × day grid).
 * Period is From–To BS dates (min 1 day). Independent of FieldDutySchedule.
 */
const hospitalRosterSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    name: { type: String, required: true, trim: true },
    academicYearBs: { type: String, required: true, index: true },
    program: { type: String, default: "", trim: true },
    batchId: { type: Schema.Types.ObjectId, ref: "Batch", required: true, index: true },
    yearId: { type: Schema.Types.ObjectId, ref: "Year", required: true, index: true },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section" },
    hospitalId: {
      type: Schema.Types.ObjectId,
      ref: "FieldHospital",
      required: true,
      index: true,
    },
    /** Inclusive period start (BS YYYY-MM-DD). */
    startDateBs: { type: String, default: "", index: true },
    /** Inclusive period end (BS YYYY-MM-DD). */
    endDateBs: { type: String, default: "", index: true },
    /** BS month of start (YYYY-MM) — kept for list filters / legacy attendance. */
    monthBs: { type: String, required: true, index: true },
    /** Inclusive day count for the period (1–93). */
    daysInMonth: { type: Number, required: true, min: 1, max: 93, default: 30 },
    coordinatorStaffId: { type: Schema.Types.ObjectId, ref: "CollegeStaff" },
    remarks: { type: String, default: "" },
    status: {
      type: String,
      enum: ["DRAFT", "PUBLISHED", "LOCKED"],
      default: "DRAFT",
      index: true,
    },
    studentIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "Student" }],
      default: [],
    },
    cells: { type: [rosterCellSchema], default: [] },
    preparedByName: { type: String, default: "" },
    approvedByName: { type: String, default: "" },
    lockedAt: { type: Date },
    lockedBy: { type: Schema.Types.ObjectId, ref: "User" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

hospitalRosterSchema.index({ schoolId: 1, monthBs: 1, hospitalId: 1 });
hospitalRosterSchema.index({ schoolId: 1, startDateBs: 1, endDateBs: 1 });
hospitalRosterSchema.index({ schoolId: 1, batchId: 1, yearId: 1, status: 1 });

export type HospitalRosterDocument = InferSchemaType<typeof hospitalRosterSchema>;
hospitalRosterSchema.plugin(softDeletePlugin);
export const HospitalRoster = mongoose.model("HospitalRoster", hospitalRosterSchema);
