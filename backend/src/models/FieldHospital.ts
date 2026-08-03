import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { softDeletePlugin } from "../plugins/softDeletePlugin.js";

/** Registry of hospitals / clinical sites used by Hospital Roster (additive). */
const fieldHospitalSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    name: { type: String, required: true, trim: true },
    address: { type: String, default: "", trim: true },
    contact: { type: String, default: "", trim: true },
    coordinatorStaffId: { type: Schema.Types.ObjectId, ref: "CollegeStaff" },
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE"],
      default: "ACTIVE",
      index: true,
    },
    remarks: { type: String, default: "" },
    isDeleted: { type: Boolean, default: false, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

fieldHospitalSchema.index({ schoolId: 1, name: 1 });

export type FieldHospitalDocument = InferSchemaType<typeof fieldHospitalSchema>;
fieldHospitalSchema.plugin(softDeletePlugin);
export const FieldHospital = mongoose.model("FieldHospital", fieldHospitalSchema);
