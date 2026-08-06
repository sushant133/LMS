import mongoose, { Schema, type InferSchemaType } from "mongoose";

const fiscalYearSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    yearBs: { type: String, required: true, trim: true },
    startDateBs: { type: String, required: true },
    endDateBs: { type: String, required: true },
    isCurrent: { type: Boolean, default: false },
    isClosed: { type: Boolean, default: false },
    closedAt: { type: Date },
    closedBy: { type: Schema.Types.ObjectId, ref: "User" },
    /** Journal voucher that transferred this year's surplus to Accumulated Fund. */
    closingEntryId: { type: Schema.Types.ObjectId, ref: "JournalEntry" },
    /** Surplus (+) or deficit (−) transferred to Accumulated Fund at close. */
    closingSurplusNpr: { type: Number }
  },
  { timestamps: true }
);

fiscalYearSchema.index({ schoolId: 1, yearBs: 1 }, { unique: true });

export type FiscalYearDocument = InferSchemaType<typeof fiscalYearSchema>;
export const FiscalYear = mongoose.model("FiscalYear", fiscalYearSchema);