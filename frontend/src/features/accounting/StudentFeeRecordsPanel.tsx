import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  EnhancedFeeCollectionRecord,
  ExtendedFeeStructureInput,
  ProgramYearFeeSummary,
  StudentAccountSummary,
  StudentFinancialHistory,
  StudentRecord,
} from "@phit-erp/shared";
import { PAYMENT_METHODS } from "@phit-erp/shared";
import {
  Award,
  FileDown,
  FileText,
  Paperclip,
  Plus,
  Printer,
  Receipt,
  Search,
  Upload,
  Wallet,
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

type PanelTab = "ledger" | "record" | "scholarship" | "receipts";

type FeeAttachment = {
  name?: string;
  url: string;
  mimeType?: string;
  size?: number;
  kind?: string;
};

type StudentPopulated = {
  _id?: string;
  admissionNumber?: string;
  user?: { fullName?: string };
  batchId?: string | { name?: string };
  yearId?: string | { name?: string };
  classId?: string | { name?: string };
};

const PROGRAM_YEARS = [
  { value: 1, label: "1st Year" },
  { value: 2, label: "2nd Year" },
  { value: 3, label: "3rd Year" },
] as const;

const yearStatusBadge = (status: ProgramYearFeeSummary["status"]) => {
  switch (status) {
    case "PAID":
      return "bg-emerald-100 text-emerald-800";
    case "SCHOLARSHIP":
      return "bg-violet-100 text-violet-800";
    case "PARTIAL":
      return "bg-amber-100 text-amber-900";
    case "DUE":
      return "bg-rose-100 text-rose-800";
    default:
      return "bg-slate-100 text-slate-600";
  }
};

const resolveStudent = (row: EnhancedFeeCollectionRecord) => {
  const s = row.studentId as unknown as StudentPopulated | string;
  if (!s || typeof s === "string") {
    return { name: "—", admission: "—", batch: "—", year: "—" };
  }
  const batch = typeof s.batchId === "object" ? s.batchId?.name : undefined;
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

const emptyPaymentForm = () => ({
  studentId: "",
  programYear: "1",
  feeStructureId: "",
  paidDateBs: "",
  currentChargesNpr: "",
  amountPaidNpr: "",
  discountNpr: "0",
  scholarshipNpr: "0",
  lateFeeNpr: "0",
  paymentMethod: "CASH" as (typeof PAYMENT_METHODS)[number],
  transactionNumber: "",
  notes: "",
  scholarshipType: "NONE" as "NONE" | "TOPPER_YEAR_WAIVER" | "MERIT" | "OTHER",
  scholarshipAwardId: "",
});

export const StudentFeeRecordsPanel = () => {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<PanelTab>("ledger");
  const [search, setSearch] = useState("");
  const [method, setMethod] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);
  const [attachments, setAttachments] = useState<FeeAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [scholarshipForm, setScholarshipForm] = useState({
    studentId: "",
    toppedProgramYear: "1",
    coversProgramYear: "2",
    examName: "Final Examination",
    rank: "1",
    amountNpr: "0",
    notes: "",
  });

  const accountsQuery = useQuery({
    queryKey: ["accounting-student-accounts"],
    queryFn: () =>
      unwrap<StudentAccountSummary[]>(api.get("/accounting/student-accounts")),
  });

  const receiptsQuery = useQuery({
    queryKey: ["accounting-fee-records"],
    queryFn: () =>
      unwrap<EnhancedFeeCollectionRecord[]>(api.get("/accounting/receipts")),
  });

  const structuresQuery = useQuery({
    queryKey: ["accounting-structures"],
    queryFn: () =>
      unwrap<
        Array<
          ExtendedFeeStructureInput & { _id: string; amountNpr: number; title: string }
        >
      >(api.get("/accounting/structures")),
  });

  const studentsQuery = useQuery({
    queryKey: ["students", "fee-picker"],
    queryFn: () => unwrap<StudentRecord[]>(api.get("/students")),
  });

  const historyQuery = useQuery({
    queryKey: ["accounting-student-financial", selectedStudentId],
    queryFn: () =>
      unwrap<StudentFinancialHistory>(
        api.get(
          `/accounting/student-accounts/${selectedStudentId}/financial-history`,
        ),
      ),
    enabled: Boolean(selectedStudentId),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["accounting"] });
    await queryClient.invalidateQueries({ queryKey: ["accounting-fee-records"] });
    await queryClient.invalidateQueries({
      queryKey: ["accounting-student-accounts"],
    });
    await queryClient.invalidateQueries({
      queryKey: ["accounting-student-financial"],
    });
    await queryClient.invalidateQueries({ queryKey: ["student-financial-history"] });
  };

  const collectMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      unwrap(api.post("/accounting/collections", body)),
    onSuccess: async () => {
      toast.success("Fee payment recorded — student account updated");
      setPaymentForm(emptyPaymentForm());
      setAttachments([]);
      await invalidate();
      setTab("ledger");
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const scholarshipMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      unwrap(api.post("/accounting/scholarships", body)),
    onSuccess: async () => {
      toast.success("Topper scholarship recorded for next year");
      setScholarshipForm({
        studentId: "",
        toppedProgramYear: "1",
        coversProgramYear: "2",
        examName: "Final Examination",
        rank: "1",
        amountNpr: "0",
        notes: "",
      });
      await invalidate();
      setTab("ledger");
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const students = studentsQuery.data ?? [];
  const accounts = accountsQuery.data ?? [];

  const filteredAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) => {
      const name = a.student?.user?.fullName?.toLowerCase() ?? "";
      const adm = a.student?.admissionNumber?.toLowerCase() ?? "";
      return name.includes(q) || adm.includes(q);
    });
  }, [accounts, search]);

  const filteredReceipts = useMemo(() => {
    let rows = receiptsQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((row) => {
        const st = resolveStudent(row);
        return (
          st.name.toLowerCase().includes(q) ||
          st.admission.toLowerCase().includes(q) ||
          row.receiptNumber.toLowerCase().includes(q)
        );
      });
    }
    if (method) rows = rows.filter((r) => r.paymentMethod === method);
    if (fromDate) rows = rows.filter((r) => r.paidDateBs >= fromDate);
    if (toDate) rows = rows.filter((r) => r.paidDateBs <= toDate);
    return rows;
  }, [receiptsQuery.data, search, method, fromDate, toDate]);

  const uploadAttachments = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const formData = new FormData();
      Array.from(files).forEach((f) => formData.append("files", f));
      const res = await unwrap<{
        files: Array<{ url: string; originalName?: string; mimeType?: string; size?: number }>;
      }>(
        api.post("/uploads/accounting", formData, {
          headers: { "Content-Type": "multipart/form-data" },
        }),
      );
      const next: FeeAttachment[] = (res.files ?? []).map((f) => ({
        url: f.url,
        name: f.originalName ?? "Attachment",
        mimeType: f.mimeType,
        size: f.size,
        kind: "OTHER",
      }));
      setAttachments((prev) => [...prev, ...next]);
      toast.success(`${next.length} file(s) attached`);
    } catch (e) {
      toast.error(parseErrorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const submitPayment = () => {
    if (!paymentForm.studentId) {
      toast.error("Select a student");
      return;
    }
    if (!paymentForm.paidDateBs) {
      toast.error("Select payment date (BS)");
      return;
    }
    const amountPaid = Number(paymentForm.amountPaidNpr);
    const charges = Number(paymentForm.currentChargesNpr);
    if (!Number.isFinite(amountPaid) || amountPaid < 0) {
      toast.error("Enter a valid amount paid (0 allowed for full scholarship)");
      return;
    }
    collectMutation.mutate({
      studentId: paymentForm.studentId,
      feeStructureId: paymentForm.feeStructureId || undefined,
      paidDateBs: paymentForm.paidDateBs,
      programYear: Number(paymentForm.programYear),
      currentChargesNpr: Number.isFinite(charges) ? charges : 0,
      amountPaidNpr: amountPaid,
      discountNpr: Number(paymentForm.discountNpr) || 0,
      scholarshipNpr: Number(paymentForm.scholarshipNpr) || 0,
      lateFeeNpr: Number(paymentForm.lateFeeNpr) || 0,
      paymentMethod: paymentForm.paymentMethod,
      transactionNumber: paymentForm.transactionNumber || undefined,
      notes: paymentForm.notes || undefined,
      scholarshipType: paymentForm.scholarshipType,
      scholarshipAwardId: paymentForm.scholarshipAwardId || undefined,
      attachments,
      feeBreakdown:
        charges > 0
          ? [
              {
                feeType: "TUITION",
                title: `${PROGRAM_YEARS.find((y) => String(y.value) === paymentForm.programYear)?.label ?? "Year"} tuition / program fee`,
                amountNpr: charges,
              },
            ]
          : [],
    });
  };

  const submitScholarship = () => {
    if (!scholarshipForm.studentId) {
      toast.error("Select a student");
      return;
    }
    const topped = Number(scholarshipForm.toppedProgramYear);
    const covers = Number(scholarshipForm.coversProgramYear);
    scholarshipMutation.mutate({
      studentId: scholarshipForm.studentId,
      toppedProgramYear: topped,
      coversProgramYear: covers,
      examName: scholarshipForm.examName,
      rank: Number(scholarshipForm.rank) || 1,
      waiverType: "FULL",
      amountNpr: Number(scholarshipForm.amountNpr) || 0,
      notes: scholarshipForm.notes,
    });
  };

  const downloadReceipt = (id: string) => {
    window.open(
      `${api.defaults.baseURL}/accounting/collections/${id}/receipt`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const exportExcel = () => {
    if (filteredReceipts.length === 0) {
      toast.error("No records to export");
      return;
    }
    downloadRecordsExcel(
      "Student_Fee_Records",
      filteredReceipts.map((row) => {
        const st = resolveStudent(row);
        return {
          receiptNumber: row.receiptNumber,
          studentName: st.name,
          admissionNumber: st.admission,
          programYear: row.programYear ?? "",
          feeCategory: feeCategory(row),
          chargedNpr: row.currentChargesNpr,
          amountPaidNpr: row.amountPaidNpr,
          scholarshipNpr: row.scholarshipNpr,
          remainingDueNpr: row.remainingDueNpr,
          paidDateBs: row.paidDateBs,
          paymentMethod: row.paymentMethod,
          attachments: row.attachments?.length ?? 0,
        };
      }),
    );
    toast.success("Excel exported");
  };

  if (accountsQuery.isLoading || receiptsQuery.isLoading) {
    return <LoadingState />;
  }

  const selectedHistory = historyQuery.data;
  const activeScholarshipForYear = selectedHistory?.scholarshipAwards?.find(
    (a) =>
      a.coversProgramYear === Number(paymentForm.programYear) &&
      (a.status === "ACTIVE" || a.status === "APPLIED"),
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-brand-600" />
              Student Fee Records
            </CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              HA program fee ledger — record payments, attach bank slips / screenshots,
              apply topper scholarships (top Year N → free Year N+1), and track paid vs
              remaining by year.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["ledger", "Student ledger", Wallet],
                ["record", "Record payment", Plus],
                ["scholarship", "Topper scholarship", Award],
                ["receipts", "All receipts", Receipt],
              ] as const
            ).map(([id, label, Icon]) => (
              <Button
                key={id}
                size="sm"
                variant={tab === id ? "default" : "outline"}
                onClick={() => setTab(id)}
              >
                <Icon className="mr-1.5 h-4 w-4" />
                {label}
              </Button>
            ))}
          </div>
        </CardHeader>
      </Card>

      {/* ─── Ledger ─── */}
      {tab === "ledger" ? (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">Student fee ledger</CardTitle>
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                className="pl-8"
                placeholder="Search student name or admission no."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {filteredAccounts.length === 0 ? (
              <EmptyState
                title="No student accounts"
                description="Students will appear here with paid / remaining balances once enrolled."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <tr>
                      <Th>Student</Th>
                      <Th>Batch / Year</Th>
                      <Th>1st Year</Th>
                      <Th>2nd Year</Th>
                      <Th>3rd Year</Th>
                      <Th>Total paid</Th>
                      <Th>Remaining</Th>
                      <Th />
                    </tr>
                  </TableHead>
                  <TableBody>
                    {filteredAccounts.map((acc) => {
                      const years = acc.yearWise ?? [];
                      const y = (n: number) =>
                        years.find((r) => r.programYear === n);
                      return (
                        <tr key={acc.student._id}>
                          <Td>
                            <div className="font-medium">
                              {acc.student.user?.fullName ?? "—"}
                            </div>
                            <div className="text-xs text-slate-500">
                              {acc.student.admissionNumber}
                            </div>
                          </Td>
                          <Td className="text-sm">
                            {acc.className || "—"}
                            {acc.sectionName ? ` / ${acc.sectionName}` : ""}
                          </Td>
                          {[1, 2, 3].map((n) => {
                            const row = y(n);
                            return (
                              <Td key={n}>
                                {row ? (
                                  <div className="space-y-0.5">
                                    <Badge className={yearStatusBadge(row.status)}>
                                      {row.status.replace(/_/g, " ")}
                                    </Badge>
                                    <div className="text-xs text-slate-600">
                                      Paid {formatCurrencyNpr(row.paidNpr)}
                                    </div>
                                    {row.scholarshipNpr > 0 ? (
                                      <div className="text-xs text-violet-700">
                                        Sch. {formatCurrencyNpr(row.scholarshipNpr)}
                                      </div>
                                    ) : null}
                                    {row.remainingNpr > 0 ? (
                                      <div className="text-xs text-rose-600">
                                        Due {formatCurrencyNpr(row.remainingNpr)}
                                      </div>
                                    ) : null}
                                  </div>
                                ) : (
                                  <span className="text-xs text-slate-400">—</span>
                                )}
                              </Td>
                            );
                          })}
                          <Td className="font-medium text-emerald-700">
                            {formatCurrencyNpr(acc.totalPaidNpr)}
                          </Td>
                          <Td className="font-medium text-rose-700">
                            {formatCurrencyNpr(acc.remainingDueNpr)}
                          </Td>
                          <Td>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedStudentId(acc.student._id);
                                setPaymentForm((f) => ({
                                  ...f,
                                  studentId: acc.student._id,
                                }));
                                setTab("record");
                              }}
                            >
                              Record fee
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
      ) : null}

      {/* ─── Record payment ─── */}
      {tab === "record" ? (
        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-base">Record student fee payment</CardTitle>
              <p className="text-sm text-slate-500">
                Posts to cash book / journal and updates the student&apos;s outstanding
                balance. Attach bank voucher, Fonepay screenshot, or invoice PDF.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Student *">
                  <Select
                    value={paymentForm.studentId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setPaymentForm((f) => ({ ...f, studentId: id }));
                      setSelectedStudentId(id);
                    }}
                  >
                    <option value="">Select student</option>
                    {students.map((s) => (
                      <option key={s._id} value={s._id}>
                        {s.user?.fullName ?? "Student"} ({s.admissionNumber})
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Program year (HA) *">
                  <Select
                    value={paymentForm.programYear}
                    onChange={(e) =>
                      setPaymentForm((f) => ({
                        ...f,
                        programYear: e.target.value,
                      }))
                    }
                  >
                    {PROGRAM_YEARS.map((y) => (
                      <option key={y.value} value={String(y.value)}>
                        {y.label}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Payment date (BS) *">
                  <NepaliDateField
                    value={paymentForm.paidDateBs}
                    onChange={(v) =>
                      setPaymentForm((f) => ({ ...f, paidDateBs: v }))
                    }
                  />
                </FormField>
                <FormField label="Fee structure (optional)">
                  <Select
                    value={paymentForm.feeStructureId}
                    onChange={(e) => {
                      const id = e.target.value;
                      const st = structuresQuery.data?.find((x) => x._id === id);
                      setPaymentForm((f) => ({
                        ...f,
                        feeStructureId: id,
                        currentChargesNpr: st
                          ? String(st.amountNpr)
                          : f.currentChargesNpr,
                      }));
                    }}
                  >
                    <option value="">— Manual amount —</option>
                    {(structuresQuery.data ?? []).map((s) => (
                      <option key={s._id} value={s._id}>
                        {s.title} ({formatCurrencyNpr(s.amountNpr)})
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Fee charged (NPR) *">
                  <NumberInput
                    min={0}
                    value={paymentForm.currentChargesNpr}
                    onChange={(e) =>
                      setPaymentForm((f) => ({
                        ...f,
                        currentChargesNpr: e.target.value,
                      }))
                    }
                  />
                </FormField>
                <FormField label="Amount paid (NPR) *">
                  <NumberInput
                    min={0}
                    value={paymentForm.amountPaidNpr}
                    onChange={(e) =>
                      setPaymentForm((f) => ({
                        ...f,
                        amountPaidNpr: e.target.value,
                      }))
                    }
                  />
                </FormField>
                <FormField label="Discount (NPR)">
                  <NumberInput
                    min={0}
                    value={paymentForm.discountNpr}
                    onChange={(e) =>
                      setPaymentForm((f) => ({
                        ...f,
                        discountNpr: e.target.value,
                      }))
                    }
                  />
                </FormField>
                <FormField label="Scholarship (NPR)">
                  <NumberInput
                    min={0}
                    value={paymentForm.scholarshipNpr}
                    onChange={(e) =>
                      setPaymentForm((f) => ({
                        ...f,
                        scholarshipNpr: e.target.value,
                      }))
                    }
                  />
                </FormField>
                <FormField label="Late fee / fine (NPR)">
                  <NumberInput
                    min={0}
                    value={paymentForm.lateFeeNpr}
                    onChange={(e) =>
                      setPaymentForm((f) => ({
                        ...f,
                        lateFeeNpr: e.target.value,
                      }))
                    }
                  />
                </FormField>
                <FormField label="Payment method">
                  <Select
                    value={paymentForm.paymentMethod}
                    onChange={(e) =>
                      setPaymentForm((f) => ({
                        ...f,
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
                <FormField label="Transaction / voucher no.">
                  <Input
                    value={paymentForm.transactionNumber}
                    onChange={(e) =>
                      setPaymentForm((f) => ({
                        ...f,
                        transactionNumber: e.target.value,
                      }))
                    }
                    placeholder="Bank ref / cheque no."
                  />
                </FormField>
                <FormField label="Scholarship type">
                  <Select
                    value={paymentForm.scholarshipType}
                    onChange={(e) =>
                      setPaymentForm((f) => ({
                        ...f,
                        scholarshipType: e.target.value as typeof f.scholarshipType,
                      }))
                    }
                  >
                    <option value="NONE">None</option>
                    <option value="TOPPER_YEAR_WAIVER">Topper year waiver</option>
                    <option value="MERIT">Merit</option>
                    <option value="OTHER">Other</option>
                  </Select>
                </FormField>
              </div>

              {activeScholarshipForYear ? (
                <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-950">
                  Active topper scholarship for this year:{" "}
                  <strong>{activeScholarshipForYear.reason}</strong>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="ml-2"
                    onClick={() => {
                      const charges = Number(paymentForm.currentChargesNpr) || 0;
                      setPaymentForm((f) => ({
                        ...f,
                        scholarshipType: "TOPPER_YEAR_WAIVER",
                        scholarshipNpr: String(
                          activeScholarshipForYear.amountNpr || charges,
                        ),
                        amountPaidNpr: "0",
                        scholarshipAwardId: activeScholarshipForYear._id,
                      }));
                    }}
                  >
                    Apply as full scholarship
                  </Button>
                </div>
              ) : null}

              <FormField label="Remarks">
                <Textarea
                  value={paymentForm.notes}
                  onChange={(e) =>
                    setPaymentForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  placeholder="Internal note for accounts"
                  rows={2}
                />
              </FormField>

              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      Payment proof (image / PDF)
                    </p>
                    <p className="text-xs text-slate-500">
                      Bank voucher, Fonepay/eSewa screenshot, invoice, or receipt slip
                    </p>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    <Upload className="h-4 w-4" />
                    {uploading ? "Uploading…" : "Attach files"}
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
                        className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1.5 text-sm"
                      >
                        <a
                          href={resolveApiUrl(a.url)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-brand-700 hover:underline"
                        >
                          <Paperclip className="h-3.5 w-3.5" />
                          {a.name || "Attachment"}
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
                    setPaymentForm(emptyPaymentForm());
                    setAttachments([]);
                  }}
                >
                  Clear
                </Button>
                <Button
                  type="button"
                  disabled={collectMutation.isPending}
                  onClick={submitPayment}
                >
                  <Receipt className="mr-1.5 h-4 w-4" />
                  {collectMutation.isPending ? "Saving…" : "Save fee record"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Account snapshot</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!selectedStudentId ? (
                <p className="text-sm text-slate-500">
                  Select a student to preview paid / remaining by year.
                </p>
              ) : historyQuery.isLoading ? (
                <LoadingState />
              ) : selectedHistory ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-rose-50 p-3">
                      <p className="text-xs text-rose-700">Outstanding</p>
                      <p className="text-lg font-semibold text-rose-800">
                        {formatCurrencyNpr(selectedHistory.outstandingDueNpr)}
                      </p>
                    </div>
                    <div className="rounded-xl bg-emerald-50 p-3">
                      <p className="text-xs text-emerald-700">Total paid</p>
                      <p className="text-lg font-semibold text-emerald-800">
                        {formatCurrencyNpr(selectedHistory.totalPaidNpr)}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-600">
                    Scholarship: {selectedHistory.scholarshipStatus ?? "None"}
                  </p>
                  <div className="space-y-2">
                    {(selectedHistory.yearWise ?? []).map((y) => (
                      <div
                        key={y.programYear}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{y.label}</span>
                          <Badge className={yearStatusBadge(y.status)}>
                            {y.status.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        <div className="mt-1 grid grid-cols-2 gap-1 text-xs text-slate-600">
                          <span>Paid: {formatCurrencyNpr(y.paidNpr)}</span>
                          <span>Due: {formatCurrencyNpr(y.remainingNpr)}</span>
                          <span>Sch: {formatCurrencyNpr(y.scholarshipNpr)}</span>
                          <span>Charged: {formatCurrencyNpr(y.chargedNpr)}</span>
                        </div>
                        {y.scholarshipNote ? (
                          <p className="mt-1 text-xs text-violet-700">
                            {y.scholarshipNote}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-500">Unable to load history.</p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* ─── Scholarship ─── */}
      {tab === "scholarship" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Award className="h-5 w-5 text-violet-600" />
              Topper scholarship (HA rule)
            </CardTitle>
            <p className="text-sm text-slate-500">
              If a student ranks top in the <strong>1st year final</strong>, they receive a
              scholarship for <strong>2nd year</strong> fees. If they do not top the 2nd
              year final, <strong>3rd year</strong> is payable again. Same pattern for
              other years.
            </p>
          </CardHeader>
          <CardContent className="grid max-w-3xl gap-3 sm:grid-cols-2">
            <FormField label="Student *">
              <Select
                value={scholarshipForm.studentId}
                onChange={(e) =>
                  setScholarshipForm((f) => ({ ...f, studentId: e.target.value }))
                }
              >
                <option value="">Select student</option>
                {students.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.user?.fullName} ({s.admissionNumber})
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Topped which year final? *">
              <Select
                value={scholarshipForm.toppedProgramYear}
                onChange={(e) => {
                  const topped = e.target.value;
                  const next =
                    topped === "1" ? "2" : topped === "2" ? "3" : topped;
                  setScholarshipForm((f) => ({
                    ...f,
                    toppedProgramYear: topped,
                    coversProgramYear: next,
                  }));
                }}
              >
                {PROGRAM_YEARS.map((y) => (
                  <option key={y.value} value={String(y.value)}>
                    {y.label} finals
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Scholarship covers year *">
              <Select
                value={scholarshipForm.coversProgramYear}
                onChange={(e) =>
                  setScholarshipForm((f) => ({
                    ...f,
                    coversProgramYear: e.target.value,
                  }))
                }
              >
                {PROGRAM_YEARS.map((y) => (
                  <option key={y.value} value={String(y.value)}>
                    {y.label} fees waived
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Exam name">
              <Input
                value={scholarshipForm.examName}
                onChange={(e) =>
                  setScholarshipForm((f) => ({ ...f, examName: e.target.value }))
                }
              />
            </FormField>
            <FormField label="Rank">
              <NumberInput
                min={1}
                value={scholarshipForm.rank}
                onChange={(e) =>
                  setScholarshipForm((f) => ({ ...f, rank: e.target.value }))
                }
              />
            </FormField>
            <FormField label="Waiver amount (0 = full year fee when applied)">
              <NumberInput
                min={0}
                value={scholarshipForm.amountNpr}
                onChange={(e) =>
                  setScholarshipForm((f) => ({
                    ...f,
                    amountNpr: e.target.value,
                  }))
                }
              />
            </FormField>
            <div className="sm:col-span-2">
              <FormField label="Notes">
                <Textarea
                  value={scholarshipForm.notes}
                  onChange={(e) =>
                    setScholarshipForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  rows={2}
                />
              </FormField>
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <Button
                type="button"
                disabled={scholarshipMutation.isPending}
                onClick={submitScholarship}
              >
                <Award className="mr-1.5 h-4 w-4" />
                {scholarshipMutation.isPending
                  ? "Saving…"
                  : "Record topper scholarship"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ─── Receipts ─── */}
      {tab === "receipts" ? (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">All fee receipts</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={exportExcel}>
              <FileDown className="mr-1 h-4 w-4" />
              Excel
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <FormField label="Search">
                <Input
                  placeholder="Student, receipt…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
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

            {filteredReceipts.length === 0 ? (
              <EmptyState
                title="No fee records"
                description="Record a payment to build the student fee history."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <tr>
                      <Th>Receipt</Th>
                      <Th>Student</Th>
                      <Th>Year</Th>
                      <Th>Category</Th>
                      <Th>Paid</Th>
                      <Th>Scholarship</Th>
                      <Th>Remaining</Th>
                      <Th>Date</Th>
                      <Th>Proof</Th>
                      <Th />
                    </tr>
                  </TableHead>
                  <TableBody>
                    {filteredReceipts.map((row) => {
                      const st = resolveStudent(row);
                      return (
                        <tr key={row._id}>
                          <Td className="font-mono text-sm">{row.receiptNumber}</Td>
                          <Td>
                            <div className="font-medium">{st.name}</div>
                            <div className="text-xs text-slate-500">
                              {st.admission}
                            </div>
                          </Td>
                          <Td className="text-sm">
                            {row.programYear
                              ? PROGRAM_YEARS.find((y) => y.value === row.programYear)
                                  ?.label ?? `Y${row.programYear}`
                              : "—"}
                          </Td>
                          <Td className="max-w-[120px] truncate text-sm">
                            {feeCategory(row)}
                          </Td>
                          <Td>{formatCurrencyNpr(row.amountPaidNpr)}</Td>
                          <Td>{formatCurrencyNpr(row.scholarshipNpr ?? 0)}</Td>
                          <Td>{formatCurrencyNpr(row.remainingDueNpr ?? 0)}</Td>
                          <Td>{row.paidDateBs}</Td>
                          <Td>
                            {(row.attachments?.length ?? 0) > 0 ? (
                              <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                                <FileText className="h-3.5 w-3.5" />
                                {row.attachments!.length}
                              </span>
                            ) : (
                              "—"
                            )}
                          </Td>
                          <Td>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => downloadReceipt(row._id)}
                            >
                              <Printer className="mr-1 h-3.5 w-3.5" />
                              Receipt
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
      ) : null}
    </div>
  );
};
