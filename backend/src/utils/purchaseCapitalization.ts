import type { ClientSession, Types } from "mongoose";
import { purchasePostingFor } from "@phit-erp/shared";
import { AccountingSettings } from "../models/AccountingSettings.js";
import { FixedAsset } from "../models/FixedAsset.js";
import { ApiError } from "./apiError.js";
import { getDepreciationPool } from "@phit-erp/shared";

/** Where a purchase is debited, using the institution's capitalisation threshold. */
export const resolvePurchasePosting = async (
  schoolId: Types.ObjectId,
  category: string,
  amountNpr: number
) => {
  const settings = await AccountingSettings.findOne({ schoolId }).select("capitalizationThresholdNpr").lean();
  const threshold = Number((settings as { capitalizationThresholdNpr?: number } | null)?.capitalizationThresholdNpr);
  return purchasePostingFor(category, amountNpr, Number.isFinite(threshold) ? threshold : undefined);
};

/**
 * Register a capitalised purchase in Fixed Assets so it depreciates. The voucher already
 * debited the pool account, so the asset is recorded as already in the ledger (no second
 * posting). Idempotent per purchase.
 */
export const registerPurchasedAsset = async (params: {
  schoolId: Types.ObjectId;
  userId: Types.ObjectId;
  pool: "B" | "D";
  purchase: {
    _id: Types.ObjectId;
    voucherNumber?: string | null;
    category: string;
    item?: string | null;
    vendor: string;
    invoiceNumber?: string | null;
    quantity: number;
    purchaseDateBs: string;
    totalAmountNpr: number;
  };
  journalEntryId?: Types.ObjectId;
}) => {
  const existing = await FixedAsset.findOne({ schoolId: params.schoolId, sourcePurchaseId: params.purchase._id, isDeleted: false }).lean();
  if (existing) return existing;
  const meta = getDepreciationPool(params.pool);
  let assetCode = params.purchase.voucherNumber?.trim() || `PUR-${params.purchase._id.toString().slice(-6).toUpperCase()}`;
  if (await FixedAsset.exists({ schoolId: params.schoolId, assetCode, isDeleted: false })) {
    assetCode = `${assetCode}-${params.purchase._id.toString().slice(-4).toUpperCase()}`;
  }
  return FixedAsset.create({
    schoolId: params.schoolId,
    assetCode,
    name: params.purchase.item?.trim() || params.purchase.category,
    description: `From Direct Expense ${params.purchase.voucherNumber ?? ""}`.trim(),
    pool: params.pool,
    category: params.purchase.category,
    quantity: params.purchase.quantity || 1,
    vendorName: params.purchase.vendor,
    invoiceNumber: params.purchase.invoiceNumber ?? "",
    acquisitionDateBs: params.purchase.purchaseDateBs,
    acquisitionCostNpr: params.purchase.totalAmountNpr,
    method: "WDV",
    ratePercent: meta?.ratePercent ?? 0,
    acquisitionJournalEntryId: params.journalEntryId,
    sourcePurchaseId: params.purchase._id,
    createdBy: params.userId
  });
};

/**
 * Before a purchase is voided: an asset registered from it is removed with it, unless
 * depreciation has already been charged (then it must be disposed in Fixed Assets).
 */
export const assertPurchaseAssetCanBeVoided = async (schoolId: Types.ObjectId, purchaseId: Types.ObjectId) => {
  const asset = await FixedAsset.findOne({ schoolId, sourcePurchaseId: purchaseId, isDeleted: false }).lean();
  if (!asset) return null;
  if ((asset.accumulatedDepreciationNpr ?? 0) > 0 || asset.status !== "ACTIVE") {
    throw new ApiError(
      400,
      `This purchase was registered as fixed asset ${asset.assetCode} and depreciation has been charged on it. Dispose of the asset in Fixed Assets instead of voiding the purchase.`
    );
  }
  return asset;
};

export const removePurchaseAsset = async (
  schoolId: Types.ObjectId,
  purchaseId: Types.ObjectId,
  userId: Types.ObjectId,
  session?: ClientSession | null
) => {
  await FixedAsset.updateOne(
    { schoolId, sourcePurchaseId: purchaseId, isDeleted: false },
    { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: userId } },
    session ? { session } : undefined
  );
};
