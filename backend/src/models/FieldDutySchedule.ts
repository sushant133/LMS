import mongoose, { Schema, type InferSchemaType } from "mongoose";

/**
 * Field Management posting (Community/PHC/Hospital and future types).
 * Extends the original hospital field-duty schedule without breaking legacy rows.
 */
const fieldDutyScheduleSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    academicYearBs: { type: String, required: true, index: true },
    faculty: { type: String, default: "" },
    semesterBs: { type: String, default: "" },
    batchId: { type: Schema.Types.ObjectId, ref: "Batch", required: true, index: true },
    yearId: { type: Schema.Types.ObjectId, ref: "Year", required: true, index: true },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section" },
    /**
     * Configurable posting type — not a hard enum so new types can be added later.
     * Defaults: COMMUNITY, PHC, HOSPITAL, CLINICAL_ROTATION, …
     */
    postingType: { type: String, required: true, default: "HOSPITAL", index: true, trim: true },
    /** Site display name (Hospital / PHC / Community). Kept in sync with hospitalName. */
    siteName: { type: String, default: "", trim: true },
    /** Legacy required field — same as siteName for older clients. */
    hospitalName: { type: String, required: true, trim: true },
    address: { type: String, default: "" },
    department: { type: String, default: "", trim: true },
    ward: { type: String, default: "" },
    /** Primary field coordinator — CollegeStaff only (not a new employee type). */
    supervisorStaffId: { type: Schema.Types.ObjectId, ref: "CollegeStaff", required: true, index: true },
    /** Optional assistant coordinators from CollegeStaff. */
    assistantCoordinatorStaffIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "CollegeStaff" }],
      default: []
    },
    /** @deprecated Kept only so legacy rows still load until reassigned */
    supervisorTeacherId: { type: Schema.Types.ObjectId, ref: "Teacher", required: false, index: true },
    clinicalInstructorName: { type: String, default: "" },
    hospitalSupervisorName: { type: String, default: "" },
    startDateBs: { type: String, required: true },
    endDateBs: { type: String, required: true },
    shift: {
      type: String,
      enum: ["MORNING", "DAY", "EVENING", "NIGHT", "FULL_DAY"],
      default: "DAY"
    },
    remarks: { type: String, default: "" },
    status: {
      type: String,
      enum: ["ACTIVE", "COMPLETED", "CANCELLED"],
      default: "ACTIVE",
      index: true
    },
    /**
     * AUTO_BATCH_YEAR = all active students in batch+year (single shift).
     * MANUAL = assignedStudentIds only (single shift).
     * MULTI_SHIFT = studentShifts maps each student to MORNING/DAY/EVENING/NIGHT/FULL_DAY;
     *   attendance is taken separately per shift.
     */
    rosterMode: {
      type: String,
      enum: ["AUTO_BATCH_YEAR", "MANUAL", "MULTI_SHIFT"],
      default: "AUTO_BATCH_YEAR"
    },
    assignedStudentIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "Student" }],
      default: []
    },
    /** Per-student shift for MULTI_SHIFT mode. */
    studentShifts: {
      type: [
        {
          _id: false,
          studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
          shift: {
            type: String,
            enum: ["MORNING", "DAY", "EVENING", "NIGHT", "FULL_DAY"],
            required: true
          }
        }
      ],
      default: []
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isDeleted: { type: Boolean, default: false, index: true }
  },
  { timestamps: true }
);

fieldDutyScheduleSchema.index({ schoolId: 1, supervisorStaffId: 1, status: 1 });
fieldDutyScheduleSchema.index({ schoolId: 1, batchId: 1, yearId: 1, status: 1 });
fieldDutyScheduleSchema.index({ schoolId: 1, postingType: 1, status: 1 });
fieldDutyScheduleSchema.index({ schoolId: 1, assistantCoordinatorStaffIds: 1 });

export type FieldDutyScheduleDocument = InferSchemaType<typeof fieldDutyScheduleSchema>;
export const FieldDutySchedule = mongoose.model("FieldDutySchedule", fieldDutyScheduleSchema);
