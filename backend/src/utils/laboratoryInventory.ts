import type {
  LaboratoryInventoryStockStatus,
  LaboratoryStockMovementType,
  LaboratoryStockPriority
} from "@phit-erp/shared";
import type { Request } from "express";
import {
  LaboratoryEquipment,
  LaboratoryStockMovement,
  LaboratoryStockRequest,
  type LaboratoryEquipmentDocument
} from "../models/Laboratory.js";
import { User } from "../models/User.js";
import { getTodayBs } from "./nepaliDate.js";
import { sendNotification } from "./notificationService.js";
import { Laboratory } from "../models/Laboratory.js";

export const getIssuedQuantity = (total: number, available: number): number =>
  Math.max(0, total - available);

/**
 * Stock status using configured min/max levels.
 *
 * - Prefer explicit minimum as the reorder point.
 * - When min is unset, derive from maximum capacity (then current total).
 * - Critical uses half of min without forcing a floor of 1, so a product that
 *   only stocks e.g. 4 units (max=4, min=1, available=1) is LOW not CRITICAL.
 */
export const getLabStockStatus = (
  available: number,
  total: number,
  minimumStockLevel = 0,
  maximumStockLevel = 0
): LaboratoryInventoryStockStatus => {
  if (available <= 0) {
    return "OUT_OF_STOCK";
  }

  // At or above configured capacity → healthy stock.
  if (maximumStockLevel > 0 && available >= maximumStockLevel) {
    return "AVAILABLE";
  }

  const capacity = maximumStockLevel > 0 ? maximumStockLevel : total;
  const minLevel =
    minimumStockLevel > 0
      ? minimumStockLevel
      : capacity > 0
        ? Math.max(1, Math.floor(capacity * 0.2))
        : 0;

  if (minLevel <= 0) {
    return "AVAILABLE";
  }

  // Half of min — do not force Math.max(1, …); that wrongly marks 1-of-4 as critical.
  const criticalLevel = Math.floor(minLevel * 0.5);
  if (criticalLevel > 0 && available <= criticalLevel) {
    return "CRITICAL_STOCK";
  }

  if (available <= minLevel) {
    return "LOW_STOCK";
  }

  return "AVAILABLE";
};

/**
 * Units needed to restock: fill up to maximum when set, otherwise up to minimum.
 * Returns 0 when stock is still above the reorder point.
 */
export const getRequiredQuantity = (
  available: number,
  minimumStockLevel: number,
  maximumStockLevel = 0
): number => {
  const capacity = maximumStockLevel > 0 ? maximumStockLevel : 0;
  const reorderPoint =
    minimumStockLevel > 0
      ? minimumStockLevel
      : capacity > 0
        ? Math.max(1, Math.floor(capacity * 0.2))
        : 0;

  if (reorderPoint <= 0 || available > reorderPoint) {
    return 0;
  }

  const target = capacity > 0 ? capacity : minimumStockLevel;
  return Math.max(0, target - available);
};

export const getStockPriority = (
  available: number,
  minimumStockLevel: number,
  maximumStockLevel = 0,
  total = 0
): LaboratoryStockPriority => {
  if (available <= 0) {
    return "CRITICAL";
  }
  const capacityRef =
    total > 0 ? total : maximumStockLevel > 0 ? maximumStockLevel : available;
  const status = getLabStockStatus(
    available,
    capacityRef,
    minimumStockLevel,
    maximumStockLevel
  );
  if (status === "CRITICAL_STOCK") {
    return "HIGH";
  }
  if (status === "LOW_STOCK") {
    return "MEDIUM";
  }
  return "LOW";
};

export function enrichEquipmentInventory<
  T extends {
    quantity: number;
    availableQuantity: number;
    minimumStockLevel?: number;
    maximumStockLevel?: number;
  }
>(item: T) {
  const minimumStockLevel = item.minimumStockLevel ?? 0;
  const maximumStockLevel = item.maximumStockLevel ?? 0;
  return {
    ...item,
    minimumStockLevel,
    maximumStockLevel,
    issuedQuantity: getIssuedQuantity(item.quantity, item.availableQuantity),
    requiredQuantity: getRequiredQuantity(
      item.availableQuantity,
      minimumStockLevel,
      maximumStockLevel
    ),
    status: getLabStockStatus(
      item.availableQuantity,
      item.quantity,
      minimumStockLevel,
      maximumStockLevel
    )
  };
}

type ApplyStockChangeParams = {
  equipment: LaboratoryEquipmentDocument;
  type: LaboratoryStockMovementType;
  quantity: number;
  notes?: string;
  performedByUserId?: string;
  schoolId: string;
  /** When true, increase total quantity as well (purchases / stock-in). */
  adjustTotal?: boolean;
  /** When true, decrease total quantity (consume / dispose / lost for disposables). */
  reduceTotal?: boolean;
};

export async function applyStockChange(params: ApplyStockChangeParams) {
  const {
    equipment,
    type,
    quantity,
    notes,
    performedByUserId,
    schoolId,
    adjustTotal,
    reduceTotal
  } = params;

  const previousStock = equipment.availableQuantity;
  let nextAvailable = previousStock;
  let nextTotal = equipment.quantity;

  switch (type) {
    case "INCREASE":
    case "PURCHASE_RECEIVED":
    case "RETURN":
      nextAvailable = previousStock + quantity;
      if (adjustTotal || type === "INCREASE" || type === "PURCHASE_RECEIVED") {
        nextTotal = equipment.quantity + quantity;
      }
      break;
    case "REDUCE":
    case "CONSUME":
    case "DAMAGE":
    case "DISPOSE":
    case "LOST":
    case "ISSUE":
      if (previousStock < quantity) {
        throw new Error(`Insufficient stock. Available: ${previousStock}`);
      }
      nextAvailable = previousStock - quantity;
      if (reduceTotal || type === "CONSUME" || type === "DISPOSE" || type === "LOST") {
        nextTotal = Math.max(0, equipment.quantity - quantity);
        if (nextAvailable > nextTotal) {
          nextAvailable = nextTotal;
        }
      }
      break;
    case "MAINTENANCE":
      if (previousStock < quantity) {
        throw new Error(`Insufficient stock. Available: ${previousStock}`);
      }
      nextAvailable = previousStock - quantity;
      break;
    case "ADJUSTMENT":
      nextAvailable = quantity;
      if (nextAvailable > nextTotal) {
        nextTotal = nextAvailable;
      }
      break;
    default:
      break;
  }

  equipment.availableQuantity = nextAvailable;
  equipment.quantity = nextTotal;

  if (type === "DAMAGE") {
    equipment.condition = "DAMAGED";
  }
  if (type === "DISPOSE") {
    equipment.equipmentStatus = "DISPOSED";
  }
  if (type === "MAINTENANCE") {
    equipment.equipmentStatus = "UNDER_MAINTENANCE";
  }
  if (
    (type === "INCREASE" || type === "PURCHASE_RECEIVED" || type === "RETURN") &&
    equipment.equipmentStatus === "UNDER_MAINTENANCE" &&
    nextAvailable > 0
  ) {
    equipment.equipmentStatus = "AVAILABLE";
  }

  await equipment.save();

  const movement = await LaboratoryStockMovement.create({
    schoolId,
    laboratoryId: equipment.laboratoryId,
    equipmentId: equipment._id,
    type,
    quantity: type === "ADJUSTMENT" ? Math.abs(nextAvailable - previousStock) || quantity : quantity,
    previousStock,
    newStock: nextAvailable,
    notes,
    performedByUserId
  });

  return { equipment, movement, previousStock, nextAvailable };
}

export async function syncLowStockRequests(
  schoolId: string,
  equipment: LaboratoryEquipmentDocument,
  requestedByUserId?: string
): Promise<void> {
  const min = equipment.minimumStockLevel ?? 0;
  const max = equipment.maximumStockLevel ?? 0;
  // Auto restock only when an explicit minimum reorder point is configured.
  if (min <= 0) {
    await LaboratoryStockRequest.updateMany(
      {
        schoolId,
        equipmentId: equipment._id,
        autoGenerated: true,
        status: { $in: ["PENDING", "APPROVED", "PURCHASED"] }
      },
      { status: "RECEIVED", adminNotes: "Closed — minimum stock level disabled or stock OK" }
    );
    return;
  }

  const available = equipment.availableQuantity;
  const needsRestock = available <= min;
  const requiredQty = getRequiredQuantity(available, min, max);

  if (!needsRestock) {
    await LaboratoryStockRequest.updateMany(
      {
        schoolId,
        equipmentId: equipment._id,
        autoGenerated: true,
        status: { $in: ["PENDING", "APPROVED", "PURCHASED"] }
      },
      {
        status: "RECEIVED",
        adminNotes: "Auto-closed — stock replenished above minimum",
        currentStock: available
      }
    );
    return;
  }

  const openRequest = await LaboratoryStockRequest.findOne({
    schoolId,
    equipmentId: equipment._id,
    status: { $in: ["PENDING", "APPROVED", "PURCHASED"] }
  });

  if (openRequest) {
    openRequest.currentStock = available;
    openRequest.minimumStock = min;
    openRequest.requiredQuantity = Math.max(openRequest.requiredQuantity, requiredQty || 1);
    openRequest.priority = getStockPriority(available, min, max, equipment.quantity);
    await openRequest.save();
    return;
  }

  const category = await (
    await import("../models/Laboratory.js")
  ).LaboratoryCategory.findById(equipment.categoryId).select("name").lean();

  await LaboratoryStockRequest.create({
    schoolId,
    laboratoryId: equipment.laboratoryId,
    equipmentId: equipment._id,
    equipmentName: equipment.name,
    categoryName: category?.name,
    currentStock: available,
    minimumStock: min,
    requiredQuantity: requiredQty || 1,
    priority: getStockPriority(available, min, max, equipment.quantity),
    requestedByUserId,
    requestDateBs: getTodayBs(),
    status: "PENDING",
    autoGenerated: true
  });

  await notifyLowStock(schoolId, equipment, available, min, max);
}

async function notifyLowStock(
  schoolId: string,
  equipment: LaboratoryEquipmentDocument,
  available: number,
  min: number,
  max = 0
): Promise<void> {
  try {
    const lab = await Laboratory.findById(equipment.laboratoryId)
      .select("name inChargeTeacherId")
      .lean();
    const status = getLabStockStatus(available, equipment.quantity, min, max);
    const title = status === "OUT_OF_STOCK" ? "Laboratory out of stock" : "Laboratory low stock alert";
    const maxPart = max > 0 ? `, max ${max}` : "";
    const message = `${equipment.name} in ${lab?.name ?? "laboratory"}: ${available} remaining (min ${min}${maxPart}).`;

    const recipientIds = new Set<string>();

    if (lab?.inChargeTeacherId) {
      const { Teacher } = await import("../models/Teacher.js");
      const teacher = await Teacher.findById(lab.inChargeTeacherId).select("user").lean();
      if (teacher?.user) {
        recipientIds.add(teacher.user.toString());
      }
    }

    const admins = await User.find({
      schoolId,
      role: { $in: ["SUPER_ADMIN", "COLLEGE_ADMIN"] },
      isActive: { $ne: false }
    })
      .select("_id")
      .lean();

    for (const admin of admins) {
      recipientIds.add(admin._id.toString());
    }

    await Promise.all(
      [...recipientIds].map((recipientUserId) =>
        sendNotification({
          schoolId,
          recipientUserId,
          title,
          message,
          type: "LABORATORY",
          channel: "IN_APP",
          metadata: {
            equipmentId: equipment._id.toString(),
            laboratoryId: equipment.laboratoryId.toString()
          }
        })
      )
    );
  } catch (error) {
    console.error("Low stock notification failed:", error);
  }
}

export async function generateNextItemCode(
  schoolId: string,
  labCode?: string | null
): Promise<string> {
  const prefix = (labCode?.trim() || "LAB").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "LAB";
  const count = await LaboratoryEquipment.countDocuments({ schoolId });
  let attempt = count + 1;
  for (let i = 0; i < 20; i += 1) {
    const code = `${prefix}-EQ-${String(attempt).padStart(4, "0")}`;
    const exists = await LaboratoryEquipment.exists({ schoolId, itemCode: code });
    if (!exists) {
      return code;
    }
    attempt += 1;
  }
  return `${prefix}-EQ-${Date.now().toString(36).toUpperCase()}`;
}

export async function generateNextLabCode(schoolId: string, type: string): Promise<string> {
  const prefix = type.slice(0, 4).toUpperCase() || "LAB";
  const count = await Laboratory.countDocuments({ schoolId });
  let attempt = count + 1;
  for (let i = 0; i < 20; i += 1) {
    const code = `${prefix}-${String(attempt).padStart(3, "0")}`;
    const exists = await Laboratory.exists({ schoolId, code });
    if (!exists) {
      return code;
    }
    attempt += 1;
  }
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

/** Back-compat helper used by library-style stock badge for equipment without min levels. */
export { getLabStockStatus as getStockStatusWithMin };

export function recordUserId(req: Request): string | undefined {
  return req.user?.userId;
}
