import mongoose, { Schema, type InferSchemaType } from "mongoose";

const budgetLineSchema = new Schema(
  {
    accountCode: { type: String, required: true },
    accountName: { type: String, default: "" },
    budgetedNpr: { type: Number, required: true, default: 0 },
    notes: { type: String, default: "" }
  },
  { _id: false }
);

/**
 * Annual budget for one fiscal year, held per ledger account.
 *
 * Budget figures are stored separately from the ledger and never posted, so a budget can
 * be revised freely without affecting the books; the variance report compares these
 * figures against actual journal balances at read time.
 */
const budgetSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    fiscalYearBs: { type: String, required: true, index: true },
    title: { type: String, default: "" },
    lines: { type: [budgetLineSchema], default: [] },
    totalIncomeBudgetNpr: { type: Number, default: 0 },
    totalExpenseBudgetNpr: { type: Number, default: 0 },
    status: { type: String, enum: ["DRAFT", "APPROVED"], default: "DRAFT" },
    approvedAt: { type: Date },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    notes: { type: String, default: "" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

budgetSchema.index(
  { schoolId: 1, fiscalYearBs: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

export type BudgetDocument = InferSchemaType<typeof budgetSchema>;
export const Budget = mongoose.model("Budget", budgetSchema);
