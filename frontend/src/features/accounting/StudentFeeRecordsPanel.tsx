import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EnhancedFeeCollectionRecord } from "@phit-erp/shared";
import { PAYMENT_METHODS } from "@phit-erp/shared";
import { FileDown, Printer, Search } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { formatCurrencyNpr } from "lib/utils";
import { downloadRecordsExcel } from "./accountingUtils";

type StudentPopulated = {
  _id?: string;
  admissionNumber?: string;
  user?: { fullName?: string };
  batchId?: string | { name?: string };
  yearId?: string | { name?: string };
  classId?: string | { name?: string };
};

const resolveStudent = (row: EnhancedFeeCollectionRecord) => {
  const s = row.studentId as unknown as StudentPopulated | string;
  if (!s || typeof s === "string") {
    return { name: "—", admission: "—", batch: "—", year: "—" };
  }
  const batch =
    typeof s.batchId === "object" ? s.batchId?.name : undefined;
  const year = typeof s.yearId === "object" ? s.yearId?.name : undefined;
  const cls = typeof s.classId === "object" ? s.classId?.name : undefined;
  return {
    name: s.user?.fullName ?? "—",
    admission: s.admissionNumber ?? "—",
    batch: batch || cls || "—",
    year: year || "—",
  };
};

const feeCategory = (row: EnhancedFeeCollectionRecord) =>
  row.feeBreakdown?.map((b) => b.title).join(", ") || "Fee";

export const StudentFeeRecordsPanel = () => {
  const [search, setSearch] = useState("");
  const [method, setMethod] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const receiptsQuery = useQuery({
    queryKey: ["accounting-fee-records"],
    queryFn: () =>
      unwrap<EnhancedFeeCollectionRecord[]>(api.get("/accounting/receipts")),
  });

  const filtered = useMemo(() => {
    let rows = receiptsQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((row) => {
        const st = resolveStudent(row);
        return (
          st.name.toLowerCase().includes(q) ||
          st.admission.toLowerCase().includes(q) ||
          row.receiptNumber.toLowerCase().includes(q) ||
          (row.accountantName ?? "").toLowerCase().includes(q) ||
          feeCategory(row).toLowerCase().includes(q)
        );
      });
    }
    if (method) {
      rows = rows.filter((r) => r.paymentMethod === method);
    }
    if (fromDate) {
      rows = rows.filter((r) => r.paidDateBs >= fromDate);
    }
    if (toDate) {
      rows = rows.filter((r) => r.paidDateBs <= toDate);
    }
    return rows;
  }, [receiptsQuery.data, search, method, fromDate, toDate]);

  const downloadReceipt = (id: string) => {
    window.open(
      `${api.defaults.baseURL}/accounting/collections/${id}/receipt`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const exportExcel = () => {
    if (filtered.length === 0) {
      toast.error("No records to export");
      return;
    }
    const exportRows = filtered.map((row) => {
      const st = resolveStudent(row);
      return {
        receiptNumber: row.receiptNumber,
        studentName: st.name,
        admissionNumber: st.admission,
        batch: st.batch,
        year: st.year,
        semesterBs: row.semesterBs ?? "",
        feeCategory: feeCategory(row),
        currentChargesNpr: row.currentChargesNpr,
        discountNpr: row.discountNpr,
        lateFeeNpr: row.lateFeeNpr,
        scholarshipNpr: row.scholarshipNpr,
        amountPaidNpr: row.amountPaidNpr,
        remainingDueNpr: row.remainingDueNpr,
        paidDateBs: row.paidDateBs,
        paymentMethod: row.paymentMethod,
        collectedBy: row.accountantName,
        remarks: row.notes ?? "",
      };
    });
    downloadRecordsExcel("Student_Fee_Records", exportRows);
    toast.success("Excel exported");
  };

  if (receiptsQuery.isLoading) return <LoadingState />;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Student Fee Records</CardTitle>
          <p className="text-sm text-slate-500">
            Payment history synchronized from fee collections — record view only (no
            ledger / voucher).
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={exportExcel}>
          <FileDown className="mr-1 h-4 w-4" />
          Excel
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <FormField label="Search">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                className="pl-8"
                placeholder="Student, receipt, collector…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </FormField>
          <FormField label="Payment method">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="">All</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="From date (BS)">
            <Input
              placeholder="YYYY-MM-DD"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </FormField>
          <FormField label="To date (BS)">
            <Input
              placeholder="YYYY-MM-DD"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </FormField>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title="No fee records"
            description="Fee payments recorded in the system will appear here automatically."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHead>
                <tr>
                  <Th>Receipt</Th>
                  <Th>Student</Th>
                  <Th>Batch / Year</Th>
                  <Th>Fee category</Th>
                  <Th>Paid</Th>
                  <Th>Discount</Th>
                  <Th>Fine</Th>
                  <Th>Scholarship</Th>
                  <Th>Remaining</Th>
                  <Th>Date</Th>
                  <Th>Mode</Th>
                  <Th>Collected by</Th>
                  <Th />
                </tr>
              </TableHead>
              <TableBody>
                {filtered.map((row) => {
                  const st = resolveStudent(row);
                  return (
                    <tr key={row._id}>
                      <Td className="font-mono text-sm">{row.receiptNumber}</Td>
                      <Td>
                        <div className="font-medium">{st.name}</div>
                        <div className="text-xs text-slate-500">{st.admission}</div>
                      </Td>
                      <Td className="text-sm">
                        {st.batch}
                        {st.year !== "—" ? ` / ${st.year}` : ""}
                      </Td>
                      <Td className="max-w-[140px] truncate text-sm" title={feeCategory(row)}>
                        {feeCategory(row)}
                      </Td>
                      <Td>{formatCurrencyNpr(row.amountPaidNpr)}</Td>
                      <Td>{formatCurrencyNpr(row.discountNpr ?? 0)}</Td>
                      <Td>{formatCurrencyNpr(row.lateFeeNpr ?? 0)}</Td>
                      <Td>{formatCurrencyNpr(row.scholarshipNpr ?? 0)}</Td>
                      <Td>{formatCurrencyNpr(row.remainingDueNpr ?? 0)}</Td>
                      <Td>{row.paidDateBs}</Td>
                      <Td className="text-sm">{row.paymentMethod.replace(/_/g, " ")}</Td>
                      <Td className="text-sm">{row.accountantName || "—"}</Td>
                      <Td>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => downloadReceipt(row._id)}
                        >
                          <Printer className="mr-1 h-3.5 w-3.5" />
                          {(row.printCount ?? 0) > 0 ? "Reprint" : "Receipt"}
                        </Button>
                      </Td>
                    </tr>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
