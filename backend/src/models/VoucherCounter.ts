import mongoose, { Schema, type InferSchemaType } from "mongoose";

/**
 * Atomic sequence source for voucher numbering.
 *
 * Voucher numbers were previously derived from `countDocuments()` plus a random suffix,
 * which produced neither sequential nor gap-free numbering: the count included reversals
 * and soft-deleted entries, and two cashiers posting at once read the same count. IRD
 * expects a gap-free series per fiscal year, so the sequence is now held here and handed
 * out by a single atomic `$inc`.
 *
 * One counter per (school, scope) where scope is e.g. "JV:2083/2084".
 */
const voucherCounterSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    /** `${voucherPrefix}:${fiscalYearBs}` */
    scope: { type: String, required: true, trim: true },
    seq: { type: Number, required: true, default: 0 }
  },
  { timestamps: true }
);

voucherCounterSchema.index({ schoolId: 1, scope: 1 }, { unique: true });

export type VoucherCounterDocument = InferSchemaType<typeof voucherCounterSchema>;
export const VoucherCounter = mongoose.model("VoucherCounter", voucherCounterSchema);
