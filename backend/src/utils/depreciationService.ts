import type { Types } from "mongoose";
import { SYSTEM_ACCOUNT_CODES, getDepreciationPool } from "@phit-erp/shared";
import { DepreciationRun } from "../models/DepreciationRun.js";
import { FixedAsset } from "../models/FixedAsset.js";
import { getFiscalYearFromBsDate } from "./fiscalYear.js";
import { postJournalEntry } from "./journalPosting.js";

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Fraction of a full year's depreciation allowed on an asset acquired during the year.
 *
 * Income Tax Act 2058, Schedule 2(2): additions are absorbed into the pool at a reducing
 * fraction depending on which third of the fiscal year they were acquired in. The Nepali
 * fiscal year runs Shrawan (month 4) to Ashadh (month 3), so:
 *
 *   Shrawan–Kartik   (4,5,6,7)    -> 100%
 *   Mangsir–Falgun   (8,9,10,11)  -> 2/3
 *   Chaitra–Ashadh   (12,1,2,3)   -> 1/3
 *
 * Assets acquired in an earlier year always get the full rate.
 */
export const getAcquisitionFactor = (acquisitionDateBs: string, fiscalYearBs: string): number => {
  if (getFiscalYearFromBsDate(acquisitionDateBs, fiscalYearBs) !== fiscalYearBs) {
    return 1; // acquired in a prior year
  }

  const month = Number(acquisitionDateBs.split("-")[1] ?? 0);
  if ([4, 5, 6, 7].includes(month)) return 1;
  if ([8, 9, 10, 11].includes(month)) return 2 / 3;
  return 1 / 3;
};

export interface DepreciationLine {
  assetId: Types.ObjectId;
  assetCode: string;
  assetName: string;
  pool: string;
  ratePercent: number;
  acquisitionFactor: number;
  openingWdvNpr: number;
  depreciationNpr: number;
  closingWdvNpr: number;
}

/**
 * Compute (without posting) the depreciation charge for a fiscal year.
 *
 * Assets acquired after the year being charged are skipped entirely, as are disposed and
 * land assets. Depreciation is capped so an asset can never be written below its salvage
 * value, and WDV is measured against the asset's own written-down value including any
 * opening accumulated depreciation carried in at onboarding.
 */
export const computeDepreciation = async (
  schoolId: Types.ObjectId,
  fiscalYearBs: string
): Promise<{ lines: DepreciationLine[]; totalNpr: number }> => {
  const assets = await FixedAsset.find({ schoolId, isDeleted: false, status: "ACTIVE" }).lean();
  const lines: DepreciationLine[] = [];

  for (const asset of assets) {
    const poolMeta = getDepreciationPool(asset.pool);
    if (asset.pool === "LAND") continue;

    // Ignore anything bought after the year we are charging.
    const assetFy = getFiscalYearFromBsDate(asset.acquisitionDateBs, fiscalYearBs);
    if (assetFy > fiscalYearBs) continue;

    const cost = Number(asset.acquisitionCostNpr || 0);
    const salvage = Math.max(0, Number(asset.salvageValueNpr || 0));
    const accumulated =
      Number(asset.openingAccumulatedDepreciationNpr || 0) + Number(asset.accumulatedDepreciationNpr || 0);
    const openingWdv = round2(cost - accumulated);

    const depreciableRemaining = round2(openingWdv - salvage);
    if (depreciableRemaining <= 0.01) continue;

    const ratePercent = Number(asset.ratePercent ?? poolMeta?.ratePercent ?? 0);
    const factor = getAcquisitionFactor(asset.acquisitionDateBs, fiscalYearBs);

    let charge: number;
    if (asset.method === "SLM") {
      const life = Number(asset.usefulLifeYears || 0);
      if (life <= 0) continue;
      charge = round2(((cost - salvage) / life) * factor);
    } else {
      if (ratePercent <= 0) continue;
      charge = round2(openingWdv * (ratePercent / 100) * factor);
    }

    // Never depreciate below salvage value.
    charge = round2(Math.min(charge, depreciableRemaining));
    if (charge <= 0.01) continue;

    lines.push({
      assetId: asset._id,
      assetCode: asset.assetCode,
      assetName: asset.name,
      pool: asset.pool,
      ratePercent,
      acquisitionFactor: round2(factor),
      openingWdvNpr: openingWdv,
      depreciationNpr: charge,
      closingWdvNpr: round2(openingWdv - charge)
    });
  }

  return { lines, totalNpr: round2(lines.reduce((sum, l) => sum + l.depreciationNpr, 0)) };
};

/**
 * Post the depreciation charge for a fiscal year.
 *
 * One voucher covers the whole run: Dr Depreciation Expense, Cr Accumulated Depreciation.
 * A unique index on (school, fiscal year) makes a second run for the same year fail rather
 * than silently double-charge.
 */
export const postDepreciationRun = async (params: {
  schoolId: Types.ObjectId;
  userId: Types.ObjectId;
  fiscalYearBs: string;
  runDateBs: string;
  notes?: string;
}): Promise<{ posted: boolean; reason?: string; runId?: Types.ObjectId; totalNpr: number }> => {
  const existing = await DepreciationRun.findOne({
    schoolId: params.schoolId,
    fiscalYearBs: params.fiscalYearBs,
    isDeleted: false
  }).lean();
  if (existing) {
    return {
      posted: false,
      reason: `Depreciation has already been charged for FY ${params.fiscalYearBs}`,
      runId: existing._id,
      totalNpr: existing.totalDepreciationNpr
    };
  }

  const { lines, totalNpr } = await computeDepreciation(params.schoolId, params.fiscalYearBs);
  if (lines.length === 0 || totalNpr <= 0) {
    return { posted: false, reason: "No depreciable assets for this fiscal year", totalNpr: 0 };
  }

  const journal = await postJournalEntry({
    schoolId: params.schoolId,
    userId: params.userId,
    dateBs: params.runDateBs,
    narration: `Depreciation for FY ${params.fiscalYearBs}`,
    lines: [
      {
        accountCode: SYSTEM_ACCOUNT_CODES.DEPRECIATION_EXPENSE,
        accountName: "Depreciation",
        debitNpr: totalNpr,
        creditNpr: 0,
        description: `Depreciation FY ${params.fiscalYearBs}`
      },
      {
        accountCode: SYSTEM_ACCOUNT_CODES.ACCUMULATED_DEPRECIATION,
        accountName: "Accumulated Depreciation",
        debitNpr: 0,
        creditNpr: totalNpr,
        description: `Depreciation FY ${params.fiscalYearBs}`
      }
    ],
    voucherType: "JOURNAL",
    referenceType: "Manual"
  });

  const run = await DepreciationRun.create({
    schoolId: params.schoolId,
    fiscalYearBs: params.fiscalYearBs,
    runDateBs: params.runDateBs,
    lines,
    totalDepreciationNpr: totalNpr,
    journalEntryId: journal._id,
    notes: params.notes ?? "",
    createdBy: params.userId
  });

  // Roll each asset's accumulated depreciation forward.
  await Promise.all(
    lines.map((line) =>
      FixedAsset.updateOne(
        { _id: line.assetId, schoolId: params.schoolId },
        { $inc: { accumulatedDepreciationNpr: line.depreciationNpr } }
      )
    )
  );

  return { posted: true, runId: run._id, totalNpr };
};

/**
 * Dispose of an asset.
 *
 * Removes the asset and its accumulated depreciation from the books, brings in any sale
 * proceeds, and books the balancing figure as a gain or loss on disposal:
 *
 *   Dr Cash/Bank (proceeds) · Dr Accumulated Depreciation · Cr Asset (cost)
 *   · Cr Gain  /  Dr Loss  (balancing)
 */
export const postAssetDisposal = async (params: {
  schoolId: Types.ObjectId;
  userId: Types.ObjectId;
  assetId: Types.ObjectId | string;
  disposalDateBs: string;
  proceedsNpr: number;
  paymentAccountCode?: string;
  notes?: string;
}): Promise<{ gainLossNpr: number; journalEntryId: Types.ObjectId }> => {
  const asset = await FixedAsset.findOne({
    _id: params.assetId,
    schoolId: params.schoolId,
    isDeleted: false
  });
  if (!asset) throw new Error("Fixed asset not found");
  if (asset.status !== "ACTIVE") throw new Error("Asset has already been disposed or written off");

  const poolMeta = getDepreciationPool(asset.pool);
  const assetAccount = poolMeta?.accountCode ?? SYSTEM_ACCOUNT_CODES.FIXED_ASSET_POOL_D;
  const cost = round2(Number(asset.acquisitionCostNpr || 0));
  const accumulated = round2(
    Number(asset.openingAccumulatedDepreciationNpr || 0) + Number(asset.accumulatedDepreciationNpr || 0)
  );
  const wdv = round2(cost - accumulated);
  const proceeds = round2(Math.max(0, params.proceedsNpr));
  const gainLossNpr = round2(proceeds - wdv);

  const lines = [
    ...(proceeds > 0
      ? [
          {
            accountCode: params.paymentAccountCode ?? SYSTEM_ACCOUNT_CODES.CASH,
            accountName: "",
            debitNpr: proceeds,
            creditNpr: 0,
            description: `Disposal proceeds — ${asset.name}`
          }
        ]
      : []),
    ...(accumulated > 0
      ? [
          {
            accountCode: SYSTEM_ACCOUNT_CODES.ACCUMULATED_DEPRECIATION,
            accountName: "Accumulated Depreciation",
            debitNpr: accumulated,
            creditNpr: 0,
            description: "Reverse accumulated depreciation on disposal"
          }
        ]
      : []),
    {
      accountCode: assetAccount,
      accountName: "",
      debitNpr: 0,
      creditNpr: cost,
      description: `Remove asset at cost — ${asset.name}`
    }
  ];

  if (Math.abs(gainLossNpr) >= 0.01) {
    lines.push({
      accountCode: SYSTEM_ACCOUNT_CODES.ASSET_DISPOSAL,
      accountName: "Gain / (Loss) on Asset Disposal",
      debitNpr: gainLossNpr < 0 ? Math.abs(gainLossNpr) : 0,
      creditNpr: gainLossNpr > 0 ? gainLossNpr : 0,
      description: gainLossNpr >= 0 ? "Gain on disposal" : "Loss on disposal"
    });
  }

  const journal = await postJournalEntry({
    schoolId: params.schoolId,
    userId: params.userId,
    dateBs: params.disposalDateBs,
    narration: `Asset disposal — ${asset.name} (${asset.assetCode})`,
    lines,
    voucherType: "JOURNAL",
    referenceType: "Manual"
  });

  asset.status = "DISPOSED";
  asset.disposalDateBs = params.disposalDateBs;
  asset.disposalProceedsNpr = proceeds;
  asset.disposalNotes = params.notes ?? "";
  asset.disposalJournalEntryId = journal._id;
  await asset.save();

  return { gainLossNpr, journalEntryId: journal._id };
};

/** Fixed asset register: cost, depreciation and written-down value per asset. */
export const buildAssetRegister = async (schoolId: Types.ObjectId, includeDisposed = false) => {
  const filter: Record<string, unknown> = { schoolId, isDeleted: false };
  if (!includeDisposed) filter.status = "ACTIVE";

  const assets = await FixedAsset.find(filter).sort({ pool: 1, assetCode: 1 }).lean();

  const rows = assets.map((asset) => {
    const cost = round2(Number(asset.acquisitionCostNpr || 0));
    const accumulated = round2(
      Number(asset.openingAccumulatedDepreciationNpr || 0) + Number(asset.accumulatedDepreciationNpr || 0)
    );
    return {
      assetCode: asset.assetCode,
      name: asset.name,
      pool: asset.pool,
      poolLabel: getDepreciationPool(asset.pool)?.label ?? asset.pool,
      acquisitionDateBs: asset.acquisitionDateBs,
      ratePercent: asset.ratePercent,
      method: asset.method,
      location: asset.location,
      status: asset.status,
      acquisitionCostNpr: cost,
      accumulatedDepreciationNpr: accumulated,
      writtenDownValueNpr: round2(cost - accumulated)
    };
  });

  return {
    rows,
    totals: {
      acquisitionCostNpr: round2(rows.reduce((s, r) => s + r.acquisitionCostNpr, 0)),
      accumulatedDepreciationNpr: round2(rows.reduce((s, r) => s + r.accumulatedDepreciationNpr, 0)),
      writtenDownValueNpr: round2(rows.reduce((s, r) => s + r.writtenDownValueNpr, 0)),
      assetCount: rows.length
    }
  };
};
