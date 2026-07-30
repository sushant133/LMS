import type { Request, Response } from "express";
import {
  COLLEGE_STAFF_CATEGORY_LABELS,
  DEFAULT_FINANCE_CATEGORIES,
  FINANCE_OWNER_SCOPES,
  financeCategorySchema,
  financeTransactionSchema,
  normalizeUserRole,
  type FinanceCategoryRecord,
  type FinanceDashboardResponse,
  type FinanceOwnerScope,
  type FinanceReportResponse,
  type FinanceStaffAccessRecord,
  type FinanceTransactionRecord
} from "@phit-erp/shared";
import { CollegeStaff } from "../models/CollegeStaff.js";
import { FinanceCategory } from "../models/FinanceCategory.js";
import { FinanceTransaction } from "../models/FinanceTransaction.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { deleteStoredMediaUrls } from "../utils/mediaCleanup.js";
import { sendSuccess } from "../utils/response.js";
import { withTenantScope, tenantObjectId } from "../utils/tenant.js";

const emptyToUndef = (value?: string | null) => {
  const v = value?.trim();
  return v ? v : undefined;
};

/** Institution Admin / Superadmin — full finance archive including all personal books. */
export const isFinanceInstitutionAdmin = (req: Request): boolean => {
  const role = normalizeUserRole(req.user?.role ?? "");
  return role === "SUPER_ADMIN" || role === "COLLEGE_ADMIN";
};

export const isFinanceCollegeAdministrator = (req: Request): boolean =>
  normalizeUserRole(req.user?.role ?? "") === "COLLEGE_VIEWER";

/** Staff personal finance is granted via User.personalFinanceAccess (default false). */
export const loadPersonalFinanceAccess = async (
  userId?: string
): Promise<boolean> => {
  if (!userId) return false;
  const user = await User.findById(userId).select("personalFinanceAccess").lean();
  return Boolean(user?.personalFinanceAccess);
};

/**
 * Who owns new rows:
 * - COLLEGE_VIEWER → COLLEGE_ADMINISTRATOR book
 * - Staff with personalFinanceAccess → STAFF book
 * - Admin / Superadmin → INSTITUTION archive
 */
const resolveOwnerScopeForUser = async (
  req: Request
): Promise<FinanceOwnerScope> => {
  const role = normalizeUserRole(req.user?.role ?? "");
  if (role === "COLLEGE_VIEWER") return "COLLEGE_ADMINISTRATOR";
  if (role === "SUPER_ADMIN" || role === "COLLEGE_ADMIN") return "INSTITUTION";
  const granted = await loadPersonalFinanceAccess(req.user?.userId);
  if (granted) return "STAFF";
  return "INSTITUTION";
};

const resolveDocOwnerScope = (doc: {
  ownerScope?: unknown;
}): FinanceOwnerScope => {
  const scope = doc.ownerScope;
  if (scope === "COLLEGE_ADMINISTRATOR") return "COLLEGE_ADMINISTRATOR";
  if (scope === "STAFF") return "STAFF";
  return "INSTITUTION";
};

/**
 * Personal-book users only see their own rows.
 * Institution admins see everything; optional query filters: ownerScope, createdBy.
 */
const applyFinanceListScope = async (
  req: Request,
  filter: Record<string, unknown>
): Promise<void> => {
  if (isFinanceInstitutionAdmin(req)) {
    const ownerScope =
      typeof req.query.ownerScope === "string" ? req.query.ownerScope : "";
    const createdBy =
      typeof req.query.createdBy === "string" ? req.query.createdBy : "";

    if (
      ownerScope &&
      (FINANCE_OWNER_SCOPES as readonly string[]).includes(ownerScope)
    ) {
      if (ownerScope === "INSTITUTION") {
        // Legacy rows without ownerScope count as institution archive.
        const scopeClause = {
          $or: [
            { ownerScope: "INSTITUTION" },
            { ownerScope: { $exists: false } },
            { ownerScope: null }
          ]
        };
        if (filter.$or) {
          filter.$and = [
            ...((filter.$and as unknown[]) ?? []),
            { $or: filter.$or },
            scopeClause
          ];
          delete filter.$or;
        } else {
          Object.assign(filter, scopeClause);
        }
      } else {
        filter.ownerScope = ownerScope;
      }
    }
    if (createdBy) {
      filter.createdBy = createdBy;
    }
    return;
  }

  if (isFinanceCollegeAdministrator(req)) {
    filter.ownerScope = "COLLEGE_ADMINISTRATOR";
    filter.createdBy = req.user?.userId;
    return;
  }

  // Staff personal book (access already enforced at route)
  filter.ownerScope = "STAFF";
  filter.createdBy = req.user?.userId;
};

/** Read access: admins all; college admin / staff only own personal book. */
const assertFinanceTransactionAccess = (
  req: Request,
  doc: { ownerScope?: unknown; createdBy?: unknown }
): void => {
  if (isFinanceInstitutionAdmin(req)) return;

  const ownerScope = resolveDocOwnerScope(doc);
  const createdBy = String(doc.createdBy ?? "");
  const self = String(req.user?.userId ?? "");

  if (isFinanceCollegeAdministrator(req)) {
    if (ownerScope !== "COLLEGE_ADMINISTRATOR" || createdBy !== self) {
      throw new ApiError(403, "You can only access your own finance records");
    }
    return;
  }

  // Staff
  if (ownerScope !== "STAFF" || createdBy !== self) {
    throw new ApiError(403, "You can only access your own finance records");
  }
};

/**
 * Write (update/delete): institution admins only.
 * Staff may create new rows but cannot edit/delete.
 * College Administrators keep edit/delete on their own book.
 */
const assertFinanceTransactionWrite = (
  req: Request,
  doc: { ownerScope?: unknown; createdBy?: unknown }
): void => {
  if (isFinanceInstitutionAdmin(req)) return;

  if (isFinanceCollegeAdministrator(req)) {
    assertFinanceTransactionAccess(req, doc);
    return;
  }

  // Staff: no edit/delete
  throw new ApiError(
    403,
    "Staff cannot edit or delete finance records. Contact Administrator."
  );
};

const serializeCategory = (doc: Record<string, unknown>): FinanceCategoryRecord => ({
  _id: String(doc._id),
  schoolId: String(doc.schoolId),
  name: String(doc.name ?? ""),
  kind: doc.kind as FinanceCategoryRecord["kind"],
  description: (doc.description as string | undefined) || undefined,
  isSystem: Boolean(doc.isSystem),
  isActive: Boolean(doc.isActive),
  sortOrder: typeof doc.sortOrder === "number" ? doc.sortOrder : 0,
  createdAt: doc.createdAt
    ? new Date(doc.createdAt as Date).toISOString()
    : undefined,
  updatedAt: doc.updatedAt
    ? new Date(doc.updatedAt as Date).toISOString()
    : undefined
});

const serializeTransaction = (
  doc: Record<string, unknown>,
  names?: { createdByName?: string; updatedByName?: string; categoryName?: string }
): FinanceTransactionRecord => ({
  _id: String(doc._id),
  schoolId: String(doc.schoolId),
  transactionType: doc.transactionType as FinanceTransactionRecord["transactionType"],
  dateBs: String(doc.dateBs ?? ""),
  title: String(doc.title ?? ""),
  categoryId: String(doc.categoryId),
  categoryName: names?.categoryName,
  expenseType: doc.expenseType as FinanceTransactionRecord["expenseType"] | undefined,
  incomeSource: (doc.incomeSource as string | undefined) || undefined,
  description: (doc.description as string | undefined) || undefined,
  vendorPayee: (doc.vendorPayee as string | undefined) || undefined,
  amountNpr: Number(doc.amountNpr ?? 0),
  paymentMethod: doc.paymentMethod as FinanceTransactionRecord["paymentMethod"],
  referenceNumber: (doc.referenceNumber as string | undefined) || undefined,
  remarks: (doc.remarks as string | undefined) || undefined,
  attachments: Array.isArray(doc.attachments)
    ? (doc.attachments as FinanceTransactionRecord["attachments"])
    : [],
  ownerScope: resolveDocOwnerScope(doc),
  accountingLinkId: doc.accountingLinkId ? String(doc.accountingLinkId) : null,
  createdBy: String(doc.createdBy),
  createdByName: names?.createdByName,
  updatedBy: doc.updatedBy ? String(doc.updatedBy) : undefined,
  updatedByName: names?.updatedByName,
  createdAt: doc.createdAt
    ? new Date(doc.createdAt as Date).toISOString()
    : undefined,
  updatedAt: doc.updatedAt
    ? new Date(doc.updatedAt as Date).toISOString()
    : undefined
});

const ensureDefaultCategories = async (schoolId: string) => {
  const count = await FinanceCategory.countDocuments({ schoolId });
  if (count > 0) return;

  await FinanceCategory.insertMany(
    DEFAULT_FINANCE_CATEGORIES.map((item) => ({
      schoolId,
      name: item.name,
      kind: item.kind,
      isSystem: true,
      isActive: true,
      sortOrder: item.sortOrder
    }))
  );
};

const loadUserNames = async (userIds: string[]) => {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return new Map<string, string>();
  const users = await User.find({ _id: { $in: unique } }).select("fullName").lean();
  return new Map(users.map((u) => [u._id.toString(), u.fullName]));
};

const enrichTransactions = async (
  rows: Array<Record<string, unknown>>
): Promise<FinanceTransactionRecord[]> => {
  const categoryIds = [
    ...new Set(rows.map((r) => String(r.categoryId)).filter(Boolean))
  ];
  const userIds = rows.flatMap((r) =>
    [r.createdBy, r.updatedBy].filter(Boolean).map(String)
  );

  const [categories, nameMap] = await Promise.all([
    FinanceCategory.find({ _id: { $in: categoryIds } }).select("name").lean(),
    loadUserNames(userIds)
  ]);
  const catMap = new Map(categories.map((c) => [c._id.toString(), c.name]));

  return rows.map((row) =>
    serializeTransaction(row, {
      categoryName: catMap.get(String(row.categoryId)),
      createdByName: nameMap.get(String(row.createdBy)),
      updatedByName: row.updatedBy
        ? nameMap.get(String(row.updatedBy))
        : undefined
    })
  );
};

// ─── Categories ──────────────────────────────────────────────────────────────

export const listFinanceCategories = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req)!;
  await ensureDefaultCategories(schoolId.toString());

  const includeInactive = req.query.includeInactive === "true";
  const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;

  const filter: Record<string, unknown> = withTenantScope(req);
  if (!includeInactive) filter.isActive = true;
  if (kind === "EXPENSE" || kind === "INCOME" || kind === "BOTH") {
    filter.kind = kind === "BOTH" ? "BOTH" : { $in: [kind, "BOTH"] };
  }

  const categories = await FinanceCategory.find(filter)
    .sort({ sortOrder: 1, name: 1 })
    .lean();

  return sendSuccess(
    res,
    "Finance categories fetched",
    categories.map((c) => serializeCategory(c as Record<string, unknown>))
  );
});

export const createFinanceCategory = asyncHandler(async (req: Request, res: Response) => {
  const payload = financeCategorySchema.parse(req.body);
  const schoolId = tenantObjectId(req)!;

  const existing = await FinanceCategory.findOne({
    schoolId,
    name: payload.name.trim()
  }).lean();
  if (existing) {
    throw new ApiError(409, "A category with this name already exists");
  }

  const category = await FinanceCategory.create({
    schoolId,
    name: payload.name.trim(),
    kind: payload.kind,
    description: emptyToUndef(payload.description),
    isActive: payload.isActive ?? true,
    isSystem: false,
    sortOrder: payload.sortOrder ?? 500
  });

  return sendSuccess(
    res,
    "Category created",
    serializeCategory(category.toObject() as Record<string, unknown>),
    201
  );
});

export const updateFinanceCategory = asyncHandler(async (req: Request, res: Response) => {
  const payload = financeCategorySchema.partial().parse(req.body);
  const category = await FinanceCategory.findOne(
    withTenantScope(req, { _id: req.params.id })
  );
  if (!category) throw new ApiError(404, "Category not found");

  if (payload.name !== undefined) {
    const duplicate = await FinanceCategory.findOne({
      schoolId: category.schoolId,
      name: payload.name.trim(),
      _id: { $ne: category._id }
    }).lean();
    if (duplicate) {
      throw new ApiError(409, "A category with this name already exists");
    }
    category.name = payload.name.trim();
  }
  if (payload.kind !== undefined) category.kind = payload.kind;
  if (payload.description !== undefined) {
    category.description = emptyToUndef(payload.description);
  }
  if (payload.isActive !== undefined) category.isActive = payload.isActive;
  if (payload.sortOrder !== undefined) category.sortOrder = payload.sortOrder;

  await category.save();
  return sendSuccess(
    res,
    "Category updated",
    serializeCategory(category.toObject() as Record<string, unknown>)
  );
});

export const deleteFinanceCategory = asyncHandler(async (req: Request, res: Response) => {
  const category = await FinanceCategory.findOne(
    withTenantScope(req, { _id: req.params.id })
  );
  if (!category) throw new ApiError(404, "Category not found");

  const usage = await FinanceTransaction.countDocuments(
    withTenantScope(req, { categoryId: category._id })
  );
  if (usage > 0) {
    throw new ApiError(
      400,
      `Cannot delete category in use by ${usage} transaction(s). Disable it instead.`
    );
  }

  await category.deleteOne();
  return sendSuccess(res, "Category deleted");
});

// ─── Transactions ────────────────────────────────────────────────────────────

const buildTransactionFilter = (req: Request): Record<string, unknown> => {
  const filter: Record<string, unknown> = withTenantScope(req);
  const {
    transactionType,
    categoryId,
    paymentMethod,
    expenseType,
    fromDateBs,
    toDateBs,
    search,
    minAmount,
    maxAmount,
    yearBs,
    monthBs
  } = req.query;

  if (typeof transactionType === "string" && transactionType) {
    filter.transactionType = transactionType;
  }
  if (typeof categoryId === "string" && categoryId) {
    filter.categoryId = categoryId;
  }
  if (typeof paymentMethod === "string" && paymentMethod) {
    filter.paymentMethod = paymentMethod;
  }
  if (typeof expenseType === "string" && expenseType) {
    filter.expenseType = expenseType;
  }

  const dateFilter: Record<string, string> = {};
  if (typeof fromDateBs === "string" && fromDateBs) dateFilter.$gte = fromDateBs;
  if (typeof toDateBs === "string" && toDateBs) dateFilter.$lte = toDateBs;
  if (typeof yearBs === "string" && yearBs && yearBs.length >= 4) {
    const y = yearBs.slice(0, 4);
    if (typeof monthBs === "string" && monthBs) {
      const m = monthBs.padStart(2, "0");
      dateFilter.$gte = `${y}-${m}-01`;
      dateFilter.$lte = `${y}-${m}-32`;
    } else {
      dateFilter.$gte = `${y}-01-01`;
      dateFilter.$lte = `${y}-12-32`;
    }
  }
  if (Object.keys(dateFilter).length) filter.dateBs = dateFilter;

  if (typeof minAmount === "string" && minAmount) {
    filter.amountNpr = {
      ...(filter.amountNpr as object | undefined),
      $gte: Number(minAmount)
    };
  }
  if (typeof maxAmount === "string" && maxAmount) {
    filter.amountNpr = {
      ...(filter.amountNpr as object | undefined),
      $lte: Number(maxAmount)
    };
  }

  if (typeof search === "string" && search.trim()) {
    const q = search.trim();
    filter.$or = [
      { title: { $regex: q, $options: "i" } },
      { description: { $regex: q, $options: "i" } },
      { vendorPayee: { $regex: q, $options: "i" } },
      { referenceNumber: { $regex: q, $options: "i" } },
      { remarks: { $regex: q, $options: "i" } },
      { incomeSource: { $regex: q, $options: "i" } }
    ];
  }

  return filter;
};

const buildScopedTransactionFilter = async (req: Request) => {
  const filter = buildTransactionFilter(req);
  await applyFinanceListScope(req, filter);
  return filter;
};

export const listFinanceTransactions = asyncHandler(async (req: Request, res: Response) => {
  const filter = await buildScopedTransactionFilter(req);
  const rows = await FinanceTransaction.find(filter).sort({ dateBs: -1, createdAt: -1 }).lean();
  return sendSuccess(res, "Finance transactions fetched", await enrichTransactions(rows as never));
});

export const getFinanceTransaction = asyncHandler(async (req: Request, res: Response) => {
  const row = await FinanceTransaction.findOne(
    withTenantScope(req, { _id: req.params.id })
  ).lean();
  if (!row) throw new ApiError(404, "Transaction not found");
  assertFinanceTransactionAccess(req, row as { ownerScope?: unknown; createdBy?: unknown });
  const [enriched] = await enrichTransactions([row as never]);
  return sendSuccess(res, "Finance transaction fetched", enriched);
});

export const createFinanceTransaction = asyncHandler(async (req: Request, res: Response) => {
  const payload = financeTransactionSchema.parse(req.body);
  const schoolId = tenantObjectId(req)!;

  // Staff must have explicit grant; college admin / institution admin always allowed here.
  if (
    !isFinanceInstitutionAdmin(req) &&
    !isFinanceCollegeAdministrator(req)
  ) {
    const granted = await loadPersonalFinanceAccess(req.user?.userId);
    if (!granted) {
      throw new ApiError(
        403,
        "Personal Finance Management is not enabled for your account"
      );
    }
  }

  const category = await FinanceCategory.findOne(
    withTenantScope(req, { _id: payload.categoryId, isActive: true })
  ).lean();
  if (!category) throw new ApiError(400, "Select a valid active category");

  // CREDIT may use any category (purchase or sale on credit); EXPENSE/INCOME must match kind.
  if (
    payload.transactionType !== "CREDIT" &&
    category.kind !== "BOTH" &&
    category.kind !== payload.transactionType
  ) {
    throw new ApiError(
      400,
      `Category "${category.name}" is not valid for ${payload.transactionType.toLowerCase()} transactions`
    );
  }

  const ownerScope = await resolveOwnerScopeForUser(req);

  const doc = await FinanceTransaction.create({
    schoolId,
    transactionType: payload.transactionType,
    dateBs: payload.dateBs,
    title: payload.title.trim(),
    categoryId: payload.categoryId,
    expenseType:
      payload.transactionType === "EXPENSE" ? payload.expenseType : undefined,
    incomeSource:
      payload.transactionType === "INCOME"
        ? emptyToUndef(payload.incomeSource)
        : undefined,
    description: emptyToUndef(payload.description),
    vendorPayee: emptyToUndef(payload.vendorPayee),
    amountNpr: payload.amountNpr,
    paymentMethod: payload.paymentMethod,
    referenceNumber: emptyToUndef(payload.referenceNumber),
    remarks: emptyToUndef(payload.remarks),
    attachments: payload.attachments ?? [],
    ownerScope,
    createdBy: req.user?.userId,
    updatedBy: req.user?.userId
  });

  const [enriched] = await enrichTransactions([doc.toObject() as never]);
  return sendSuccess(res, "Transaction recorded", enriched, 201);
});

export const updateFinanceTransaction = asyncHandler(async (req: Request, res: Response) => {
  const payload = financeTransactionSchema.partial().parse(req.body);
  const doc = await FinanceTransaction.findOne(
    withTenantScope(req, { _id: req.params.id })
  );
  if (!doc) throw new ApiError(404, "Transaction not found");
  assertFinanceTransactionWrite(req, doc);

  // Personal-book ownership is never re-tagged on update.

  if (payload.categoryId) {
    const category = await FinanceCategory.findOne(
      withTenantScope(req, { _id: payload.categoryId, isActive: true })
    ).lean();
    if (!category) throw new ApiError(400, "Select a valid active category");
    const nextType = payload.transactionType ?? doc.transactionType;
    if (
      nextType !== "CREDIT" &&
      category.kind !== "BOTH" &&
      category.kind !== nextType
    ) {
      throw new ApiError(
        400,
        `Category "${category.name}" is not valid for ${String(nextType).toLowerCase()} transactions`
      );
    }
    doc.categoryId = category._id as never;
  }

  if (payload.transactionType !== undefined) doc.transactionType = payload.transactionType;
  if (payload.dateBs !== undefined) doc.dateBs = payload.dateBs;
  if (payload.title !== undefined) doc.title = payload.title.trim();
  if (payload.expenseType !== undefined) doc.expenseType = payload.expenseType;
  if (payload.incomeSource !== undefined) {
    doc.incomeSource = emptyToUndef(payload.incomeSource);
  }
  if (payload.description !== undefined) {
    doc.description = emptyToUndef(payload.description);
  }
  if (payload.vendorPayee !== undefined) {
    doc.vendorPayee = emptyToUndef(payload.vendorPayee);
  }
  if (payload.amountNpr !== undefined) doc.amountNpr = payload.amountNpr;
  if (payload.paymentMethod !== undefined) doc.paymentMethod = payload.paymentMethod;
  if (payload.referenceNumber !== undefined) {
    doc.referenceNumber = emptyToUndef(payload.referenceNumber);
  }
  if (payload.remarks !== undefined) doc.remarks = emptyToUndef(payload.remarks);
  if (payload.attachments !== undefined) doc.attachments = payload.attachments as never;

  if (doc.transactionType === "INCOME" || doc.transactionType === "CREDIT") {
    doc.expenseType = undefined;
  }
  if (doc.transactionType === "EXPENSE" || doc.transactionType === "CREDIT") {
    doc.incomeSource = undefined;
  }

  doc.updatedBy = req.user?.userId as never;
  await doc.save();

  const [enriched] = await enrichTransactions([doc.toObject() as never]);
  return sendSuccess(res, "Transaction updated", enriched);
});

export const deleteFinanceTransaction = asyncHandler(async (req: Request, res: Response) => {
  const doc = await FinanceTransaction.findOne(
    withTenantScope(req, { _id: req.params.id })
  );
  if (!doc) throw new ApiError(404, "Transaction not found");
  assertFinanceTransactionWrite(req, doc);

  const urls = (doc.attachments ?? [])
    .map((a) => a.url)
    .filter((u): u is string => Boolean(u));

  await doc.deleteOne();

  if (urls.length) {
    await deleteStoredMediaUrls(urls);
  }

  return sendSuccess(res, "Transaction deleted");
});

// ─── Dashboard & reports ─────────────────────────────────────────────────────

export const getFinanceDashboard = asyncHandler(async (req: Request, res: Response) => {
  const filter = await buildScopedTransactionFilter(req);
  const rows = await FinanceTransaction.find(filter).sort({ dateBs: -1 }).lean();
  const enriched = await enrichTransactions(rows as never);

  let totalCollegeExpensesNpr = 0;
  let totalOtherExpensesNpr = 0;
  let totalExternalExpensesNpr = 0;
  let totalIncomeNpr = 0;
  let totalCreditNpr = 0;

  const expenseByMonth = new Map<string, number>();
  const incomeByMonth = new Map<string, number>();
  const creditByMonth = new Map<string, number>();
  const categoryMap = new Map<
    string,
    {
      categoryId: string;
      categoryName: string;
      transactionType: "EXPENSE" | "INCOME" | "CREDIT";
      amountNpr: number;
      count: number;
    }
  >();

  for (const tx of enriched) {
    const month = tx.dateBs.slice(0, 7);
    if (tx.transactionType === "EXPENSE") {
      if (tx.expenseType === "COLLEGE_EXPENSE") {
        totalCollegeExpensesNpr += tx.amountNpr;
      } else if (tx.expenseType === "EXTERNAL_EXPENSE") {
        totalExternalExpensesNpr += tx.amountNpr;
      } else {
        totalOtherExpensesNpr += tx.amountNpr;
      }
      expenseByMonth.set(month, (expenseByMonth.get(month) ?? 0) + tx.amountNpr);
    } else if (tx.transactionType === "INCOME") {
      totalIncomeNpr += tx.amountNpr;
      incomeByMonth.set(month, (incomeByMonth.get(month) ?? 0) + tx.amountNpr);
    } else if (tx.transactionType === "CREDIT") {
      totalCreditNpr += tx.amountNpr;
      creditByMonth.set(month, (creditByMonth.get(month) ?? 0) + tx.amountNpr);
    }

    const key = `${tx.transactionType}:${tx.categoryId}`;
    const existing = categoryMap.get(key);
    if (existing) {
      existing.amountNpr += tx.amountNpr;
      existing.count += 1;
    } else {
      categoryMap.set(key, {
        categoryId: tx.categoryId,
        categoryName: tx.categoryName ?? "—",
        transactionType: tx.transactionType,
        amountNpr: tx.amountNpr,
        count: 1
      });
    }
  }

  const totalExpensesNpr =
    totalCollegeExpensesNpr + totalOtherExpensesNpr + totalExternalExpensesNpr;

  const payload: FinanceDashboardResponse = {
    totalCollegeExpensesNpr,
    totalOtherExpensesNpr,
    totalExternalExpensesNpr,
    totalExpensesNpr,
    totalIncomeNpr,
    totalCreditNpr,
    // Cash position only — credit is tracked separately (not settled yet)
    netPositionNpr: totalIncomeNpr - totalExpensesNpr,
    monthlyExpenseSummary: [...expenseByMonth.entries()]
      .map(([month, amountNpr]) => ({ month, amountNpr }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    monthlyIncomeSummary: [...incomeByMonth.entries()]
      .map(([month, amountNpr]) => ({ month, amountNpr }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    monthlyCreditSummary: [...creditByMonth.entries()]
      .map(([month, amountNpr]) => ({ month, amountNpr }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    recentTransactions: enriched.slice(0, 12),
    categoryBreakdown: [...categoryMap.values()].sort(
      (a, b) => b.amountNpr - a.amountNpr
    ),
    filters: {
      yearBs: typeof req.query.yearBs === "string" ? req.query.yearBs : undefined,
      monthBs:
        typeof req.query.monthBs === "string" ? req.query.monthBs : undefined,
      categoryId:
        typeof req.query.categoryId === "string" ? req.query.categoryId : undefined
    }
  };

  return sendSuccess(res, "Finance dashboard fetched", payload);
});

export const getFinanceReport = asyncHandler(async (req: Request, res: Response) => {
  const reportType =
    typeof req.query.reportType === "string" && req.query.reportType
      ? req.query.reportType
      : "ALL";

  const filter = await buildScopedTransactionFilter(req);
  if (reportType === "COLLEGE_EXPENSES") {
    filter.transactionType = "EXPENSE";
    filter.expenseType = "COLLEGE_EXPENSE";
  } else if (reportType === "OTHER_EXPENSES") {
    filter.transactionType = "EXPENSE";
    filter.expenseType = { $in: ["OTHER_EXPENSE", "EXTERNAL_EXPENSE"] };
  } else if (reportType === "INCOME") {
    filter.transactionType = "INCOME";
  } else if (reportType === "EXPENSES") {
    filter.transactionType = "EXPENSE";
  } else if (reportType === "CREDIT") {
    filter.transactionType = "CREDIT";
  }

  const rows = await FinanceTransaction.find(filter).sort({ dateBs: -1 }).lean();
  const enriched = await enrichTransactions(rows as never);

  let expenseNpr = 0;
  let incomeNpr = 0;
  let creditNpr = 0;
  for (const tx of enriched) {
    if (tx.transactionType === "EXPENSE") expenseNpr += tx.amountNpr;
    else if (tx.transactionType === "INCOME") incomeNpr += tx.amountNpr;
    else if (tx.transactionType === "CREDIT") creditNpr += tx.amountNpr;
  }

  const titles: Record<string, string> = {
    ALL: "All finance transactions",
    COLLEGE_EXPENSES: "College expenses",
    OTHER_EXPENSES: "Other / external expenses",
    EXPENSES: "All expenses",
    INCOME: "Income records",
    CREDIT: "Credit transactions",
    CATEGORY: "Category-wise finance report",
    MONTHLY: "Monthly finance report",
    YEARLY: "Yearly finance report"
  };

  const payload: FinanceReportResponse = {
    reportType,
    title: titles[reportType] ?? "Finance report",
    generatedAt: new Date().toISOString(),
    filters: {
      reportType,
      fromDateBs:
        typeof req.query.fromDateBs === "string" ? req.query.fromDateBs : undefined,
      toDateBs:
        typeof req.query.toDateBs === "string" ? req.query.toDateBs : undefined,
      categoryId:
        typeof req.query.categoryId === "string" ? req.query.categoryId : undefined,
      yearBs: typeof req.query.yearBs === "string" ? req.query.yearBs : undefined,
      monthBs: typeof req.query.monthBs === "string" ? req.query.monthBs : undefined
    },
    totals: {
      expenseNpr,
      incomeNpr,
      creditNpr,
      netNpr: incomeNpr - expenseNpr,
      count: enriched.length
    },
    rows: enriched.map((tx) => ({
      dateBs: tx.dateBs,
      transactionType: tx.transactionType,
      categoryName: tx.categoryName ?? "—",
      title: tx.title,
      amountNpr: tx.amountNpr,
      paymentMethod: tx.paymentMethod,
      referenceNumber: tx.referenceNumber,
      vendorPayee: tx.vendorPayee,
      expenseType: tx.expenseType,
      incomeSource: tx.incomeSource,
      ownerScope: tx.ownerScope,
      attachmentCount: tx.attachments?.length ?? 0,
      createdByName: tx.createdByName,
      createdBy: tx.createdBy
    }))
  };

  return sendSuccess(res, "Finance report generated", payload);
});

// ─── Staff personal finance access (Admin / Superadmin) ──────────────────────

/**
 * List all college staff with login + personal finance access status.
 * Admin uses this panel to grant/revoke Finance Management for each staff.
 */
export const listFinanceStaffAccess = asyncHandler(
  async (req: Request, res: Response) => {
    if (!isFinanceInstitutionAdmin(req)) {
      throw new ApiError(403, "Only Administrator can manage staff finance access");
    }

    const schoolId = tenantObjectId(req)!;
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";

    const filter: Record<string, unknown> = {
      schoolId,
      isDeleted: false
    };
    if (search) {
      const term = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { fullName: { $regex: term, $options: "i" } },
        { staffId: { $regex: term, $options: "i" } },
        { email: { $regex: term, $options: "i" } },
        { phone: { $regex: term, $options: "i" } },
        { designation: { $regex: term, $options: "i" } },
        { department: { $regex: term, $options: "i" } }
      ];
    }

    const staffRows = await CollegeStaff.find(filter)
      .sort({ fullName: 1 })
      .lean();

    const userIds = staffRows
      .map((s) => s.user)
      .filter(Boolean)
      .map((id) => String(id));

    const users = userIds.length
      ? await User.find({ _id: { $in: userIds } })
          .select("fullName email role isActive personalFinanceAccess")
          .lean()
      : [];
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const payload: FinanceStaffAccessRecord[] = staffRows.map((staff) => {
      const userId = staff.user ? String(staff.user) : undefined;
      const user = userId ? userMap.get(userId) : undefined;
      const category = String(staff.category ?? "");
      const record: FinanceStaffAccessRecord = {
        staffId: String(staff._id),
        staffCode: String(staff.staffId ?? ""),
        fullName: String(staff.fullName ?? ""),
        email: staff.email || user?.email || undefined,
        phone: staff.phone ? String(staff.phone) : undefined,
        designation: String(staff.designation ?? ""),
        department: staff.department ? String(staff.department) : undefined,
        category,
        categoryLabel:
          COLLEGE_STAFF_CATEGORY_LABELS[
            category as keyof typeof COLLEGE_STAFF_CATEGORY_LABELS
          ] ?? category,
        status: staff.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
        userId,
        userRole: user?.role ? String(user.role) : undefined,
        userActive: user?.isActive,
        hasLogin: Boolean(userId && user),
        financeAccessEnabled: Boolean(user?.personalFinanceAccess),
        photoUrl: staff.photoUrl ? String(staff.photoUrl) : undefined
      };
      return record;
    });

    return sendSuccess(res, "Staff finance access list fetched", payload);
  }
);

/**
 * Grant or revoke personal Finance Management for a staff user account.
 * Body: { enabled: boolean }
 */
export const setFinanceStaffAccess = asyncHandler(
  async (req: Request, res: Response) => {
    if (!isFinanceInstitutionAdmin(req)) {
      throw new ApiError(403, "Only Administrator can manage staff finance access");
    }

    const userId = req.params.userId;
    if (!userId) throw new ApiError(400, "User id is required");

    const enabled = Boolean(
      (req.body as { enabled?: unknown })?.enabled === true ||
        (req.body as { enabled?: unknown })?.enabled === "true"
    );

    const schoolId = tenantObjectId(req)!;

    // Must be a linked college-staff login (not arbitrary admin accounts)
    const staff = await CollegeStaff.findOne({
      schoolId,
      user: userId,
      isDeleted: false
    }).lean();
    if (!staff) {
      throw new ApiError(
        404,
        "No college staff profile is linked to this user account"
      );
    }

    const user = await User.findOne({
      _id: userId,
      schoolId
    });
    if (!user) throw new ApiError(404, "User account not found");

    // Never toggle finance access on institution admin accounts via this path
    const role = normalizeUserRole(user.role as string);
    if (role === "SUPER_ADMIN" || role === "COLLEGE_ADMIN") {
      throw new ApiError(
        400,
        "Administrator accounts already have full Finance Management access"
      );
    }

    user.personalFinanceAccess = enabled;
    await user.save();

    return sendSuccess(res, enabled ? "Finance access granted" : "Finance access revoked", {
      userId: user._id.toString(),
      staffId: String(staff._id),
      fullName: staff.fullName,
      financeAccessEnabled: Boolean(user.personalFinanceAccess)
    });
  }
);
