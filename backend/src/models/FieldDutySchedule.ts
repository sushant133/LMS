import mongoose, { Schema, type InferSchemaType } from "mongoose";

const fieldDutyScheduleSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    academicYearBs: { type: String, required: true, index: true },
    faculty: { type: String, default: "" },
    batchId: { type: Schema.Types.ObjectId, ref: "Batch", required: true, index: true },
    yearId: { type: Schema.Types.ObjectId, ref: "Year", required: true, index: true },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section" },
    hospitalName: { type: String, required: true, trim: true },
    department: { type: String, required: true, trim: true },
    ward: { type: String, default: "" },
    supervisorTeacherId: { type: Schema.Types.ObjectId, ref: "Teacher", required: true, index: true },
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
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isDeleted: { type: Boolean, default: false, index: true }
  },
  { timestamps: true }
);

fieldDutyScheduleSchema.index({ schoolId: 1, supervisorTeacherId: 1, status: 1 });
fieldDutyScheduleSchema.index({ schoolId: 1, batchId: 1, yearId: 1, status: 1 });

export type FieldDutyScheduleDocument = InferSchemaType<typeof fieldDutyScheduleSchema>;
export const FieldDutySchedule = mongoose.model("FieldDutySchedule", fieldDutyScheduleSchema);
