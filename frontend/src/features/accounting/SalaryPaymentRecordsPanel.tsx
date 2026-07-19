import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SalaryPaymentRecord } from "@phit-erp/shared";
import { PAYMENT_METHODS } from "@phit-erp/shared";
import { FileDown, Search } from "lucide-react";
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

const employeeName = (row: SalaryPaymentRecord): string => {
  if (row.staffName) return row.staffName;
  if (row.collegeStaff?.fullName) return row.collegeStaff.fullName;
  const teacher = row.teacher as { user?: { fullName?: string } } | undefined;
  if (teacher?.user?.fullName) return teacher.user.fullName;
  return "—";
};

const deductions = (row: SalaryPaymentRecord) =>
  (row.advanceSalaryNpr ?? 0) +
  (row.loanDeductionNpr ?? 0) +
  (row.taxNpr ?? 0) +
  (row.otherDeductionsNpr ?? 0);

export const SalaryPaymentRecordsPanel = () => {
  const [search, setSearch] = useState("");
  const [method, setMethod] = useState("");
  const [status, setStatus] = useState("");
  const [monthBs, setMonthBs] = useState("");

  const salariesQuery = useQuery({
    queryKey: ["accounting-salary-records"],
    queryFn: () =>
      unwrap<SalaryPaymentRecord[]>(api.get("/accounting/salaries")),
  });

  const filtered = useMemo(() => {
    let rows = salariesQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((row) => employeeName(row).toLowerCase().includes(q));
    }
    if (method) rows = rows.filter((r) => r.paymentMethod === method);
    if (status) rows = rows.filter((r) => r.status === status);
    if (monthBs) rows = rows.filter((r) => r.monthBs === monthBs || r.monthBs.startsWith(monthBs));
    return rows;
  }, [salariesQuery.data, search, method, status, monthBs]);

  const exportExcel = () => {
    if (filtered.length === 0) {
      toast.error("No records to export");
      return;
    }
    const exportRows = filtered.map((row) => ({
      employee: employeeName(row),
      employeeType: row.employeeType,
      department: "—",
      designation: "—",
      salaryMonth: row.monthBs,
      basicSalaryNpr: row.basicSalaryNpr,
      allowancesNpr: (row.allowancesNpr ?? 0) + (row.bonusNpr ?? 0),
      deductionsNpr: deductions(row),
      netSalaryNpr: row.netSalaryNpr,
      paymentDate: row.paidDateBs ?? "",
      paymentMethod: row.paymentMethod,
      status: row.status,
      remarks: "",
    }));
    downloadRecordsExcel("Salary_Payment_Records", exportRows);
    toast.success("Excel exported");
  };

  if (salariesQuery.isLoading) return <LoadingState />;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Salary Payment Records</CardTitle>
          <p className="text-sm text-slate-500">
            Salary payment history synchronized from HR/payroll — record view only.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={exportExcel}>
          <FileDown className="mr-1 h-4 w-4" />
          Excel
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <FormField label="Search employee">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                className="pl-8"
                placeholder="Name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </FormField>
          <FormField label="Month (BS)">
            <Input
              placeholder="YYYY-MM"
              value={monthBs}
              onChange={(e) => setMonthBs(e.target.value)}
            />
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
          <FormField label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="DRAFT">Draft</option>
              <option value="PROCESSED">Processed</option>
              <option value="PAID">Paid</option>
            </Select>
          </FormField>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title="No salary records"
            description="Salary payments recorded in HR/payroll will appear here automatically."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Type</Th>
                  <Th>Month</Th>
                  <Th>Basic</Th>
                  <Th>Allowances</Th>
                  <Th>Deductions</Th>
                  <Th>Net</Th>
                  <Th>Paid date</Th>
                  <Th>Method</Th>
                  <Th>Status</Th>
                </tr>
              </TableHead>
              <TableBody>
                {filtered.map((row) => (
                  <tr key={row._id}>
                    <Td className="font-medium">{employeeName(row)}</Td>
                    <Td>{row.employeeType}</Td>
                    <Td>{row.monthBs}</Td>
                    <Td>{formatCurrencyNpr(row.basicSalaryNpr)}</Td>
                    <Td>
                      {formatCurrencyNpr(
                        (row.allowancesNpr ?? 0) + (row.bonusNpr ?? 0),
                      )}
                    </Td>
                    <Td>{formatCurrencyNpr(deductions(row))}</Td>
                    <Td className="font-medium">
                      {formatCurrencyNpr(row.netSalaryNpr)}
                    </Td>
                    <Td>{row.paidDateBs || "—"}</Td>
                    <Td className="text-sm">
                      {row.paymentMethod.replace(/_/g, " ")}
                    </Td>
                    <Td>{row.status}</Td>
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
