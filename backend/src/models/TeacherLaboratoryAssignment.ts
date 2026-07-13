import mongoose, { Schema, type InferSchemaType } from "mongoose";

/**
 * Multi-lab responsibility for a single Teacher account.
 * One teacher may have many ACTIVE lab rows; one lab may have multiple teachers
 * (e.g. IN_CHARGE + ASSISTANT) via separate rows.
 */
const teacherLaboratoryAssignmentSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "Teacher", required: true, index: true },
    laboratoryId: { type: Schema.Types.ObjectId, ref: "Laboratory", required: true, index: true },
    role: {
      type: String,
      enum: ["IN_CHARGE", "ASSISTANT", "INSTRUCTOR"],
      default: "IN_CHARGE",
      required: true
    },
    assignedFromBs: { type: String, required: true },
    assignedToBs: { type: String, default: null },
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE"],
      default: "ACTIVE",
      required: true,
      index: true
    },
    remarks: { type: String, default: "" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

// One ACTIVE row per teacher + lab + role
teacherLaboratoryAssignmentSchema.index(
  { schoolId: 1, teacherId: 1, laboratoryId: 1, role: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "ACTIVE" },
    name: "uniq_active_teacher_lab_role"
  }
);

teacherLaboratoryAssignmentSchema.index({ schoolId: 1, teacherId: 1, status: 1 });
teacherLaboratoryAssignmentSchema.index({ schoolId: 1, laboratoryId: 1, status: 1 });

export type TeacherLaboratoryAssignmentDocument = InferSchemaType<
  typeof teacherLaboratoryAssignmentSchema
>;
export const TeacherLaboratoryAssignment = mongoose.model(
  "TeacherLaboratoryAssignment",
  teacherLaboratoryAssignmentSchema
);
