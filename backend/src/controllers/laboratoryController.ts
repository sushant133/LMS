import type { Request, Response } from "express";
import {
  DEFAULT_LAB_CATEGORIES,
  laboratoryCategorySchema,
  laboratoryEquipmentSchema,
  laboratoryIssueSchema,
  laboratoryReturnSchema,
  laboratorySchema,
  moduleStaffSchema
} from "@nepal-school-erp/shared";
import { env } from "../config/env.js";
import {
  Laboratory,
  LaboratoryCategory,
  LaboratoryEquipment,
  LaboratoryIssue
} from "../models/Laboratory.js";
import { Teacher } from "../models/Teacher.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { enrichEquipmentInventory } from "../utils/inventory.js";
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

const getLaboratoryName = (type: string, customName?: string | null): string => {
  if (type === "OTHER") {
    return customName?.trim() || "Custom Lab";
  }
  return LAB_TYPE_LABELS[type] ?? type;
};

const syncEquipmentOverdueStatuses = async (schoolId: string): Promise<void> => {
  const todayBs = getTodayBs();
  const activeIssues = await LaboratoryIssue.find({ schoolId, status: { $in: ["ISSUED", "OVERDUE"] } });

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

export const getLaboratoryDashboard = asyncHandler(async (req: Request, res: Response) => {
  const scope = withTenantScope(req);
  await syncEquipmentOverdueStatuses(req.tenantSchoolId!);

  const equipment = await LaboratoryEquipment.find(scope).lean();
  const enriched = equipment.map((item) => enrichEquipmentInventory(item));
  const lowStockItems = enriched
    .filter((item) => item.status === "LOW_STOCK" || item.status === "OUT_OF_STOCK")
    .slice(0, 10);

  return sendSuccess(res, "Laboratory dashboard fetched", {
    totalEquipment: enriched.reduce((sum, item) => sum + item.quantity, 0),
    availableEquipment: enriched.reduce((sum, item) => sum + item.availableQuantity, 0),
    issuedEquipment: enriched.reduce((sum, item) => sum + item.issuedQuantity, 0),
    remainingStock: enriched.reduce((sum, item) => sum + item.availableQuantity, 0),
    lowStockItems
  });
});

export const listLaboratories = asyncHandler(async (req: Request, res: Response) => {
  const labs = await Laboratory.find(withTenantScope(req)).sort({ name: 1 }).lean();
  return sendSuccess(res, "Laboratories fetched", labs);
});

export const createLaboratory = asyncHandler(async (req: Request, res: Response) => {
  const payload = laboratorySchema.parse(req.body);
  const name = getLaboratoryName(payload.type, payload.customName);

  const existing = await Laboratory.findOne(withTenantScope(req, { name }));
  if (existing) {
    throw new ApiError(409, "A laboratory with this name already exists");
  }

  const lab = await Laboratory.create({
    schoolId: req.tenantSchoolId,
    name,
    type: payload.type,
    customName: payload.type === "OTHER" ? payload.customName : undefined,
    isActive: payload.isActive
  });

  const categories = DEFAULT_LAB_CATEGORIES[payload.type];
  await LaboratoryCategory.insertMany(
    categories.map((categoryName) => ({
      schoolId: req.tenantSchoolId,
      laboratoryId: lab._id,
      name: categoryName,
      isDefault: true
    }))
  );

  return sendSuccess(res, "Laboratory created", lab, 201);
});

export const updateLaboratory = asyncHandler(async (req: Request, res: Response) => {
  const payload = laboratorySchema.partial().parse(req.body);
  const lab = await Laboratory.findOne(withTenantScope(req, { _id: req.params.id }));

  if (!lab) {
    throw new ApiError(404, "Laboratory not found");
  }

  const nextType = payload.type ?? lab.type;
  const nextCustomName = payload.customName ?? lab.customName;
  const nextName = getLaboratoryName(nextType, nextCustomName);

  const duplicate = await Laboratory.findOne({
    schoolId: req.tenantSchoolId,
    name: nextName,
    _id: { $ne: lab._id }
  });

  if (duplicate) {
    throw new ApiError(409, "A laboratory with this name already exists");
  }

  lab.type = nextType;
  lab.customName = nextType === "OTHER" ? nextCustomName : undefined;
  lab.name = nextName;
  if (payload.isActive !== undefined) {
    lab.isActive = payload.isActive;
  }

  await lab.save();
  return sendSuccess(res, "Laboratory updated", lab);
});

export const deleteLaboratory = asyncHandler(async (req: Request, res: Response) => {
  const lab = await Laboratory.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!lab) {
    throw new ApiError(404, "Laboratory not found");
  }

  const activeIssues = await LaboratoryIssue.countDocuments({
    schoolId: req.tenantSchoolId,
    status: { $in: ["ISSUED", "OVERDUE"] },
    equipmentId: {
      $in: await LaboratoryEquipment.find({ laboratoryId: lab._id }).distinct("_id")
    }
  });

  if (activeIssues > 0) {
    throw new ApiError(400, "Cannot delete a laboratory with active equipment issues");
  }

  await LaboratoryEquipment.deleteMany({ laboratoryId: lab._id });
  await LaboratoryCategory.deleteMany({ laboratoryId: lab._id });
  await lab.deleteOne();

  return sendSuccess(res, "Laboratory deleted");
});

export const listLaboratoryCategories = asyncHandler(async (req: Request, res: Response) => {
  const categories = await LaboratoryCategory.find(
    withTenantScope(req, { laboratoryId: req.params.labId })
  ).sort({ name: 1 });

  return sendSuccess(res, "Laboratory categories fetched", categories);
});

export const createLaboratoryCategory = asyncHandler(async (req: Request, res: Response) => {
  const payload = laboratoryCategorySchema.parse(req.body);
  const lab = await Laboratory.findOne(withTenantScope(req, { _id: req.params.labId }));

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
  const payload = laboratoryCategorySchema.parse(req.body);
  const category = await LaboratoryCategory.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id }),
    { name: payload.name },
    { new: true }
  );

  if (!category) {
    throw new ApiError(404, "Category not found");
  }

  return sendSuccess(res, "Category updated", category);
});

export const deleteLaboratoryCategory = asyncHandler(async (req: Request, res: Response) => {
  const equipmentCount = await LaboratoryEquipment.countDocuments(
    withTenantScope(req, { categoryId: req.params.id })
  );

  if (equipmentCount > 0) {
    throw new ApiError(400, "Cannot delete a category that still has equipment");
  }

  const category = await LaboratoryCategory.findOneAndDelete(withTenantScope(req, { _id: req.params.id }));
  if (!category) {
    throw new ApiError(404, "Category not found");
  }

  return sendSuccess(res, "Category deleted");
});

export const listEquipment = asyncHandler(async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = withTenantScope(req);
  const { laboratoryId, search } = req.query;

  if (typeof laboratoryId === "string" && laboratoryId) {
    filter.laboratoryId = laboratoryId;
  }

  if (typeof search === "string" && search.trim()) {
    const term = search.trim();
    filter.$or = [{ name: { $regex: term, $options: "i" } }, { itemCode: { $regex: term, $options: "i" } }];
  }

  const equipment = await LaboratoryEquipment.find(filter)
    .populate("laboratoryId", "name")
    .populate("categoryId", "name")
    .sort({ name: 1 })
    .lean();

  const enriched = equipment.map((item) => {
    const lab = item.laboratoryId as { name?: string } | null;
    const category = item.categoryId as { name?: string } | null;
    return {
      ...enrichEquipmentInventory(item),
      laboratoryName: lab?.name,
      categoryName: category?.name
    };
  });

  return sendSuccess(res, "Laboratory equipment fetched", enriched);
});

export const createEquipment = asyncHandler(async (req: Request, res: Response) => {
  const payload = laboratoryEquipmentSchema.parse(req.body);

  const [lab, category] = await Promise.all([
    Laboratory.findOne(withTenantScope(req, { _id: payload.laboratoryId })),
    LaboratoryCategory.findOne(withTenantScope(req, { _id: payload.categoryId, laboratoryId: payload.laboratoryId }))
  ]);

  if (!lab) {
    throw new ApiError(404, "Laboratory not found");
  }
  if (!category) {
    throw new ApiError(404, "Category not found for this laboratory");
  }

  const equipment = await LaboratoryEquipment.create({
    ...payload,
    schoolId: req.tenantSchoolId,
    availableQuantity: payload.quantity
  });

  return sendSuccess(res, "Equipment added", enrichEquipmentInventory(equipment.toObject()), 201);
});

export const updateEquipment = asyncHandler(async (req: Request, res: Response) => {
  const payload = laboratoryEquipmentSchema.partial().parse(req.body);
  const equipment = await LaboratoryEquipment.findOne(withTenantScope(req, { _id: req.params.id }));

  if (!equipment) {
    throw new ApiError(404, "Equipment not found");
  }

  if (payload.laboratoryId || payload.categoryId) {
    const laboratoryId = payload.laboratoryId ?? equipment.laboratoryId.toString();
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
  if (payload.itemCode !== undefined) equipment.itemCode = payload.itemCode;
  if (payload.description !== undefined) equipment.description = payload.description;

  await equipment.save();
  return sendSuccess(res, "Equipment updated", enrichEquipmentInventory(equipment.toObject()));
});

export const deleteEquipment = asyncHandler(async (req: Request, res: Response) => {
  const activeIssues = await LaboratoryIssue.countDocuments(
    withTenantScope(req, { equipmentId: req.params.id, status: { $in: ["ISSUED", "OVERDUE"] } })
  );

  if (activeIssues > 0) {
    throw new ApiError(400, "Cannot delete equipment with active issues");
  }

  const equipment = await LaboratoryEquipment.findOneAndDelete(withTenantScope(req, { _id: req.params.id }));
  if (!equipment) {
    throw new ApiError(404, "Equipment not found");
  }

  return sendSuccess(res, "Equipment deleted");
});

export const listEquipmentIssues = asyncHandler(async (req: Request, res: Response) => {
  await syncEquipmentOverdueStatuses(req.tenantSchoolId!);

  const issues = await LaboratoryIssue.find(withTenantScope(req))
    .populate("equipmentId")
    .populate({ path: "teacherId", populate: { path: "user", select: "fullName" } })
    .sort({ createdAt: -1 });

  const formatted = issues.map((issue) => {
    const equipment = issue.equipmentId as { name?: string } | null;
    const teacher = issue.teacherId as { user?: { fullName?: string } } | null;
    return {
      ...issue.toObject(),
      equipmentName: equipment?.name,
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
  const payload = laboratoryIssueSchema.parse(req.body);
  const equipment = await LaboratoryEquipment.findOne(withTenantScope(req, { _id: payload.equipmentId }));

  if (!equipment || equipment.availableQuantity < payload.quantity) {
    throw new ApiError(400, "Equipment is not available in the requested quantity");
  }

  const teacher = await Teacher.findOne(withTenantScope(req, { _id: payload.teacherId }));
  if (!teacher) {
    throw new ApiError(404, "Teacher not found");
  }

  equipment.availableQuantity -= payload.quantity;
  await equipment.save();

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

  return sendSuccess(res, "Equipment issued", issue, 201);
});

export const returnEquipment = asyncHandler(async (req: Request, res: Response) => {
  const payload = laboratoryReturnSchema.parse(req.body);
  const issue = await LaboratoryIssue.findOne(
    withTenantScope(req, { _id: req.params.id, status: { $in: ["ISSUED", "OVERDUE"] } })
  );

  if (!issue) {
    throw new ApiError(404, "Active issue not found");
  }

  const returnQuantity = payload.quantity ?? issue.quantity;
  if (returnQuantity > issue.quantity) {
    throw new ApiError(400, "Return quantity cannot exceed issued quantity");
  }

  issue.status = "RETURNED";
  issue.returnedDateBs = payload.returnedDateBs;
  await issue.save();

  await LaboratoryEquipment.findByIdAndUpdate(issue.equipmentId, { $inc: { availableQuantity: returnQuantity } });
  return sendSuccess(res, "Equipment returned", issue);
});

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

  const user = await User.create({
    schoolId: req.tenantSchoolId,
    fullName: payload.fullName,
    email,
    phone: payload.phone,
    password: payload.password ?? env.DEFAULT_USER_PASSWORD,
    role: "LABORATORY_STAFF",
    mustChangePassword: !payload.password
  });

  const safeUser = await User.findById(user._id).select("-password").lean();
  return sendSuccess(res, "Laboratory staff created", safeUser, 201);
});

export const updateLaboratoryStaff = asyncHandler(async (req: Request, res: Response) => {
  const payload = moduleStaffSchema.partial().parse(req.body);
  const user = await User.findOne(withTenantScope(req, { _id: req.params.id, role: "LABORATORY_STAFF" }));

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