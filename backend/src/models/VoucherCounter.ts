import mongoose, { Schema, type InferSchemaType } from "mongoose";

/**
 * Atomic sequence source for every numbered document series.
 *
 * Numbers were previously derived from `countDocuments()` (plus, for vouchers, a random
 * suffix), which produced neither sequential nor reuse-proof numbering: the count included
 * reversals and deleted rows, and two users posting at once read the same count. A number
 * that has been handed out must never be handed out again, so the sequence lives here and
 * is issued by a single atomic `$inc` that no delete can wind back.
 *
 * One counter per (school, scope). Scope keys the series and is opaque to this model:
 *   "JV:2083/2084"  journal vouchers for a fiscal year
 *   "RCPT:2083/2084" fee receipts
 *   "CC:2082"       character certificates for a BS year
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
