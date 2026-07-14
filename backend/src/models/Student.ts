import crypto from "crypto";
import mongoose, { Schema, type InferSchemaType } from "mongoose";
import {
  BLOOD_GROUPS,
  DISABILITY_CATEGORIES,
  ETHNICITY_CATEGORIES,
  STUDENT_ACADEMIC_STATUSES,
  STUDENT_DOCUMENT_STATUSES
} from "@phit-erp/shared";

const studentDocumentSchema = new Schema(
  {
    _id: { type: String, default: () => crypto.randomUUID() },
    type: { type: String, required: true },
    name: { type: String, required: true },
    // File fields optional so PENDING placeholders can exist without an upload
    url: { type: String, default: "" },
    originalName: { type: String, default: "" },
    mimeType: { type: String },
    size: { type: Number, default: 0 },
    status: { type: String, enum: STUDENT_DOCUMENT_STATUSES, default: "UPLOADED" },
    uploadedAt: { type: String, default: "" },
    uploadedBy: { type: String, default: "" },
    uploadedByName: { type: String },
    notes: { type: String }
  },
  { _id: false }
);

const addressSchema = new Schema(
  {
    province: { type: String, default: "" },
    district: { type: String, default: "" },
    municipality: { type: String, default: "" },
    ward: { type: String, default: "" },
    streetAddress: { type: String, default: "" }
  },
  { _id: false }
);

const studentSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    admissionNumber: { type: String, required: true, trim: true },
    rollNumber: { type: Number, default: 0 },
    classId: { type: Schema.Types.ObjectId, ref: "SchoolClass" },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section" },
    batchId: { type: Schema.Types.ObjectId, ref: "Batch" },
    yearId: { type: Schema.Types.ObjectId, ref: "Year" },
    academicStatus: {
      type: String,
      enum: STUDENT_ACADEMIC_STATUSES,
      default: "ACTIVE",
      index: true
    },
    admissionDateBs: { type: String, default: "" },
    dateOfBirthBs: { type: String, default: "" },
    gender: { type: String, default: "" },
    bloodGroup: { type: String, enum: BLOOD_GROUPS },
    disabilityCategory: { type: String, enum: DISABILITY_CATEGORIES },
    ethnicityCategory: { type: String, enum: ETHNICITY_CATEGORIES },
    address: {
      type: addressSchema,
      default: () => ({
        province: "",
        district: "",
        municipality: "",
        ward: "",
        streetAddress: ""
      })
    },
    fatherName: { type: String, default: "" },
    fatherPhone: { type: String, trim: true, default: "" },
    motherName: { type: String, default: "" },
    motherPhone: { type: String, trim: true, default: "" },
    guardianName: { type: String, default: "" },
    guardianPhone: { type: String, default: "" },
    feesDueNpr: { type: Number, default: 0 },
    /** Full scholarship — UI shows "Scholarship" instead of a fee amount. */
    hasScholarship: { type: Boolean, default: false },
    remarks: { type: String },
    // Phase 0 - Foundation fields
    photoUrl: { type: String },
    documents: { type: [studentDocumentSchema], default: [] }
  },
  { timestamps: true }
);

studentSchema.index({ schoolId: 1, admissionNumber: 1 }, { unique: true });
studentSchema.index({ schoolId: 1, academicStatus: 1 });
studentSchema.index(
  { schoolId: 1, rollNumber: 1, classId: 1, sectionId: 1 },
  { unique: true, partialFilterExpression: { classId: { $exists: true }, sectionId: { $exists: true } } }
);
studentSchema.index(
  { schoolId: 1, rollNumber: 1, batchId: 1, yearId: 1 },
  { unique: true, partialFilterExpression: { batchId: { $exists: true }, yearId: { $exists: true } } }
);

export type StudentDocument = InferSchemaType<typeof studentSchema>;
export const Student = mongoose.model("Student", studentSchema);
