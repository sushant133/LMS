import crypto from "crypto";
import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { HR_DOCUMENT_STATUSES } from "@phit-erp/shared";

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

const hrDocumentSchema = new Schema(
  {
    _id: { type: String, default: () => crypto.randomUUID() },
    type: { type: String, required: true },
    name: { type: String, required: true },
    url: { type: String, default: "" },
    originalName: { type: String, default: "" },
    mimeType: { type: String },
    size: { type: Number, default: 0 },
    status: { type: String, enum: HR_DOCUMENT_STATUSES, default: "UPLOADED" },
    uploadedAt: { type: String, default: "" },
    uploadedBy: { type: String, default: "" },
    uploadedByName: { type: String },
    notes: { type: String }
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
    basicSalaryNpr: { type: Number, default: 0 },
    photoUrl: { type: String },
    documents: { type: [hrDocumentSchema], default: [] },
    /**
     * Employment / portal status. INACTIVE disables login (User.isActive = false).
     * Defaults ACTIVE for existing teachers without the field.
     */
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE"],
      default: "ACTIVE",
      index: true
    }
  },
  { timestamps: true }
);

teacherSchema.index({ schoolId: 1, teacherCode: 1 }, { unique: true });
teacherSchema.index({ schoolId: 1, status: 1 });

export type TeacherDocument = InferSchemaType<typeof teacherSchema>;
export const Teacher = mongoose.model("Teacher", teacherSchema);
