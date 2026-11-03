import { useState } from "react";
import type { JournalVoucherDetails } from "@phit-erp/shared";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Input } from "components/ui/input";
import { Textarea } from "components/ui/textarea";
import { cn } from "lib/utils";

interface JournalVoucherDetailsFieldsProps {
  value: JournalVoucherDetails | undefined;
  onChange: (next: JournalVoucherDetails) => void;
  /** Label for the bill / receipt number line on the voucher */
  receiptLabel?: string;
  /** Opened by default (e.g. while editing) */
  defaultOpen?: boolean;
  className?: string;
}

/**
 * Details printed on the expense's Journal Voucher (AGF No. 10): narration,
 * bill / cheque numbers and the Prepared / Checked / Approved / Received By block.
 */
export const JournalVoucherDetailsFields = ({
  value,
  onChange,
  receiptLabel = "Bill / Receipt No.",
  defaultOpen = false,
  className,
}: JournalVoucherDetailsFieldsProps) => {
  const [open, setOpen] = useState(defaultOpen);
  const details = value ?? {};
  const set = (key: keyof JournalVoucherDetails, next: string) => onChange({ ...details, [key]: next });
  const filled = Object.values(details).filter((item) => typeof item === "string" && item.trim()).length;

  return (
    <div className={cn("col-span-full rounded-2xl border border-brand-100 bg-brand-50/40", className)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-brand-600 shadow-sm">
            <FileText className="h-4 w-4" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-slate-900">Journal Voucher details</span>
            <span className="block text-xs text-slate-500">
              Printed on the Journal Voucher (AGF No. 10){filled ? ` · ${filled} filled` : " · optional"}
            </span>
          </span>
        </span>
        {open ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
      </button>

      {open ? (
        <div className="grid gap-3 border-t border-brand-100 px-4 pb-4 pt-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <FormField label="Narration">
              <Textarea
                rows={2}
                value={details.narration ?? ""}
                onChange={(e) => set("narration", e.target.value)}
                placeholder="e.g. Being electricity bill for Kartik paid by cheque"
              />
            </FormField>
          </div>
          <FormField label={receiptLabel}>
            <Input value={details.receiptNo ?? ""} onChange={(e) => set("receiptNo", e.target.value)} />
          </FormField>
          <FormField label="Cheque No.">
            <Input value={details.chequeNo ?? ""} onChange={(e) => set("chequeNo", e.target.value)} />
          </FormField>
          <FormField label="Cheque Date (BS)">
            <NepaliDateField value={details.chequeDateBs ?? ""} onChange={(v) => set("chequeDateBs", v)} />
          </FormField>
          <div className="hidden sm:block" />
          <FormField label="Prepared By">
            <Input value={details.preparedByName ?? ""} onChange={(e) => set("preparedByName", e.target.value)} />
          </FormField>
          <FormField label="Designation (Prepared By)">
            <Input
              value={details.preparedByDesignation ?? ""}
              onChange={(e) => set("preparedByDesignation", e.target.value)}
              placeholder="e.g. Accountant"
            />
          </FormField>
          <FormField label="Checked By">
            <Input value={details.checkedByName ?? ""} onChange={(e) => set("checkedByName", e.target.value)} />
          </FormField>
          <FormField label="Approved By">
            <Input value={details.approvedByName ?? ""} onChange={(e) => set("approvedByName", e.target.value)} />
          </FormField>
          <FormField label="Received By (payee)">
            <Input
              value={details.receivedByName ?? ""}
              onChange={(e) => set("receivedByName", e.target.value)}
              placeholder="Vendor / person paid"
            />
          </FormField>
          <FormField label="Designation (Received By)">
            <Input
              value={details.receivedByDesignation ?? ""}
              onChange={(e) => set("receivedByDesignation", e.target.value)}
            />
          </FormField>
        </div>
      ) : null}
    </div>
  );
};
