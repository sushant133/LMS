import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { COLLEGE_STAFF_CATEGORIES, EMPLOYMENT_TYPES } from "@nepal-school-erp/shared";

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

const collegeStaffSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User" },
    staffId: { type: String, required: true, trim: true },
    fullName: { type: String, required: true },
    photoUrl: { type: String },
    gender: { type: String, required: true },
    dateOfBirthBs: { type: String },
    phone: { type: String, required: true },
    email: { type: String },
    address: { type: addressSchema, required: true },
    joinedDateBs: { type: String, required: true },
    designation: { type: String, required: true },
    category: { type: String, enum: COLLEGE_STAFF_CATEGORIES, required: true, index: true },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, default: "FULL_TIME" },
    basicSalaryNpr: { type: Number, default: 0 },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE" },
    enableLogin: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false }
  },
  { timestamps: true }
);

collegeStaffSchema.index({ schoolId: 1, staffId: 1 }, { unique: true });
collegeStaffSchema.index({ schoolId: 1, category: 1, isDeleted: 1 });

export type CollegeStaffDocument = InferSchemaType<typeof collegeStaffSchema>;
export const CollegeStaff = mongoose.model("CollegeStaff", collegeStaffSchema);