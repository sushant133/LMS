import mongoose, { Schema, type InferSchemaType } from "mongoose";

const rosterCellSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    day: { type: Number, required: true, min: 1, max: 32 },
    shiftId: { type: Schema.Types.ObjectId, ref: "DutyShift" },
    departmentId: { type: Schema.Types.ObjectId, ref: "HospitalDepartment" },
    code: { type: String, default: "", trim: true },
    remarks: { type: String, default: "", trim: true },
  },
  { _id: false },
);

/**
 * Monthly hospital clinical duty roster (student × day grid).
 * Independent of FieldDutySchedule so existing postings/attendance stay intact.
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
    monthBs: { type: String, required: true, index: true },
    daysInMonth: { type: Number, required: true, min: 28, max: 32, default: 30 },
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
hospitalRosterSchema.index({ schoolId: 1, batchId: 1, yearId: 1, status: 1 });

export type HospitalRosterDocument = InferSchemaType<typeof hospitalRosterSchema>;
export const HospitalRoster = mongoose.model("HospitalRoster", hospitalRosterSchema);
