import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { softDeletePlugin } from "../plugins/softDeletePlugin.js";
import { FINANCE_CATEGORY_KINDS } from "@phit-erp/shared";

const financeCategorySchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    name: { type: String, required: true, trim: true },
    kind: {
      type: String,
      enum: FINANCE_CATEGORY_KINDS,
      default: "EXPENSE",
      index: true
    },
    description: { type: String, trim: true },
    isSystem: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 }
  },
  { timestamps: true }
);

financeCategorySchema.index({ schoolId: 1, name: 1 }, { unique: true });
financeCategorySchema.index({ schoolId: 1, kind: 1, isActive: 1 });

export type FinanceCategoryDocument = InferSchemaType<typeof financeCategorySchema>;
financeCategorySchema.plugin(softDeletePlugin);
export const FinanceCategory = mongoose.model("FinanceCategory", financeCategorySchema);
