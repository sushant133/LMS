import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import {
  LABORATORY_EQUIPMENT_CONDITIONS,
  LABORATORY_EQUIPMENT_STATUSES,
  LABORATORY_ITEM_KINDS,
  LABORATORY_STOCK_MOVEMENT_TYPES,
  LABORATORY_STOCK_PRIORITIES,
  LABORATORY_STOCK_REQUEST_STATUSES,
  LABORATORY_TYPES
} from "@phit-erp/shared";

const laboratorySchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, trim: true },
    type: { type: String, enum: LABORATORY_TYPES, required: true },
    customName: { type: String, trim: true },
    department: { type: String, trim: true },
    academicProgram: { type: String, trim: true },
    description: { type: String, trim: true },
    location: { type: String, trim: true },
    roomNumber: { type: String, trim: true },
    inChargeTeacherId: { type: Schema.Types.ObjectId, ref: "Teacher", default: null },
    remarks: { type: String, trim: true },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

laboratorySchema.index({ schoolId: 1, name: 1 }, { unique: true });
laboratorySchema.index({ schoolId: 1, code: 1 }, { unique: true, sparse: true });
laboratorySchema.index({ schoolId: 1, inChargeTeacherId: 1 });

export type LaboratoryDocument = HydratedDocument<InferSchemaType<typeof laboratorySchema>>;
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

export type LaboratoryCategoryDocument = HydratedDocument<
  InferSchemaType<typeof laboratoryCategorySchema>
>;
export const LaboratoryCategory = mongoose.model("LaboratoryCategory", laboratoryCategorySchema);

const laboratoryEquipmentSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    laboratoryId: { type: Schema.Types.ObjectId, ref: "Laboratory", required: true, index: true },
    categoryId: { type: Schema.Types.ObjectId, ref: "LaboratoryCategory", required: true },
    name: { type: String, required: true, trim: true },
    itemCode: { type: String, required: true, trim: true },
    itemKind: { type: String, enum: LABORATORY_ITEM_KINDS, default: "NON_DISPOSABLE" },
    brand: { type: String, trim: true },
    /** Equipment model/make (not Mongoose Document.model). */
    equipmentModel: { type: String, trim: true },
    unit: { type: String, trim: true, default: "pcs" },
    quantity: { type: Number, required: true, min: 0 },
    availableQuantity: { type: Number, required: true, min: 0 },
    minimumStockLevel: { type: Number, default: 0, min: 0 },
    purchaseDateBs: { type: String, trim: true },
    supplier: { type: String, trim: true },
    purchaseCost: { type: Number, min: 0 },
    storageLocation: { type: String, trim: true },
    condition: { type: String, enum: LABORATORY_EQUIPMENT_CONDITIONS, default: "GOOD" },
    equipmentStatus: { type: String, enum: LABORATORY_EQUIPMENT_STATUSES, default: "AVAILABLE" },
    description: { type: String, trim: true },
    remarks: { type: String, trim: true }
  },
  { timestamps: true }
);

laboratoryEquipmentSchema.index({ schoolId: 1, itemCode: 1 }, { unique: true });
laboratoryEquipmentSchema.index({ laboratoryId: 1, name: 1 });
laboratoryEquipmentSchema.index({ schoolId: 1, availableQuantity: 1, minimumStockLevel: 1 });

export type LaboratoryEquipmentDocument = HydratedDocument<
  InferSchemaType<typeof laboratoryEquipmentSchema>
>;
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

export type LaboratoryIssueDocument = HydratedDocument<InferSchemaType<typeof laboratoryIssueSchema>>;
export const LaboratoryIssue = mongoose.model("LaboratoryIssue", laboratoryIssueSchema);

const laboratoryStockMovementSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    laboratoryId: { type: Schema.Types.ObjectId, ref: "Laboratory", required: true, index: true },
    equipmentId: { type: Schema.Types.ObjectId, ref: "LaboratoryEquipment", required: true, index: true },
    type: { type: String, enum: LABORATORY_STOCK_MOVEMENT_TYPES, required: true },
    quantity: { type: Number, required: true, min: 1 },
    previousStock: { type: Number, required: true, min: 0 },
    newStock: { type: Number, required: true, min: 0 },
    notes: { type: String, trim: true },
    performedByUserId: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

laboratoryStockMovementSchema.index({ schoolId: 1, createdAt: -1 });
laboratoryStockMovementSchema.index({ equipmentId: 1, createdAt: -1 });

export type LaboratoryStockMovementDocument = HydratedDocument<
  InferSchemaType<typeof laboratoryStockMovementSchema>
>;
export const LaboratoryStockMovement = mongoose.model(
  "LaboratoryStockMovement",
  laboratoryStockMovementSchema
);

const laboratoryStockRequestSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    laboratoryId: { type: Schema.Types.ObjectId, ref: "Laboratory", required: true, index: true },
    equipmentId: { type: Schema.Types.ObjectId, ref: "LaboratoryEquipment", default: null },
    equipmentName: { type: String, required: true, trim: true },
    categoryName: { type: String, trim: true },
    currentStock: { type: Number, required: true, min: 0, default: 0 },
    minimumStock: { type: Number, required: true, min: 0, default: 0 },
    requiredQuantity: { type: Number, required: true, min: 1 },
    priority: { type: String, enum: LABORATORY_STOCK_PRIORITIES, default: "MEDIUM" },
    requestedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    requestDateBs: { type: String, required: true },
    status: { type: String, enum: LABORATORY_STOCK_REQUEST_STATUSES, default: "PENDING" },
    adminNotes: { type: String, trim: true },
    autoGenerated: { type: Boolean, default: false },
    receivedQuantity: { type: Number, min: 0 }
  },
  { timestamps: true }
);

laboratoryStockRequestSchema.index({ schoolId: 1, status: 1, createdAt: -1 });
laboratoryStockRequestSchema.index({ laboratoryId: 1, status: 1 });
laboratoryStockRequestSchema.index(
  { schoolId: 1, equipmentId: 1, status: 1 },
  {
    partialFilterExpression: {
      status: { $in: ["PENDING", "APPROVED", "PURCHASED"] },
      equipmentId: { $type: "objectId" }
    }
  }
);

export type LaboratoryStockRequestDocument = HydratedDocument<
  InferSchemaType<typeof laboratoryStockRequestSchema>
>;
export const LaboratoryStockRequest = mongoose.model(
  "LaboratoryStockRequest",
  laboratoryStockRequestSchema
);
