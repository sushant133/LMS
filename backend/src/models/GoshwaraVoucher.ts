import mongoose, { Schema, type InferSchemaType } from "mongoose";

const goshwaraLineSchema = new Schema(
  {
    accountCode: { type: String, required: true },
    accountName: { type: String, required: true },
    debitNpr: { type: Number, default: 0 },
    creditNpr: { type: Number, default: 0 },
    description: { type: String }
  },
  { _id: false }
);

const printLineSchema = new Schema(
  {
    sn: { type: String },
    particulars: { type: String },
    account: { type: String },
    ledgerNo: { type: String },
    debit: { type: Number },
    credit: { type: Number }
  },
  { _id: false }
);

const goshwaraVoucherSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    voucherNo: { type: String, required: true, trim: true },
    voucherType: {
      type: String,
      enum: ["JOURNAL", "RECEIPT", "PAYMENT", "CONTRA", "SALES", "PURCHASE"],
      default: "JOURNAL"
    },
    dateBs: { type: String, required: true, index: true },
    fiscalYearBs: { type: String, required: true, index: true },
    particulars: { type: String, required: true },
    /** Government office name under नेपाल सरकार → printed as "{name} कार्यालय" */
    govOfficeName: { type: String, default: "" },
    /** Institute name line */
    instituteName: { type: String, default: "" },
    /** Address / ward line */
    addressLine: { type: String, default: "" },
    /** Legacy single office field */
    officeName: { type: String, default: "" },
    /** Free-text rows shown on the paper-style PDF table */
    printLines: { type: [printLineSchema], default: [] },
    receiptNo: { type: String, default: "" },
    receivedAmount: { type: String, default: "" },
    presenterName: { type: String, default: "" },
    presenterRank: { type: String, default: "" },
    chequeNo: { type: String, default: "" },
    chequeAmount: { type: String, default: "" },
    chequePresenter: { type: String, default: "" },
    chequeDate: { type: String, default: "" },
    chequeRank: { type: String, default: "" },
    amountInWords: { type: String, default: "" },
    lines: { type: [goshwaraLineSchema], required: true },
    totalAmount: { type: Number, required: true },
    totalDebitNpr: { type: Number, required: true },
    totalCreditNpr: { type: Number, required: true },
    journalEntryId: { type: Schema.Types.ObjectId, ref: "JournalEntry", required: true },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

goshwaraVoucherSchema.index({ schoolId: 1, voucherNo: 1 }, { unique: true });
goshwaraVoucherSchema.index({ schoolId: 1, journalEntryId: 1 });

export type GoshwaraVoucherDocument = InferSchemaType<typeof goshwaraVoucherSchema>;
export const GoshwaraVoucher = mongoose.model("GoshwaraVoucher", goshwaraVoucherSchema);
