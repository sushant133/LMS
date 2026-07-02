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

const accountantSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    employeeId: { type: String, required: true, trim: true },
    gender: { type: String, required: true },
    address: { type: addressSchema, required: true },
    joinedDateBs: { type: String, required: true },
    photoUrl: { type: String },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE" },
    isDeleted: { type: Boolean, default: false }
  },
  { timestamps: true }
);

accountantSchema.index({ schoolId: 1, employeeId: 1 }, { unique: true });

export type AccountantDocument = InferSchemaType<typeof accountantSchema>;
export const Accountant = mongoose.model("Accountant", accountantSchema);