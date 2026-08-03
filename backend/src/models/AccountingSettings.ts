import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { softDeletePlugin } from "../plugins/softDeletePlugin.js";

const accountingSettingsSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, unique: true },
    lateFinePercent: { type: Number, default: 0 },
    lateFineGraceDays: { type: Number, default: 0 },
    receiptPrefix: { type: String, default: "RCPT" },
    autoReceiptNumber: { type: Boolean, default: true },
    defaultPaymentMethod: {
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
    voucherPrefix: { type: String, default: "JV" },
    currentFiscalYearBs: { type: String, default: "2083/2084" },
    auditLockDateBs: { type: String },
    panNumber: { type: String },
    vatNumber: { type: String },
    tdsEnabled: { type: Boolean, default: false },
    institutionSignatureUrl: { type: String },
    /** Amount (NPR) above which reversals/voids require principal/admin approval */
    approvalThresholdNpr: { type: Number, default: 25000 }
  },
  { timestamps: true }
);

export type AccountingSettingsDocument = InferSchemaType<typeof accountingSettingsSchema>;
accountingSettingsSchema.plugin(softDeletePlugin);
export const AccountingSettings = mongoose.model("AccountingSettings", accountingSettingsSchema);