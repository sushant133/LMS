import type { Request, Response } from "express";
import {
  DEFAULT_LAB_CATEGORIES,
  laboratoryCategorySchema,
  laboratoryEquipmentSchema,
  laboratoryEquipmentUpdateSchema,
  laboratoryIssueSchema,
  laboratoryReportQuerySchema,
  laboratoryReturnSchema,
  laboratorySchema,
  laboratoryStockAdjustSchema,
  laboratoryStockRequestSchema,
  laboratoryStockRequestStatusSchema,
  moduleStaffSchema,
  isInstitutionAdmin
} from "@phit-erp/shared";
import {
  Laboratory,
  LaboratoryCategory,
  LaboratoryEquipment,
  LaboratoryIssue,
  LaboratoryStockMovement,
  LaboratoryStockRequest
} from "../models/Laboratory.js";
import { Teacher } from "../models/Teacher.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";
import {
  buildCredentialsAdminMessage,
  notifyAccountCredentials,
  resolvePortalPassword
} from "../utils/credentialEmail.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import {
  assertCanDeleteLaboratory,
  assertLabAccess,
  labScopeFilter,
  resolveLabAccess
} from "../utils/laboratoryAccess.js";
import {
  applyStockChange,
  enrichEquipmentInventory,
  generateNextItemCode,
  generateNextLabCode,
  getStockPriority,
  recordUserId,
  syncLowStockRequests
} from "../utils/laboratoryInventory.js";
import { compareBsDates, getTodayBs } from "../utils/nepaliDate.js";
import { sendNotification } from "../utils/notificationService.js";
import { sendSuccess } from "../utils/response.js";
import { withTenantScope } from "../utils/tenant.js";

const LAB_TYPE_LABELS: Record<string, string> = {
  COMPUTER: "Computer Lab",
  PHYSICS: "Physics Lab",
  CHEMISTRY: "Chemistry Lab",
  BIOLOGY: "Biology Lab",
  OTHER: "Custom Lab"
};

const getLaboratoryName = (
  type: string,
  customName?: string | null,
  explicitName?: string | null
): string => {
  if (explicitName?.trim()) {
    return explicitName.trim();
  }
  if (type === "OTHER") {
    return customName?.trim() || "Custom Lab";
  }
  return LAB_TYPE_LABELS[type] ?? type;
};

const emptyToUndef = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const syncEquipmentOverdueStatuses = async (schoolId: string): Promise<void> => {
  const todayBs = getTodayBs();
  const activeIssues = await LaboratoryIssue.find({
    schoolId,
    status: { $in: ["ISSUED", "OVERDUE"] }
  });

  await Promise.all(
    activeIssues.map(async (issue) => {
      if (issue.status === "RETURNED") {
        return;
      }

      const comparison = compareBsDates(todayBs, issue.dueDateBs);
      if (comparison > 0 && issue.status !== "OVERDUE") {
        issue.status = "OVERDUE";
        await issue.save();
      } else if (comparison <= 0 && issue.status === "OVERDUE") {
        issue.status = "ISSUED";
        await issue.save();
      }
    })
  );
};

const formatLab = (lab: Record<string, unknown>) => {
  const teacher = lab.inChargeTeacherId as
    | { _id?: unknown; user?: { fullName?: string } }
    | string
    | null
    | undefined;
  let inChargeTeacherId: string | null = null;
  let inChargeTeacherName: string | undefined;

  if (teacher && typeof teacher === "object" && "_id" in teacher) {
    inChargeTeacherId = String(teacher._id);
    inChargeTeacherName = teacher.user?.fullName;
  } else if (teacher) {
    inChargeTeacherId = String(teacher);
  }

  return {
    ...lab,
    inChargeTeacherId,
    inChargeTeacherName
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const formatEquipment = (item: any) => {
  const lab = item.laboratoryId as { _id?: unknown; name?: string } | string | null;
  const category = item.categoryId as { _id?: unknown; name?: string } | string | null;

  const laboratoryId =
    lab && typeof lab === "object" && lab._id != null ? String(lab._id) : String(item.laboratoryId);
  const categoryId =
    category && typeof category === "object" && category._id != null
      ? String(category._id)
      : String(item.categoryId);

  return {
    ...enrichEquipmentInventory({
      ...item,
      laboratoryId,
      categoryId,
      quantity: Number(item.quantity ?? 0),
      availableQuantity: Number(item.availableQuantity ?? 0),
      minimumStockLevel: Number(item.minimumStockLevel ?? 0)
    }),
    laboratoryName: lab && typeof lab === "object" ? lab.name : undefined,
    categoryName: category && typeof category === "object" ? category.name : undefined
  };
};

const paramId = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
};

// ─── Dashboard ───────────────────────────────────────────────────────────────

export const getLaboratoryDashboard = asyncHandler(async (req: Request, res: Response) => {
  const access = await resolveLabAccess(req);
  await syncEquipmentOverdueStatuses(req.tenantSchoolId!);

  const labFilter = access.isGlobalManager
    ? withTenantScope(req)
    : withTenantScope(req, { _id: { $in: access.assignedLabIds } });

  const equipmentFilter = access.isGlobalManager
    ? withTenantScope(req)
    : withTenantScope(req, labScopeFilter(access));

  const [labs, equipment, pendingRequests] = await Promise.all([
    Laboratory.countDocuments(labFilter),
    LaboratoryEquipment.find(equipmentFilter)
      .populate("laboratoryId", "name")
      .populate("categoryId", "name")
      .sort({ updatedAt: -1 })
      .lean(),
    LaboratoryStockRequest.countDocuments(
      withTenantScope(
        req,
        labScopeFilter(access, { status: { $in: ["PENDING", "APPROVED", "PURCHASED"] } })
      )
    )
  ]);

  const enriched = equipment.map((item) => formatEquipment(item as Record<string, unknown>));
  const lowStockItems = enriched.filter(
    (item) =>
      item.status === "LOW_STOCK" ||
      item.status === "CRITICAL_STOCK" ||
      item.status === "OUT_OF_STOCK"
  );

  return sendSuccess(res, "Laboratory dashboard fetched", {
    totalLaboratories: labs,
    totalEquipment: enriched.length,
    availableEquipment: enriched.reduce((sum, item) => sum + item.availableQuantity, 0),
    issuedEquipment: enriched.reduce((sum, item) => sum + item.issuedQuantity, 0),
    remainingStock: enriched.reduce((sum, item) => sum + item.availableQuantity, 0),
    lowStockItemsCount: lowStockItems.filter((i) => i.status !== "OUT_OF_STOCK").length,
    outOfStockItemsCount: lowStockItems.filter((i) => i.status === "OUT_OF_STOCK").length,
    damagedItemsCount: enriched.filter((i) => i.condition === "DAMAGED").length,
    pendingRequestsCount: pendingRequests,
    lowStockItems: lowStockItems.slice(0, 15),
    recentlyAdded: [...enriched]
      .sort(
        (a, b) =>
          new Date(String(b.createdAt ?? 0)).getTime() - new Date(String(a.createdAt ?? 0)).getTime()
      )
      .slice(0, 8),
    recentlyUpdated: enriched.slice(0, 8),
    scopedToAssignedLabs: !access.isGlobalManager
  });
});

// ─── Laboratories ────────────────────────────────────────────────────────────

export const listLaboratories = asyncHandler(async (req: Request, res: Response) => {
  const access = await resolveLabAccess(req);
  const baseFilter = access.isGlobalManager
    ? withTenantScope(req)
    : withTenantScope(req, { _id: { $in: access.assignedLabIds } });

  const yearLevel =
    typeof req.query.yearLevel === "string" && req.query.yearLevel.trim()
      ? req.query.yearLevel.trim()
      : undefined;
  const filter =
    yearLevel && yearLevel !== "ALL"
      ? { ...baseFilter, yearLevel }
      : baseFilter;

  const labs = await Laboratory.find(filter)
    .populate({ path: "inChargeTeacherId", populate: { path: "user", select: "fullName" } })
    .sort({ yearLevel: 1, name: 1 })
    .lean();

  return sendSuccess(
    res,
    "Laboratories fetched",
    labs.map((lab) => formatLab(lab as Record<string, unknown>))
  );
});

export const createLaboratory = asyncHandler(async (req: Request, res: Response) => {
  const access = await resolveLabAccess(req);
  if (!access.isAdmin && access.role !== "LABORATORY_STAFF") {
    throw new ApiError(403, "Only administrators can create laboratories");
  }

  const payload = laboratorySchema.parse(req.body);
  const name = getLaboratoryName(payload.type, payload.customName, payload.name);
  const existing = await Laboratory.findOne(withTenantScope(req, { name }));
  if (existing) {
    throw new ApiError(409, "A laboratory with this name already exists");
  }

  let inChargeTeacherId: string | undefined;
  if (payload.inChargeTeacherId) {
    const teacher = await Teacher.findOne(
      withTenantScope(req, { _id: payload.inChargeTeacherId })
    );
    if (!teacher) {
      throw new ApiError(404, "Laboratory in-charge teacher not found");
    }
    inChargeTeacherId = teacher._id.toString();
  }

  const code =
    emptyToUndef(payload.code) ?? (await generateNextLabCode(req.tenantSchoolId!, payload.type));

  const codeExists = await Laboratory.findOne(withTenantScope(req, { code }));
  if (codeExists) {
    throw new ApiError(409, "A laboratory with this code already exists");
  }

  const lab = await Laboratory.create({
    schoolId: req.tenantSchoolId,
    name,
    code,
    type: payload.type,
    yearLevel: payload.yearLevel ?? "All Years",
    // Keep user-facing name on customName for templates + OTHER
    customName: emptyToUndef(payload.customName) ?? emptyToUndef(payload.name) ?? name,
    department: emptyToUndef(payload.department),
    academicProgram: emptyToUndef(payload.academicProgram),
    description: emptyToUndef(payload.description),
    location: emptyToUndef(payload.location),
    roomNumber: emptyToUndef(payload.roomNumber),
    inChargeTeacherId: inChargeTeacherId ?? null,
    remarks: emptyToUndef(payload.remarks),
    isActive: payload.isActive
  });

  const categories = DEFAULT_LAB_CATEGORIES[payload.type] ?? DEFAULT_LAB_CATEGORIES.OTHER;
  await LaboratoryCategory.insertMany(
    categories.map((categoryName) => ({
      schoolId: req.tenantSchoolId,
      laboratoryId: lab._id,
      name: categoryName,
      isDefault: true
    }))
  );

  await recordAudit(req, {
    action: "CREATE",
    entity: "Laboratory",
    entityId: lab._id.toString(),
    after: lab.toObject()
  });

  return sendSuccess(res, "Laboratory created", lab, 201);
});

export const updateLaboratory = asyncHandler(async (req: Request, res: Response) => {
  const access = await resolveLabAccess(req);
  const lab = await Laboratory.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!lab) {
    throw new ApiError(404, "Laboratory not found");
  }

  assertLabAccess(access, lab._id.toString());

  // Teachers manage inventory only; lab metadata is admin/staff.
  if (!access.isAdmin && access.role !== "LABORATORY_STAFF") {
    throw new ApiError(403, "Only administrators can update laboratory details");
  }

  const payload = laboratorySchema.partial().parse(req.body);
  const before = lab.toObject();

  const nextType = payload.type ?? lab.type;
  const nextCustomName = payload.customName !== undefined ? payload.customName : lab.customName;
  const nextName = getLaboratoryName(
    nextType,
    nextCustomName,
    payload.name !== undefined ? payload.name : lab.name
  );

  const duplicate = await Laboratory.findOne({
    schoolId: req.tenantSchoolId,
    name: nextName,
    _id: { $ne: lab._id }
  });
  if (duplicate) {
    throw new ApiError(409, "A laboratory with this name already exists");
  }

  if (payload.code !== undefined) {
    const nextCode = emptyToUndef(payload.code);
    if (nextCode) {
      const codeDup = await Laboratory.findOne({
        schoolId: req.tenantSchoolId,
        code: nextCode,
        _id: { $ne: lab._id }
      });
      if (codeDup) {
        throw new ApiError(409, "A laboratory with this code already exists");
      }
      lab.code = nextCode;
    }
  }

  lab.type = nextType;
  lab.customName = nextType === "OTHER" ? emptyToUndef(nextCustomName as string) : undefined;
  lab.name = nextName;
  if (payload.yearLevel !== undefined) lab.yearLevel = payload.yearLevel;

  if (payload.department !== undefined) lab.department = emptyToUndef(payload.department);
  if (payload.academicProgram !== undefined) {
    lab.academicProgram = emptyToUndef(payload.academicProgram);
  }
  if (payload.description !== undefined) lab.description = emptyToUndef(payload.description);
  if (payload.location !== undefined) lab.location = emptyToUndef(payload.location);
  if (payload.roomNumber !== undefined) lab.roomNumber = emptyToUndef(payload.roomNumber);
  if (payload.remarks !== undefined) lab.remarks = emptyToUndef(payload.remarks);
  if (payload.isActive !== undefined) lab.isActive = payload.isActive;

  if (payload.inChargeTeacherId !== undefined) {
    if (!access.isAdmin && access.role !== "LABORATORY_STAFF") {
      throw new ApiError(403, "Only administrators can assign laboratory in-charge");
    }
    if (!payload.inChargeTeacherId) {
      lab.set("inChargeTeacherId", null);
      // Deactivate multi-lab IN_CHARGE rows for this lab when cleared
      try {
        const { TeacherLaboratoryAssignment } = await import(
          "../models/TeacherLaboratoryAssignment.js"
        );
        await TeacherLaboratoryAssignment.updateMany(
          withTenantScope(req, { laboratoryId: lab._id, role: "IN_CHARGE", status: "ACTIVE" }),
          { $set: { status: "INACTIVE" } }
        );
      } catch {
        /* non-fatal */
      }
    } else {
      const teacher = await Teacher.findOne(
        withTenantScope(req, { _id: payload.inChargeTeacherId })
      );
      if (!teacher) {
        throw new ApiError(404, "Laboratory in-charge teacher not found");
      }
      lab.inChargeTeacherId = teacher._id;
      // Mirror into multi-lab assignment table
      try {
        const { TeacherLaboratoryAssignment } = await import(
          "../models/TeacherLaboratoryAssignment.js"
        );
        const { getTodayBs } = await import("../utils/nepaliDate.js");
        await TeacherLaboratoryAssignment.findOneAndUpdate(
          withTenantScope(req, {
            teacherId: teacher._id,
            laboratoryId: lab._id,
            role: "IN_CHARGE"
          }),
          {
            $set: {
              status: "ACTIVE",
              assignedFromBs: getTodayBs(),
              assignedToBs: null,
              updatedBy: req.user?.userId
            },
            $setOnInsert: {
              schoolId: req.tenantSchoolId,
              teacherId: teacher._id,
              laboratoryId: lab._id,
              role: "IN_CHARGE",
              createdBy: req.user?.userId
            }
          },
          { upsert: true, new: true }
        );
      } catch {
        /* non-fatal */
      }
    }
  }

  await lab.save();

  await recordAudit(req, {
    action: "UPDATE",
    entity: "Laboratory",
    entityId: lab._id.toString(),
    before,
    after: lab.toObject()
  });

  return sendSuccess(res, "Laboratory updated", lab);
});

export const deleteLaboratory = asyncHandler(async (req: Request, res: Response) => {
  const access = await resolveLabAccess(req);
  assertCanDeleteLaboratory(access);

  const lab = await Laboratory.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!lab) {
    throw new ApiError(404, "Laboratory not found");
  }

  const equipmentIds = await LaboratoryEquipment.find({ laboratoryId: lab._id }).distinct("_id");
  const activeIssues = await LaboratoryIssue.countDocuments({
    schoolId: req.tenantSchoolId,
    status: { $in: ["ISSUED", "OVERDUE"] },
    equipmentId: { $in: equipmentIds }
  });

  if (activeIssues > 0) {
    throw new ApiError(400, "Cannot delete a laboratory with active equipment issues");
  }

  await LaboratoryStockRequest.deleteMany({ laboratoryId: lab._id });
  await LaboratoryStockMovement.deleteMany({ laboratoryId: lab._id });
  await LaboratoryEquipment.deleteMany({ laboratoryId: lab._id });
  await LaboratoryCategory.deleteMany({ laboratoryId: lab._id });
  await lab.deleteOne();

  await recordAudit(req, {
    action: "DELETE",
    entity: "Laboratory",
    entityId: lab._id.toString(),
    before: lab.toObject()
  });

  return sendSuccess(res, "Laboratory deleted");
});

// ─── Categories ──────────────────────────────────────────────────────────────

export const listLaboratoryCategories = asyncHandler(async (req: Request, res: Response) => {
  const access = await resolveLabAccess(req);
  assertLabAccess(access, paramId(req.params.labId));

  const categories = await LaboratoryCategory.find(
    withTenantScope(req, { laboratoryId: req.params.labId })
  ).sort({ name: 1 });

  return sendSuccess(res, "Laboratory categories fetched", categories);
});

export const createLaboratoryCategory = asyncHandler(async (req: Request, res: Response) => {
  const access = await resolveLabAccess(req);
  const labId = paramId(req.params.labId);
  assertLabAccess(access, labId);

  const payload = laboratoryCategorySchema.parse(req.body);
  const lab = await Laboratory.findOne(withTenantScope(req, { _id: labId }));
  if (!lab) {
    throw new ApiError(404, "Laboratory not found");
  }

  const category = await LaboratoryCategory.create({
    schoolId: req.tenantSchoolId,
    laboratoryId: lab._id,
    name: payload.name,
    isDefault: false
  });

  return sendSuccess(res, "Category created", category, 201);
});

export const updateLaboratoryCategory = asyncHandler(async (req: Request, res: Response) => {
  const access = await resolveLabAccess(req);
  const payload = laboratoryCategorySchema.parse(req.body);
  const existing = await LaboratoryCategory.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!existing) {
    throw new ApiError(404, "Category not found");
  }
  assertLabAccess(access, existing.laboratoryId.toString());

  existing.name = payload.name;
  await existing.save();
  return sendSuccess(res, "Category updated", existing);
});

export const deleteLaboratoryCategory = asyncHandler(async (req: Request, res: Response) => {
  const access = await resolveLabAccess(req);
  const existing = await LaboratoryCategory.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!existing) {
    throw new ApiError(404, "Category not found");
  }
  assertLabAccess(access, existing.laboratoryId.toString());

  const equipmentCount = await LaboratoryEquipment.countDocuments(
    withTenantScope(req, { categoryId: req.params.id })
  );
  if (equipmentCount > 0) {
    throw new ApiError(400, "Cannot delete a category that still has equipment");
  }

  await existing.deleteOne();
  return sendSuccess(res, "Category deleted");
});

// ─── Equipment / Inventory ───────────────────────────────────────────────────

export const listEquipment = asyncHandler(async (req: Request, res: Response) => {
  const access = await resolveLabAccess(req);
  const filter: Record<string, unknown> = withTenantScope(req, labScopeFilter(access));
  const { laboratoryId, search, itemKind, condition, equipmentStatus, stockStatus, yearLevel } =
    req.query;

  if (typeof laboratoryId === "string" && laboratoryId) {
    assertLabAccess(access, laboratoryId);
    filter.laboratoryId = laboratoryId;
  }

  if (typeof itemKind === "string" && itemKind) {
    filter.itemKind = itemKind;
  }
  if (typeof yearLevel === "string" && yearLevel.trim() && yearLevel !== "ALL") {
    filter.yearLevel = yearLevel.trim();
  }
  if (typeof condition === "string" && condition) {
    filter.condition = condition;
  }
  if (typeof equipmentStatus === "string" && equipmentStatus) {
    filter.equipmentStatus = equipmentStatus;
  }

  if (typeof search === "string" && search.trim()) {
    const term = escapeRegex(search.trim());
    filter.$or = [
      { name: { $regex: term, $options: "i" } },
      { itemCode: { $regex: term, $options: "i" } },
      { brand: { $regex: term, $options: "i" } },
      { equipmentModel: { $regex: term, $options: "i" } }
    ];
  }

  const equipment = await LaboratoryEquipment.find(filter)
    .populate("laboratoryId", "name yearLevel")
    .populate("categoryId", "name")
    .sort({ yearLevel: 1, name: 1 })
    .lean();

  let enriched = equipment.map((item) => formatEquipment(item as Record<string, unknown>));

  if (typeof stockStatus === "string" && stockStatus) {
    enriched = enriched.filter((item) => item.status === stockStatus);
  }

  return sendSuccess(res, "Laboratory equipment fetched", enriched);
});

export const createEquipment = asyncHandler(async (req: Request, res: Response) => {
  const access = await resolveLabAccess(req);
  const payload = laboratoryEquipmentSchema.parse(req.body);
  assertLabAccess(access, payload.laboratoryId);

  const [lab, category] = await Promise.all([
    Laboratory.findOne(withTenantScope(req, { _id: payload.laboratoryId })),
    LaboratoryCategory.findOne(
      withTenantScope(req, { _id: payload.categoryId, laboratoryId: payload.laboratoryId })
    )
  ]);

  if (!lab) {
    throw new ApiError(404, "Laboratory not found");
  }
  if (!category) {
    throw new ApiError(404, "Category not found for this laboratory");
  }

  const itemCode =
    emptyToUndef(payload.itemCode) ??
    (await generateNextItemCode(req.tenantSchoolId!, lab.code ?? lab.name));

  const codeExists = await LaboratoryEquipment.findOne(
    withTenantScope(req, { itemCode })
  );
  if (codeExists) {
    throw new ApiError(409, "Equipment code already exists");
  }

  const equipment = await LaboratoryEquipment.create({
    schoolId: req.tenantSchoolId,
    laboratoryId: payload.laboratoryId,
    categoryId: payload.categoryId,
    name: payload.name,
    itemCode,
    itemKind: payload.itemKind,
    yearLevel: payload.yearLevel ?? lab.yearLevel ?? "All Years",
    brand: emptyToUndef(payload.brand),
    equipmentModel: emptyToUndef(payload.equipmentModel),
    unit: emptyToUndef(payload.unit) ?? "pcs",
    quantity: payload.quantity,
    availableQuantity: payload.quantity,
    minimumStockLevel: payload.minimumStockLevel ?? 0,
    purchaseDateBs: emptyToUndef(payload.purchaseDateBs),
    supplier: emptyToUndef(payload.supplier),
    purchaseCost: payload.purchaseCost,
    storageLocation: emptyToUndef(payload.storageLocation),
    condition: payload.condition,
    equipmentStatus: payload.equipmentStatus,
    description: emptyToUndef(payload.description),
    remarks: emptyToUndef(payload.remarks)
  });

  await LaboratoryStockMovement.create({
    schoolId: req.tenantSchoolId,
    laboratoryId: equipment.laboratoryId,
    equipmentId: equipment._id,
    type: "INCREASE",
    quantity: payload.quantity || 1,
    previousStock: 0,
    newStock: payload.quantity,
    notes: "Initial stock on equipment create",
    performedByUserId: recordUserId(req)
  });

  await syncLowStockRequests(req.tenantSchoolId!, equipment, recordUserId(req));

  await recordAudit(req, {
    action: "CREATE",
    entity: "LaboratoryEquipment",
    entityId: equipment._id.toString(),
    after: equipment.toObject()
  });

  return sendSuccess(res, "Equipment added", enrichEquipmentInventory(equipment.toObject()), 201);
});

export const updateEquipment = asyncHandler(async (req: Request, res: Response) => {
  const access = await resolveLabAccess(req);
  const payload = laboratoryEquipmentUpdateSchema.parse(req.body);
  const equipment = await LaboratoryEquipment.findOne(withTenantScope(req, { _id: req.params.id }));

  if (!equipment) {
    throw new ApiError(404, "Equipment not found");
  }

  assertLabAccess(access, equipment.laboratoryId.toString());
  const before = equipment.toObject();

  if (payload.laboratoryId || payload.categoryId) {
    const laboratoryId = payload.laboratoryId ?? equipment.laboratoryId.toString();
    assertLabAccess(access, laboratoryId);
    const categoryId = payload.categoryId ?? equipment.categoryId.toString();
    const category = await LaboratoryCategory.findOne(
      withTenantScope(req, { _id: categoryId, laboratoryId })
    );
    if (!category) {
      throw new ApiError(404, "Category not found for this laboratory");
    }
    equipment.laboratoryId = category.laboratoryId;
    equipment.categoryId = category._id;
  }

  if (payload.quantity !== undefined) {
    const issuedQuantity = equipment.quantity - equipment.availableQuantity;
    const nextAvailable = payload.quantity - issuedQuantity;
    if (nextAvailable < 0) {
      throw new ApiError(400, "Quantity cannot be less than currently issued units");
    }
    equipment.quantity = payload.quantity;
    equipment.availableQuantity = nextAvailable;
  }

  if (payload.name !== undefined) equipment.name = payload.name;
  if (payload.yearLevel !== undefined) equipment.yearLevel = payload.yearLevel;
  if (payload.itemCode !== undefined && payload.itemCode.trim()) {
    const codeDup = await LaboratoryEquipment.findOne({
      schoolId: req.tenantSchoolId,
      itemCode: payload.itemCode.trim(),
      _id: { $ne: equipment._id }
    });
    if (codeDup) {
      throw new ApiError(409, "Equipment code already exists");
    }
    equipment.itemCode = payload.itemCode.trim();
  }
  if (payload.itemKind !== undefined) equipment.itemKind = payload.itemKind;
  if (payload.brand !== undefined) equipment.brand = emptyToUndef(payload.brand);
  if (payload.equipmentModel !== undefined) {
    equipment.equipmentModel = emptyToUndef(payload.equipmentModel);
  }
  if (payload.unit !== undefined) equipment.unit = emptyToUndef(payload.unit) ?? "pcs";
  if (payload.minimumStockLevel !== undefined) {
    equipment.minimumStockLevel = payload.minimumStockLevel;
  }
  if (payload.purchaseDateBs !== undefined) {
    equipment.set("purchaseDateBs", emptyToUndef(payload.purchaseDateBs));
  }
  if (payload.supplier !== undefined) equipment.supplier = emptyToUndef(payload.supplier);
  if (payload.purchaseCost !== undefined) equipment.purchaseCost = payload.purchaseCost;
  if (payload.storageLocation !== undefined) {
    equipment.storageLocation = emptyToUndef(payload.storageLocation);
  }
  if (payload.condition !== undefined) equipment.condition = payload.condition;
  if (payload.equipmentStatus !== undefined) equipment.equipmentStatus = payload.equipmentStatus;
  if (payload.description !== undefined) equipment.description = emptyToUndef(payload.description);
  if (payload.remarks !== undefined) equipment.remarks = emptyToUndef(payload.remarks);

  await equipment.save();
  await syncLowStockRequests(req.tenantSchoolId!, equipment, recordUserId(req));

  await recordAudit(req, {
    action: "UPDATE",
    entity: "LaboratoryEquipment",
    entityId: equipment._id.toString(),
    before,
    after: equipment.toObject()
  });

  return sendSuccess(res, "Equipment updated", enrichEquipmentInventory(equipment.toObject()));
});

export const deleteEquipment = asyncHandler(async (req: Request, res: Response) => {
  const access = await resolveLabAccess(req);
  const equipment = await LaboratoryEquipment.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!equipment) {
    throw new ApiError(404, "Equipment not found");
  }
  assertLabAccess(access, equipment.laboratoryId.toString());

  const activeIssues = await LaboratoryIssue.countDocuments(
    withTenantScope(req, {
      equipmentId: req.params.id,
      status: { $in: ["ISSUED", "OVERDUE"] }
    })
  );
  if (activeIssues > 0) {
    throw new ApiError(400, "Cannot delete equipment with active issues");
  }

  await LaboratoryStockRequest.deleteMany({ equipmentId: equipment._id });
  await equipment.deleteOne();

  await recordAudit(req, {
    action: "DELETE",
    entity: "LaboratoryEquipment",
    entityId: equipment._id.toString(),
    before: equipment.toObject()
  });

  return sendSuccess(res, "Equipment deleted");
});

export const adjustEquipmentStock = asyncHandler(async (req: Request, res: Response) => {
  const access = await resolveLabAccess(req);
  const payload = laboratoryStockAdjustSchema.parse(req.body);
  const equipment = await LaboratoryEquipment.findOne(withTenantScope(req, { _id: req.params.id }));

  if (!equipment) {
    throw new ApiError(404, "Equipment not found");
  }
  assertLabAccess(access, equipment.laboratoryId.toString());

  const before = equipment.toObject();

  try {
    const result = await applyStockChange({
      equipment,
      type: payload.type,
      quantity: payload.quantity,
      notes: emptyToUndef(payload.notes),
      performedByUserId: recordUserId(req),
      schoolId: req.tenantSchoolId!,
      adjustTotal: payload.type === "INCREASE" || payload.type === "PURCHASE_RECEIVED",
      reduceTotal:
        payload.type === "CONSUME" ||
        payload.type === "DISPOSE" ||
        payload.type === "LOST" ||
        (payload.type === "DAMAGE" && equipment.itemKind === "DISPOSABLE")
    });

    if (payload.condition) {
      result.equipment.set("condition", payload.condition);
    }
    if (payload.equipmentStatus) {
      result.equipment.set("equipmentStatus", payload.equipmentStatus);
    }
    await result.equipment.save();

    await syncLowStockRequests(req.tenantSchoolId!, result.equipment, recordUserId(req));

    await recordAudit(req, {
      action: `STOCK_${payload.type}`,
      entity: "LaboratoryEquipment",
      entityId: equipment._id.toString(),
      before,
      after: result.equipment.toObject()
    });

    return sendSuccess(res, "Stock updated", {
      equipment: enrichEquipmentInventory(result.equipment.toObject() as never),
      movement: result.movement
    });
  } catch (error) {
    throw new ApiError(400, error instanceof Error ? error.message : "Stock update failed");
  }
});

// ─── Issues ──────────────────────────────────────────────────────────────────

export const listEquipmentIssues = asyncHandler(async (req: Request, res: Response) => {
  const access = await resolveLabAccess(req);
  await syncEquipmentOverdueStatuses(req.tenantSchoolId!);

  let equipmentFilter: Record<string, unknown> = withTenantScope(req);
  if (!access.isGlobalManager) {
    equipmentFilter = withTenantScope(req, labScopeFilter(access));
  }
  const equipmentIds = await LaboratoryEquipment.find(equipmentFilter).distinct("_id");

  const issues = await LaboratoryIssue.find(
    withTenantScope(req, { equipmentId: { $in: equipmentIds } })
  )
    .populate({
      path: "equipmentId",
      populate: { path: "laboratoryId", select: "name" }
    })
    .populate({ path: "teacherId", populate: { path: "user", select: "fullName" } })
    .sort({ createdAt: -1 });

  const formatted = issues.map((issue) => {
    const equipment = issue.equipmentId as {
      name?: string;
      laboratoryId?: { name?: string; _id?: unknown };
    } | null;
    const teacher = issue.teacherId as { user?: { fullName?: string } } | null;
    return {
      ...issue.toObject(),
      equipmentName: equipment?.name,
      laboratoryName:
        equipment?.laboratoryId && typeof equipment.laboratoryId === "object"
          ? equipment.laboratoryId.name
          : undefined,
      teacherName: teacher?.user?.fullName
    };
  });

  return sendSuccess(res, "Equipment issues fetched", formatted);
});

export const listMyEquipment = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.role !== "TEACHER") {
    throw new ApiError(403, "Only teachers can view issued laboratory equipment");
  }

  const teacher = await Teacher.findOne({ user: req.user.userId }).select("_id").lean();
  if (!teacher) {
    throw new ApiError(404, "Teacher profile not found");
  }

  await syncEquipmentOverdueStatuses(req.tenantSchoolId!);

  const issues = await LaboratoryIssue.find(withTenantScope(req, { teacherId: teacher._id }))
    .populate("equipmentId")
    .sort({ createdAt: -1 });

  const formatted = issues.map((issue) => {
    const equipment = issue.equipmentId as { name?: string } | null;
    return {
      ...issue.toObject(),
      equipmentName: equipment?.name
    };
  });

  return sendSuccess(res, "Issued equipment fetched", formatted);
});

export const issueEquipment = asyncHandler(async (req: Request, res: Response) => {
  const access = await resolveLabAccess(req);
  const payload = laboratoryIssueSchema.parse(req.body);
  const equipment = await LaboratoryEquipment.findOne(
    withTenantScope(req, { _id: payload.equipmentId })
  );

  if (!equipment || equipment.availableQuantity < payload.quantity) {
    throw new ApiError(400, "Equipment is not available in the requested quantity");
  }

  assertLabAccess(access, equipment.laboratoryId.toString());

  const teacher = await Teacher.findOne(withTenantScope(req, { _id: payload.teacherId }));
  if (!teacher) {
    throw new ApiError(404, "Teacher not found");
  }

  try {
    await applyStockChange({
      equipment,
      type: "ISSUE",
      quantity: payload.quantity,
      notes: `Issued to teacher`,
      performedByUserId: recordUserId(req),
      schoolId: req.tenantSchoolId!
    });
  } catch (error) {
    throw new ApiError(400, error instanceof Error ? error.message : "Issue failed");
  }

  const issue = await LaboratoryIssue.create({
    ...payload,
    schoolId: req.tenantSchoolId,
    status: "ISSUED"
  });

  await sendNotification({
    schoolId: req.tenantSchoolId!,
    recipientUserId: teacher.user.toString(),
    title: "Laboratory equipment issued",
    message: `${equipment.name} (x${payload.quantity}) — due ${payload.dueDateBs}`,
    type: "LABORATORY",
    channel: "BOTH",
    metadata: { laboratoryIssueId: issue._id.toString() }
  });

  await syncLowStockRequests(req.tenantSchoolId!, equipment, recordUserId(req));

  return sendSuccess(res, "Equipment issued", issue, 201);
});

export const returnEquipment = asyncHandler(async (req: Request, res: Response) => {
  const access = await resolveLabAccess(req);
  const payload = laboratoryReturnSchema.parse(req.body);
  const issue = await LaboratoryIssue.findOne(
    withTenantScope(req, { _id: req.params.id, status: { $in: ["ISSUED", "OVERDUE"] } })
  );

  if (!issue) {
    throw new ApiError(404, "Active issue not found");
  }

  const equipment = await LaboratoryEquipment.findOne(
    withTenantScope(req, { _id: issue.equipmentId })
  );
  if (!equipment) {
    throw new ApiError(404, "Equipment not found");
  }
  assertLabAccess(access, equipment.laboratoryId.toString());

  const outstandingBefore = issue.quantity;
  const returnQuantity = payload.quantity ?? outstandingBefore;
  if (returnQuantity <= 0) {
    throw new ApiError(400, "Return quantity must be at least 1");
  }
  if (returnQuantity > outstandingBefore) {
    throw new ApiError(400, "Return quantity cannot exceed issued quantity");
  }

  const isPartial = returnQuantity < outstandingBefore;
  // Partial return: reduce outstanding qty and keep ISSUED until fully returned
  if (isPartial) {
    issue.quantity = outstandingBefore - returnQuantity;
  } else {
    issue.status = "RETURNED";
  }
  issue.returnedDateBs = payload.returnedDateBs;
  await issue.save();

  await applyStockChange({
    equipment,
    type: "RETURN",
    quantity: returnQuantity,
    notes: isPartial ? "Equipment partially returned" : "Equipment returned",
    performedByUserId: recordUserId(req),
    schoolId: req.tenantSchoolId!
  });

  await syncLowStockRequests(req.tenantSchoolId!, equipment, recordUserId(req));

  return sendSuccess(
    res,
    isPartial ? "Partial return recorded" : "Equipment returned",
    issue
  );
});

// ─── Stock movements ─────────────────────────────────────────────────────────

export const listStockMovements = asyncHandler(async (req: Request, res: Response) => {
  const access = await resolveLabAccess(req);
  const filter: Record<string, unknown> = withTenantScope(req, labScopeFilter(access));
  const { laboratoryId, equipmentId } = req.query;

  if (typeof laboratoryId === "string" && laboratoryId) {
    assertLabAccess(access, laboratoryId);
    filter.laboratoryId = laboratoryId;
  }
  if (typeof equipmentId === "string" && equipmentId) {
    filter.equipmentId = equipmentId;
  }

  const movements = await LaboratoryStockMovement.find(filter)
    .populate("laboratoryId", "name")
    .populate("equipmentId", "name itemCode")
    .populate("performedByUserId", "fullName")
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();

  const formatted = movements.map((m) => {
    const lab = m.laboratoryId as { name?: string } | null;
    const eq = m.equipmentId as { name?: string; itemCode?: string } | null;
    const user = m.performedByUserId as { fullName?: string } | null;
    return {
      ...m,
      laboratoryName: lab?.name,
      equipmentName: eq?.name,
      performedByName: user?.fullName
    };
  });

  return sendSuccess(res, "Stock movements fetched", formatted);
});

// ─── Stock requests / Required items ─────────────────────────────────────────

export const listStockRequests = asyncHandler(async (req: Request, res: Response) => {
  const access = await resolveLabAccess(req);
  const filter: Record<string, unknown> = withTenantScope(req, labScopeFilter(access));
  const { status, laboratoryId } = req.query;

  if (typeof status === "string" && status) {
    filter.status = status;
  }
  if (typeof laboratoryId === "string" && laboratoryId) {
    assertLabAccess(access, laboratoryId);
    filter.laboratoryId = laboratoryId;
  }

  // Refresh required items from current inventory for open auto requests
  const lowItems = await LaboratoryEquipment.find(
    withTenantScope(req, labScopeFilter(access, { minimumStockLevel: { $gt: 0 } }))
  );
  for (const item of lowItems) {
    if (item.availableQuantity <= (item.minimumStockLevel ?? 0)) {
      await syncLowStockRequests(req.tenantSchoolId!, item);
    }
  }

  const requests = await LaboratoryStockRequest.find(filter)
    .populate("laboratoryId", "name")
    .populate("requestedByUserId", "fullName")
    .sort({ createdAt: -1 })
    .lean();

  const formatted = requests.map((r) => {
    const lab = r.laboratoryId as { name?: string; _id?: unknown } | string | null;
    const user = r.requestedByUserId as { fullName?: string } | null;
    return {
      ...r,
      laboratoryId:
        lab && typeof lab === "object" && lab._id != null ? String(lab._id) : String(r.laboratoryId),
      laboratoryName: lab && typeof lab === "object" ? lab.name : undefined,
      requestedByName: user?.fullName
    };
  });

  return sendSuccess(res, "Stock requests fetched", formatted);
});

export const createStockRequest = asyncHandler(async (req: Request, res: Response) => {
  const access = await resolveLabAccess(req);
  const payload = laboratoryStockRequestSchema.parse(req.body);
  assertLabAccess(access, payload.laboratoryId);

  const lab = await Laboratory.findOne(withTenantScope(req, { _id: payload.laboratoryId }));
  if (!lab) {
    throw new ApiError(404, "Laboratory not found");
  }

  if (payload.equipmentId) {
    const equipment = await LaboratoryEquipment.findOne(
      withTenantScope(req, { _id: payload.equipmentId, laboratoryId: payload.laboratoryId })
    );
    if (!equipment) {
      throw new ApiError(404, "Equipment not found in this laboratory");
    }
  }

  const request = await LaboratoryStockRequest.create({
    schoolId: req.tenantSchoolId,
    laboratoryId: payload.laboratoryId,
    equipmentId: emptyToUndef(payload.equipmentId) || null,
    equipmentName: payload.equipmentName,
    categoryName: emptyToUndef(payload.categoryName),
    currentStock: payload.currentStock,
    minimumStock: payload.minimumStock,
    requiredQuantity: payload.requiredQuantity,
    priority: payload.priority,
    requestedByUserId: recordUserId(req),
    requestDateBs: getTodayBs(),
    status: "PENDING",
    autoGenerated: false,
    adminNotes: emptyToUndef(payload.remarks)
  });

  const admins = await User.find({
    schoolId: req.tenantSchoolId,
    role: { $in: ["SUPER_ADMIN", "COLLEGE_ADMIN"] }
  })
    .select("_id")
    .lean();

  await Promise.all(
    admins.map((admin) =>
      sendNotification({
        schoolId: req.tenantSchoolId!,
        recipientUserId: admin._id.toString(),
        title: "Laboratory stock request",
        message: `${payload.equipmentName} requested for ${lab.name} (qty ${payload.requiredQuantity})`,
        type: "LABORATORY",
        channel: "IN_APP",
        metadata: { stockRequestId: request._id.toString() }
      })
    )
  );

  return sendSuccess(res, "Stock request submitted", request, 201);
});

export const updateStockRequestStatus = asyncHandler(async (req: Request, res: Response) => {
  const access = await resolveLabAccess(req);
  if (!isInstitutionAdmin(access.role)) {
    throw new ApiError(403, "Only administrators can approve or process stock purchases");
  }

  const payload = laboratoryStockRequestStatusSchema.parse(req.body);
  const request = await LaboratoryStockRequest.findOne(
    withTenantScope(req, { _id: req.params.id })
  );
  if (!request) {
    throw new ApiError(404, "Stock request not found");
  }

  const previousStatus = request.status;

  // Prevent double-receive (would inflate inventory)
  if (payload.status === "RECEIVED" && previousStatus === "RECEIVED") {
    throw new ApiError(400, "This stock request was already marked as received");
  }
  // Only allow RECEIVED when request is still open (not already received/rejected)
  if (payload.status === "RECEIVED" && previousStatus === "REJECTED") {
    throw new ApiError(400, "Cannot receive a rejected stock request");
  }

  request.status = payload.status;
  if (payload.adminNotes !== undefined) {
    request.adminNotes = emptyToUndef(payload.adminNotes);
  }

  if (payload.status === "RECEIVED" && previousStatus !== "RECEIVED") {
    const receivedQty = payload.receivedQuantity ?? request.requiredQuantity;
    if (receivedQty <= 0) {
      throw new ApiError(400, "Received quantity must be at least 1");
    }
    request.receivedQuantity = receivedQty;

    if (request.equipmentId) {
      const equipment = await LaboratoryEquipment.findOne(
        withTenantScope(req, { _id: request.equipmentId })
      );
      if (equipment) {
        await applyStockChange({
          equipment,
          type: "PURCHASE_RECEIVED",
          quantity: receivedQty,
          notes: `Purchase received for request ${request._id.toString()}`,
          performedByUserId: recordUserId(req),
          schoolId: req.tenantSchoolId!,
          adjustTotal: true
        });
        request.currentStock = equipment.availableQuantity;
        await syncLowStockRequests(req.tenantSchoolId!, equipment, recordUserId(req));
      }
    }
  }

  await request.save();

  if (request.requestedByUserId) {
    await sendNotification({
      schoolId: req.tenantSchoolId!,
      recipientUserId: request.requestedByUserId.toString(),
      title: `Stock request ${payload.status.toLowerCase()}`,
      message: `${request.equipmentName}: ${previousStatus} → ${payload.status}`,
      type: "LABORATORY",
      channel: "IN_APP",
      metadata: { stockRequestId: request._id.toString() }
    });
  }

  await recordAudit(req, {
    action: `STOCK_REQUEST_${payload.status}`,
    entity: "LaboratoryStockRequest",
    entityId: request._id.toString(),
    before: { status: previousStatus },
    after: request.toObject()
  });

  return sendSuccess(res, "Stock request updated", request);
});

// ─── Reports ─────────────────────────────────────────────────────────────────

export const getLaboratoryReports = asyncHandler(async (req: Request, res: Response) => {
  const access = await resolveLabAccess(req);
  const query = laboratoryReportQuerySchema.parse({
    reportType: req.query.reportType,
    laboratoryId: req.query.laboratoryId || "",
    format: req.query.format || "json"
  });

  if (query.laboratoryId) {
    assertLabAccess(access, query.laboratoryId);
  }

  const equipmentFilter = withTenantScope(
    req,
    labScopeFilter(access, query.laboratoryId ? { laboratoryId: query.laboratoryId } : {})
  );

  const equipment = await LaboratoryEquipment.find(equipmentFilter)
    .populate("laboratoryId", "name code")
    .populate("categoryId", "name")
    .lean();

  const enriched = equipment.map((item) => formatEquipment(item as Record<string, unknown>));

  let rows: Record<string, unknown>[] = [];
  const summary: Record<string, number | string> = {};

  switch (query.reportType) {
    case "LABORATORY_INVENTORY":
    case "EQUIPMENT":
      rows = enriched.map((e) => ({
        laboratory: e.laboratoryName,
        equipment: e.name,
        code: e.itemCode,
        category: e.categoryName,
        kind: e.itemKind,
        total: e.quantity,
        available: e.availableQuantity,
        minStock: e.minimumStockLevel,
        status: e.status,
        condition: e.condition,
        storage: e.storageLocation
      }));
      break;
    case "CATEGORY": {
      const byCat = new Map<string, { category: string; items: number; totalQty: number; available: number }>();
      for (const e of enriched) {
        const key = e.categoryName || "Uncategorized";
        const cur = byCat.get(key) ?? { category: key, items: 0, totalQty: 0, available: 0 };
        cur.items += 1;
        cur.totalQty += e.quantity;
        cur.available += e.availableQuantity;
        byCat.set(key, cur);
      }
      rows = [...byCat.values()];
      break;
    }
    case "STOCK_MOVEMENT": {
      const movements = await LaboratoryStockMovement.find(
        withTenantScope(
          req,
          labScopeFilter(access, query.laboratoryId ? { laboratoryId: query.laboratoryId } : {})
        )
      )
        .populate("laboratoryId", "name")
        .populate("equipmentId", "name")
        .populate("performedByUserId", "fullName")
        .sort({ createdAt: -1 })
        .limit(1000)
        .lean();
      rows = movements.map((m) => ({
        date: m.createdAt,
        laboratory: (m.laboratoryId as { name?: string } | null)?.name,
        equipment: (m.equipmentId as { name?: string } | null)?.name,
        type: m.type,
        quantity: m.quantity,
        previous: m.previousStock,
        new: m.newStock,
        by: (m.performedByUserId as { fullName?: string } | null)?.fullName,
        notes: m.notes
      }));
      break;
    }
    case "LOW_STOCK":
      rows = enriched
        .filter((e) => e.status === "LOW_STOCK" || e.status === "CRITICAL_STOCK")
        .map((e) => ({
          laboratory: e.laboratoryName,
          equipment: e.name,
          available: e.availableQuantity,
          minimum: e.minimumStockLevel,
          required: e.requiredQuantity,
          status: e.status,
          priority: getStockPriority(e.availableQuantity, e.minimumStockLevel)
        }));
      break;
    case "OUT_OF_STOCK":
      rows = enriched
        .filter((e) => e.status === "OUT_OF_STOCK")
        .map((e) => ({
          laboratory: e.laboratoryName,
          equipment: e.name,
          code: e.itemCode,
          minimum: e.minimumStockLevel
        }));
      break;
    case "DAMAGED":
      rows = enriched
        .filter((e) => e.condition === "DAMAGED")
        .map((e) => ({
          laboratory: e.laboratoryName,
          equipment: e.name,
          code: e.itemCode,
          available: e.availableQuantity,
          status: e.equipmentStatus
        }));
      break;
    case "PURCHASE_REQUEST": {
      const requests = await LaboratoryStockRequest.find(
        withTenantScope(
          req,
          labScopeFilter(access, query.laboratoryId ? { laboratoryId: query.laboratoryId } : {})
        )
      )
        .populate("laboratoryId", "name")
        .sort({ createdAt: -1 })
        .lean();
      rows = requests.map((r) => ({
        laboratory: (r.laboratoryId as { name?: string } | null)?.name,
        equipment: r.equipmentName,
        required: r.requiredQuantity,
        current: r.currentStock,
        minimum: r.minimumStock,
        priority: r.priority,
        status: r.status,
        date: r.requestDateBs,
        auto: r.autoGenerated
      }));
      break;
    }
    case "INVENTORY_VALUATION":
      rows = enriched.map((e) => {
        const unitCost = Number(e.purchaseCost ?? 0);
        const value = unitCost * e.quantity;
        return {
          laboratory: e.laboratoryName,
          equipment: e.name,
          quantity: e.quantity,
          unitCost,
          totalValue: value
        };
      });
      summary.totalValuation = rows.reduce((s, r) => s + Number(r.totalValue ?? 0), 0);
      break;
    case "LABORATORY_ASSETS":
      rows = enriched
        .filter((e) => e.itemKind === "NON_DISPOSABLE")
        .map((e) => ({
          laboratory: e.laboratoryName,
          asset: e.name,
          code: e.itemCode,
          brand: e.brand,
          model: e.equipmentModel,
          condition: e.condition,
          status: e.equipmentStatus,
          quantity: e.quantity,
          location: e.storageLocation,
          cost: e.purchaseCost
        }));
      break;
    default:
      rows = [];
  }

  summary.rowCount = rows.length;

  if (query.format === "csv") {
    const headers = rows.length > 0 ? Object.keys(rows[0]!) : ["message"];
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = [
      headers.join(","),
      ...rows.map((row) => headers.map((h) => escape(row[h])).join(","))
    ];
    if (rows.length === 0) {
      lines.push(escape("No data"));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="lab-report-${query.reportType.toLowerCase()}.csv"`
    );
    return res.send("\uFEFF" + lines.join("\n"));
  }

  return sendSuccess(res, "Laboratory report generated", {
    reportType: query.reportType,
    generatedAt: new Date().toISOString(),
    rows,
    summary
  });
});

// ─── Staff ───────────────────────────────────────────────────────────────────

export const listLaboratoryStaff = asyncHandler(async (req: Request, res: Response) => {
  const staff = await User.find(withTenantScope(req, { role: "LABORATORY_STAFF" }))
    .select("-password")
    .sort({ createdAt: -1 });
  return sendSuccess(res, "Laboratory staff fetched", staff);
});

export const createLaboratoryStaff = asyncHandler(async (req: Request, res: Response) => {
  const payload = moduleStaffSchema.parse(req.body);
  const email = payload.email.toLowerCase().trim();
  const existingUser = await User.findOne({ email });

  if (existingUser) {
    throw new ApiError(409, "A user with this email already exists");
  }

  const { password: portalPassword, wasGenerated } = resolvePortalPassword(payload.password);
  const user = await User.create({
    schoolId: req.tenantSchoolId,
    fullName: payload.fullName,
    email,
    phone: payload.phone,
    password: portalPassword,
    role: "LABORATORY_STAFF",
    mustChangePassword: wasGenerated
  });

  const safeUser = await User.findById(user._id).select("-password").lean();
  const credentialsEmail = await notifyAccountCredentials({
    userId: user._id.toString(),
    fullName: payload.fullName,
    email,
    password: portalPassword,
    schoolId: req.tenantSchoolId?.toString(),
    req
  });

  return sendSuccess(
    res,
    buildCredentialsAdminMessage(credentialsEmail),
    {
      staff: safeUser,
      loginEmail: email,
      defaultPassword: portalPassword,
      credentialsEmail
    },
    201
  );
});

export const updateLaboratoryStaff = asyncHandler(async (req: Request, res: Response) => {
  const payload = moduleStaffSchema.partial().parse(req.body);
  const user = await User.findOne(
    withTenantScope(req, { _id: req.params.id, role: "LABORATORY_STAFF" })
  );

  if (!user) {
    throw new ApiError(404, "Laboratory staff not found");
  }

  if (payload.fullName) user.fullName = payload.fullName;
  if (payload.phone !== undefined) user.phone = payload.phone;
  if (payload.email) {
    const email = payload.email.toLowerCase().trim();
    const duplicate = await User.findOne({ email, _id: { $ne: user._id } });
    if (duplicate) {
      throw new ApiError(409, "A user with this email already exists");
    }
    user.email = email;
  }
  if (payload.password) {
    user.password = payload.password;
    user.mustChangePassword = false;
  }

  await user.save();
  const safeUser = await User.findById(user._id).select("-password").lean();
  return sendSuccess(res, "Laboratory staff updated", safeUser);
});

export const deleteLaboratoryStaff = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id, role: "LABORATORY_STAFF" }),
    { isActive: false },
    { new: true }
  ).select("-password");

  if (!user) {
    throw new ApiError(404, "Laboratory staff not found");
  }

  return sendSuccess(res, "Laboratory staff deactivated", user);
});
