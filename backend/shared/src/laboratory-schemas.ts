import { z } from "zod";
import {
  LABORATORY_EQUIPMENT_CONDITIONS,
  LABORATORY_EQUIPMENT_STATUSES,
  LABORATORY_ITEM_KINDS,
  LABORATORY_REPORT_TYPES,
  LABORATORY_STOCK_MOVEMENT_TYPES,
  LABORATORY_STOCK_PRIORITIES,
  LABORATORY_STOCK_REQUEST_STATUSES,
  LABORATORY_TYPES
} from "./laboratory-constants.js";
import { objectIdSchema, bsDateSchema, moneySchema } from "./schemas.js";

export const laboratorySchema = z
  .object({
    type: z.enum(LABORATORY_TYPES),
    customName: z.string().optional().or(z.literal("")),
    name: z.string().min(1).optional(),
    code: z.string().trim().max(40).optional().or(z.literal("")),
    department: z.string().trim().max(120).optional().or(z.literal("")),
    academicProgram: z.string().trim().max(120).optional().or(z.literal("")),
    description: z.string().trim().max(2000).optional().or(z.literal("")),
    location: z.string().trim().max(120).optional().or(z.literal("")),
    roomNumber: z.string().trim().max(40).optional().or(z.literal("")),
    inChargeTeacherId: objectIdSchema.optional().or(z.literal("")),
    remarks: z.string().trim().max(2000).optional().or(z.literal("")),
    isActive: z.boolean().default(true)
  })
  .superRefine((value, ctx) => {
    if (value.type === "OTHER" && !value.customName?.trim() && !value.name?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "Custom laboratory name is required",
        path: ["customName"]
      });
    }
  });

export const laboratoryCategorySchema = z.object({
  name: z.string().min(1)
});

export const laboratoryEquipmentSchema = z.object({
  laboratoryId: objectIdSchema,
  categoryId: objectIdSchema,
  name: z.string().min(2),
  itemCode: z.string().trim().max(40).optional().or(z.literal("")),
  itemKind: z.enum(LABORATORY_ITEM_KINDS).default("NON_DISPOSABLE"),
  brand: z.string().trim().max(100).optional().or(z.literal("")),
  equipmentModel: z.string().trim().max(100).optional().or(z.literal("")),
  unit: z.string().trim().max(40).optional().or(z.literal("")),
  quantity: z.coerce.number().int().min(0),
  minimumStockLevel: z.coerce.number().int().min(0).default(0),
  purchaseDateBs: bsDateSchema.optional().or(z.literal("")),
  supplier: z.string().trim().max(150).optional().or(z.literal("")),
  purchaseCost: moneySchema.optional(),
  storageLocation: z.string().trim().max(120).optional().or(z.literal("")),
  condition: z.enum(LABORATORY_EQUIPMENT_CONDITIONS).default("GOOD"),
  equipmentStatus: z.enum(LABORATORY_EQUIPMENT_STATUSES).default("AVAILABLE"),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  remarks: z.string().trim().max(2000).optional().or(z.literal(""))
});

export const laboratoryEquipmentUpdateSchema = laboratoryEquipmentSchema.partial().extend({
  laboratoryId: objectIdSchema.optional(),
  categoryId: objectIdSchema.optional()
});

export const laboratoryStockAdjustSchema = z.object({
  type: z.enum(LABORATORY_STOCK_MOVEMENT_TYPES),
  quantity: z.coerce.number().int().min(1),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  condition: z.enum(LABORATORY_EQUIPMENT_CONDITIONS).optional(),
  equipmentStatus: z.enum(LABORATORY_EQUIPMENT_STATUSES).optional()
});

export const laboratoryIssueSchema = z.object({
  equipmentId: objectIdSchema,
  teacherId: objectIdSchema,
  quantity: z.coerce.number().int().min(1).default(1),
  issuedDateBs: bsDateSchema,
  dueDateBs: bsDateSchema
});

export const laboratoryReturnSchema = z.object({
  returnedDateBs: bsDateSchema,
  quantity: z.coerce.number().int().min(1).optional()
});

export const laboratoryStockRequestSchema = z.object({
  laboratoryId: objectIdSchema,
  equipmentId: objectIdSchema.optional().or(z.literal("")),
  equipmentName: z.string().min(1).max(200),
  categoryName: z.string().trim().max(120).optional().or(z.literal("")),
  currentStock: z.coerce.number().int().min(0).default(0),
  minimumStock: z.coerce.number().int().min(0).default(0),
  requiredQuantity: z.coerce.number().int().min(1),
  priority: z.enum(LABORATORY_STOCK_PRIORITIES).default("MEDIUM"),
  remarks: z.string().trim().max(2000).optional().or(z.literal(""))
});

export const laboratoryStockRequestStatusSchema = z.object({
  status: z.enum(LABORATORY_STOCK_REQUEST_STATUSES),
  adminNotes: z.string().trim().max(2000).optional().or(z.literal("")),
  receivedQuantity: z.coerce.number().int().min(0).optional()
});

export const laboratoryReportQuerySchema = z.object({
  reportType: z.enum(LABORATORY_REPORT_TYPES),
  laboratoryId: objectIdSchema.optional().or(z.literal("")),
  format: z.enum(["json", "csv"]).default("json")
});

export type LaboratoryInput = z.infer<typeof laboratorySchema>;
export type LaboratoryCategoryInput = z.infer<typeof laboratoryCategorySchema>;
export type LaboratoryEquipmentInput = z.infer<typeof laboratoryEquipmentSchema>;
export type LaboratoryEquipmentUpdateInput = z.infer<typeof laboratoryEquipmentUpdateSchema>;
export type LaboratoryStockAdjustInput = z.infer<typeof laboratoryStockAdjustSchema>;
export type LaboratoryIssueInput = z.infer<typeof laboratoryIssueSchema>;
export type LaboratoryReturnInput = z.infer<typeof laboratoryReturnSchema>;
export type LaboratoryStockRequestInput = z.infer<typeof laboratoryStockRequestSchema>;
export type LaboratoryStockRequestStatusInput = z.infer<typeof laboratoryStockRequestStatusSchema>;
export type LaboratoryReportQueryInput = z.infer<typeof laboratoryReportQuerySchema>;
