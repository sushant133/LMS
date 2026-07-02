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

const schoolSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    nameNp: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    principalName: { type: String, required: true, trim: true },
    academicYearBs: { type: String, required: true, trim: true },
    address: { type: addressSchema, required: true },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export type SchoolDocument = InferSchemaType<typeof schoolSchema>;
export const School = mongoose.model("School", schoolSchema);