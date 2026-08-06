import type { Request, Response } from "express";
import type { Types } from "mongoose";
import { DEPRECIATION_POOLS, SYSTEM_ACCOUNT_CODES, getDepreciationPool } from "@phit-erp/shared";
import { BankReconciliation } from "../models/BankReconciliation.js";
import { Budget } from "../models/Budget.js";
import { DepreciationRun } from "../models/DepreciationRun.js";
import { FixedAsset } from "../models/FixedAsset.js";
import { ApiError } from "../utils/apiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { recordAudit } from "../utils/audit.js";
import { buildReconciliationView, getPreviouslyClearedIds } from "../utils/bankReconciliationService.js";
import { buildBudgetVariance, flattenBudgetVariance } from "../utils/budgetService.js";
import { buildAssetRegister, computeDepreciation, postAssetDisposal, postDepreciationRun } from "../utils/depreciationService.js";
import { assertFiscalPeriodOpen, getFiscalYearFromBsDate } from "../utils/fiscalYear.js";
import { ensureValidBsDate } from "../utils/nepaliDate.js";
import { postJournalEntry } from "../utils/journalPosting.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";

const currentUserId = (req: Request) => req.user!.userId as unknown as Types.ObjectId;

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------------------
// Fixed assets
// ---------------------------------------------------------------------------

export const listDepreciationPools = asyncHandler(async (_req: Request, res: Response) =>
  sendSuccess(res, "Depreciation pools fetched", DEPRECIATION_POOLS)
);

export const listFixedAssets = asyncHandler(async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = { ...withTenantScope(req), isDeleted: false };
  if (typeof req.query.status === "string" && req.query.status) filter.status = req.query.status;
  if (typeof req.query.pool === "string" && req.query.pool) filter.pool = req.query.pool;

  const assets = await FixedAsset.find(filter).sort({ pool: 1, assetCode: 1 }).limit(2000);
  return sendSuccess(res, "Fixed assets fetched", assets);
});

export const getAssetRegister = asyncHandler(async (req: Request, res: Response) => {
  const includeDisposed = req.query.includeDisposed === "true";
  const register = await buildAssetRegister(tenantObjectId(req), includeDisposed);
  return sendSuccess(res, "Asset register generated", register);
});

export const createFixedAsset = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const body = req.body as Record<string, unknown>;

  const pool = String(body.pool ?? "");
  const poolMeta = getDepreciationPool(pool);
  if (!poolMeta) throw new ApiError(400, "Invalid depreciation pool");

  const acquisitionDateBs = ensureValidBsDate(String(body.acquisitionDateBs ?? ""));
  const acquisitionCostNpr = Number(body.acquisitionCostNpr ?? 0);
  if (!(acquisitionCostNpr > 0)) throw new ApiError(400, "Acquisition cost must be greater than zero");

  const assetCode = String(body.assetCode ?? "").trim();
  if (!assetCode) throw new ApiError(400, "Asset code is required");

  const duplicate = await FixedAsset.findOne({ schoolId, assetCode, isDeleted: false }).lean();
  if (duplicate) throw new ApiError(409, `Asset code ${assetCode} already exists`);

  const asset = await FixedAsset.create({
    schoolId,
    assetCode,
    name: String(body.name ?? "").trim(),
    nameNp: String(body.nameNp ?? ""),
    description: String(body.description ?? ""),
    pool,
    category: String(body.category ?? ""),
    quantity: Number(body.quantity ?? 1),
    serialNumber: String(body.serialNumber ?? ""),
    location: String(body.location ?? ""),
    custodian: String(body.custodian ?? ""),
    vendorName: String(body.vendorName ?? ""),
    invoiceNumber: String(body.invoiceNumber ?? ""),
    acquisitionDateBs,
    acquisitionCostNpr,
    salvageValueNpr: Number(body.salvageValueNpr ?? 0),
    method: body.method === "SLM" ? "SLM" : "WDV",
    ratePercent: body.ratePercent !== undefined ? Number(body.ratePercent) : poolMeta.ratePercent,
    usefulLifeYears: Number(body.usefulLifeYears ?? 0),
    openingAccumulatedDepreciationNpr: Number(body.openingAccumulatedDepreciationNpr ?? 0),
    createdBy: currentUserId(req)
  });

  // Capitalise through the ledger only when asked. Assets onboarded from an existing
  // register are already reflected in the books and must not be double-counted.
  if (body.postToLedger === true) {
    await assertFiscalPeriodOpen(schoolId, acquisitionDateBs);
    const journal = await postJournalEntry({
      schoolId,
      userId: currentUserId(req),
      dateBs: acquisitionDateBs,
      narration: `Asset acquired — ${asset.name} (${asset.assetCode})`,
      lines: [
        {
          accountCode: poolMeta.accountCode,
          accountName: "",
          debitNpr: acquisitionCostNpr,
          creditNpr: 0,
          description: asset.name
        },
        {
          accountCode: String(body.paymentAccountCode ?? SYSTEM_ACCOUNT_CODES.CASH),
          accountName: "",
          debitNpr: 0,
          creditNpr: acquisitionCostNpr,
          description: `Payment for ${asset.name}`
        }
      ],
      voucherType: "PAYMENT",
      referenceType: "Manual"
    });
    asset.acquisitionJournalEntryId = journal._id;
    await asset.save();
  }

  await recordAudit(req, {
    action: "accounting.asset.create",
    entity: "FixedAsset",
    entityId: asset._id.toString(),
    after: asset
  });
  return sendSuccess(res, "Fixed asset created", asset, 201);
});

export const updateFixedAsset = asyncHandler(async (req: Request, res: Response) => {
  const asset = await FixedAsset.findOne(withTenantScope(req, { _id: req.params.id, isDeleted: false }));
  if (!asset) throw new ApiError(404, "Fixed asset not found");
  if (asset.status !== "ACTIVE") throw new ApiError(400, "Disposed assets cannot be edited");

  const before = asset.toObject();
  const body = req.body as Record<string, unknown>;
  const editable = [
    "name",
    "nameNp",
    "description",
    "category",
    "serialNumber",
    "location",
    "custodian",
    "vendorName",
    "invoiceNumber"
  ] as const;

  const writable = asset as unknown as Record<string, unknown>;
  for (const field of editable) {
    if (body[field] !== undefined) writable[field] = String(body[field]);
  }
  if (body.quantity !== undefined) asset.quantity = Number(body.quantity);
  if (body.salvageValueNpr !== undefined) asset.salvageValueNpr = Number(body.salvageValueNpr);
  if (body.ratePercent !== undefined) asset.ratePercent = Number(body.ratePercent);
  if (body.usefulLifeYears !== undefined) asset.usefulLifeYears = Number(body.usefulLifeYears);

  await asset.save();
  await recordAudit(req, {
    action: "accounting.asset.update",
    entity: "FixedAsset",
    entityId: asset._id.toString(),
    before,
    after: asset
  });
  return sendSuccess(res, "Fixed asset updated", asset);
});

export const disposeFixedAsset = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const body = req.body as Record<string, unknown>;
  const disposalDateBs = ensureValidBsDate(String(body.disposalDateBs ?? ""));
  await assertFiscalPeriodOpen(schoolId, disposalDateBs);

  const result = await postAssetDisposal({
    schoolId,
    userId: currentUserId(req),
    assetId: String(req.params.id),
    disposalDateBs,
    proceedsNpr: Number(body.proceedsNpr ?? 0),
    paymentAccountCode: body.paymentAccountCode ? String(body.paymentAccountCode) : undefined,
    notes: body.notes ? String(body.notes) : undefined
  });

  await recordAudit(req, {
    action: "accounting.asset.dispose",
    entity: "FixedAsset",
    entityId: String(req.params.id),
    after: result
  });

  return sendSuccess(
    res,
    result.gainLossNpr >= 0
      ? `Asset disposed with a gain of NPR ${result.gainLossNpr.toFixed(2)}`
      : `Asset disposed with a loss of NPR ${Math.abs(result.gainLossNpr).toFixed(2)}`,
    result
  );
});

// ---------------------------------------------------------------------------
// Depreciation
// ---------------------------------------------------------------------------

export const previewDepreciation = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const fiscalYearBs = String(req.query.fiscalYearBs ?? "").trim();
  if (!fiscalYearBs) throw new ApiError(400, "fiscalYearBs is required");

  const [preview, existing] = await Promise.all([
    computeDepreciation(schoolId, fiscalYearBs),
    DepreciationRun.findOne({ schoolId, fiscalYearBs, isDeleted: false }).lean()
  ]);

  return sendSuccess(res, "Depreciation preview generated", {
    fiscalYearBs,
    alreadyPosted: Boolean(existing),
    postedTotalNpr: existing?.totalDepreciationNpr ?? 0,
    lines: preview.lines,
    totalNpr: preview.totalNpr
  });
});

export const listDepreciationRuns = asyncHandler(async (req: Request, res: Response) => {
  const runs = await DepreciationRun.find({ ...withTenantScope(req), isDeleted: false })
    .sort({ fiscalYearBs: -1 })
    .limit(50);
  return sendSuccess(res, "Depreciation runs fetched", runs);
});

export const runDepreciation = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const body = req.body as Record<string, unknown>;
  const runDateBs = ensureValidBsDate(String(body.runDateBs ?? ""));
  const fiscalYearBs = String(body.fiscalYearBs ?? getFiscalYearFromBsDate(runDateBs)).trim();

  await assertFiscalPeriodOpen(schoolId, runDateBs);

  const result = await postDepreciationRun({
    schoolId,
    userId: currentUserId(req),
    fiscalYearBs,
    runDateBs,
    notes: body.notes ? String(body.notes) : undefined
  });

  if (!result.posted) throw new ApiError(400, result.reason ?? "Depreciation could not be posted");

  await recordAudit(req, {
    action: "accounting.depreciation.run",
    entity: "DepreciationRun",
    entityId: result.runId!.toString(),
    after: result
  });

  return sendSuccess(res, `Depreciation of NPR ${result.totalNpr.toFixed(2)} posted for FY ${fiscalYearBs}`, result);
});

// ---------------------------------------------------------------------------
// Bank reconciliation
// ---------------------------------------------------------------------------

export const listBankReconciliations = asyncHandler(async (req: Request, res: Response) => {
  const reconciliations = await BankReconciliation.find({ ...withTenantScope(req), isDeleted: false })
    .sort({ statementDateBs: -1 })
    .limit(100);
  return sendSuccess(res, "Bank reconciliations fetched", reconciliations);
});

export const previewBankReconciliation = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const statementDateBs = ensureValidBsDate(String(req.query.statementDateBs ?? ""));
  const accountCode = String(req.query.accountCode ?? SYSTEM_ACCOUNT_CODES.BANK);
  const fromDateBs = typeof req.query.fromDateBs === "string" && req.query.fromDateBs ? req.query.fromDateBs : undefined;

  // Pre-tick whatever a previous completed reconciliation already settled.
  const previouslyCleared = await getPreviouslyClearedIds(schoolId, accountCode, statementDateBs);

  const view = await buildReconciliationView({
    schoolId,
    accountCode,
    statementDateBs,
    statementBalanceNpr: Number(req.query.statementBalanceNpr ?? 0),
    clearedEntryIds: previouslyCleared,
    fromDateBs
  });

  return sendSuccess(res, "Reconciliation preview generated", view);
});

export const saveBankReconciliation = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const body = req.body as Record<string, unknown>;
  const statementDateBs = ensureValidBsDate(String(body.statementDateBs ?? ""));
  const accountCode = String(body.accountCode ?? SYSTEM_ACCOUNT_CODES.BANK);
  const statementBalanceNpr = Number(body.statementBalanceNpr ?? 0);
  const clearedEntryIds = Array.isArray(body.clearedEntryIds) ? (body.clearedEntryIds as string[]) : [];

  const view = await buildReconciliationView({
    schoolId,
    accountCode,
    statementDateBs,
    statementBalanceNpr,
    clearedEntryIds,
    fromDateBs: body.fromDateBs ? String(body.fromDateBs) : undefined
  });

  const markCompleted = body.status === "COMPLETED";
  if (markCompleted && !view.isReconciled) {
    throw new ApiError(
      400,
      `Cannot complete: statement and ledger differ by NPR ${view.differenceNpr.toFixed(2)}. Clear the remaining items or post the missing entries first.`
    );
  }

  const doc = await BankReconciliation.findOneAndUpdate(
    { schoolId, accountCode, statementDateBs, isDeleted: false },
    {
      schoolId,
      accountCode,
      bankAccountId: body.bankAccountId ? String(body.bankAccountId) : undefined,
      statementDateBs,
      statementBalanceNpr: round2(statementBalanceNpr),
      clearedEntryIds,
      ledgerBalanceNpr: view.ledgerBalanceNpr,
      unpresentedChequesNpr: view.unpresentedChequesNpr,
      depositsInTransitNpr: view.depositsInTransitNpr,
      adjustedBalanceNpr: view.adjustedBalanceNpr,
      differenceNpr: view.differenceNpr,
      notes: String(body.notes ?? ""),
      status: markCompleted ? "COMPLETED" : "DRAFT",
      ...(markCompleted ? { completedAt: new Date(), completedBy: currentUserId(req) } : {}),
      createdBy: currentUserId(req)
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  await recordAudit(req, {
    action: markCompleted ? "accounting.reconciliation.complete" : "accounting.reconciliation.save",
    entity: "BankReconciliation",
    entityId: doc!._id.toString(),
    after: doc
  });

  return sendSuccess(res, markCompleted ? "Bank reconciliation completed" : "Bank reconciliation saved", {
    reconciliation: doc,
    view
  });
});

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

export const listBudgets = asyncHandler(async (req: Request, res: Response) => {
  const budgets = await Budget.find({ ...withTenantScope(req), isDeleted: false }).sort({ fiscalYearBs: -1 });
  return sendSuccess(res, "Budgets fetched", budgets);
});

export const upsertBudget = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const body = req.body as Record<string, unknown>;
  const fiscalYearBs = String(body.fiscalYearBs ?? "").trim();
  if (!fiscalYearBs) throw new ApiError(400, "fiscalYearBs is required");

  const rawLines = Array.isArray(body.lines) ? (body.lines as Array<Record<string, unknown>>) : [];
  const lines = rawLines
    .map((line) => ({
      accountCode: String(line.accountCode ?? "").trim(),
      accountName: String(line.accountName ?? ""),
      budgetedNpr: round2(Number(line.budgetedNpr ?? 0)),
      notes: String(line.notes ?? "")
    }))
    .filter((line) => line.accountCode);

  const existing = await Budget.findOne({ schoolId, fiscalYearBs, isDeleted: false });
  if (existing?.status === "APPROVED" && body.status !== "DRAFT") {
    throw new ApiError(400, "Approved budget is locked. Reopen it as draft before editing.");
  }

  const budget = await Budget.findOneAndUpdate(
    { schoolId, fiscalYearBs, isDeleted: false },
    {
      schoolId,
      fiscalYearBs,
      title: String(body.title ?? ""),
      lines,
      notes: String(body.notes ?? ""),
      status: body.status === "APPROVED" ? "APPROVED" : "DRAFT",
      ...(body.status === "APPROVED" ? { approvedAt: new Date(), approvedBy: currentUserId(req) } : {}),
      createdBy: currentUserId(req)
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  await recordAudit(req, {
    action: "accounting.budget.upsert",
    entity: "Budget",
    entityId: budget!._id.toString(),
    after: budget
  });
  return sendSuccess(res, "Budget saved", budget);
});

export const getBudgetVariance = asyncHandler(async (req: Request, res: Response) => {
  const fiscalYearBs = String(req.query.fiscalYearBs ?? "").trim();
  if (!fiscalYearBs) throw new ApiError(400, "fiscalYearBs is required");

  const variance = await buildBudgetVariance(tenantObjectId(req), fiscalYearBs);
  return sendSuccess(res, "Budget variance generated", {
    ...variance,
    reportRows: flattenBudgetVariance(variance)
  });
});
