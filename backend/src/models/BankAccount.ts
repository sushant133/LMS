import mongoose, { Schema, type InferSchemaType } from "mongoose";

const bankAccountSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    bankName: { type: String, required: true },
    accountName: { type: String, required: true },
    accountNumber: { type: String, required: true },
    branch: { type: String },
    openingBalanceNpr: { type: Number, default: 0 },
    currentBalanceNpr: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

bankAccountSchema.index({ schoolId: 1, accountNumber: 1 }, { unique: true });

export type BankAccountDocument = InferSchemaType<typeof bankAccountSchema>;
export const BankAccount = mongoose.model("BankAccount", bankAccountSchema);