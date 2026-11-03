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
      enum: [
        "CASH",
        "BANK_TRANSFER",
        "CHEQUE",
        "ESEWA",
        "KHALTI",
        "IMEPAY",
        "FONEPAY",
        "CONNECT_IPS",
        "ONLINE",
        "OTHER"
      ],
      default: "CASH"
    },
    referenceType: { type: String },
    referenceId: { type: Schema.Types.ObjectId },
    balanceAfterNpr: { type: Number, required: true },
    /**
     * "LEDGER": receipts are DEBIT, payments CREDIT (the cash book convention). Rows saved
     * before this field existed used the opposite (CREDIT = money in).
     */
    convention: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

export type CashBookEntryDocument = InferSchemaType<typeof cashBookEntrySchema>;
export const CashBookEntry = mongoose.model("CashBookEntry", cashBookEntrySchema);