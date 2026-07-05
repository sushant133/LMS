import { normalizeUserRole } from "./constants.js";
import type { UserRole } from "./types.js";

/** Granular accounting permissions for PHIT ERP role hierarchy */
export const ACCOUNTING_PERMISSIONS = [
  "read",
  "collect_fees",
  "print_receipt",
  "reverse_transaction",
  "manage_expenses",
  "manage_purchases",
  "manage_income",
  "manage_salaries",
  "manage_journal",
  "manage_coa",
  "manage_settings",
  "manage_staff",
  "approve_transactions",
  "view_audit"
] as const;

export type AccountingPermission = (typeof ACCOUNTING_PERMISSIONS)[number];

const ALL_PERMISSIONS: AccountingPermission[] = [...ACCOUNTING_PERMISSIONS];

/**
 * PHIT finance role matrix:
 * - SUPER_ADMIN: full access
 * - COLLEGE_ADMIN (Finance Administrator): full access
 * - ACCOUNTANT: operational write (no settings/staff/COA admin)
 * - CASHIER: fee collection + receipts only
 * - PRINCIPAL: read + approvals + audit
 * - AUDITOR: read-only + audit
 */
export const ACCOUNTING_ROLE_PERMISSIONS: Partial<Record<UserRole, AccountingPermission[]>> = {
  SUPER_ADMIN: ALL_PERMISSIONS,
  COLLEGE_ADMIN: ALL_PERMISSIONS,
  ACCOUNTANT: [
    "read",
    "collect_fees",
    "print_receipt",
    "reverse_transaction",
    "manage_expenses",
    "manage_purchases",
    "manage_income",
    "manage_salaries",
    "manage_journal",
    "view_audit"
  ],
  CASHIER: ["read", "collect_fees", "print_receipt"],
  PRINCIPAL: ["read", "view_audit", "approve_transactions"],
  AUDITOR: ["read", "view_audit"]
};

export const hasAccountingPermission = (role: string, permission: AccountingPermission): boolean => {
  const normalized = normalizeUserRole(role);
  if (normalized === "SUPER_ADMIN") return true;
  const permissions = ACCOUNTING_ROLE_PERMISSIONS[normalized];
  return permissions?.includes(permission) ?? false;
};

export const canWriteAccounting = (role: string): boolean =>
  hasAccountingPermission(role, "collect_fees") ||
  hasAccountingPermission(role, "manage_expenses") ||
  hasAccountingPermission(role, "manage_journal");

export const isAccountingReadOnly = (role: string): boolean => {
  const normalized = normalizeUserRole(role);
  return normalized === "AUDITOR" || (normalized === "PRINCIPAL" && !hasAccountingPermission(role, "approve_transactions"));
};