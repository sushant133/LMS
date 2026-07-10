import mongoose, { Schema, type InferSchemaType } from "mongoose";

const addressSchema = new Schema(
  {
    province: { type: String, required: true },
    district: { type: String, required: true },
    municipality: { type: String, required: true },
    ward: { type: String, required: true },
    streetAddress: { type: String, required: true }
  },
  { _id: false }
);

const teacherSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    teacherCode: { type: String, required: true, trim: true },
    qualification: { type: String, required: true },
    joinedDateBs: { type: String, required: true },
    address: { type: addressSchema, required: true },
    subjects: [{ type: Schema.Types.ObjectId, ref: "Subject" }],
    assignedClassIds: [{ type: Schema.Types.ObjectId, ref: "SchoolClass" }],
    assignedSectionIds: [{ type: Schema.Types.ObjectId, ref: "Section" }],
    assignedBatchIds: [{ type: Schema.Types.ObjectId, ref: "Batch" }],
    assignedYearIds: [{ type: Schema.Types.ObjectId, ref: "Year" }],
    /**
     * Dual-read migration marker.
     * Default PENDING (never NA) so pre-existing docs and dual mode stay on legacy arrays.
     * Missing/undefined on old docs treated as PENDING by getTeacherScope.
     */
    assignmentMigrationStatus: {
      type: String,
      enum: ["NA", "PENDING", "NEEDS_REVIEW", "ACCEPTED"],
      default: "PENDING",
      index: true
    },
    basicSalaryNpr: { type: Number, default: 0 }
  },
  { timestamps: true }
);

teacherSchema.index({ schoolId: 1, teacherCode: 1 }, { unique: true });

export type TeacherDocument = InferSchemaType<typeof teacherSchema>;
export const Teacher = mongoose.model("Teacher", teacherSchema);
