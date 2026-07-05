import mongoose, { Schema, type InferSchemaType } from "mongoose";

const financialApprovalSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    entityType: {
      type: String,
      enum: ["FeeCollection", "AccountingExpense", "AccountingPurchase", "AccountingIncome", "FeeRefund", "SalaryPayment"],
      required: true
    },
    entityId: { type: Schema.Types.ObjectId, required: true },
    actionType: {
      type: String,
      enum: ["REVERSE", "VOID"],
      required: true
    },
    amountNpr: { type: Number, required: true },
    reason: { type: String, required: true },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
      index: true
    },
    requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    rejectionReason: { type: String },
    beforeSnapshot: { type: Schema.Types.Mixed },
    isDeleted: { type: Boolean, default: false }
  },
  { timestamps: true }
);

financialApprovalSchema.index({ schoolId: 1, status: 1, createdAt: -1 });

export type FinancialApprovalDocument = InferSchemaType<typeof financialApprovalSchema>;
export const FinancialApproval = mongoose.model("FinancialApproval", financialApprovalSchema);