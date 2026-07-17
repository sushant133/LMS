import crypto from "crypto";
import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { COLLEGE_STAFF_CATEGORIES, EMPLOYMENT_TYPES, HR_DOCUMENT_STATUSES } from "@phit-erp/shared";

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

const collegeStaffSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User" },
    staffId: { type: String, required: true, trim: true },
    fullName: { type: String, required: true },
    photoUrl: { type: String },
    documents: { type: [hrDocumentSchema], default: [] },
    gender: { type: String, required: true },
    dateOfBirthBs: { type: String },
    phone: { type: String, required: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: addressSchema, required: true },
    emergencyContactName: { type: String, trim: true },
    emergencyContactPhone: { type: String, trim: true },
    joinedDateBs: { type: String, required: true },
    designation: { type: String, required: true },
    department: { type: String, trim: true },
    category: { type: String, enum: COLLEGE_STAFF_CATEGORIES, required: true, index: true },
    customRoleLabel: { type: String, trim: true },
    qualification: { type: String, trim: true },
    experienceYears: { type: Number, min: 0, default: 0 },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, default: "FULL_TIME" },
    basicSalaryNpr: { type: Number, default: 0 },
    remarks: { type: String, trim: true },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE" },
    enableLogin: { type: Boolean, default: true },
    credentialsEmailStatus: {
      type: String,
      enum: ["PENDING", "SENT", "FAILED", "SKIPPED"],
      default: "PENDING"
    },
    credentialsEmailError: { type: String, trim: true },
    credentialsEmailSentAt: { type: Date },
    isDeleted: { type: Boolean, default: false }
  },
  { timestamps: true }
);

collegeStaffSchema.index({ schoolId: 1, staffId: 1 }, { unique: true });
collegeStaffSchema.index({ schoolId: 1, category: 1, isDeleted: 1 });
collegeStaffSchema.index({ schoolId: 1, email: 1 });
collegeStaffSchema.index({ user: 1 }, { sparse: true });

export type CollegeStaffDocument = InferSchemaType<typeof collegeStaffSchema>;
export const CollegeStaff = mongoose.model("CollegeStaff", collegeStaffSchema);
