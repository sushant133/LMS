import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BatchRecord,
  FeeRefundRecord,
  StudentRecord,
  YearRecord,
} from "@phit-erp/shared";
import {
  FEE_REFUND_TYPE_LABELS,
  FEE_REFUND_TYPES,
  PAYMENT_METHODS,
  type FeeRefundType,
} from "@phit-erp/shared";
import {
  FileDown,
  GraduationCap,
  Paperclip,
  Plus,
  RotateCcw,
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

type PanelTab = "register" | "process";

type StudentPop = {
  _id?: string;
  user?: { fullName?: string };
  admissionNumber?: string;
  academicStatus?: string;
  securityDepositNpr?: number;
  securityDepositRefundedNpr?: number;
  batchId?: string;
  yearId?: string;
};

type Attachment = {
  name?: string;
  url: string;
  mimeType?: string;
  size?: number;
};

const PASSOUT_STATUSES = new Set([
  "PASSED_OUT",
  "ALUMNI",
  "WITHDRAWN",
  "CANCELLED",
]);

const refundTypeBadge = (type?: string) => {
  switch (type) {
    case "DEPOSIT_REFUND":
      return "bg-violet-100 text-violet-800";
    case "OVERPAYMENT":
      return "bg-sky-100 text-sky-800";
    case "WITHDRAWAL":
      return "bg-amber-100 text-amber-900";
    case "FEE_ADJUSTMENT":
      return "bg-indigo-100 text-indigo-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
};

const studentLabel = (row: FeeRefundRecord): string => {
  const s = row.studentId as unknown as StudentPop | string;
  if (!s || typeof s === "string") return "—";
  return s.user?.fullName ?? "—";
};

const admissionOf = (row: FeeRefundRecord): string => {
  const s = row.studentId as unknown as StudentPop | string;
  if (!s || typeof s === "string") return "—";
  return s.admissionNumber ?? "—";
};

const asId = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value === "object" && value && "_id" in value) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
};

const defaultReason = (type: FeeRefundType): string => {
  switch (type) {
    case "DEPOSIT_REFUND":
      return "Refund of admission security / caution deposit after pass-out";
    case "OVERPAYMENT":
      return "Refund of excess fee payment";
    case "FEE_ADJUSTMENT":
      return "Fee adjustment refund";
    case "WITHDRAWAL":
      return "Refund on course withdrawal";
    default:
      return "";
  }
};

export const RefundRecordsPanel = () => {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<PanelTab>("register");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [batchId, setBatchId] = useState("");
  const [yearId, setYearId] = useState("");

  const [form, setForm] = useState({
    studentId: "",
    refundType: "DEPOSIT_REFUND" as FeeRefundType,
    amountNpr: 0,
    dateBs: "",
    reason: defaultReason("DEPOSIT_REFUND"),
    paymentMethod: "BANK_TRANSFER" as (typeof PAYMENT_METHODS)[number],
    transactionNumber: "",
    notes: "",
    approvedBy: "",
    originalDepositNpr: 0,
  });
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [pickerBatchId, setPickerBatchId] = useState("");
  const [pickerYearId, setPickerYearId] = useState("");
  const [showPassoutOnly, setShowPassoutOnly] = useState(true);

  const refundsQuery = useQuery({
    queryKey: ["accounting-refund-records"],
    queryFn: () => unwrap<FeeRefundRecord[]>(api.get("/accounting/refunds")),
  });

  const studentsQuery = useQuery({
    queryKey: ["students", "refund-picker"],
    queryFn: () => unwrap<StudentRecord[]>(api.get("/students")),
  });

  const batchesQuery = useQuery({
    queryKey: ["batches"],
    queryFn: () => unwrap<BatchRecord[]>(api.get("/academics/batches")),
  });

  const yearsQuery = useQuery({
    queryKey: ["years"],
    queryFn: () => unwrap<YearRecord[]>(api.get("/academics/years")),
  });

  const students = studentsQuery.data ?? [];
  const batches = batchesQuery.data ?? [];
  const years = yearsQuery.data ?? [];

  const yearsForPicker = useMemo(() => {
    if (!pickerBatchId) return years;
    return years.filter((y) => y.batchId === pickerBatchId);
  }, [years, pickerBatchId]);

  const yearsForRegister = useMemo(() => {
    if (!batchId) return years;
    return years.filter((y) => y.batchId === batchId);
  }, [years, batchId]);

  const selectedStudent = useMemo(
    () => students.find((s) => s._id === form.studentId),
    [students, form.studentId],
  );

  const depositHeld = selectedStudent?.securityDepositNpr ?? 0;
  const depositRefunded = selectedStudent?.securityDepositRefundedNpr ?? 0;
  const depositRemaining = Math.max(0, depositHeld - depositRefunded);

  const pickerStudents = useMemo(() => {
    return students.filter((s) => {
      if (pickerBatchId && asId(s.batchId) !== pickerBatchId) return false;
      if (pickerYearId && asId(s.yearId) !== pickerYearId) return false;
      if (showPassoutOnly && form.refundType === "DEPOSIT_REFUND") {
        if (!PASSOUT_STATUSES.has(String(s.academicStatus || "ACTIVE"))) {
          return false;
        }
      }
      return true;
    });
  }, [
    students,
    pickerBatchId,
    pickerYearId,
    showPassoutOnly,
    form.refundType,
  ]);

  const filtered = useMemo(() => {
    let rows = refundsQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((row) => {
        const name = studentLabel(row).toLowerCase();
        const adm = admissionOf(row).toLowerCase();
        return (
          name.includes(q) ||
          adm.includes(q) ||
          (row.refundNumber ?? "").toLowerCase().includes(q) ||
          (row.reason ?? "").toLowerCase().includes(q)
        );
      });
    }
    if (typeFilter) {
      rows = rows.filter((r) => (r.refundType || "OTHER") === typeFilter);
    }
    if (fromDate) rows = rows.filter((r) => r.dateBs >= fromDate);
    if (toDate) rows = rows.filter((r) => r.dateBs <= toDate);
    if (batchId || yearId) {
      rows = rows.filter((row) => {
        const s = row.studentId as unknown as StudentPop | string;
        if (!s || typeof s === "string") return false;
        if (batchId && asId(s.batchId) !== batchId) return false;
        if (yearId && asId(s.yearId) !== yearId) return false;
        return true;
      });
    }
    return rows;
  }, [refundsQuery.data, search, typeFilter, fromDate, toDate, batchId, yearId]);

  const summary = useMemo(() => {
    const deposit = filtered.filter((r) => r.refundType === "DEPOSIT_REFUND");
    const other = filtered.filter((r) => r.refundType !== "DEPOSIT_REFUND");
    return {
      count: filtered.length,
      depositTotal: deposit.reduce((s, r) => s + r.amountNpr, 0),
      otherTotal: other.reduce((s, r) => s + r.amountNpr, 0),
      allTotal: filtered.reduce((s, r) => s + r.amountNpr, 0),
    };
  }, [filtered]);

  const invalidate = async () => {
    const { invalidateAccountingQueries } = await import(
      "./invalidateAccountingQueries"
    );
    await invalidateAccountingQueries();
  };

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      unwrap(api.post("/accounting/refunds", payload)),
    onSuccess: async () => {
      toast.success("Refund processed successfully");
      setForm({
        studentId: "",
        refundType: "DEPOSIT_REFUND",
        amountNpr: 0,
        dateBs: "",
        reason: defaultReason("DEPOSIT_REFUND"),
        paymentMethod: "BANK_TRANSFER",
        transactionNumber: "",
        notes: "",
        approvedBy: "",
        originalDepositNpr: 0,
      });
      setAttachments([]);
      await invalidate();
      setTab("register");
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

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

  const selectStudent = (id: string) => {
    const s = students.find((x) => x._id === id);
    setForm((c) => {
      const next = { ...c, studentId: id };
      if (c.refundType === "DEPOSIT_REFUND" && s) {
        const held = s.securityDepositNpr ?? 0;
        const refunded = s.securityDepositRefundedNpr ?? 0;
        const rem = Math.max(0, held - refunded);
        if (rem > 0) next.amountNpr = rem;
        if (held === 0 && (s.securityDepositNpr ?? 0) === 0) {
          // leave amount for accountant to set after original deposit
        }
      }
      return next;
    });
    if (s?.batchId) setPickerBatchId(asId(s.batchId));
    if (s?.yearId) setPickerYearId(asId(s.yearId));
  };

  const submit = () => {
    if (!form.studentId) {
      toast.error("Select a student");
      return;
    }
    if (!form.dateBs) {
      toast.error("Select refund date (BS)");
      return;
    }
    if (!form.amountNpr || form.amountNpr <= 0) {
      toast.error("Enter a valid refund amount");
      return;
    }
    if (!form.reason.trim()) {
      toast.error("Enter a reason for the refund");
      return;
    }
    if (
      form.refundType === "DEPOSIT_REFUND" &&
      depositHeld <= 0 &&
      (!form.originalDepositNpr || form.originalDepositNpr <= 0)
    ) {
      toast.error(
        "Enter the original admission deposit amount (not yet on student record)",
      );
      return;
    }

    createMutation.mutate({
      studentId: form.studentId,
      refundType: form.refundType,
      amountNpr: form.amountNpr,
      dateBs: form.dateBs,
      reason: form.reason.trim(),
      paymentMethod: form.paymentMethod,
      transactionNumber: form.transactionNumber || undefined,
      notes: form.notes || undefined,
      approvedBy: form.approvedBy || undefined,
      originalDepositNpr:
        form.refundType === "DEPOSIT_REFUND" && form.originalDepositNpr > 0
          ? form.originalDepositNpr
          : undefined,
      attachments,
    });
  };

  const exportExcel = () => {
    if (filtered.length === 0) {
      toast.error("No records to export");
      return;
    }
    downloadRecordsExcel(
      "Student_Refund_Records",
      filtered.map((row) => ({
        refundNumber: row.refundNumber,
        student: studentLabel(row),
        admission: admissionOf(row),
        refundType:
          FEE_REFUND_TYPE_LABELS[
            (row.refundType as FeeRefundType) || "OTHER"
          ] ?? row.refundType,
        refundAmountNpr: row.amountNpr,
        reason: row.reason,
        refundDate: row.dateBs,
        paymentMethod: row.paymentMethod,
        transactionNumber: row.transactionNumber ?? "",
        remarks: row.notes ?? "",
      })),
    );
    toast.success("Excel exported");
  };

  if (refundsQuery.isLoading || studentsQuery.isLoading) {
    return <LoadingState />;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-brand-600" />
              Refund Records
            </CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              Student refunds including{" "}
              <strong>admission security deposit after pass-out</strong>,
              overpayments, withdrawal, and other adjustments.
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
              variant={tab === "process" ? "default" : "outline"}
              onClick={() => setTab("process")}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Process refund
            </Button>
          </div>
        </CardHeader>
      </Card>

      {tab === "register" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-slate-500">Records shown</p>
                <p className="text-xl font-semibold">{summary.count}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-slate-500">Deposit refunds</p>
                <p className="text-xl font-semibold text-violet-800">
                  {formatCurrencyNpr(summary.depositTotal)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-slate-500">Other refunds</p>
                <p className="text-xl font-semibold text-sky-800">
                  {formatCurrencyNpr(summary.otherTotal)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-slate-500">Total refunded</p>
                <p className="text-xl font-semibold">
                  {formatCurrencyNpr(summary.allTotal)}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base">Refund register</CardTitle>
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
                        placeholder="Name, admission, refund no."
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
                  <FormField label="Refund type">
                    <Select
                      value={typeFilter}
                      onChange={(e) => setTypeFilter(e.target.value)}
                    >
                      <option value="">All types</option>
                      {FEE_REFUND_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {FEE_REFUND_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Batch">
                    <Select
                      value={batchId}
                      onChange={(e) => {
                        setBatchId(e.target.value);
                        setYearId("");
                      }}
                    >
                      <option value="">All batches</option>
                      {batches.map((b) => (
                        <option key={b._id} value={b._id}>
                          {b.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Year">
                    <Select
                      value={yearId}
                      onChange={(e) => setYearId(e.target.value)}
                    >
                      <option value="">All years</option>
                      {yearsForRegister.map((y) => (
                        <option key={y._id} value={y._id}>
                          {y.name}
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
              </div>

              {filtered.length === 0 ? (
                <EmptyState
                  title="No refund records"
                  description="Process a deposit or other student refund to build history."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHead>
                      <tr>
                        <Th>Refund no.</Th>
                        <Th>Student</Th>
                        <Th>Type</Th>
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
                          <Td className="font-mono text-sm">
                            {row.refundNumber}
                          </Td>
                          <Td>
                            <div className="font-medium">{studentLabel(row)}</div>
                            <div className="text-xs text-slate-500">
                              {admissionOf(row)}
                            </div>
                          </Td>
                          <Td>
                            <Badge
                              className={refundTypeBadge(row.refundType)}
                            >
                              {FEE_REFUND_TYPE_LABELS[
                                (row.refundType as FeeRefundType) || "OTHER"
                              ] ?? row.refundType ?? "Other"}
                            </Badge>
                          </Td>
                          <Td className="font-medium">
                            {formatCurrencyNpr(row.amountNpr)}
                          </Td>
                          <Td
                            className="max-w-xs truncate text-sm"
                            title={row.reason}
                          >
                            {row.reason}
                          </Td>
                          <Td>{row.dateBs}</Td>
                          <Td className="text-sm">
                            {row.paymentMethod.replace(/_/g, " ")}
                          </Td>
                          <Td className="max-w-[140px] truncate text-sm">
                            {row.approvedBy || row.notes || "—"}
                          </Td>
                        </tr>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      {tab === "process" ? (
        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-base">Process student refund</CardTitle>
              <p className="text-sm text-slate-500">
                Use <strong>Admission deposit</strong> for pass-out caution money.
                Use other types for overpayment, withdrawal, or fee adjustments.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField label="Refund type *">
                <Select
                  value={form.refundType}
                  onChange={(e) => {
                    const t = e.target.value as FeeRefundType;
                    setForm((c) => ({
                      ...c,
                      refundType: t,
                      reason: c.reason.trim()
                        ? c.reason
                        : defaultReason(t),
                      amountNpr:
                        t === "DEPOSIT_REFUND" && depositRemaining > 0
                          ? depositRemaining
                          : c.amountNpr,
                    }));
                    if (t === "DEPOSIT_REFUND") setShowPassoutOnly(true);
                  }}
                >
                  {FEE_REFUND_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {FEE_REFUND_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </FormField>

              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Find student by batch &amp; year
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <FormField label="Batch">
                    <Select
                      value={pickerBatchId}
                      onChange={(e) => {
                        setPickerBatchId(e.target.value);
                        setPickerYearId("");
                        setForm((c) => ({ ...c, studentId: "" }));
                      }}
                    >
                      <option value="">All batches</option>
                      {batches.map((b) => (
                        <option key={b._id} value={b._id}>
                          {b.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Year">
                    <Select
                      value={pickerYearId}
                      onChange={(e) => {
                        setPickerYearId(e.target.value);
                        setForm((c) => ({ ...c, studentId: "" }));
                      }}
                    >
                      <option value="">All years</option>
                      {yearsForPicker.map((y) => (
                        <option key={y._id} value={y._id}>
                          {y.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <div className="flex items-end pb-1">
                    {form.refundType === "DEPOSIT_REFUND" ? (
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300"
                          checked={showPassoutOnly}
                          onChange={(e) => {
                            setShowPassoutOnly(e.target.checked);
                            setForm((c) => ({ ...c, studentId: "" }));
                          }}
                        />
                        Pass-out / withdrawn only
                      </label>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Student *">
                  <Select
                    value={form.studentId}
                    onChange={(e) => selectStudent(e.target.value)}
                  >
                    <option value="">
                      {pickerStudents.length === 0
                        ? "No students match filters"
                        : "Select student"}
                    </option>
                    {pickerStudents.map((s) => (
                      <option key={s._id} value={s._id}>
                        {s.user?.fullName ?? "Student"} ({s.admissionNumber})
                        {s.academicStatus
                          ? ` · ${String(s.academicStatus).replace(/_/g, " ")}`
                          : ""}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Refund date (BS) *">
                  <NepaliDateField
                    value={form.dateBs}
                    onChange={(v) => setForm((c) => ({ ...c, dateBs: v }))}
                  />
                </FormField>
                <FormField label="Amount (NPR) *">
                  <NumberInput
                    min={0}
                    value={form.amountNpr}
                    onChange={(e) =>
                      setForm((c) => ({
                        ...c,
                        amountNpr: e.target.valueAsNumber || 0,
                      }))
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
                          .value as (typeof PAYMENT_METHODS)[number],
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
                    value={form.transactionNumber}
                    onChange={(e) =>
                      setForm((c) => ({
                        ...c,
                        transactionNumber: e.target.value,
                      }))
                    }
                    placeholder="Cheque / transfer ref"
                  />
                </FormField>
                {form.refundType === "DEPOSIT_REFUND" && depositHeld <= 0 ? (
                  <FormField label="Original admission deposit (NPR) *">
                    <NumberInput
                      min={0}
                      value={form.originalDepositNpr}
                      onChange={(e) => {
                        const v = e.target.valueAsNumber || 0;
                        setForm((c) => ({
                          ...c,
                          originalDepositNpr: v,
                          amountNpr: c.amountNpr > 0 ? c.amountNpr : v,
                        }));
                      }}
                    />
                  </FormField>
                ) : null}
              </div>

              <FormField label="Reason *">
                <Textarea
                  rows={2}
                  value={form.reason}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, reason: e.target.value }))
                  }
                />
              </FormField>
              <FormField label="Approved By">
                <Input
                  value={form.approvedBy}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, approvedBy: e.target.value }))
                  }
                  placeholder="Principal / Admin name"
                />
              </FormField>
              <FormField label="Internal notes">
                <Textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, notes: e.target.value }))
                  }
                  placeholder="Optional accounts note"
                />
              </FormField>

              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      Supporting documents (optional)
                    </p>
                    <p className="text-xs text-slate-500">
                      Pass-out clearance, bank advice, student application
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

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setForm({
                      studentId: "",
                      refundType: "DEPOSIT_REFUND",
                      amountNpr: 0,
                      dateBs: "",
                      reason: defaultReason("DEPOSIT_REFUND"),
                      paymentMethod: "BANK_TRANSFER",
                      transactionNumber: "",
                      notes: "",
                      approvedBy: "",
                      originalDepositNpr: 0,
                    });
                    setAttachments([]);
                  }}
                >
                  Clear
                </Button>
                <Button
                  type="button"
                  disabled={createMutation.isPending}
                  onClick={submit}
                >
                  {createMutation.isPending
                    ? "Processing…"
                    : "Process refund"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <GraduationCap className="h-4 w-4 text-violet-600" />
                Student deposit snapshot
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {!selectedStudent ? (
                <p className="text-slate-500">
                  Select a student to see admission deposit held and remaining.
                </p>
              ) : (
                <>
                  <div>
                    <p className="font-medium text-slate-900">
                      {selectedStudent.user?.fullName}
                    </p>
                    <p className="text-xs text-slate-500">
                      {selectedStudent.admissionNumber} ·{" "}
                      {String(selectedStudent.academicStatus || "ACTIVE").replace(
                        /_/g,
                        " ",
                      )}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">Deposit held</p>
                      <p className="text-lg font-semibold">
                        {formatCurrencyNpr(depositHeld)}
                      </p>
                    </div>
                    <div className="rounded-xl bg-amber-50 p-3">
                      <p className="text-xs text-amber-800">Already refunded</p>
                      <p className="text-lg font-semibold text-amber-900">
                        {formatCurrencyNpr(depositRefunded)}
                      </p>
                    </div>
                    <div className="rounded-xl bg-violet-50 p-3">
                      <p className="text-xs text-violet-800">
                        Remaining deposit
                      </p>
                      <p className="text-lg font-semibold text-violet-900">
                        {formatCurrencyNpr(
                          depositHeld > 0
                            ? depositRemaining
                            : form.originalDepositNpr || 0,
                        )}
                      </p>
                    </div>
                  </div>
                  {form.refundType === "DEPOSIT_REFUND" ? (
                    <p className="rounded-lg bg-violet-50 px-2 py-1.5 text-xs text-violet-950">
                      Typical HA process: collect security deposit at admission;
                      after final pass-out (or approved withdrawal), refund the
                      remaining deposit here.
                    </p>
                  ) : (
                    <p className="rounded-lg bg-sky-50 px-2 py-1.5 text-xs text-sky-950">
                      Other refunds post to cash book and journal. Use for
                      overpayment or special adjustments.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
};
