import type { NextFunction, Request, Response } from "express";
import { USER_ROLE_LABELS, normalizeUserRole, type NotificationType } from "@phit-erp/shared";
import { User } from "../models/User.js";
import { sendNotification } from "../utils/notificationService.js";

/**
 * Accounts oversight: every successful change made in the accounts section
 * (fee collected, deposit recorded, expense voided, salary approved, …) is
 * announced to the Administrators and College Administrators of the school.
 *
 * Mounted as router middleware so new accounting endpoints are covered
 * automatically instead of each handler having to remember to notify.
 */

/** Administrator (+ System Administrator) and College Administrator. */
const OVERSIGHT_ROLES = ["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER"];

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Writes that are not accounting activity worth announcing. */
const IGNORED_PATHS = [/\/reset-password$/, /\/preview$/];

const METHOD_VERBS: Record<string, string> = {
  POST: "Recorded",
  PUT: "Updated",
  PATCH: "Updated",
  DELETE: "Deleted"
};

/** First path segment → human label for the title. */
const SECTION_LABELS: Record<string, string> = {
  collections: "Fee collection",
  "security-deposits": "Security deposit",
  structures: "Fee structure",
  scholarships: "Scholarship",
  approvals: "Financial approval",
  refunds: "Fee refund",
  expenses: "Expense",
  purchases: "Purchase",
  income: "Income",
  "salary-sheet": "Salary sheet",
  salaries: "Salary",
  "bank-accounts": "Bank account",
  "cash-book": "Cash book entry",
  "chart-of-accounts": "Chart of accounts",
  "journal-entries": "Journal entry",
  "goshwara-vouchers": "Goshwara voucher",
  vendors: "Vendor",
  "fiscal-years": "Fiscal year",
  assets: "Fixed asset",
  depreciation: "Depreciation",
  reconciliations: "Bank reconciliation",
  budgets: "Budget",
  accountants: "Accountant",
  settings: "Accounting settings"
};

/** Trailing action segment (e.g. /refunds/:id/approve) → verb. */
const ACTION_VERBS: Record<string, string> = {
  approve: "Approved",
  reject: "Rejected",
  reverse: "Reversed",
  revoke: "Revoked",
  submit: "Submitted",
  save: "Saved",
  close: "Closed",
  dispose: "Disposed",
  run: "Run",
  seed: "Seeded",
  version: "New version"
};

const formatNpr = (value: unknown): string | null => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return `NPR ${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
};

const describeData = (data: unknown): string[] => {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const record = data as Record<string, unknown>;
  const parts: string[] = [];

  const reference =
    record.receiptNumber ?? record.voucherNumber ?? record.referenceNumber ?? record.entryNumber;
  if (typeof reference === "string" && reference.trim()) parts.push(`Ref: ${reference.trim()}`);

  const amount = formatNpr(record.amountPaidNpr ?? record.amountNpr ?? record.totalAmountNpr);
  if (amount) parts.push(`Amount: ${amount}`);

  const deposit = formatNpr(record.securityDepositPaidNpr);
  if (deposit) parts.push(`Deposit: ${deposit}`);

  return parts;
};

const describeRoute = (req: Request): { section: string; verb: string } => {
  const segments = req.path.split("/").filter(Boolean);
  const head = segments[0] ?? "";
  const tail = segments[segments.length - 1] ?? "";
  const base = req.baseUrl.endsWith("/fees") ? "Fee " : "";
  const section = SECTION_LABELS[head] ?? `${base}${head.replace(/-/g, " ") || "Accounts"}`;
  const verb = (segments.length > 1 && ACTION_VERBS[tail]) || METHOD_VERBS[req.method] || "Updated";
  return { section: section.charAt(0).toUpperCase() + section.slice(1), verb };
};

const notificationTypeFor = (req: Request): NotificationType =>
  /^\/(salary-sheet|salaries)(\/|$)/.test(req.path) ? "PAYROLL" : "FEE";

const announce = async (
  req: Request,
  schoolId: string,
  body: { message?: unknown; data?: unknown } | undefined
): Promise<void> => {
  const actor = req.user;
  if (!actor) return;

  const [actorUser, recipients] = await Promise.all([
    User.findById(actor.userId).select("fullName").lean(),
    User.find({
      schoolId,
      role: { $in: OVERSIGHT_ROLES },
      isActive: { $ne: false },
      // Department Accounts are operator logins, not the oversight audience.
      departmentAccount: null,
      _id: { $ne: actor.userId }
    })
      .select("_id")
      .lean()
  ]);
  if (recipients.length === 0) return;

  const { section, verb } = describeRoute(req);
  const actorName = actorUser?.fullName?.trim() || actor.email || "A user";
  const actorRole = USER_ROLE_LABELS[normalizeUserRole(actor.role)] ?? actor.role;
  const summary =
    typeof body?.message === "string" && body.message.trim()
      ? body.message.trim().replace(/\.$/, "")
      : `${section} ${verb.toLowerCase()}`;
  const details = describeData(body?.data);
  const message = [`${summary} by ${actorName} (${actorRole}).`, details.join(" · ")]
    .filter(Boolean)
    .join(" ");

  const metadata: Record<string, string> = {
    path: "/accounting",
    accountingAction: `${req.method} ${req.baseUrl}${req.path}`,
    actorUserId: actor.userId
  };
  const data = body?.data as { _id?: unknown } | undefined;
  if (data && typeof data === "object" && data._id) metadata.recordId = String(data._id);

  await Promise.all(
    recipients.map((recipient) =>
      sendNotification({
        schoolId,
        recipientUserId: recipient._id.toString(),
        title: `Accounts: ${section} ${verb.toLowerCase()}`,
        message,
        type: notificationTypeFor(req),
        metadata,
        // Every accounting action is a distinct event; never collapse them.
        dedupeHours: 0
      })
    )
  );
};

export const notifyAccountingActivity = (req: Request, res: Response, next: NextFunction): void => {
  if (!MUTATING_METHODS.has(req.method) || IGNORED_PATHS.some((re) => re.test(req.path))) {
    return next();
  }

  let body: { message?: unknown; data?: unknown } | undefined;
  const originalJson = res.json.bind(res);
  res.json = ((payload: unknown) => {
    if (payload && typeof payload === "object") body = payload as typeof body;
    return originalJson(payload);
  }) as Response["json"];

  res.on("finish", () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    const schoolId = req.tenantSchoolId ?? req.user?.schoolId ?? null;
    if (!schoolId) return;
    announce(req, String(schoolId), body).catch((error) => {
      // Never let oversight notifications affect the accounting operation.
      console.error("Accounting activity notification failed:", error);
    });
  });

  next();
};
