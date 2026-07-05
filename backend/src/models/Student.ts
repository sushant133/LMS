import crypto from "crypto";
import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { BLOOD_GROUPS, DISABILITY_CATEGORIES, ETHNICITY_CATEGORIES, STUDENT_DOCUMENT_STATUSES } from "@phit-erp/shared";

const studentDocumentSchema = new Schema(
  {
    _id: { type: String, default: () => crypto.randomUUID() },
    type: { type: String, required: true },
    name: { type: String, required: true },
    url: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String },
    size: { type: Number, required: true },
    status: { type: String, enum: STUDENT_DOCUMENT_STATUSES, default: "UPLOADED" },
    uploadedAt: { type: String, required: true },
    uploadedBy: { type: String, required: true },
    uploadedByName: { type: String },
    notes: { type: String }
  },
  { _id: false }
);

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

const studentSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    admissionNumber: { type: String, required: true, trim: true },
    rollNumber: { type: Number, required: true },
    classId: { type: Schema.Types.ObjectId, ref: "SchoolClass" },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section" },
    batchId: { type: Schema.Types.ObjectId, ref: "Batch" },
    yearId: { type: Schema.Types.ObjectId, ref: "Year" },
    admissionDateBs: { type: String, required: true },
    dateOfBirthBs: { type: String, required: true },
    gender: { type: String, required: true },
    bloodGroup: { type: String, enum: BLOOD_GROUPS },
    disabilityCategory: { type: String, enum: DISABILITY_CATEGORIES },
    ethnicityCategory: { type: String, enum: ETHNICITY_CATEGORIES },
    address: { type: addressSchema, required: true },
    fatherName: { type: String, required: true },
    fatherPhone: { type: String, trim: true },
    motherName: { type: String, required: true },
    motherPhone: { type: String, trim: true },
    guardianName: { type: String, required: true },
    guardianPhone: { type: String, required: true },
    feesDueNpr: { type: Number, default: 0 },
    remarks: { type: String },
    // Phase 0 - Foundation fields
    photoUrl: { type: String },
    documents: { type: [studentDocumentSchema], default: [] }
  },
  { timestamps: true }
);

studentSchema.index({ schoolId: 1, admissionNumber: 1 }, { unique: true });
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
