import mongoose, { Schema, type InferSchemaType } from "mongoose";

const vendorSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    name: { type: String, required: true, trim: true },
    panNumber: { type: String, trim: true },
    vatNumber: { type: String, trim: true },
    contactPerson: { type: String },
    phone: { type: String },
    email: { type: String },
    address: { type: String },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false }
  },
  { timestamps: true }
);

vendorSchema.index({ schoolId: 1, name: 1 });

export type VendorDocument = InferSchemaType<typeof vendorSchema>;
export const Vendor = mongoose.model("Vendor", vendorSchema);