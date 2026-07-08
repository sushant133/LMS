import type { Request } from "express";
import { DEFAULT_LIBRARY_INVENTORY_ACCESS, isInstitutionAdmin } from "@phit-erp/shared";
import { Setting } from "../models/Setting.js";
import { ApiError } from "./apiError.js";

export async function getLibraryInventoryAccessEnabled(schoolId: string): Promise<boolean> {
  const settings = await Setting.findOne({ schoolId }).select("libraryInventoryAccess").lean();
  return settings?.libraryInventoryAccess?.enabled ?? DEFAULT_LIBRARY_INVENTORY_ACCESS.enabled;
}

export async function assertLibraryInventoryWriteAccess(req: Request): Promise<void> {
  if (isInstitutionAdmin(req.user?.role ?? "")) {
    return;
  }

  const enabled = await getLibraryInventoryAccessEnabled(req.tenantSchoolId!);
  if (!enabled) {
    throw new ApiError(
      403,
      "Inventory access is disabled. Ask your administrator to enable inventory changes before adding or editing books."
    );
  }
}