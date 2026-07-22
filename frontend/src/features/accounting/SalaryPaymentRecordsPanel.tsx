import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SalaryPaymentInput, SalaryPaymentRecord } from "@phit-erp/shared";
import { PAYMENT_METHODS } from "@phit-erp/shared";
import {
  Banknote,
  FileDown,
  Paperclip,
  Plus,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { Textarea } from "components/ui/textarea";
import { api, resolveApiUrl, unwrap } from "lib/api";
import { formatCurrencyNpr, parseErrorMessage } from "lib/utils";
import { downloadRecordsExcel } from "./accountingUtils";

type PanelTab = "register" | "pay";

type SalaryEmployeeTeacher = {
  _id: string;
  teacherCode?: string;
  basicSalaryNpr?: number;
  designation?: string;
  user?: { fullName?: string; designation?: string };
};

type SalaryEmployeeStaff = {
  _id: string;
  staffId?: string;
  fullName: string;
  department?: string;
  designation?: string;
  basicSalaryNpr?: number;
};

type SalaryEmployeesResponse = {
  teachers: SalaryEmployeeTeacher[];
  collegeStaff: SalaryEmployeeStaff[];
};

type Attachment = {
  name?: string;
  url: string;
  mimeType?: string;
  size?: number;
};

const statusBadge = (status: string) => {
  switch (status) {
    case "PAID":
      return "bg-emerald-100 text-emerald-800";
    case "PROCESSED":
      return "bg-sky-100 text-sky-800";
    case "DRAFT":
      return "bg-amber-100 text-amber-900";
    default:
      return "bg-slate-100 text-slate-700";
  }
};

const employeeName = (row: SalaryPaymentRecord): string => {
  if (row.employeeName) return row.employeeName;
  if (row.staffName) return row.staffName;
  if (row.collegeStaff?.fullName) return row.collegeStaff.fullName;
  const teacher = row.teacher as { user?: { fullName?: string } } | undefined;
  if (teacher?.user?.fullName) return teacher.user.fullName;
  return "—";
};

const totalDeductions = (row: {
  advanceSalaryNpr?: number;
  loanDeductionNpr?: number;
  taxNpr?: number;
  otherDeductionsNpr?: number;
}) =>
  (row.advanceSalaryNpr ?? 0) +
  (row.loanDeductionNpr ?? 0) +
  (row.taxNpr ?? 0) +
  (row.otherDeductionsNpr ?? 0);

const totalEarnings = (row: {
  basicSalaryNpr?: number;
  allowancesNpr?: number;
  bonusNpr?: number;
}) =>
  (row.basicSalaryNpr ?? 0) + (row.allowancesNpr ?? 0) + (row.bonusNpr ?? 0);

const calcNet = (f: {
  basicSalaryNpr: number;
  allowancesNpr: number;
  bonusNpr: number;
  advanceSalaryNpr: number;
  loanDeductionNpr: number;
  taxNpr: number;
  otherDeductionsNpr: number;
}) =>
  Math.max(
    0,
    f.basicSalaryNpr +
      f.allowancesNpr +
      f.bonusNpr -
      f.advanceSalaryNpr -
      f.loanDeductionNpr -
      f.taxNpr -
      f.otherDeductionsNpr,
  );

const emptyForm = (): SalaryPaymentInput & {
  basicSalaryNpr: number;
  allowancesNpr: number;
  bonusNpr: number;
  advanceSalaryNpr: number;
  loanDeductionNpr: number;
  taxNpr: number;
  otherDeductionsNpr: number;
} => ({
  employeeType: "TEACHER",
  teacherId: "",
  staffId: "",
  staffName: "",
  monthBs: "",
  basicSalaryNpr: 0,
  allowancesNpr: 0,
  bonusNpr: 0,
  advanceSalaryNpr: 0,
  loanDeductionNpr: 0,
  taxNpr: 0,
  otherDeductionsNpr: 0,
  status: "DRAFT",
  paidDateBs: "",
  paymentMethod: "BANK_TRANSFER",
  transactionNumber: "",
  notes: "",
  attachments: [],
});

const num = (v: string | number | undefined): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const SalaryPaymentRecordsPanel = () => {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<PanelTab>("register");
  const [search, setSearch] = useState("");
  const [employeeTypeFilter, setEmployeeTypeFilter] = useState("");
  const [method, setMethod] = useState("");
  const [status, setStatus] = useState("");
  const [monthBs, setMonthBs] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [deptFilter, setDeptFilter] = useState("");

  const salariesQuery = useQuery({
    queryKey: ["accounting-salary-records"],
    queryFn: () =>
      unwrap<SalaryPaymentRecord[]>(api.get("/accounting/salaries")),
  });

  const employeesQuery = useQuery({
    queryKey: ["accounting-salary-employees"],
    queryFn: () =>
      unwrap<SalaryEmployeesResponse>(api.get("/accounting/salary-employees")),
  });

  const invalidate = async () => {
    const { invalidateAccountingQueries } = await import(
      "./invalidateAccountingQueries"
    );
    await invalidateAccountingQueries();
  };

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editingId
        ? unwrap(api.put(`/accounting/salaries/${editingId}`, payload))
        : unwrap(api.post("/accounting/salaries", payload)),
    onSuccess: async () => {
      toast.success(
        editingId ? "Salary record updated" : "Salary payment recorded",
      );
      setForm(emptyForm());
      setEditingId(null);
      setAttachments([]);
      await invalidate();
      setTab("register");
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const rows = salariesQuery.data ?? [];
  const teachers = employeesQuery.data?.teachers ?? [];
  const staff = employeesQuery.data?.collegeStaff ?? [];

  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const s of staff) {
      if (s.department?.trim()) set.add(s.department.trim());
    }
    return [...set].sort();
  }, [staff]);

  const filtered = useMemo(() => {
    let list = rows;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((row) => {
        const name = employeeName(row).toLowerCase();
        const dept = (row.department ?? "").toLowerCase();
        const desig = (row.designation ?? "").toLowerCase();
        return name.includes(q) || dept.includes(q) || desig.includes(q);
      });
    }
    if (employeeTypeFilter) {
      list = list.filter((r) => r.employeeType === employeeTypeFilter);
    }
    if (method) list = list.filter((r) => r.paymentMethod === method);
    if (status) list = list.filter((r) => r.status === status);
    if (monthBs) {
      list = list.filter(
        (r) => r.monthBs === monthBs || r.monthBs.startsWith(monthBs),
      );
    }
    if (deptFilter) {
      list = list.filter(
        (r) => (r.department || "").toLowerCase() === deptFilter.toLowerCase(),
      );
    }
    return list;
  }, [rows, search, employeeTypeFilter, method, status, monthBs, deptFilter]);

  const summary = useMemo(() => {
    const paid = filtered.filter((r) => r.status === "PAID");
    const draft = filtered.filter((r) => r.status === "DRAFT");
    const totalPaid = paid.reduce((s, r) => s + (r.netSalaryNpr ?? 0), 0);
    const totalNet = filtered.reduce((s, r) => s + (r.netSalaryNpr ?? 0), 0);
    return {
      count: filtered.length,
      paidCount: paid.length,
      draftCount: draft.length,
      totalPaid,
      totalNet,
    };
  }, [filtered]);

  const liveNet = calcNet({
    basicSalaryNpr: num(form.basicSalaryNpr),
    allowancesNpr: num(form.allowancesNpr),
    bonusNpr: num(form.bonusNpr),
    advanceSalaryNpr: num(form.advanceSalaryNpr),
    loanDeductionNpr: num(form.loanDeductionNpr),
    taxNpr: num(form.taxNpr),
    otherDeductionsNpr: num(form.otherDeductionsNpr),
  });

  const staffForPicker = useMemo(() => {
    if (!deptFilter && form.employeeType === "STAFF" && deptFilter) return staff;
    if (form.employeeType !== "STAFF") return staff;
    // optional: no dept filter on form, show all staff
    return staff;
  }, [staff, form.employeeType, deptFilter]);

  const clearFilters = () => {
    setSearch("");
    setEmployeeTypeFilter("");
    setMethod("");
    setStatus("");
    setMonthBs("");
    setDeptFilter("");
  };

  const uploadAttachments = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("files", f));
      const res = await unwrap<{
        files: Array<{
          url: string;
          originalName?: string;
          mimeType?: string;
          size?: number;
        }>;
      }>(
        api.post("/uploads/accounting", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        }),
      );
      const next = (res.files ?? []).map((f) => ({
        url: f.url,
        name: f.originalName ?? "Attachment",
        mimeType: f.mimeType,
        size: f.size,
      }));
      setAttachments((prev) => [...prev, ...next]);
      toast.success(`${next.length} file(s) attached`);
    } catch (e) {
      toast.error(parseErrorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const startEdit = (row: SalaryPaymentRecord) => {
    setEditingId(row._id);
    setForm({
      employeeType: row.employeeType,
      teacherId: row.teacherId ?? "",
      staffId: row.staffId ?? "",
      staffName: row.staffName ?? "",
      monthBs: row.monthBs,
      basicSalaryNpr: row.basicSalaryNpr,
      allowancesNpr: row.allowancesNpr ?? 0,
      bonusNpr: row.bonusNpr ?? 0,
      advanceSalaryNpr: row.advanceSalaryNpr ?? 0,
      loanDeductionNpr: row.loanDeductionNpr ?? 0,
      taxNpr: row.taxNpr ?? 0,
      otherDeductionsNpr: row.otherDeductionsNpr ?? 0,
      status: row.status,
      paidDateBs: row.paidDateBs ?? "",
      paymentMethod: row.paymentMethod,
      transactionNumber: row.transactionNumber ?? "",
      notes: row.notes ?? "",
      attachments: row.attachments ?? [],
    });
    setAttachments(row.attachments ?? []);
    setTab("pay");
  };

  const submit = () => {
    if (!form.monthBs || !/^\d{4}-\d{2}$/.test(form.monthBs)) {
      toast.error("Salary month must be YYYY-MM (BS), e.g. 2082-01");
      return;
    }
    if (form.employeeType === "TEACHER" && !form.teacherId) {
      toast.error("Select a teacher");
      return;
    }
    if (form.employeeType === "STAFF" && !form.staffId) {
      toast.error("Select a staff member");
      return;
    }
    if (form.status === "PAID" && !form.paidDateBs) {
      toast.error("Paid date (BS) is required when status is Paid");
      return;
    }

    const payload = {
      employeeType: form.employeeType,
      teacherId: form.employeeType === "TEACHER" ? form.teacherId || undefined : undefined,
      staffId: form.employeeType === "STAFF" ? form.staffId || undefined : undefined,
      staffName:
        form.employeeType === "STAFF"
          ? staff.find((s) => s._id === form.staffId)?.fullName || form.staffName
          : undefined,
      monthBs: form.monthBs,
      basicSalaryNpr: num(form.basicSalaryNpr),
      allowancesNpr: num(form.allowancesNpr),
      bonusNpr: num(form.bonusNpr),
      advanceSalaryNpr: num(form.advanceSalaryNpr),
      loanDeductionNpr: num(form.loanDeductionNpr),
      taxNpr: num(form.taxNpr),
      otherDeductionsNpr: num(form.otherDeductionsNpr),
      status: form.status,
      paidDateBs: form.paidDateBs || undefined,
      paymentMethod: form.paymentMethod,
      transactionNumber: form.transactionNumber || undefined,
      notes: form.notes || undefined,
      attachments,
    };
    saveMutation.mutate(payload);
  };

  const exportExcel = () => {
    if (filtered.length === 0) {
      toast.error("No records to export");
      return;
    }
    downloadRecordsExcel(
      "Salary_Payment_Records",
      filtered.map((row) => ({
        employee: employeeName(row),
        employeeType: row.employeeType,
        department: row.department ?? "",
        designation: row.designation ?? "",
        salaryMonth: row.monthBs,
        basicSalaryNpr: row.basicSalaryNpr,
        allowancesNpr: (row.allowancesNpr ?? 0) + (row.bonusNpr ?? 0),
        deductionsNpr: totalDeductions(row),
        netSalaryNpr: row.netSalaryNpr,
        paymentDate: row.paidDateBs ?? "",
        paymentMethod: row.paymentMethod,
        transactionNumber: row.transactionNumber ?? "",
        status: row.status,
        remarks: row.notes ?? "",
      })),
    );
    toast.success("Excel exported");
  };

  if (salariesQuery.isLoading) return <LoadingState />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Banknote className="h-5 w-5 text-brand-600" />
              Salary Payment Records
            </CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              Payroll register for teachers and college staff — draft, process, and
              mark paid with bank reference and payslip attachments.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={tab === "register" ? "default" : "outline"}
              onClick={() => setTab("register")}
            >
              <Wallet className="mr-1.5 h-4 w-4" />
              Register
            </Button>
            <Button
              size="sm"
              variant={tab === "pay" ? "default" : "outline"}
              onClick={() => {
                setEditingId(null);
                setForm(emptyForm());
                setAttachments([]);
                setTab("pay");
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              {editingId ? "Edit payslip" : "Record salary"}
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Summary */}
      {tab === "register" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Records shown", value: String(summary.count) },
            {
              label: "Paid (net)",
              value: formatCurrencyNpr(summary.totalPaid),
              className: "text-emerald-700",
            },
            {
              label: "Drafts",
              value: String(summary.draftCount),
              className: "text-amber-800",
            },
            {
              label: "Total net (filtered)",
              value: formatCurrencyNpr(summary.totalNet),
            },
          ].map((c) => (
            <Card key={c.label}>
              <CardContent className="pt-4">
                <p className="text-xs text-slate-500">{c.label}</p>
                <p className={`text-xl font-semibold ${c.className ?? ""}`}>
                  {c.value}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {tab === "register" ? (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">Salary register</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={exportExcel}>
              <FileDown className="mr-1 h-4 w-4" />
              Excel
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <FormField label="Search">
                  <div className="relative">
                    <Input
                      className="h-10 pr-9"
                      placeholder="Name, department…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    {search ? (
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-200"
                        onClick={() => setSearch("")}
                        aria-label="Clear search"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                </FormField>
                <FormField label="Employee type">
                  <Select
                    value={employeeTypeFilter}
                    onChange={(e) => setEmployeeTypeFilter(e.target.value)}
                  >
                    <option value="">All</option>
                    <option value="TEACHER">Teacher</option>
                    <option value="STAFF">Staff</option>
                  </Select>
                </FormField>
                <FormField label="Department">
                  <Select
                    value={deptFilter}
                    onChange={(e) => setDeptFilter(e.target.value)}
                  >
                    <option value="">All departments</option>
                    {departments.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </Select>
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
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-500">
                  Showing {filtered.length} of {rows.length} record
                  {rows.length === 1 ? "" : "s"}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={
                    !search &&
                    !employeeTypeFilter &&
                    !method &&
                    !status &&
                    !monthBs &&
                    !deptFilter
                  }
                  onClick={clearFilters}
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  Clear filters
                </Button>
              </div>
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                title="No salary records"
                description="Use Record salary to create a payslip for a teacher or staff member."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <tr>
                      <Th>Employee</Th>
                      <Th>Type</Th>
                      <Th>Department</Th>
                      <Th>Month</Th>
                      <Th>Earnings</Th>
                      <Th>Deductions</Th>
                      <Th>Net</Th>
                      <Th>Paid date</Th>
                      <Th>Method</Th>
                      <Th>Status</Th>
                      <Th />
                    </tr>
                  </TableHead>
                  <TableBody>
                    {filtered.map((row) => (
                      <tr key={row._id}>
                        <Td>
                          <div className="font-medium">{employeeName(row)}</div>
                          {row.designation ? (
                            <div className="text-xs text-slate-500">
                              {row.designation}
                            </div>
                          ) : null}
                        </Td>
                        <Td className="text-sm">{row.employeeType}</Td>
                        <Td className="text-sm">{row.department || "—"}</Td>
                        <Td>{row.monthBs}</Td>
                        <Td>{formatCurrencyNpr(totalEarnings(row))}</Td>
                        <Td>{formatCurrencyNpr(totalDeductions(row))}</Td>
                        <Td className="font-semibold text-emerald-800">
                          {formatCurrencyNpr(row.netSalaryNpr)}
                        </Td>
                        <Td>{row.paidDateBs || "—"}</Td>
                        <Td className="text-sm">
                          {row.paymentMethod.replace(/_/g, " ")}
                        </Td>
                        <Td>
                          <Badge className={statusBadge(row.status)}>
                            {row.status}
                          </Badge>
                        </Td>
                        <Td>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={row.status === "PAID"}
                            onClick={() => startEdit(row)}
                          >
                            {row.status === "PAID" ? "Paid" : "Edit"}
                          </Button>
                        </Td>
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === "pay" ? (
        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-base">
                {editingId ? "Edit salary payslip" : "Record salary payment"}
              </CardTitle>
              <p className="text-sm text-slate-500">
                Earnings − deductions = net pay. Set status to <strong>Paid</strong>{" "}
                with a paid date to post cash book and journal entries.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Employee type *">
                  <Select
                    value={form.employeeType}
                    disabled={Boolean(editingId)}
                    onChange={(e) =>
                      setForm((c) => ({
                        ...c,
                        employeeType: e.target
                          .value as SalaryPaymentInput["employeeType"],
                        teacherId: "",
                        staffId: "",
                        staffName: "",
                        basicSalaryNpr: 0,
                      }))
                    }
                  >
                    <option value="TEACHER">Teacher</option>
                    <option value="STAFF">College staff</option>
                  </Select>
                </FormField>
                <FormField label="Salary month (BS) *">
                  <Input
                    placeholder="YYYY-MM e.g. 2082-01"
                    value={form.monthBs}
                    onChange={(e) =>
                      setForm((c) => ({ ...c, monthBs: e.target.value }))
                    }
                  />
                </FormField>

                {form.employeeType === "TEACHER" ? (
                  <FormField label="Teacher *">
                    <Select
                      value={form.teacherId ?? ""}
                      disabled={Boolean(editingId)}
                      onChange={(e) => {
                        const t = teachers.find((x) => x._id === e.target.value);
                        setForm((c) => ({
                          ...c,
                          teacherId: e.target.value,
                          basicSalaryNpr: t?.basicSalaryNpr ?? c.basicSalaryNpr,
                        }));
                      }}
                    >
                      <option value="">Select teacher</option>
                      {teachers.map((t) => (
                        <option key={t._id} value={t._id}>
                          {t.user?.fullName ?? "Teacher"}
                          {t.teacherCode ? ` (${t.teacherCode})` : ""}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                ) : (
                  <FormField label="College staff *">
                    <Select
                      value={form.staffId ?? ""}
                      disabled={Boolean(editingId)}
                      onChange={(e) => {
                        const s = staffForPicker.find(
                          (x) => x._id === e.target.value,
                        );
                        setForm((c) => ({
                          ...c,
                          staffId: e.target.value,
                          staffName: s?.fullName ?? "",
                          basicSalaryNpr: s?.basicSalaryNpr ?? c.basicSalaryNpr,
                        }));
                      }}
                    >
                      <option value="">Select staff</option>
                      {staffForPicker.map((s) => (
                        <option key={s._id} value={s._id}>
                          {s.fullName}
                          {s.staffId ? ` (${s.staffId})` : ""}
                          {s.department ? ` · ${s.department}` : ""}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                )}

                <FormField label="Status *">
                  <Select
                    value={form.status}
                    onChange={(e) =>
                      setForm((c) => ({
                        ...c,
                        status: e.target.value as SalaryPaymentInput["status"],
                      }))
                    }
                  >
                    <option value="DRAFT">Draft</option>
                    <option value="PROCESSED">Processed</option>
                    <option value="PAID">Paid</option>
                  </Select>
                </FormField>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Earnings
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <FormField label="Basic salary (NPR) *">
                    <NumberInput
                      min={0}
                      value={form.basicSalaryNpr}
                      onChange={(e) =>
                        setForm((c) => ({
                          ...c,
                          basicSalaryNpr: e.target.valueAsNumber || 0,
                        }))
                      }
                    />
                  </FormField>
                  <FormField label="Allowances">
                    <NumberInput
                      min={0}
                      value={form.allowancesNpr}
                      onChange={(e) =>
                        setForm((c) => ({
                          ...c,
                          allowancesNpr: e.target.valueAsNumber || 0,
                        }))
                      }
                    />
                  </FormField>
                  <FormField label="Bonus">
                    <NumberInput
                      min={0}
                      value={form.bonusNpr}
                      onChange={(e) =>
                        setForm((c) => ({
                          ...c,
                          bonusNpr: e.target.valueAsNumber || 0,
                        }))
                      }
                    />
                  </FormField>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Deductions
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <FormField label="Advance recovery">
                    <NumberInput
                      min={0}
                      value={form.advanceSalaryNpr}
                      onChange={(e) =>
                        setForm((c) => ({
                          ...c,
                          advanceSalaryNpr: e.target.valueAsNumber || 0,
                        }))
                      }
                    />
                  </FormField>
                  <FormField label="Loan deduction">
                    <NumberInput
                      min={0}
                      value={form.loanDeductionNpr}
                      onChange={(e) =>
                        setForm((c) => ({
                          ...c,
                          loanDeductionNpr: e.target.valueAsNumber || 0,
                        }))
                      }
                    />
                  </FormField>
                  <FormField label="Tax / TDS">
                    <NumberInput
                      min={0}
                      value={form.taxNpr}
                      onChange={(e) =>
                        setForm((c) => ({
                          ...c,
                          taxNpr: e.target.valueAsNumber || 0,
                        }))
                      }
                    />
                  </FormField>
                  <FormField label="Other deductions">
                    <NumberInput
                      min={0}
                      value={form.otherDeductionsNpr}
                      onChange={(e) =>
                        setForm((c) => ({
                          ...c,
                          otherDeductionsNpr: e.target.valueAsNumber || 0,
                        }))
                      }
                    />
                  </FormField>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Paid date (BS)">
                  <NepaliDateField
                    value={form.paidDateBs ?? ""}
                    onChange={(v) =>
                      setForm((c) => ({ ...c, paidDateBs: v }))
                    }
                  />
                </FormField>
                <FormField label="Payment method">
                  <Select
                    value={form.paymentMethod}
                    onChange={(e) =>
                      setForm((c) => ({
                        ...c,
                        paymentMethod: e.target
                          .value as SalaryPaymentInput["paymentMethod"],
                      }))
                    }
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m.replace(/_/g, " ")}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Transaction / bank ref">
                  <Input
                    value={form.transactionNumber ?? ""}
                    onChange={(e) =>
                      setForm((c) => ({
                        ...c,
                        transactionNumber: e.target.value,
                      }))
                    }
                    placeholder="Cheque no. / transfer ref"
                  />
                </FormField>
                <FormField label="Notes">
                  <Textarea
                    rows={2}
                    value={form.notes ?? ""}
                    onChange={(e) =>
                      setForm((c) => ({ ...c, notes: e.target.value }))
                    }
                    placeholder="Payroll notes"
                  />
                </FormField>
              </div>

              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      Payslip / bank advice (optional)
                    </p>
                    <p className="text-xs text-slate-500">
                      PDF or image of transfer advice
                    </p>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium">
                    <Upload className="h-4 w-4" />
                    {uploading ? "Uploading…" : "Attach"}
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*,.pdf,application/pdf"
                      multiple
                      disabled={uploading}
                      onChange={(e) => void uploadAttachments(e.target.files)}
                    />
                  </label>
                </div>
                {attachments.length > 0 ? (
                  <ul className="mt-3 space-y-1">
                    {attachments.map((a, i) => (
                      <li
                        key={`${a.url}-${i}`}
                        className="flex items-center justify-between rounded-lg bg-white px-2 py-1.5 text-sm"
                      >
                        <a
                          href={resolveApiUrl(a.url)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-brand-700 hover:underline"
                        >
                          <Paperclip className="h-3.5 w-3.5" />
                          {a.name || "File"}
                        </a>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setAttachments((list) =>
                              list.filter((_, idx) => idx !== i),
                            )
                          }
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setForm(emptyForm());
                    setEditingId(null);
                    setAttachments([]);
                  }}
                >
                  Clear
                </Button>
                <Button
                  type="button"
                  disabled={saveMutation.isPending}
                  onClick={submit}
                >
                  {saveMutation.isPending
                    ? "Saving…"
                    : editingId
                      ? "Update salary"
                      : "Save salary record"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Payslip preview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Net payable</p>
                <p className="text-2xl font-semibold text-emerald-800">
                  {formatCurrencyNpr(liveNet)}
                </p>
              </div>
              <dl className="space-y-1.5">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Basic</dt>
                  <dd>{formatCurrencyNpr(num(form.basicSalaryNpr))}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Allowances</dt>
                  <dd>{formatCurrencyNpr(num(form.allowancesNpr))}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Bonus</dt>
                  <dd>{formatCurrencyNpr(num(form.bonusNpr))}</dd>
                </div>
                <div className="flex justify-between border-t border-slate-100 pt-1.5 text-rose-700">
                  <dt>Deductions</dt>
                  <dd>
                    {formatCurrencyNpr(
                      num(form.advanceSalaryNpr) +
                        num(form.loanDeductionNpr) +
                        num(form.taxNpr) +
                        num(form.otherDeductionsNpr),
                    )}
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-slate-500">
                Formula: (Basic + Allowances + Bonus) − (Advance + Loan + Tax +
                Other)
              </p>
              {form.status === "PAID" ? (
                <p className="rounded-lg bg-emerald-50 px-2 py-1.5 text-xs text-emerald-900">
                  Saving as <strong>Paid</strong> will post to cash book and
                  salary journal when a paid date is set.
                </p>
              ) : (
                <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-950">
                  Draft / Processed records do not move cash until marked{" "}
                  <strong>Paid</strong>.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
};
