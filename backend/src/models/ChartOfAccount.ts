import mongoose, { Schema, type InferSchemaType } from "mongoose";

const chartOfAccountSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    nameNp: { type: String },
    accountType: { type: String, enum: ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"], required: true },
    parentCode: { type: String },
    description: { type: String },
    isSystem: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

chartOfAccountSchema.index({ schoolId: 1, code: 1 }, { unique: true });

export type ChartOfAccountDocument = InferSchemaType<typeof chartOfAccountSchema>;
export const ChartOfAccount = mongoose.model("ChartOfAccount", chartOfAccountSchema);