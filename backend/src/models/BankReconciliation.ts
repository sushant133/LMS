import mongoose, { Schema, type InferSchemaType } from "mongoose";

/**
 * A bank reconciliation as at a statement date.
 *
 * Rather than mutating journal entries, a reconciliation records which vouchers had
 * cleared the bank by its statement date. The ledger stays immutable and a reconciliation
 * can be reopened or superseded without touching accounting data.
 */
const bankReconciliationSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    bankAccountId: { type: Schema.Types.ObjectId, ref: "BankAccount", index: true },
    /** Ledger account being reconciled (defaults to the system Bank account). */
    accountCode: { type: String, required: true, default: "1101" },
    statementDateBs: { type: String, required: true, index: true },
    /** Closing balance printed on the bank statement. */
    statementBalanceNpr: { type: Number, required: true },
    /** Journal entries confirmed as cleared on or before the statement date. */
    clearedEntryIds: { type: [{ type: Schema.Types.ObjectId, ref: "JournalEntry" }], default: [] },

    /** Snapshot of the computed figures at the time the reconciliation was completed. */
    ledgerBalanceNpr: { type: Number, default: 0 },
    unpresentedChequesNpr: { type: Number, default: 0 },
    depositsInTransitNpr: { type: Number, default: 0 },
    adjustedBalanceNpr: { type: Number, default: 0 },
    differenceNpr: { type: Number, default: 0 },

    status: { type: String, enum: ["DRAFT", "COMPLETED"], default: "DRAFT", index: true },
    completedAt: { type: Date },
    completedBy: { type: Schema.Types.ObjectId, ref: "User" },
    notes: { type: String, default: "" },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

bankReconciliationSchema.index({ schoolId: 1, accountCode: 1, statementDateBs: -1 });

export type BankReconciliationDocument = InferSchemaType<typeof bankReconciliationSchema>;
export const BankReconciliation = mongoose.model("BankReconciliation", bankReconciliationSchema);
