import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { LABORATORY_TYPES } from "@nepal-school-erp/shared";

const laboratorySchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: LABORATORY_TYPES, required: true },
    customName: { type: String, trim: true },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

laboratorySchema.index({ schoolId: 1, name: 1 }, { unique: true });

export type LaboratoryDocument = InferSchemaType<typeof laboratorySchema>;
export const Laboratory = mongoose.model("Laboratory", laboratorySchema);

const laboratoryCategorySchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    laboratoryId: { type: Schema.Types.ObjectId, ref: "Laboratory", required: true, index: true },
    name: { type: String, required: true, trim: true },
    isDefault: { type: Boolean, default: false }
  },
  { timestamps: true }
);

laboratoryCategorySchema.index({ laboratoryId: 1, name: 1 }, { unique: true });

export type LaboratoryCategoryDocument = InferSchemaType<typeof laboratoryCategorySchema>;
export const LaboratoryCategory = mongoose.model("LaboratoryCategory", laboratoryCategorySchema);

const laboratoryEquipmentSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    laboratoryId: { type: Schema.Types.ObjectId, ref: "Laboratory", required: true, index: true },
    categoryId: { type: Schema.Types.ObjectId, ref: "LaboratoryCategory", required: true },
    name: { type: String, required: true, trim: true },
    itemCode: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    availableQuantity: { type: Number, required: true, min: 0 },
    description: { type: String, trim: true }
  },
  { timestamps: true }
);

laboratoryEquipmentSchema.index({ schoolId: 1, itemCode: 1 }, { unique: true });

export type LaboratoryEquipmentDocument = InferSchemaType<typeof laboratoryEquipmentSchema>;
export const LaboratoryEquipment = mongoose.model("LaboratoryEquipment", laboratoryEquipmentSchema);

const laboratoryIssueSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    equipmentId: { type: Schema.Types.ObjectId, ref: "LaboratoryEquipment", required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "Teacher", required: true },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    issuedDateBs: { type: String, required: true },
    dueDateBs: { type: String, required: true },
    returnedDateBs: { type: String },
    status: { type: String, enum: ["ISSUED", "RETURNED", "OVERDUE"], default: "ISSUED" }
  },
  { timestamps: true }
);

export type LaboratoryIssueDocument = InferSchemaType<typeof laboratoryIssueSchema>;
export const LaboratoryIssue = mongoose.model("LaboratoryIssue", laboratoryIssueSchema);