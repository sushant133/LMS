import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  EnhancedFeeCollectionRecord,
  StudentRecord,
} from "@phit-erp/shared";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
} from "@phit-erp/shared";
import {
  Pencil,
  Plus,
  Shield,
  Trash2,
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
import { useAuth } from "features/auth/AuthProvider";
import { api, unwrap } from "lib/api";
import { canManageInstitution, normalizeUserRole } from "lib/roles";
import { cn, formatCurrencyNpr, parseErrorMessage } from "lib/utils";
import {
  adDateToBsString,
  bsDateToAdString,
  formatDualDateCell,
  downloadRecordsExcel,
} from "./accountingUtils";
import { invalidateAccountingQueries } from "./invalidateAccountingQueries";

type PanelTab = "receipts" | "students" | "record";

type StudentPopulated = {
  _id?: string;
  admissionNumber?: string;
  user?: { fullName?: string };
  batchId?: string | { name?: string };
  yearId?: string | { name?: string };
  classId?: string | { name?: string };
  securityDepositExpectedNpr?: number;
  securityDepositNpr?: number;
  securityDepositRefundedNpr?: number;
  securityDepositWaived?: boolean;
};

const useCanEditFeePayments = (): boolean => {
  const { user } = useAuth();
  if (!user) return false;
  if (canManageInstitution(user.role)) return true;
  return (user.secondaryRoles ?? []).some((role) =>
    canManageInstitution(normalizeUserRole(role)),
  );
};

const resolveStudent = (row: EnhancedFeeCollectionRecord) => {
  const s = row.studentId as unknown as StudentPopulated | string;
  if (!s || typeof s === "string") {
    return {
      id: typeof s === "string" ? s : "",
      name: "—",
      admission: "—",
      batch: "—",
      year: "—",
    };
  }
  const batch = typeof s.batchId === "object" ? s.batchId?.name : undefined;
  const year = typeof s.yearId === "object" ? s.yearId?.name : undefined;
  const cls = typeof s.classId === "object" ? s.classId?.name : undefined;
  return {
    id: s._id ? String(s._id) : "",
    name: s.user?.fullName ?? "—",
    admission: s.admissionNumber ?? "—",
    batch: batch || cls || "—",
    year: year || "—",
  };
};

const DualDateCell = ({
  dateBs,
  dateAd,
}: {
  dateBs?: string | null;
  dateAd?: string | null;
}) => {
  const { primary, secondary } = formatDualDateCell({ dateBs, dateAd });
  return (
    <div className="whitespace-nowrap text-sm">
      <div className="font-medium text-slate-800">{primary}</div>
      {secondary ? (
        <div className="text-xs text-slate-500">{secondary}</div>
      ) : null}
    </div>
  );
};

const paymentMethodLabel = (method?: string) =>
  (method &&
    PAYMENT_METHOD_LABELS[method as keyof typeof PAYMENT_METHOD_LABELS]) ||
  method ||
  "—";

const emptyRecordForm = () => ({
  studentId: "",
  securityDepositPaidNpr: "",
  paidDateBs: "",
  paidDateAd: "",
  paymentMethod: "CASH" as (typeof PAYMENT_METHODS)[number],
  receivedByName: "",
  paidByName: "",
  notes: "",
});

export const SecurityDepositRecordsPanel = () => {
  const canAdminEdit = useCanEditFeePayments();
  const [tab, setTab] = useState<PanelTab>("receipts");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "ALL" | "PAID" | "PARTIAL" | "DUE" | "WAIVED"
  >("ALL");

  const [editingRow, setEditingRow] =
    useState<EnhancedFeeCollectionRecord | null>(null);
  const [editDeposit, setEditDeposit] = useState("");
  const [editDateBs, setEditDateBs] = useState("");
  const [editDateAd, setEditDateAd] = useState("");
  const [editMethod, setEditMethod] =
    useState<(typeof PAYMENT_METHODS)[number]>("CASH");
  const [editNotes, setEditNotes] = useState("");
  const [editFeePaid, setEditFeePaid] = useState("");

  const [recordForm, setRecordForm] = useState(emptyRecordForm);
  const [studentPickerSearch, setStudentPickerSearch] = useState("");

  const receiptsQuery = useQuery({
    queryKey: ["accounting-fee-records"],
    queryFn: () =>
      unwrap<EnhancedFeeCollectionRecord[]>(api.get("/accounting/receipts")),
  });

  const studentsQuery = useQuery({
    queryKey: ["students", "deposit-desk"],
    queryFn: () => unwrap<StudentRecord[]>(api.get("/students")),
  });

  const invalidate = async () => {
    await invalidateAccountingQueries();
  };

  const depositReceipts = useMemo(() => {
    const rows = (receiptsQuery.data ?? []).filter(
      (r) => (Number(r.securityDepositPaidNpr) || 0) > 0,
    );
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const st = resolveStudent(row);
      return (
        st.name.toLowerCase().includes(q) ||
        st.admission.toLowerCase().includes(q) ||
        (row.receiptNumber ?? "").toLowerCase().includes(q) ||
        (row.paidByName ?? "").toLowerCase().includes(q) ||
        (row.receivedByName ?? "").toLowerCase().includes(q)
      );
    });
  }, [receiptsQuery.data, search]);

  const totalDepositCollected = useMemo(
    () =>
      depositReceipts.reduce(
        (s, r) => s + (Number(r.securityDepositPaidNpr) || 0),
        0,
      ),
    [depositReceipts],
  );

  const studentDepositRows = useMemo(() => {
    const list = studentsQuery.data ?? [];
    const q = search.trim().toLowerCase();
    let rows = list.map((s) => {
      const expected = Number(s.securityDepositExpectedNpr) || 0;
      const held = Number(s.securityDepositNpr) || 0;
      const refunded = Number(s.securityDepositRefundedNpr) || 0;
      const waived = Boolean(s.securityDepositWaived);
      const stillDue = waived ? 0 : Math.max(0, expected - held);
      const remainingHeld = Math.max(0, held - refunded);
      let status: "PAID" | "PARTIAL" | "DUE" | "WAIVED" | "NONE" = "NONE";
      if (waived) status = "WAIVED";
      else if (expected <= 0 && held <= 0) status = "NONE";
      else if (stillDue <= 0.001 && held > 0) status = "PAID";
      else if (held > 0 && stillDue > 0.001) status = "PARTIAL";
      else if (stillDue > 0.001) status = "DUE";
      return {
        student: s,
        expected,
        held,
        refunded,
        stillDue,
        remainingHeld,
        waived,
        status,
      };
    });

    // Hide students with no deposit involvement unless searching
    rows = rows.filter(
      (r) =>
        r.expected > 0 ||
        r.held > 0 ||
        r.waived ||
        (q &&
          ((r.student.user?.fullName ?? "").toLowerCase().includes(q) ||
            (r.student.admissionNumber ?? "").toLowerCase().includes(q))),
    );

    if (statusFilter !== "ALL") {
      rows = rows.filter((r) => r.status === statusFilter);
    }
    if (q) {
      rows = rows.filter(
        (r) =>
          (r.student.user?.fullName ?? "").toLowerCase().includes(q) ||
          (r.student.admissionNumber ?? "").toLowerCase().includes(q),
      );
    }
    return rows.sort((a, b) => b.stillDue - a.stillDue || b.held - a.held);
  }, [studentsQuery.data, search, statusFilter]);

  const pickerStudents = useMemo(() => {
    const q = studentPickerSearch.trim().toLowerCase();
    const list = studentsQuery.data ?? [];
    if (!q) return list.slice(0, 40);
    return list
      .filter(
        (s) =>
          (s.user?.fullName ?? "").toLowerCase().includes(q) ||
          (s.admissionNumber ?? "").toLowerCase().includes(q),
      )
      .slice(0, 40);
  }, [studentsQuery.data, studentPickerSearch]);

  const selectedRecordStudent = useMemo(
    () =>
      (studentsQuery.data ?? []).find((s) => s._id === recordForm.studentId) ??
      null,
    [studentsQuery.data, recordForm.studentId],
  );

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Record<string, unknown>;
    }) => unwrap(api.put(`/accounting/collections/${id}`, body)),
    onSuccess: async () => {
      toast.success("Deposit receipt updated — student held amount recalculated");
      setEditingRow(null);
      await invalidate();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      unwrap(api.post(`/accounting/collections/${id}/reverse`, { reason })),
    onSuccess: async () => {
      toast.success("Deposit receipt deleted — accounts and held deposit updated");
      if (editingRow) setEditingRow(null);
      await invalidate();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const recordMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      unwrap(api.post("/accounting/collections", body)),
    onSuccess: async () => {
      toast.success("Security deposit recorded — held amount updated");
      setRecordForm(emptyRecordForm());
      setStudentPickerSearch("");
      await invalidate();
      setTab("receipts");
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const startEdit = (row: EnhancedFeeCollectionRecord) => {
    setEditingRow(row);
    setEditDeposit(String(row.securityDepositPaidNpr ?? 0));
    setEditFeePaid(String(row.amountPaidNpr ?? 0));
    const bs = row.paidDateBs ?? "";
    setEditDateBs(bs);
    setEditDateAd(
      row.paidDateAd?.trim() || (bs ? bsDateToAdString(bs) : ""),
    );
    setEditMethod(
      (row.paymentMethod as (typeof PAYMENT_METHODS)[number]) || "CASH",
    );
    setEditNotes(row.notes ?? "");
  };

  const submitEdit = () => {
    if (!editingRow) return;
    const deposit = Math.max(0, Number(editDeposit) || 0);
    const feePaid = Math.max(0, Number(editFeePaid) || 0);
    if (deposit <= 0 && feePaid <= 0) {
      toast.error("Deposit or fee paid must be greater than 0");
      return;
    }
    let paidDateBs = editDateBs.trim();
    let paidDateAd = editDateAd.trim();
    if (!paidDateBs && paidDateAd) paidDateBs = adDateToBsString(paidDateAd);
    if (!paidDateAd && paidDateBs) paidDateAd = bsDateToAdString(paidDateBs);
    if (!paidDateBs) {
      toast.error("Enter payment date");
      return;
    }
    updateMutation.mutate({
      id: editingRow._id,
      body: {
        securityDepositPaidNpr: deposit,
        amountPaidNpr: feePaid,
        paidDateBs,
        paidDateAd: paidDateAd || undefined,
        paymentMethod: editMethod,
        notes: editNotes.trim() || undefined,
      },
    });
  };

  const confirmDelete = (row: EnhancedFeeCollectionRecord) => {
    const st = resolveStudent(row);
    const reason = window.prompt(
      `Delete deposit receipt ${row.receiptNumber} for ${st.name}?\n\nDeposit: ${formatCurrencyNpr(row.securityDepositPaidNpr ?? 0)}\nThis reverses journal/cash book and reduces held deposit.\n\nReason:`,
      "Deposit entered by mistake",
    );
    if (reason === null) return;
    if (reason.trim().length < 3) {
      toast.error("Reason must be at least 3 characters");
      return;
    }
    deleteMutation.mutate({ id: row._id, reason: reason.trim() });
  };

  const submitRecord = () => {
    if (!recordForm.studentId) {
      toast.error("Select a student");
      return;
    }
    const deposit = Math.max(0, Number(recordForm.securityDepositPaidNpr) || 0);
    if (deposit <= 0) {
      toast.error("Enter the deposit amount received");
      return;
    }
    let paidDateBs = recordForm.paidDateBs.trim();
    let paidDateAd = recordForm.paidDateAd.trim();
    if (!paidDateBs && paidDateAd) paidDateBs = adDateToBsString(paidDateAd);
    if (!paidDateAd && paidDateBs) paidDateAd = bsDateToAdString(paidDateBs);
    if (!paidDateBs) {
      toast.error("Enter payment date");
      return;
    }
    if (selectedRecordStudent?.securityDepositWaived) {
      toast.error(
        "Security deposit was marked not taken for this student — clear that on the student profile first",
      );
      return;
    }
    recordMutation.mutate({
      studentId: recordForm.studentId,
      paidDateBs,
      paidDateAd: paidDateAd || undefined,
      programYear: 1,
      currentChargesNpr: 0,
      amountPaidNpr: 0,
      securityDepositPaidNpr: deposit,
      discountNpr: 0,
      scholarshipNpr: 0,
      lateFeeNpr: 0,
      paymentMethod: recordForm.paymentMethod,
      receivedByName: recordForm.receivedByName.trim() || undefined,
      paidByName: recordForm.paidByName.trim() || undefined,
      notes: recordForm.notes.trim() || undefined,
      feeBreakdown: [
        {
          feeType: "SECURITY_DEPOSIT",
          title: "Security / caution deposit",
          amountNpr: deposit,
        },
      ],
    });
  };

  const exportReceipts = () => {
    if (depositReceipts.length === 0) {
      toast.error("No deposit receipts to export");
      return;
    }
    downloadRecordsExcel(
      "Security_Deposit_Receipts",
      depositReceipts.map((row) => {
        const st = resolveStudent(row);
        return {
          receiptNumber: row.receiptNumber,
          studentName: st.name,
          admissionNumber: st.admission,
          batch: st.batch,
          year: st.year,
          depositPaidNpr: row.securityDepositPaidNpr ?? 0,
          feePaidNpr: row.amountPaidNpr ?? 0,
          paidDateBs: row.paidDateBs,
          paidDateAd: row.paidDateAd || bsDateToAdString(row.paidDateBs) || "",
          paymentMethod: paymentMethodLabel(row.paymentMethod),
          receivedByName: row.receivedByName ?? "",
          paidByName: row.paidByName ?? "",
          notes: row.notes ?? "",
        };
      }),
    );
    toast.success("Excel exported");
  };

  if (receiptsQuery.isLoading || studentsQuery.isLoading) {
    return <LoadingState />;
  }

  if (receiptsQuery.isError) {
    return (
      <EmptyState
        title="Could not load deposits"
        description="Try refreshing. You need Accounting read access."
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-violet-600" />
              Security deposits
            </CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              Check planned vs paid deposits, record collection, and edit or
              delete deposit receipts. Admission “to be deposited” is plan only —
              paid only when recorded here (or with a fee payment).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["receipts", "Deposit receipts", Wallet],
                ["students", "Student status", Shield],
                ["record", "Record deposit", Plus],
              ] as const
            ).map(([id, label, Icon]) => (
              <Button
                key={id}
                size="sm"
                variant={tab === id ? "default" : "secondary"}
                className={cn(tab === id && "bg-brand-600 hover:bg-brand-700")}
                onClick={() => setTab(id)}
              >
                <Icon className="mr-1.5 h-4 w-4" />
                {label}
              </Button>
            ))}
          </div>
        </CardHeader>
      </Card>

      {tab === "receipts" ? (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Deposit receipts</CardTitle>
              <p className="mt-1 text-sm text-slate-500">
                {depositReceipts.length} receipt
                {depositReceipts.length === 1 ? "" : "s"} · total collected{" "}
                {formatCurrencyNpr(totalDepositCollected)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="max-w-xs"
                placeholder="Search student, receipt, name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Button variant="outline" size="sm" onClick={exportReceipts}>
                Export Excel
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {editingRow ? (
              <div className="mb-6 rounded-xl border border-violet-200 bg-violet-50/50 p-4">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-900">
                      Edit deposit — {editingRow.receiptNumber}
                    </p>
                    <p className="text-sm text-slate-600">
                      {resolveStudent(editingRow).name} ·{" "}
                      {resolveStudent(editingRow).admission}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingRow(null)}
                  >
                    Cancel
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <FormField label="Deposit paid (NPR)">
                    <NumberInput
                      min={0}
                      value={editDeposit}
                      onChange={(e) => setEditDeposit(e.target.value)}
                    />
                  </FormField>
                  <FormField label="Fee paid on same receipt (NPR)">
                    <NumberInput
                      min={0}
                      value={editFeePaid}
                      onChange={(e) => setEditFeePaid(e.target.value)}
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Leave as-is if only deposit is changing
                    </p>
                  </FormField>
                  <FormField label="Payment method">
                    <Select
                      value={editMethod}
                      onChange={(e) =>
                        setEditMethod(
                          e.target.value as (typeof PAYMENT_METHODS)[number],
                        )
                      }
                    >
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {paymentMethodLabel(m)}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Date (BS)">
                    <NepaliDateField
                      value={editDateBs}
                      onChange={(v) => {
                        setEditDateBs(v);
                        setEditDateAd(v ? bsDateToAdString(v) : "");
                      }}
                    />
                  </FormField>
                  <FormField label="Date (AD)">
                    <Input
                      type="date"
                      value={editDateAd}
                      onChange={(e) => {
                        const v = e.target.value;
                        setEditDateAd(v);
                        setEditDateBs(v ? adDateToBsString(v) : "");
                      }}
                    />
                  </FormField>
                  <FormField label="Notes">
                    <Textarea
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      rows={2}
                    />
                  </FormField>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    onClick={submitEdit}
                    disabled={updateMutation.isPending || !canAdminEdit}
                  >
                    {updateMutation.isPending ? "Saving…" : "Save changes"}
                  </Button>
                  {canAdminEdit ? (
                    <Button
                      variant="destructive"
                      disabled={deleteMutation.isPending}
                      onClick={() => confirmDelete(editingRow)}
                    >
                      Delete receipt
                    </Button>
                  ) : null}
                  {!canAdminEdit ? (
                    <p className="text-xs text-amber-800">
                      Only college admin can edit or delete deposit receipts.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {depositReceipts.length === 0 ? (
              <EmptyState
                title="No deposit receipts yet"
                description="Record a security deposit under Record deposit, or include deposit when collecting fees."
              />
            ) : (
              <div className="max-w-full overflow-x-auto">
                <Table className="min-w-[960px]">
                  <TableHead>
                    <tr>
                      <Th>Receipt</Th>
                      <Th>Student</Th>
                      <Th>Batch / Year</Th>
                      <Th className="text-right">Deposit paid</Th>
                      <Th className="text-right">Fee on receipt</Th>
                      <Th>Method</Th>
                      <Th>Date</Th>
                      <Th>Received / Paid by</Th>
                      <Th className="text-right">Actions</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {depositReceipts.map((row) => {
                      const st = resolveStudent(row);
                      return (
                        <tr key={row._id}>
                          <Td className="font-mono text-sm">
                            {row.receiptNumber}
                          </Td>
                          <Td>
                            <div className="font-medium">{st.name}</div>
                            <div className="text-xs text-slate-500">
                              {st.admission}
                            </div>
                          </Td>
                          <Td className="text-sm whitespace-nowrap">
                            {st.batch}
                            {st.year !== "—" ? ` / ${st.year}` : ""}
                          </Td>
                          <Td className="text-right font-medium text-violet-800">
                            {formatCurrencyNpr(row.securityDepositPaidNpr ?? 0)}
                          </Td>
                          <Td className="text-right text-sm">
                            {(row.amountPaidNpr ?? 0) > 0
                              ? formatCurrencyNpr(row.amountPaidNpr)
                              : "—"}
                          </Td>
                          <Td className="text-sm whitespace-nowrap">
                            {paymentMethodLabel(row.paymentMethod)}
                          </Td>
                          <Td>
                            <DualDateCell
                              dateBs={row.paidDateBs}
                              dateAd={row.paidDateAd}
                            />
                          </Td>
                          <Td className="text-xs text-slate-600">
                            <div>{row.receivedByName?.trim() || "—"}</div>
                            <div>{row.paidByName?.trim() || "—"}</div>
                          </Td>
                          <Td className="text-right">
                            <div className="flex flex-wrap justify-end gap-1">
                              {canAdminEdit ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="default"
                                    onClick={() => startEdit(row)}
                                  >
                                    <Pencil className="mr-1 h-3.5 w-3.5" />
                                    Edit
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    disabled={deleteMutation.isPending}
                                    onClick={() => confirmDelete(row)}
                                  >
                                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                                    Delete
                                  </Button>
                                </>
                              ) : (
                                <span className="text-xs text-slate-400">
                                  View only
                                </span>
                              )}
                            </div>
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

      {tab === "students" ? (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Student deposit status</CardTitle>
              <p className="mt-1 text-sm text-slate-500">
                Plan (admission) vs paid (accounts). Use Record deposit to
                collect outstanding amounts.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                className="w-auto min-w-[140px]"
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(
                    e.target.value as typeof statusFilter,
                  )
                }
              >
                <option value="ALL">All statuses</option>
                <option value="DUE">Due (not paid)</option>
                <option value="PARTIAL">Partial</option>
                <option value="PAID">Fully paid</option>
                <option value="WAIVED">Waived</option>
              </Select>
              <Input
                className="max-w-xs"
                placeholder="Search student…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent>
            {studentDepositRows.length === 0 ? (
              <EmptyState
                title="No deposit plans found"
                description="Set deposit to be deposited when creating a student, then record collection here."
              />
            ) : (
              <div className="max-w-full overflow-x-auto">
                <Table className="min-w-[900px]">
                  <TableHead>
                    <tr>
                      <Th>Student</Th>
                      <Th className="text-right">Plan (to deposit)</Th>
                      <Th className="text-right">Paid / held</Th>
                      <Th className="text-right">Still due</Th>
                      <Th className="text-right">Refunded</Th>
                      <Th>Status</Th>
                      <Th className="text-right">Action</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {studentDepositRows.map((row) => {
                      const statusBadge =
                        row.status === "PAID"
                          ? "bg-emerald-100 text-emerald-800"
                          : row.status === "PARTIAL"
                            ? "bg-amber-100 text-amber-900"
                            : row.status === "DUE"
                              ? "bg-rose-100 text-rose-800"
                              : row.status === "WAIVED"
                                ? "bg-slate-100 text-slate-600"
                                : "bg-slate-50 text-slate-500";
                      return (
                        <tr key={row.student._id}>
                          <Td>
                            <div className="font-medium">
                              {row.student.user?.fullName ?? "—"}
                            </div>
                            <div className="text-xs text-slate-500">
                              {row.student.admissionNumber ?? "—"}
                            </div>
                          </Td>
                          <Td className="text-right">
                            {formatCurrencyNpr(row.expected)}
                          </Td>
                          <Td className="text-right font-medium text-violet-800">
                            {formatCurrencyNpr(row.held)}
                          </Td>
                          <Td className="text-right font-medium text-rose-700">
                            {formatCurrencyNpr(row.stillDue)}
                          </Td>
                          <Td className="text-right text-sm">
                            {row.refunded > 0
                              ? formatCurrencyNpr(row.refunded)
                              : "—"}
                          </Td>
                          <Td>
                            <Badge className={statusBadge}>
                              {row.status === "NONE"
                                ? "No plan"
                                : row.status.replace(/_/g, " ")}
                            </Badge>
                          </Td>
                          <Td className="text-right">
                            {row.stillDue > 0 && !row.waived ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  setRecordForm((f) => ({
                                    ...f,
                                    studentId: row.student._id,
                                    securityDepositPaidNpr: String(row.stillDue),
                                  }));
                                  setStudentPickerSearch(
                                    row.student.user?.fullName ??
                                      row.student.admissionNumber ??
                                      "",
                                  );
                                  setTab("record");
                                }}
                              >
                                Record due
                              </Button>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
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

      {tab === "record" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Record security deposit</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              Collect deposit only (no tuition). To collect fee + deposit
              together, use Student Fee Records → Record payment.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField label="Student">
              <Input
                placeholder="Search name or admission number…"
                value={studentPickerSearch}
                onChange={(e) => setStudentPickerSearch(e.target.value)}
              />
              <Select
                className="mt-2"
                value={recordForm.studentId}
                onChange={(e) =>
                  setRecordForm((f) => ({ ...f, studentId: e.target.value }))
                }
              >
                <option value="">Select student…</option>
                {pickerStudents.map((s) => {
                  const expected = Number(s.securityDepositExpectedNpr) || 0;
                  const held = Number(s.securityDepositNpr) || 0;
                  const due = Math.max(0, expected - held);
                  return (
                    <option key={s._id} value={s._id}>
                      {s.user?.fullName ?? "Student"} ({s.admissionNumber})
                      {due > 0
                        ? ` — due ${due.toLocaleString("en-NP")}`
                        : held > 0
                          ? ` — held ${held.toLocaleString("en-NP")}`
                          : expected > 0
                            ? ` — plan ${expected.toLocaleString("en-NP")}`
                            : ""}
                    </option>
                  );
                })}
              </Select>
              {selectedRecordStudent ? (
                <p className="mt-2 text-xs text-slate-600">
                  Plan{" "}
                  {formatCurrencyNpr(
                    selectedRecordStudent.securityDepositExpectedNpr ?? 0,
                  )}{" "}
                  · Held{" "}
                  {formatCurrencyNpr(
                    selectedRecordStudent.securityDepositNpr ?? 0,
                  )}{" "}
                  · Still due{" "}
                  {formatCurrencyNpr(
                    Math.max(
                      0,
                      (selectedRecordStudent.securityDepositExpectedNpr ?? 0) -
                        (selectedRecordStudent.securityDepositNpr ?? 0),
                    ),
                  )}
                </p>
              ) : null}
            </FormField>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <FormField label="Deposit amount received (NPR)">
                <NumberInput
                  min={0}
                  value={recordForm.securityDepositPaidNpr}
                  onChange={(e) =>
                    setRecordForm((f) => ({
                      ...f,
                      securityDepositPaidNpr: e.target.value,
                    }))
                  }
                  placeholder="Amount actually collected"
                />
              </FormField>
              <FormField label="Payment method">
                <Select
                  value={recordForm.paymentMethod}
                  onChange={(e) =>
                    setRecordForm((f) => ({
                      ...f,
                      paymentMethod: e.target
                        .value as (typeof PAYMENT_METHODS)[number],
                    }))
                  }
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {paymentMethodLabel(m)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Date (BS)">
                <NepaliDateField
                  value={recordForm.paidDateBs}
                  onChange={(v) =>
                    setRecordForm((f) => ({
                      ...f,
                      paidDateBs: v,
                      paidDateAd: v ? bsDateToAdString(v) : "",
                    }))
                  }
                />
              </FormField>
              <FormField label="Date (AD)">
                <Input
                  type="date"
                  value={recordForm.paidDateAd}
                  onChange={(e) => {
                    const v = e.target.value;
                    setRecordForm((f) => ({
                      ...f,
                      paidDateAd: v,
                      paidDateBs: v ? adDateToBsString(v) : "",
                    }));
                  }}
                />
              </FormField>
              <FormField label="Received by">
                <Input
                  value={recordForm.receivedByName}
                  onChange={(e) =>
                    setRecordForm((f) => ({
                      ...f,
                      receivedByName: e.target.value,
                    }))
                  }
                  placeholder="Staff who received cash / voucher"
                />
              </FormField>
              <FormField label="Paid by">
                <Input
                  value={recordForm.paidByName}
                  onChange={(e) =>
                    setRecordForm((f) => ({
                      ...f,
                      paidByName: e.target.value,
                    }))
                  }
                  placeholder="Person who paid"
                />
              </FormField>
              <div className="sm:col-span-2">
                <FormField label="Notes">
                  <Textarea
                    value={recordForm.notes}
                    onChange={(e) =>
                      setRecordForm((f) => ({ ...f, notes: e.target.value }))
                    }
                    rows={2}
                  />
                </FormField>
              </div>
            </div>

            <Button
              onClick={submitRecord}
              disabled={recordMutation.isPending}
            >
              {recordMutation.isPending
                ? "Saving…"
                : "Record security deposit"}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};
