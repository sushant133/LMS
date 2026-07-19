import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FeeRefundRecord } from "@phit-erp/shared";
import { FileDown, Search } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { formatCurrencyNpr } from "lib/utils";
import { downloadRecordsExcel } from "./accountingUtils";

type StudentPop = {
  user?: { fullName?: string };
  admissionNumber?: string;
};

const studentLabel = (row: FeeRefundRecord): string => {
  const s = row.studentId as unknown as StudentPop | string;
  if (!s || typeof s === "string") return "—";
  return s.user?.fullName ?? "—";
};

export const RefundRecordsPanel = () => {
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const refundsQuery = useQuery({
    queryKey: ["accounting-refund-records"],
    queryFn: () => unwrap<FeeRefundRecord[]>(api.get("/accounting/refunds")),
  });

  const filtered = useMemo(() => {
    let rows = refundsQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((row) => {
        const name = studentLabel(row).toLowerCase();
        return (
          name.includes(q) ||
          (row.refundNumber ?? "").toLowerCase().includes(q) ||
          (row.reason ?? "").toLowerCase().includes(q)
        );
      });
    }
    if (fromDate) rows = rows.filter((r) => r.dateBs >= fromDate);
    if (toDate) rows = rows.filter((r) => r.dateBs <= toDate);
    return rows;
  }, [refundsQuery.data, search, fromDate, toDate]);

  const exportExcel = () => {
    if (filtered.length === 0) {
      toast.error("No records to export");
      return;
    }
    const exportRows = filtered.map((row) => ({
      refundNumber: row.refundNumber,
      student: studentLabel(row),
      receiptReference: row.feeCollectionId ?? "",
      refundAmountNpr: row.amountNpr,
      reason: row.reason,
      refundDate: row.dateBs,
      paymentMethod: row.paymentMethod,
      remarks: row.notes ?? "",
    }));
    downloadRecordsExcel("Refund_Records", exportRows);
    toast.success("Excel exported");
  };

  if (refundsQuery.isLoading) return <LoadingState />;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Refund Records</CardTitle>
          <p className="text-sm text-slate-500">
            Refund history only — balances and student fee history update automatically.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={exportExcel}>
          <FileDown className="mr-1 h-4 w-4" />
          Excel
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <FormField label="Search">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                className="pl-8"
                placeholder="Student, refund no., reason…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
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
            title="No refund records"
            description="Processed refunds will appear here as history."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHead>
                <tr>
                  <Th>Refund no.</Th>
                  <Th>Student</Th>
                  <Th>Amount</Th>
                  <Th>Reason</Th>
                  <Th>Date</Th>
                  <Th>Method</Th>
                  <Th>Remarks</Th>
                </tr>
              </TableHead>
              <TableBody>
                {filtered.map((row) => (
                  <tr key={row._id}>
                    <Td className="font-mono text-sm">{row.refundNumber}</Td>
                    <Td className="font-medium">{studentLabel(row)}</Td>
                    <Td>{formatCurrencyNpr(row.amountNpr)}</Td>
                    <Td className="max-w-xs truncate" title={row.reason}>
                      {row.reason}
                    </Td>
                    <Td>{row.dateBs}</Td>
                    <Td className="text-sm">
                      {row.paymentMethod.replace(/_/g, " ")}
                    </Td>
                    <Td className="max-w-[160px] truncate text-sm">
                      {row.notes || "—"}
                    </Td>
                  </tr>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
