import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BankAccountRecord } from "@phit-erp/shared";
import { FormField } from "components/shared/FormField";
import { Select } from "components/ui/select";
import { api, unwrap } from "lib/api";
import { bankLabel, isBankPaymentMethod } from "./bankCashShared";

/** Active bank accounts (shared cache with the Bank / Cash tab). */
export const useActiveBankAccounts = () => {
  const query = useQuery({
    queryKey: ["accounting-bank-cash", "accounts"],
    queryFn: () => unwrap<BankAccountRecord[]>(api.get("/accounting/bank-accounts")),
  });
  return useMemo(() => (query.data ?? []).filter((bank) => bank.isActive), [query.data]);
};

/**
 * Bank account to use when a payment method changes: keeps the current choice,
 * or picks the only bank when there is just one.
 */
export const bankAccountForMethod = (
  method: string,
  current: string | undefined,
  banks: BankAccountRecord[],
): string => (isBankPaymentMethod(method) && !current && banks.length === 1 ? banks[0]!._id : current ?? "");

/** Error message when a bank payment has no bank account chosen, else null. */
export const missingBankAccountError = (
  method: string,
  bankAccountId: string | undefined,
  banks: BankAccountRecord[],
): string | null =>
  isBankPaymentMethod(method) && banks.length > 0 && !bankAccountId
    ? "Choose the bank account for this payment"
    : null;

interface BankAccountFieldProps {
  paymentMethod: string;
  value: string | undefined;
  onChange: (bankAccountId: string) => void;
  banks: BankAccountRecord[];
  /** Fixed once posted (shown, not editable). */
  locked?: boolean;
  label?: string;
}

/**
 * "Bank account" dropdown, shown only for bank-type payment methods, so the
 * entry is posted to that bank's balance, Bank Book and Day Book.
 */
export const BankAccountField = ({
  paymentMethod,
  value,
  onChange,
  banks,
  locked,
  label = "Bank account",
}: BankAccountFieldProps) => {
  if (!isBankPaymentMethod(paymentMethod)) return null;
  return (
    <FormField label={label}>
      {banks.length > 0 || value ? (
        <Select
          value={value ?? ""}
          disabled={locked}
          title={locked ? "The bank account is fixed once the entry is posted" : undefined}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{locked ? "Not recorded" : "Select bank account"}</option>
          {banks.map((bank) => (
            <option key={bank._id} value={bank._id}>
              {bankLabel(bank)}
            </option>
          ))}
        </Select>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500">
          No bank accounts yet — add them in Bank / Cash → Bank Accounts.
        </p>
      )}
    </FormField>
  );
};
