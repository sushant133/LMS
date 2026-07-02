import mongoose, { Schema, type InferSchemaType } from "mongoose";

const accountingSettingsSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, unique: true },
    lateFinePercent: { type: Number, default: 0 },
    lateFineGraceDays: { type: Number, default: 0 },
    receiptPrefix: { type: String, default: "RCPT" },
    autoReceiptNumber: { type: Boolean, default: true },
    defaultPaymentMethod: { type: String, enum: ["CASH", "BANK_TRANSFER", "CHEQUE", "ONLINE", "OTHER"], default: "CASH" }
  },
  { timestamps: true }
);

export type AccountingSettingsDocument = InferSchemaType<typeof accountingSettingsSchema>;
export const AccountingSettings = mongoose.model("AccountingSettings", accountingSettingsSchema);