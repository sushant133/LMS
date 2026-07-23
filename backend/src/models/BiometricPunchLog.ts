import mongoose, { Schema, type InferSchemaType } from "mongoose";
import {
  BIOMETRIC_PERSON_TYPES,
  BIOMETRIC_PUNCH_ACTIONS,
  BIOMETRIC_PUNCH_RESULTS
} from "@phit-erp/shared";

/**
 * Immutable-ish audit log of every device punch received by the LMS.
 * Foundation only — not exposed in UI yet.
 */
const biometricPunchLogSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    deviceId: { type: String, required: true, trim: true, index: true },
    biometricCodeRaw: { type: String, required: true, trim: true },
    biometricCodeNormalized: { type: String, required: true, trim: true, index: true },
    punchAt: { type: Date, required: true, index: true },
    punchTimeHm: { type: String, default: "" },
    dateBs: { type: String, required: true, index: true },
    personType: {
      type: String,
      enum: BIOMETRIC_PERSON_TYPES,
      default: "UNKNOWN",
      index: true
    },
    personId: { type: Schema.Types.ObjectId, index: true },
    result: {
      type: String,
      enum: BIOMETRIC_PUNCH_RESULTS,
      required: true,
      index: true
    },
    action: {
      type: String,
      enum: BIOMETRIC_PUNCH_ACTIONS,
      default: "NONE"
    },
    externalRef: { type: String, trim: true, default: "" },
    message: { type: String, default: "" },
    rawPayload: { type: Schema.Types.Mixed }
  },
  { timestamps: true }
);

biometricPunchLogSchema.index({ schoolId: 1, dateBs: 1, personType: 1 });
biometricPunchLogSchema.index(
  { schoolId: 1, externalRef: 1 },
  {
    unique: true,
    partialFilterExpression: { externalRef: { $type: "string", $gt: "" } }
  }
);

export type BiometricPunchLogDocument = InferSchemaType<typeof biometricPunchLogSchema>;
export const BiometricPunchLog = mongoose.model("BiometricPunchLog", biometricPunchLogSchema);
