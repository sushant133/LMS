import mongoose, { Schema, type InferSchemaType } from "mongoose";

const cashBookEntrySchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    dateBs: { type: String, required: true },
    entryType: { type: String, enum: ["DEBIT", "CREDIT"], required: true },
    category: { type: String, required: true },
    description: { type: String, required: true },
    amountNpr: { type: Number, required: true },
    paymentMethod: {
      type: String,
      enum: ["CASH", "BANK_TRANSFER", "CHEQUE", "ONLINE", "FONEPAY", "OTHER"],
      default: "CASH"
    },
    referenceType: { type: String },
    referenceId: { type: Schema.Types.ObjectId },
    balanceAfterNpr: { type: Number, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

export type CashBookEntryDocument = InferSchemaType<typeof cashBookEntrySchema>;
export const CashBookEntry = mongoose.model("CashBookEntry", cashBookEntrySchema);