import mongoose, { Schema, type InferSchemaType } from "mongoose";

const journalLineSchema = new Schema(
  {
    accountCode: { type: String, required: true },
    accountName: { type: String, required: true },
    debitNpr: { type: Number, default: 0 },
    creditNpr: { type: Number, default: 0 },
    description: { type: String }
  },
  { _id: false }
);

const journalEntrySchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    voucherNumber: { type: String, required: true, trim: true },
    voucherType: {
      type: String,
      enum: ["JOURNAL", "RECEIPT", "PAYMENT", "CONTRA", "SALES", "PURCHASE"],
      default: "JOURNAL"
    },
    dateBs: { type: String, required: true, index: true },
    fiscalYearBs: { type: String, required: true, index: true },
    narration: { type: String, required: true },
    lines: { type: [journalLineSchema], required: true },
    totalDebitNpr: { type: Number, required: true },
    totalCreditNpr: { type: Number, required: true },
    referenceType: {
      type: String,
      enum: [
        "FeeCollection",
        "FeeRefund",
        "AccountingExpense",
        "AccountingIncome",
        "AccountingPurchase",
        "SalaryPayment",
        "CashBookEntry",
        "GoshwaraVoucher",
        "Manual"
      ]
    },
    referenceId: { type: Schema.Types.ObjectId },
    studentId: { type: Schema.Types.ObjectId, ref: "Student" },
    bankAccountId: { type: Schema.Types.ObjectId, ref: "BankAccount" },
    isReversal: { type: Boolean, default: false },
    /** True when a reversal entry has been posted against this original. */
    isReversed: { type: Boolean, default: false },
    reversedEntryId: { type: Schema.Types.ObjectId, ref: "JournalEntry" },
    isPosted: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

journalEntrySchema.index({ schoolId: 1, voucherNumber: 1 }, { unique: true });
journalEntrySchema.index({ schoolId: 1, referenceType: 1, referenceId: 1 });

export type JournalEntryDocument = InferSchemaType<typeof journalEntrySchema>;
export const JournalEntry = mongoose.model("JournalEntry", journalEntrySchema);