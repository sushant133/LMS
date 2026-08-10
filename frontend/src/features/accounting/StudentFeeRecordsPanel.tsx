import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BatchRecord,
  EnhancedFeeCollectionRecord,
  ExtendedFeeStructureInput,
  ProgramYearFeeSummary,
  StudentAccountSummary,
  StudentFinancialHistory,
  StudentRecord,
  StudentScholarshipAwardRecord,
  YearRecord,
} from "@phit-erp/shared";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHODS_WITH_HANDOVER,
} from "@phit-erp/shared";
import {
  Award,
  ChevronLeft,
  ChevronRight,
  FileDown,
  FileText,
  Paperclip,
  Pencil,
  Plus,
  Printer,
  Receipt,
  Trash2,
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
import { useAuth } from "features/auth/AuthProvider";
import { api, resolveApiUrl, unwrap } from "lib/api";
import {
  buildPrintInstitutionHeaderHtml,
  getPrintInstitutionBranding,
  PRINT_INSTITUTION_HEADER_CSS,
} from "lib/printBranding";
import { canManageInstitution, normalizeUserRole } from "lib/roles";
import { formatCurrencyNpr, parseErrorMessage } from "lib/utils";
import {
  adDateToBsString,
  bsDateToAdString,
  downloadRecordsExcel,
  formatDualDateCell,
} from "./accountingUtils";
import { printHtmlViaIframe } from "./voucherPrint";

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

/** Exam options for merit scholarship (no 3rd year final as basis). */
const TOPPED_EXAM_OPTIONS = [
  { value: 0, label: "Entrance" },
  { value: 1, label: "1st Year" },
  { value: 2, label: "2nd Year" },
] as const;

const defaultCoversFromTopped = (topped: number): number => {
  if (topped === 0) return 1;
  if (topped === 1) return 2;
  if (topped === 2) return 3;
  return Math.min(3, topped + 1);
};

const toppedExamLabel = (value: number): string =>
  TOPPED_EXAM_OPTIONS.find((o) => o.value === value)?.label ??
  PROGRAM_YEARS.find((y) => y.value === value)?.label ??
  `Year ${value}`;

const coversYearLabel = (value: number): string =>
  PROGRAM_YEARS.find((y) => y.value === value)?.label ?? `Year ${value}`;

const emptyScholarshipForm = () => ({
  studentId: "",
  toppedProgramYear: "0",
  coversProgramYear: "1",
  examName: "Entrance",
  rank: "1",
  amountNpr: "0",
  notes: "",
});

const scholarshipStudentMeta = (award: StudentScholarshipAwardRecord) => {
  const s = award.studentId;
  if (!s || typeof s === "string") {
    return { name: "—", admission: "—", batch: "—", year: "—" };
  }
  const batch =
    typeof s.batchId === "object" && s.batchId ? s.batchId.name : undefined;
  const year =
    typeof s.yearId === "object" && s.yearId ? s.yearId.name : undefined;
  return {
    name: s.user?.fullName ?? "—",
    admission: s.admissionNumber ?? "—",
    batch: batch || "—",
    year: year || "—",
  };
};

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
  paidDateAd: "",
  currentChargesNpr: "",
  amountPaidNpr: "",
  /** Security / caution deposit collected with this payment (0 = none) */
  securityDepositPaidNpr: "0",
  discountNpr: "0",
  scholarshipNpr: "0",
  paymentMethod: "CASH" as (typeof PAYMENT_METHODS)[number],
  transactionNumber: "",
  receivedByName: "",
  paidByName: "",
  notes: "",
  scholarshipType: "NONE" as "NONE" | "TOPPER_YEAR_WAIVER" | "MERIT" | "OTHER",
  scholarshipAwardId: "",
});

const paymentMethodNeedsHandover = (
  method: (typeof PAYMENT_METHODS)[number],
): boolean =>
  (PAYMENT_METHODS_WITH_HANDOVER as readonly string[]).includes(method);

const paymentMethodLabel = (method: string): string =>
  PAYMENT_METHOD_LABELS[method as (typeof PAYMENT_METHODS)[number]] ??
  method.replace(/_/g, " ");

/** Dual-calendar payment date cell for fee tables. */
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

const resolveCollectionStudentId = (
  row: EnhancedFeeCollectionRecord,
): string => {
  const s = row.studentId as unknown;
  if (!s) return "";
  if (typeof s === "string") return s;
  if (typeof s === "object" && s && "_id" in s) {
    return String((s as { _id: unknown })._id);
  }
  return String(s);
};

/**
 * Super Admin / College Admin only may edit/delete fee payments.
 * Checks primary + secondary roles (normalized, case-safe).
 */
const useCanEditFeePayments = (): boolean => {
  const { user } = useAuth();
  if (!user) return false;
  const roles = [user.role, ...(user.secondaryRoles ?? [])].filter(Boolean);
  return roles.some((role) => canManageInstitution(normalizeUserRole(String(role))));
};

/**
 * Desktop-contained horizontal scroll for All receipts.
 * Fits inside main content only (no page-wide overflow). Student + Actions
 * stay pinned so each row’s student details stay readable while scrolling.
 */
const ReceiptsTableScroll = ({
  children,
}: {
  children: ReactNode;
}) => {
  const topRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [contentWidth, setContentWidth] = useState(0);
  const [needsHScroll, setNeedsHScroll] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    const overflow = scrollWidth > clientWidth + 2;
    setNeedsHScroll(overflow);
    setCanScrollLeft(overflow && scrollLeft > 2);
    setCanScrollRight(overflow && scrollLeft + clientWidth < scrollWidth - 2);
    setContentWidth(scrollWidth);
  }, []);

  const syncFrom = useCallback(
    (source: "top" | "body" | "bottom", left: number) => {
      if (syncing.current) return;
      syncing.current = true;
      if (source !== "top" && topRef.current) topRef.current.scrollLeft = left;
      if (source !== "body" && bodyRef.current) bodyRef.current.scrollLeft = left;
      if (source !== "bottom" && bottomRef.current) {
        bottomRef.current.scrollLeft = left;
      }
      requestAnimationFrame(() => {
        syncing.current = false;
        updateScrollState();
      });
    },
    [updateScrollState],
  );

  const scrollByDir = (dir: -1 | 1) => {
    const el = bodyRef.current;
    if (!el) return;
    const step = Math.max(180, Math.floor(el.clientWidth * 0.5));
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  };

  useEffect(() => {
    updateScrollState();
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => updateScrollState());
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    window.addEventListener("resize", updateScrollState);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateScrollState);
    };
  }, [updateScrollState, children]);

  const spacerStyle = {
    width: contentWidth > 0 ? `${contentWidth}px` : "100%",
  };

  return (
    /* min-w-0 + max-w-full: stay inside desktop main panel only */
    <div className="w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-slate-200 bg-white">
      {/* Left/right controls — desktop only */}
      <div className="hidden items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/90 px-3 py-2 md:flex">
        <p className="text-xs text-slate-500">
          {needsHScroll
            ? "Use ← → or the sliders to see more columns. Student name stays fixed on the left."
            : "All columns fit on this screen."}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0"
            disabled={!canScrollLeft}
            onClick={() => scrollByDir(-1)}
            title="Scroll left"
            aria-label="Scroll table left"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0"
            disabled={!canScrollRight}
            onClick={() => scrollByDir(1)}
            title="Scroll right"
            aria-label="Scroll table right"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Top horizontal slider — desktop only */}
      <div
        ref={topRef}
        className="hidden overflow-x-auto overflow-y-hidden border-b border-slate-100 [scrollbar-width:thin] md:block"
        onScroll={(e) => syncFrom("top", e.currentTarget.scrollLeft)}
      >
        <div className="h-3" style={spacerStyle} />
      </div>

      {/* Scrollport locked to parent width on desktop */}
      <div
        ref={bodyRef}
        className="max-h-[min(70vh,720px)] w-full min-w-0 max-w-full overflow-auto overscroll-contain [scrollbar-width:thin]"
        onScroll={(e) => {
          syncFrom("body", e.currentTarget.scrollLeft);
          updateScrollState();
        }}
      >
        <div className="w-max min-w-full">{children}</div>
      </div>

      {/* Bottom horizontal slider — desktop only */}
      <div
        ref={bottomRef}
        className="hidden overflow-x-auto overflow-y-hidden border-t border-slate-100 [scrollbar-width:thin] md:block"
        onScroll={(e) => syncFrom("bottom", e.currentTarget.scrollLeft)}
      >
        <div className="h-3" style={spacerStyle} />
      </div>
    </div>
  );
};

export const StudentFeeRecordsPanel = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  /** Logged-in staff name (accountant / college admin / admin) — auto “Received by”. */
  const currentUserName = user?.fullName?.trim() || "";
  /** Super Admin / College Admin only — edit amount paid / delete mistaken receipts */
  const canAdminEdit = useCanEditFeePayments();
  const [tab, setTab] = useState<PanelTab>("ledger");
  const [search, setSearch] = useState("");
  /** Ledger filters */
  const [ledgerBatchId, setLedgerBatchId] = useState("");
  const [ledgerYearId, setLedgerYearId] = useState("");
  /** Record / scholarship student picker filters */
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerBatchId, setPickerBatchId] = useState("");
  const [pickerYearId, setPickerYearId] = useState("");
  /** All receipts filters */
  const [receiptSearch, setReceiptSearch] = useState("");
  const [receiptBatchId, setReceiptBatchId] = useState("");
  const [receiptYearId, setReceiptYearId] = useState("");
  const [method, setMethod] = useState("");
  const [receiptFromBs, setReceiptFromBs] = useState("");
  const [receiptFromAd, setReceiptFromAd] = useState("");
  const [receiptToBs, setReceiptToBs] = useState("");
  const [receiptToAd, setReceiptToAd] = useState("");
  const [printingReceiptId, setPrintingReceiptId] = useState<string | null>(null);
  /** Bulk table print of All receipts (not individual PDFs). */
  const [printingBulkList, setPrintingBulkList] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);
  const [attachments, setAttachments] = useState<FeeAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  /** Super Admin / College Admin: edit existing fee receipt */
  const [editingReceipt, setEditingReceipt] =
    useState<EnhancedFeeCollectionRecord | null>(null);
  const [scholarshipForm, setScholarshipForm] = useState(emptyScholarshipForm);
  const [editingScholarship, setEditingScholarship] =
    useState<StudentScholarshipAwardRecord | null>(null);

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

  const scholarshipsQuery = useQuery({
    queryKey: ["accounting-scholarships"],
    queryFn: () =>
      unwrap<StudentScholarshipAwardRecord[]>(api.get("/accounting/scholarships")),
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
    queryKey: ["students", "fee-picker", "login-active"],
    queryFn: () =>
      unwrap<StudentRecord[]>(
        api.get("/students", { params: { loginActive: "1" } }),
      ),
  });

  const batchesQuery = useQuery({
    queryKey: ["batches"],
    queryFn: () => unwrap<BatchRecord[]>(api.get("/academics/batches")),
  });

  const yearsQuery = useQuery({
    queryKey: ["years"],
    queryFn: () => unwrap<YearRecord[]>(api.get("/academics/years")),
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
    const { invalidateAccountingQueries } = await import(
      "./invalidateAccountingQueries"
    );
    await invalidateAccountingQueries();
  };

  const collectMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      unwrap(api.post("/accounting/collections", body)),
    onSuccess: async () => {
      toast.success(
        "Payment recorded — fee balance and security deposit (if any) updated",
      );
      setPaymentForm(emptyPaymentForm());
      setAttachments([]);
      setEditingReceipt(null);
      await invalidate();
      setTab("ledger");
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const updateCollectionMutation = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Record<string, unknown>;
    }) => unwrap(api.put(`/accounting/collections/${id}`, body)),
    onSuccess: async () => {
      toast.success(
        "Payment updated — journal, cash book, and student balance corrected",
      );
      setPaymentForm(emptyPaymentForm());
      setAttachments([]);
      setEditingReceipt(null);
      await invalidate();
      setTab("receipts");
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const deleteCollectionMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      unwrap(api.post(`/accounting/collections/${id}/reverse`, { reason })),
    onSuccess: async () => {
      toast.success(
        "Payment deleted — accounts and student profile balance updated",
      );
      if (editingReceipt) {
        setEditingReceipt(null);
        setPaymentForm(emptyPaymentForm());
        setAttachments([]);
      }
      await invalidate();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const startEditReceipt = (row: EnhancedFeeCollectionRecord) => {
    const studentId = resolveCollectionStudentId(row);
    const paidDateBs = row.paidDateBs ?? "";
    const paidDateAd =
      row.paidDateAd?.trim() ||
      (paidDateBs ? bsDateToAdString(paidDateBs) : "");
    setEditingReceipt(row);
    setSelectedStudentId(studentId);
    const depositPaid = Number(row.securityDepositPaidNpr ?? 0) || 0;
    setPaymentForm({
      studentId,
      programYear: String(row.programYear ?? 1),
      feeStructureId: row.feeStructureId
        ? String(row.feeStructureId)
        : "",
      paidDateBs,
      paidDateAd,
      currentChargesNpr: String(row.currentChargesNpr ?? 0),
      amountPaidNpr: String(row.amountPaidNpr ?? 0),
      securityDepositPaidNpr: String(depositPaid),
      discountNpr: String(row.discountNpr ?? 0),
      scholarshipNpr: String(row.scholarshipNpr ?? 0),
      paymentMethod:
        (row.paymentMethod as (typeof PAYMENT_METHODS)[number]) || "CASH",
      transactionNumber: row.transactionNumber ?? "",
      receivedByName: row.receivedByName ?? "",
      paidByName: row.paidByName ?? "",
      notes: row.notes ?? "",
      scholarshipType:
        (row.scholarshipType as
          | "NONE"
          | "TOPPER_YEAR_WAIVER"
          | "MERIT"
          | "OTHER") || "NONE",
      scholarshipAwardId: "",
    });
    setAttachments(
      (row.attachments ?? []).map((a) => ({
        name: a.name,
        url: a.url,
        mimeType: a.mimeType,
        size: a.size,
        kind: a.kind,
      })),
    );
    setTab("record");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEditReceipt = () => {
    setEditingReceipt(null);
    setPaymentForm(emptyPaymentForm());
    setAttachments([]);
    setSelectedStudentId("");
  };

  const confirmDeleteReceipt = (row: EnhancedFeeCollectionRecord) => {
    const st = resolveStudent(row);
    const reason = window.prompt(
      `Delete fee receipt ${row.receiptNumber} for ${st.name}?\n\nThis reverses journal, cash book, and updates the student balance.\n\nEnter reason for audit:`,
      "Entered by mistake",
    );
    if (reason === null) return;
    if (reason.trim().length < 3) {
      toast.error("Reason must be at least 3 characters");
      return;
    }
    deleteCollectionMutation.mutate({ id: row._id, reason: reason.trim() });
  };

  const scholarshipMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editingScholarship
        ? unwrap(api.put(`/accounting/scholarships/${editingScholarship._id}`, body))
        : unwrap(api.post("/accounting/scholarships", body)),
    onSuccess: async () => {
      toast.success(
        editingScholarship
          ? "Scholarship updated — student fee ledger refreshed"
          : "Merit scholarship recorded",
      );
      setScholarshipForm(emptyScholarshipForm());
      setEditingScholarship(null);
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: ["accounting-scholarships"] });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const revokeScholarshipMutation = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.post(`/accounting/scholarships/${id}/revoke`)),
    onSuccess: async () => {
      toast.success("Scholarship revoked — student dues restored");
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: ["accounting-scholarships"] });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const deleteScholarshipMutation = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.delete(`/accounting/scholarships/${id}`)),
    onSuccess: async () => {
      toast.success("Scholarship deleted");
      if (editingScholarship) {
        setEditingScholarship(null);
        setScholarshipForm(emptyScholarshipForm());
      }
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: ["accounting-scholarships"] });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const startEditScholarship = (award: StudentScholarshipAwardRecord) => {
    const studentId =
      typeof award.studentId === "string"
        ? award.studentId
        : award.studentId?._id ?? "";
    const topped = Number(award.toppedProgramYear);
    setEditingScholarship(award);
    setScholarshipForm({
      studentId,
      toppedProgramYear: String(topped),
      coversProgramYear: String(
        award.coversProgramYear ?? defaultCoversFromTopped(topped),
      ),
      examName:
        award.examName ||
        (topped === 0 ? "Entrance" : "Final Examination"),
      rank: String(award.rank ?? 1),
      amountNpr: String(award.amountNpr ?? 0),
      notes: award.notes ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEditScholarship = () => {
    setEditingScholarship(null);
    setScholarshipForm(emptyScholarshipForm());
  };

  const students = studentsQuery.data ?? [];
  const accounts = accountsQuery.data ?? [];
  const batches = batchesQuery.data ?? [];
  const years = yearsQuery.data ?? [];

  const yearsForLedgerBatch = useMemo(() => {
    if (!ledgerBatchId) return years;
    return years.filter((y) => y.batchId === ledgerBatchId);
  }, [years, ledgerBatchId]);

  const yearsForPickerBatch = useMemo(() => {
    if (!pickerBatchId) return years;
    return years.filter((y) => y.batchId === pickerBatchId);
  }, [years, pickerBatchId]);

  const yearsForReceiptBatch = useMemo(() => {
    if (!receiptBatchId) return years;
    return years.filter((y) => y.batchId === receiptBatchId);
  }, [years, receiptBatchId]);

  const asId = (value: unknown): string => {
    if (value == null) return "";
    if (typeof value === "object" && value && "_id" in value) {
      return String((value as { _id: unknown })._id);
    }
    return String(value);
  };

  const studentMatchesGroup = (
    student: { batchId?: unknown; yearId?: unknown } | undefined,
    batchId: string,
    yearId: string,
  ) => {
    if (!student) return !batchId && !yearId;
    if (batchId && asId(student.batchId) !== batchId) return false;
    if (yearId && asId(student.yearId) !== yearId) return false;
    return true;
  };

  const filteredAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter((a) => {
      if (!studentMatchesGroup(a.student, ledgerBatchId, ledgerYearId)) {
        return false;
      }
      if (!q) return true;
      const name = a.student?.user?.fullName?.toLowerCase() ?? "";
      const adm = a.student?.admissionNumber?.toLowerCase() ?? "";
      const batchName = (a.className ?? "").toLowerCase();
      const yearName = (a.sectionName ?? "").toLowerCase();
      return (
        name.includes(q) ||
        adm.includes(q) ||
        batchName.includes(q) ||
        yearName.includes(q)
      );
    });
  }, [accounts, search, ledgerBatchId, ledgerYearId]);

  /** Students available in payment / scholarship pickers after search + batch+year filter */
  const pickerStudents = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    return students.filter((s) => {
      if (!studentMatchesGroup(s, pickerBatchId, pickerYearId)) return false;
      if (!q) return true;
      const name = s.user?.fullName?.toLowerCase() ?? "";
      const adm = s.admissionNumber?.toLowerCase() ?? "";
      const reg = s.registrationNumber?.toLowerCase() ?? "";
      const phone = s.user?.phone?.toLowerCase() ?? "";
      const email = s.user?.email?.toLowerCase() ?? "";
      return (
        name.includes(q) ||
        adm.includes(q) ||
        reg.includes(q) ||
        phone.includes(q) ||
        email.includes(q)
      );
    });
  }, [students, pickerBatchId, pickerYearId, pickerSearch]);

  const filteredReceipts = useMemo(() => {
    let rows = receiptsQuery.data ?? [];
    if (receiptBatchId || receiptYearId) {
      rows = rows.filter((row) => {
        const s = row.studentId as unknown as
          | { batchId?: unknown; yearId?: unknown }
          | string
          | null;
        if (!s || typeof s === "string") {
          return !receiptBatchId && !receiptYearId;
        }
        return studentMatchesGroup(s, receiptBatchId, receiptYearId);
      });
    }
    const q = receiptSearch.trim().toLowerCase();
    if (q) {
      rows = rows.filter((row) => {
        const st = resolveStudent(row);
        return (
          st.name.toLowerCase().includes(q) ||
          st.admission.toLowerCase().includes(q) ||
          st.batch.toLowerCase().includes(q) ||
          st.year.toLowerCase().includes(q) ||
          row.receiptNumber.toLowerCase().includes(q) ||
          (row.transactionNumber ?? "").toLowerCase().includes(q)
        );
      });
    }
    if (method) rows = rows.filter((r) => r.paymentMethod === method);
    // Date filters use BS (source of truth); AD inputs sync into BS fields
    if (receiptFromBs) {
      rows = rows.filter((r) => r.paidDateBs >= receiptFromBs);
    }
    if (receiptToBs) {
      rows = rows.filter((r) => r.paidDateBs <= receiptToBs);
    }
    return rows;
  }, [
    receiptsQuery.data,
    receiptSearch,
    receiptBatchId,
    receiptYearId,
    method,
    receiptFromBs,
    receiptToBs,
  ]);

  const clearLedgerFilters = () => {
    setSearch("");
    setLedgerBatchId("");
    setLedgerYearId("");
  };

  const clearPickerFilters = () => {
    setPickerSearch("");
    setPickerBatchId("");
    setPickerYearId("");
  };

  const clearReceiptFilters = () => {
    setReceiptSearch("");
    setReceiptBatchId("");
    setReceiptYearId("");
    setMethod("");
    setReceiptFromBs("");
    setReceiptFromAd("");
    setReceiptToBs("");
    setReceiptToAd("");
  };

  const hasReceiptFilters = Boolean(
    receiptSearch ||
      receiptBatchId ||
      receiptYearId ||
      method ||
      receiptFromBs ||
      receiptToBs,
  );

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

  const buildPaymentPayload = () => {
    if (!paymentForm.studentId) {
      toast.error("Select a student");
      return null;
    }
    let paidDateBs = paymentForm.paidDateBs.trim();
    let paidDateAd = paymentForm.paidDateAd.trim();
    if (!paidDateBs && paidDateAd) {
      paidDateBs = adDateToBsString(paidDateAd);
    }
    if (!paidDateAd && paidDateBs) {
      paidDateAd = bsDateToAdString(paidDateBs);
    }
    if (!paidDateBs && !paidDateAd) {
      toast.error("Enter payment date (BS or AD)");
      return null;
    }
    if (!paidDateBs) {
      toast.error("Could not convert AD date to BS — check the AD date");
      return null;
    }
    const amountPaid = Number(paymentForm.amountPaidNpr);
    const charges = Number(paymentForm.currentChargesNpr);
    // Security deposits are recorded in Security Deposit Records — not here.
    // When editing an older receipt that had a deposit line, preserve it.
    const depositPaid = editingReceipt
      ? Math.max(0, Number(editingReceipt.securityDepositPaidNpr) || 0)
      : 0;
    if (!Number.isFinite(amountPaid) || amountPaid < 0) {
      toast.error("Enter a valid amount paid (0 allowed for full scholarship)");
      return null;
    }
    if (amountPaid <= 0 && !(Number(paymentForm.scholarshipNpr) > 0)) {
      toast.error("Enter fee amount paid (or apply scholarship)");
      return null;
    }
    const feeBreakdown: Array<{
      feeType: string;
      title: string;
      amountNpr: number;
    }> = [];
    if (charges > 0) {
      feeBreakdown.push({
        feeType: "TUITION",
        title: `${PROGRAM_YEARS.find((y) => String(y.value) === paymentForm.programYear)?.label ?? "Year"} tuition / program fee`,
        amountNpr: charges,
      });
    }
    if (depositPaid > 0) {
      feeBreakdown.push({
        feeType: "SECURITY_DEPOSIT",
        title: "Security / caution deposit",
        amountNpr: depositPaid,
      });
    }
    return {
      studentId: paymentForm.studentId,
      feeStructureId: paymentForm.feeStructureId || undefined,
      paidDateBs,
      paidDateAd: paidDateAd || undefined,
      programYear: Number(paymentForm.programYear),
      currentChargesNpr: Number.isFinite(charges) ? charges : 0,
      amountPaidNpr: amountPaid,
      securityDepositPaidNpr: depositPaid,
      discountNpr: Number(paymentForm.discountNpr) || 0,
      scholarshipNpr: Number(paymentForm.scholarshipNpr) || 0,
      lateFeeNpr: 0,
      paymentMethod: paymentForm.paymentMethod,
      transactionNumber: paymentForm.transactionNumber || undefined,
      // Always the person recording this entry (not manual). Backend also enforces this on create.
      receivedByName:
        (editingReceipt
          ? paymentForm.receivedByName.trim() || currentUserName
          : currentUserName) || undefined,
      paidByName: paymentForm.paidByName.trim() || undefined,
      notes: paymentForm.notes || undefined,
      scholarshipType: paymentForm.scholarshipType,
      scholarshipAwardId: paymentForm.scholarshipAwardId || undefined,
      attachments,
      feeBreakdown,
    };
  };

  const submitPayment = () => {
    const body = buildPaymentPayload();
    if (!body) return;
    if (editingReceipt) {
      updateCollectionMutation.mutate({ id: editingReceipt._id, body });
      return;
    }
    collectMutation.mutate(body);
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

  const scholarshipAwards = scholarshipsQuery.data ?? [];
  const activeScholarshipAwards = useMemo(
    () =>
      scholarshipAwards.filter(
        (a) => a.status === "ACTIVE" || a.status === "APPLIED",
      ),
    [scholarshipAwards],
  );

  /** Super Admin / College Admin only — open single receipt PDF. */
  const downloadReceiptPdf = async (
    id: string,
    receiptNumber?: string,
    options?: { silent?: boolean },
  ): Promise<void> => {
    if (!canAdminEdit) {
      toast.error("Only college admin or super admin can print receipts");
      return;
    }
    setPrintingReceiptId(id);
    try {
      const response = await api.get(`/accounting/collections/${id}/receipt`, {
        responseType: "blob",
        headers: { Accept: "application/pdf" },
        timeout: 120_000,
      });
      const raw = response.data as Blob;
      const headerType = String(response.headers["content-type"] ?? "");
      const contentType = `${headerType} ${raw.type || ""}`.toLowerCase();

      // API errors often arrive as JSON with responseType: blob
      if (
        contentType.includes("json") ||
        contentType.includes("application/problem")
      ) {
        const text = await raw.text();
        let message = "Could not open receipt PDF";
        try {
          const parsed = JSON.parse(text) as {
            message?: string;
            error?: string;
          };
          message = parsed.message || parsed.error || message;
        } catch {
          if (text.trim()) message = text.slice(0, 200);
        }
        throw new Error(message);
      }

      const blob =
        contentType.includes("pdf") || raw.type === "application/pdf"
          ? raw
          : new Blob([raw], { type: "application/pdf" });
      if (!blob.size) {
        throw new Error("Receipt PDF was empty");
      }

      const url = URL.createObjectURL(blob);
      const filename = `${(receiptNumber || id).replace(/[^\w.-]+/g, "_")}-receipt.pdf`;

      // Download file (always works)
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();

      // Open for print when not in bulk mode
      if (!options?.silent) {
        const opened = window.open(url, "_blank");
        if (opened) {
          toast.success("Receipt PDF opened — use browser Print if needed");
        } else {
          toast.success("Receipt PDF downloaded");
        }
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } catch (e) {
      // Blob error body from axios
      if (typeof e === "object" && e && "response" in e) {
        const data = (e as { response?: { data?: unknown } }).response?.data;
        if (data instanceof Blob) {
          try {
            const text = await data.text();
            const parsed = JSON.parse(text) as {
              message?: string;
              error?: string;
            };
            throw new Error(
              parsed.message || parsed.error || "Could not open receipt PDF",
            );
          } catch (inner) {
            if (inner instanceof Error && inner.message !== "Could not open receipt PDF") {
              throw inner;
            }
          }
        }
      }
      toast.error(
        e instanceof Error
          ? e.message
          : parseErrorMessage(e) || "Could not open receipt PDF",
      );
    } finally {
      setPrintingReceiptId(null);
    }
  };

  /**
   * Bulk print of All receipts as one landscape table (not individual PDFs).
   * Use each row’s Print button for a single official receipt PDF.
   */
  const printAllFilteredReceipts = () => {
    if (!canAdminEdit) {
      toast.error("Only college admin or super admin can print receipts");
      return;
    }
    if (filteredReceipts.length === 0) {
      toast.error("No receipts to print");
      return;
    }

    setPrintingBulkList(true);
    try {
      const escapeHtml = (value: string) =>
        value
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");

      /** Compact money for narrow print columns (header already says NPR). */
      const money = (amount: number): string =>
        new Intl.NumberFormat("en-NP", {
          maximumFractionDigits: 2,
          minimumFractionDigits: 2,
        }).format(amount);

      const batchName =
        batches.find((b) => b._id === receiptBatchId)?.name?.trim() || "";
      const yearName =
        years.find((y) => y._id === receiptYearId)?.name?.trim() || "";

      const filterBits: string[] = [];
      if (batchName) filterBits.push(`Batch: ${batchName}`);
      if (yearName) filterBits.push(`Year: ${yearName}`);
      if (method) filterBits.push(`Method: ${paymentMethodLabel(method)}`);
      if (receiptSearch.trim()) {
        filterBits.push(`Search: “${receiptSearch.trim()}”`);
      }
      if (receiptFromBs || receiptToBs) {
        filterBits.push(
          `Date: ${receiptFromBs || "…"} → ${receiptToBs || "…"}`,
        );
      }

      let totalFeePaid = 0;
      let totalDeposit = 0;
      let totalScholarship = 0;
      let totalRemaining = 0;

      const rowsHtml = filteredReceipts
        .map((row, index) => {
          const st = resolveStudent(row);
          const dual = formatDualDateCell({
            dateBs: row.paidDateBs,
            dateAd: row.paidDateAd,
          });
          const programYearLabel = row.programYear
            ? (PROGRAM_YEARS.find((y) => y.value === row.programYear)?.label ??
              `Year ${row.programYear}`)
            : "";
          const hasProgramYear =
            row.programYear === 1 ||
            row.programYear === 2 ||
            row.programYear === 3;
          const feePaid = Number(row.amountPaidNpr) || 0;
          const deposit = Number(row.securityDepositPaidNpr) || 0;
          const scholarship = Number(row.scholarshipNpr) || 0;
          const remaining = Number(row.remainingDueNpr) || 0;
          totalFeePaid += feePaid;
          totalDeposit += deposit;
          totalScholarship += scholarship;
          // Only sum year-scoped remaining when a program year is set
          if (hasProgramYear) totalRemaining += remaining;

          const dateHtml = dual.secondary
            ? `<div class="date-bs">${escapeHtml(dual.primary)}</div><div class="date-ad">${escapeHtml(dual.secondary)}</div>`
            : `<div class="date-bs">${escapeHtml(dual.primary)}</div>`;

          // Remaining always names which program year the balance belongs to
          const remainingHtml = hasProgramYear
            ? `<div class="due-year">${escapeHtml(programYearLabel)} due</div><div class="due-amt">${escapeHtml(money(remaining))}</div>`
            : `<div class="due-year muted">No program year</div><div class="due-amt">—</div>`;

          const batchYear = [
            st.batch !== "—" ? st.batch : "",
            st.year !== "—" ? st.year : "",
          ]
            .filter(Boolean)
            .join(" / ");

          return `<tr>
            <td class="c">${index + 1}</td>
            <td class="mono">${escapeHtml(row.receiptNumber ?? "")}</td>
            <td class="student"><div class="name">${escapeHtml(st.name)}</div><div class="muted">${escapeHtml(st.admission)}</div></td>
            <td>${escapeHtml(batchYear || "—")}</td>
            <td class="c">${escapeHtml(programYearLabel || "—")}</td>
            <td>${escapeHtml(feeCategory(row))}</td>
            <td class="num">${escapeHtml(money(feePaid))}</td>
            <td class="num">${deposit > 0 ? escapeHtml(money(deposit)) : "—"}</td>
            <td class="num">${scholarship > 0 ? escapeHtml(money(scholarship)) : "—"}</td>
            <td class="remaining">${remainingHtml}</td>
            <td>${escapeHtml(paymentMethodLabel(row.paymentMethod))}</td>
            <td class="date">${dateHtml}</td>
            <td class="people"><div>${escapeHtml(row.receivedByName?.trim() || "—")}</div><div class="muted">${escapeHtml(row.paidByName?.trim() || "—")}</div></td>
          </tr>`;
        })
        .join("");

      const printedAt = new Date().toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const branding = getPrintInstitutionBranding();
      const institutionHeader = buildPrintInstitutionHeaderHtml({ branding });

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Fee Receipts List</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: "IBM Plex Sans", "Noto Sans Devanagari", system-ui, sans-serif;
      margin: 10px 12px;
      color: #0f172a;
      background: #fff;
    }
    h1 { font-size: 13px; margin: 4px 0 2px; font-weight: 700; }
    .meta { font-size: 9px; color: #475569; margin-bottom: 8px; line-height: 1.4; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.5px;
      table-layout: fixed;
      line-height: 1.3;
    }
    th, td {
      border: 1px solid #64748b;
      padding: 3px 4px;
      text-align: left;
      vertical-align: top;
      overflow: hidden;
    }
    th {
      background: #e2e8f0;
      font-weight: 700;
      white-space: normal;
      line-height: 1.2;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    tbody tr:nth-child(even) td { background: #f8fafc; }
    .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .c { text-align: center; }
    .mono {
      font-family: ui-monospace, Consolas, "Courier New", monospace;
      font-size: 7.5px;
      word-break: break-all;
      overflow-wrap: anywhere;
      white-space: normal;
    }
    .name { font-weight: 600; }
    .muted { color: #64748b; font-size: 7.5px; line-height: 1.25; }
    .date { white-space: normal; }
    .date-bs {
      font-weight: 600;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .date-ad {
      display: block;
      margin-top: 2px;
      color: #475569;
      font-size: 7.5px;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .remaining { text-align: right; white-space: normal; }
    .due-year {
      font-size: 7.5px;
      font-weight: 700;
      color: #0c2d6b;
      line-height: 1.2;
      margin-bottom: 1px;
    }
    .due-amt {
      font-variant-numeric: tabular-nums;
      font-weight: 600;
      white-space: nowrap;
    }
    .student .muted, .people .muted { margin-top: 1px; }
    tfoot td {
      font-weight: 700;
      background: #f1f5f9;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    tr { page-break-inside: avoid; break-inside: avoid; }
    @page { size: A4 landscape; margin: 7mm 5mm; }
    @media print {
      body { margin: 0; }
    }
    ${PRINT_INSTITUTION_HEADER_CSS}
  </style>
</head>
<body>
  ${institutionHeader}
  <h1>All Fee Receipts</h1>
  <div class="meta">
    ${filteredReceipts.length} receipt${filteredReceipts.length === 1 ? "" : "s"}
    · Amounts in NPR
    · Total fee paid ${escapeHtml(money(totalFeePaid))}
    ${totalDeposit > 0 ? ` · Deposit ${escapeHtml(money(totalDeposit))}` : ""}
    · Printed ${escapeHtml(printedAt)}
    ${filterBits.length > 0 ? `<br/>Filters: ${escapeHtml(filterBits.join(" · "))}` : ""}
  </div>
  <table>
    <colgroup>
      <col style="width: 2.5%" />
      <col style="width: 9%" />
      <col style="width: 11%" />
      <col style="width: 9%" />
      <col style="width: 5.5%" />
      <col style="width: 9%" />
      <col style="width: 7%" />
      <col style="width: 6.5%" />
      <col style="width: 6.5%" />
      <col style="width: 9%" />
      <col style="width: 6%" />
      <col style="width: 9%" />
      <col style="width: 10%" />
    </colgroup>
    <thead>
      <tr>
        <th class="c">#</th>
        <th>Receipt</th>
        <th>Student</th>
        <th>Batch / Year</th>
        <th class="c">Program year</th>
        <th>Category</th>
        <th class="num">Fee paid</th>
        <th class="num">Deposit</th>
        <th class="num">Scholarship</th>
        <th class="num">Remaining<br/>(by program year)</th>
        <th>Method</th>
        <th>Date<br/>(BS / AD)</th>
        <th>Received by<br/><span style="font-weight:500">Paid by</span></th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot>
      <tr>
        <td colspan="6">Totals (${filteredReceipts.length} receipt${filteredReceipts.length === 1 ? "" : "s"})</td>
        <td class="num">${escapeHtml(money(totalFeePaid))}</td>
        <td class="num">${totalDeposit > 0 ? escapeHtml(money(totalDeposit)) : "—"}</td>
        <td class="num">${totalScholarship > 0 ? escapeHtml(money(totalScholarship)) : "—"}</td>
        <td class="num remaining"><div class="due-year">Program years</div><div class="due-amt">${escapeHtml(money(totalRemaining))}</div></td>
        <td colspan="3"></td>
      </tr>
    </tfoot>
  </table>
  <p class="meta" style="margin-top:6px">
    Date shows BS on the first line and AD on the second.
    Remaining lists the program year (1st / 2nd / 3rd) and that year’s balance only — not all-years total.
  </p>
</body>
</html>`;

      printHtmlViaIframe(html);
      toast.success(
        `Print dialog opened — ${filteredReceipts.length} receipt${
          filteredReceipts.length === 1 ? "" : "s"
        } in one table`,
      );
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not open print preview",
      );
    } finally {
      setPrintingBulkList(false);
    }
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
          securityDepositPaidNpr: row.securityDepositPaidNpr ?? 0,
          scholarshipNpr: row.scholarshipNpr,
          remainingDueNpr: row.remainingDueNpr,
          paidDateBs: row.paidDateBs,
          paidDateAd:
            row.paidDateAd || bsDateToAdString(row.paidDateBs) || "",
          paymentMethod: paymentMethodLabel(row.paymentMethod),
          receivedByName: row.receivedByName ?? "",
          paidByName: row.paidByName ?? "",
          attachments: row.attachments?.length ?? 0,
        };
      }),
    );
    toast.success("Excel exported");
  };

  if (accountsQuery.isLoading || receiptsQuery.isLoading) {
    return <LoadingState />;
  }

  if (accountsQuery.isError || receiptsQuery.isError) {
    return (
      <EmptyState
        title="Could not load student fee records"
        description={parseErrorMessage(
          accountsQuery.error ?? receiptsQuery.error,
        )}
      />
    );
  }

  // Picker lists are optional for the ledger/receipts views — soft-fail only.
  const pickerListError =
    studentsQuery.isError || batchesQuery.isError || yearsQuery.isError
      ? parseErrorMessage(
          studentsQuery.error ?? batchesQuery.error ?? yearsQuery.error,
        )
      : null;

  const selectedHistory = historyQuery.data;
  const activeScholarshipForYear = selectedHistory?.scholarshipAwards?.find(
    (a) =>
      a.coversProgramYear === Number(paymentForm.programYear) &&
      (a.status === "ACTIVE" || a.status === "APPLIED"),
  );

  return (
    <div className="min-w-0 max-w-full space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-brand-600" />
              Student Fee Records
            </CardTitle>
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["ledger", "Student ledger", Wallet],
                ["record", "Record payment", Plus],
                ["scholarship", "Merit Scholarship", Award],
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

      {pickerListError && (tab === "record" || tab === "scholarship") ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Student / batch lists could not load ({pickerListError}). The ledger
          still works; ask an admin to grant Accounting module access if pickers
          stay empty.
        </div>
      ) : null}

      {/* ─── Ledger ─── */}
      {tab === "ledger" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Student fee ledger</CardTitle>
            <p className="text-sm text-slate-500">
              Filter by batch and year, or search by name / admission number.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <FormField label="Search">
                  <div className="relative">
                    <Input
                      className="h-10 pr-9"
                      placeholder="Name or admission no."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    {search ? (
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                        onClick={() => setSearch("")}
                        aria-label="Clear search"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                </FormField>
                <FormField label="Batch">
                  <Select
                    value={ledgerBatchId}
                    onChange={(e) => {
                      setLedgerBatchId(e.target.value);
                      setLedgerYearId("");
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
                    value={ledgerYearId}
                    onChange={(e) => setLedgerYearId(e.target.value)}
                    disabled={Boolean(ledgerBatchId) && yearsForLedgerBatch.length === 0}
                  >
                    <option value="">
                      {ledgerBatchId ? "All years in batch" : "All years"}
                    </option>
                    {yearsForLedgerBatch.map((y) => (
                      <option key={y._id} value={y._id}>
                        {y.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={!search && !ledgerBatchId && !ledgerYearId}
                    onClick={clearLedgerFilters}
                  >
                    <X className="mr-1.5 h-4 w-4" />
                    Clear filters
                  </Button>
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Showing {filteredAccounts.length} of {accounts.length} student
                {accounts.length === 1 ? "" : "s"}
                {ledgerBatchId || ledgerYearId || search
                  ? " (filtered)"
                  : ""}
              </p>
            </div>

            {filteredAccounts.length === 0 ? (
              <EmptyState
                title="No students match"
                description={
                  accounts.length === 0
                    ? "Students will appear here with paid / remaining balances once enrolled."
                    : "Try another batch, year, or search term — or clear filters."
                }
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
                      <Th>Last payment</Th>
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
                              Adm: {acc.student.admissionNumber}
                              {acc.student.registrationNumber
                                ? ` · Reg: ${acc.student.registrationNumber}`
                                : ""}
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
                            {acc.lastPaymentDateBs || acc.lastPaymentDateAd ? (
                              <DualDateCell
                                dateBs={acc.lastPaymentDateBs}
                                dateAd={acc.lastPaymentDateAd}
                              />
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
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
                                if (acc.student.batchId) {
                                  setPickerBatchId(asId(acc.student.batchId));
                                }
                                if (acc.student.yearId) {
                                  setPickerYearId(asId(acc.student.yearId));
                                }
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
              <CardTitle className="text-base">
                {editingReceipt
                  ? `Edit fee payment — ${editingReceipt.receiptNumber}`
                  : "Record student fee payment"}
              </CardTitle>
              {editingReceipt ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                  <Pencil className="h-4 w-4 shrink-0" />
                  <span className="flex-1">
                    Editing payment{" "}
                    <strong className="font-mono">
                      {editingReceipt.receiptNumber}
                    </strong>
                    {" · "}
                    Amount paid:{" "}
                    <strong>
                      {formatCurrencyNpr(editingReceipt.amountPaidNpr ?? 0)}
                    </strong>
                    {(editingReceipt.securityDepositPaidNpr ?? 0) > 0
                      ? ` · Deposit: ${formatCurrencyNpr(editingReceipt.securityDepositPaidNpr ?? 0)}`
                      : ""}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={cancelEditReceipt}
                  >
                    Cancel edit
                  </Button>
                  {canAdminEdit ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={deleteCollectionMutation.isPending}
                      onClick={() => confirmDeleteReceipt(editingReceipt)}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      Delete payment
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Find student by search, batch &amp; year
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <FormField label="Search">
                    <div className="relative">
                      <Input
                        className="h-10 pr-9"
                        placeholder="Name, admission no., phone…"
                        value={pickerSearch}
                        onChange={(e) => {
                          setPickerSearch(e.target.value);
                          setPaymentForm((f) => ({ ...f, studentId: "" }));
                          setSelectedStudentId("");
                        }}
                      />
                      {pickerSearch ? (
                        <button
                          type="button"
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                          onClick={() => {
                            setPickerSearch("");
                            setPaymentForm((f) => ({ ...f, studentId: "" }));
                            setSelectedStudentId("");
                          }}
                          aria-label="Clear search"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </FormField>
                  <FormField label="Batch">
                    <Select
                      value={pickerBatchId}
                      onChange={(e) => {
                        setPickerBatchId(e.target.value);
                        setPickerYearId("");
                        setPaymentForm((f) => ({ ...f, studentId: "" }));
                        setSelectedStudentId("");
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
                        setPaymentForm((f) => ({ ...f, studentId: "" }));
                        setSelectedStudentId("");
                      }}
                    >
                      <option value="">
                        {pickerBatchId ? "All years in batch" : "All years"}
                      </option>
                      {yearsForPickerBatch.map((y) => (
                        <option key={y._id} value={y._id}>
                          {y.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      disabled={!pickerSearch && !pickerBatchId && !pickerYearId}
                      onClick={() => {
                        clearPickerFilters();
                        setPaymentForm((f) => ({ ...f, studentId: "" }));
                        setSelectedStudentId("");
                      }}
                    >
                      <X className="mr-1.5 h-4 w-4" />
                      Clear
                    </Button>
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {pickerStudents.length} student
                  {pickerStudents.length === 1 ? "" : "s"} in list
                  {pickerSearch || pickerBatchId || pickerYearId
                    ? " (filtered)"
                    : ""}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Student *">
                  <Select
                    value={paymentForm.studentId}
                    disabled={Boolean(editingReceipt)}
                    onChange={(e) => {
                      const id = e.target.value;
                      setPaymentForm((f) => ({ ...f, studentId: id }));
                      setSelectedStudentId(id);
                      // Sync picker filters from student so ledger/history stay consistent
                      const st = students.find((s) => s._id === id);
                      if (st?.batchId) setPickerBatchId(asId(st.batchId));
                      if (st?.yearId) setPickerYearId(asId(st.yearId));
                    }}
                  >
                    <option value="">
                      {pickerStudents.length === 0 && !editingReceipt
                        ? "No students match search / batch / year"
                        : "Select student"}
                    </option>
                    {(() => {
                      const list = [...pickerStudents];
                      if (
                        editingReceipt &&
                        paymentForm.studentId &&
                        !list.some((s) => s._id === paymentForm.studentId)
                      ) {
                        const extra = students.find(
                          (s) => s._id === paymentForm.studentId,
                        );
                        if (extra) list.unshift(extra);
                      }
                      return list.map((s) => (
                        <option key={s._id} value={s._id}>
                          {s.user?.fullName ?? "Student"} ({s.admissionNumber})
                        </option>
                      ));
                    })()}
                  </Select>
                </FormField>
                <FormField label="Program year (HA) *">
                  <Select
                    value={paymentForm.programYear}
                    onChange={(e) => {
                      const year = e.target.value;
                      const yearRow = selectedHistory?.yearWise?.find(
                        (y) => String(y.programYear) === year,
                      );
                      // Due is remaining against the fee plan — do not re-enter full year fee
                      const remaining = yearRow
                        ? Math.max(0, Number(yearRow.remainingNpr) || 0)
                        : null;
                      setPaymentForm((f) => ({
                        ...f,
                        programYear: year,
                        // Charge field 0 when plan already exists (avoids double-booking)
                        currentChargesNpr:
                          remaining != null
                            ? "0"
                            : f.currentChargesNpr,
                        amountPaidNpr:
                          remaining != null && remaining > 0
                            ? String(remaining)
                            : f.amountPaidNpr,
                      }));
                    }}
                  >
                    {PROGRAM_YEARS.map((y) => (
                      <option key={y.value} value={String(y.value)}>
                        {y.label}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Payment date (BS)">
                  <NepaliDateField
                    value={paymentForm.paidDateBs}
                    onChange={(v) =>
                      setPaymentForm((f) => ({
                        ...f,
                        paidDateBs: v,
                        paidDateAd: v ? bsDateToAdString(v) : "",
                      }))
                    }
                  />
                </FormField>
                <FormField label="Payment date (AD)">
                  <Input
                    type="date"
                    value={paymentForm.paidDateAd}
                    onChange={(e) => {
                      const v = e.target.value;
                      setPaymentForm((f) => ({
                        ...f,
                        paidDateAd: v,
                        paidDateBs: v ? adDateToBsString(v) : "",
                      }));
                    }}
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
                <FormField label="Extra charge this receipt (NPR)">
                  <NumberInput
                    min={0}
                    value={paymentForm.currentChargesNpr}
                    onChange={(e) =>
                      setPaymentForm((f) => ({
                        ...f,
                        currentChargesNpr: e.target.value,
                      }))
                    }
                    placeholder="0"
                  />
                </FormField>
                <FormField label="Amount paid — fee (NPR) *">
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
                  {selectedHistory?.yearWise ? (
                    <p className="mt-1 text-xs text-slate-500">
                      {(() => {
                        const y = selectedHistory.yearWise?.find(
                          (r) =>
                            String(r.programYear) === paymentForm.programYear,
                        );
                        if (!y) return "Select student to see year balance";
                        return `This year: plan ${formatCurrencyNpr(y.chargedNpr)} · paid ${formatCurrencyNpr(y.paidNpr)} · due ${formatCurrencyNpr(y.remainingNpr)}`;
                      })()}
                    </p>
                  ) : null}
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
                        {paymentMethodLabel(m)}
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
                    placeholder="Bank ref / cheque no. / eSewa ref"
                  />
                </FormField>
                <FormField label="Received by">
                  <Input
                    value={
                      editingReceipt
                        ? paymentForm.receivedByName || currentUserName
                        : currentUserName
                    }
                    readOnly
                    disabled
                    className="bg-slate-50 text-slate-800"
                    placeholder="Your account name"
                    title="Automatically set to the person recording this payment"
                  />
                </FormField>
                {paymentMethodNeedsHandover(paymentForm.paymentMethod) ? (
                  <FormField label="Paid by / Depositor">
                    <Input
                      value={paymentForm.paidByName}
                      onChange={(e) =>
                        setPaymentForm((f) => ({
                          ...f,
                          paidByName: e.target.value,
                        }))
                      }
                      placeholder="Person who paid or deposited"
                    />
                  </FormField>
                ) : null}
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
                    <option value="TOPPER_YEAR_WAIVER">Merit year waiver</option>
                    <option value="MERIT">Merit (other)</option>
                    <option value="OTHER">Other</option>
                  </Select>
                </FormField>
              </div>

              {activeScholarshipForYear ? (
                <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-950">
                  Active merit scholarship for this year:{" "}
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

              {(Number(paymentForm.amountPaidNpr) || 0) > 0 ? (
                <p className="text-sm text-slate-600">
                  Amount paid this receipt:{" "}
                  <span className="font-semibold text-slate-900">
                    {formatCurrencyNpr(Number(paymentForm.amountPaidNpr) || 0)}
                  </span>
                </p>
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
                    if (editingReceipt) {
                      cancelEditReceipt();
                      return;
                    }
                    setPaymentForm(emptyPaymentForm());
                    setAttachments([]);
                  }}
                >
                  {editingReceipt ? "Cancel" : "Clear"}
                </Button>
                <Button
                  type="button"
                  disabled={
                    collectMutation.isPending ||
                    updateCollectionMutation.isPending
                  }
                  onClick={submitPayment}
                >
                  <Receipt className="mr-1.5 h-4 w-4" />
                  {collectMutation.isPending || updateCollectionMutation.isPending
                    ? "Saving…"
                    : editingReceipt
                      ? "Update payment"
                      : "Save fee record"}
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
                  <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-sm">
                    <p className="text-xs font-medium uppercase tracking-wide text-amber-800">
                      Security deposit
                    </p>
                    {selectedHistory.securityDepositWaived ? (
                      <p className="mt-1 text-amber-900">Not taken / cancelled</p>
                    ) : (
                      <div className="mt-1 grid grid-cols-2 gap-1 text-xs text-slate-700">
                        <span>
                          To deposit (plan):{" "}
                          {formatCurrencyNpr(
                            selectedHistory.securityDepositExpectedNpr ?? 0,
                          )}
                        </span>
                        <span>
                          Paid / held:{" "}
                          {formatCurrencyNpr(
                            selectedHistory.securityDepositHeldNpr ?? 0,
                          )}
                        </span>
                        <span>
                          Still due:{" "}
                          {formatCurrencyNpr(
                            Math.max(
                              0,
                              (selectedHistory.securityDepositExpectedNpr ?? 0) -
                                (selectedHistory.securityDepositHeldNpr ?? 0),
                            ),
                          )}
                        </span>
                        <span>
                          Refunded:{" "}
                          {formatCurrencyNpr(
                            selectedHistory.securityDepositRefundedNpr ?? 0,
                          )}
                        </span>
                        <span className="font-medium text-violet-800 col-span-2">
                          Remaining held (refundable):{" "}
                          {formatCurrencyNpr(
                            Math.max(
                              0,
                              (selectedHistory.securityDepositHeldNpr ?? 0) -
                                (selectedHistory.securityDepositRefundedNpr ??
                                  0),
                            ),
                          )}
                        </span>
                      </div>
                    )}
                    {(selectedHistory.securityDepositHeldNpr ?? 0) <= 0 &&
                    !selectedHistory.securityDepositWaived ? (
                      <p className="mt-1 text-xs text-amber-900">
                        Plan only — not paid yet. Record collection under
                        Security Deposit Records.
                      </p>
                    ) : null}
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
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Award className="h-5 w-5 text-violet-600" />
                {editingScholarship
                  ? "Edit merit scholarship"
                  : "Merit Scholarship (HA rule)"}
              </CardTitle>
              <p className="text-sm text-slate-500">
                Merit in <strong>Entrance</strong> → free <strong>1st year</strong>.
                Merit in <strong>1st year final</strong> → free{" "}
                <strong>2nd year</strong>. Merit in <strong>2nd year final</strong> →
                free <strong>3rd year</strong>.
              </p>
              {editingScholarship ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-950">
                  <Pencil className="h-4 w-4 shrink-0" />
                  <span className="flex-1">
                    Editing scholarship for{" "}
                    <strong>
                      {scholarshipStudentMeta(editingScholarship).name}
                    </strong>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={cancelEditScholarship}
                  >
                    Cancel edit
                  </Button>
                </div>
              ) : null}
            </CardHeader>
            <CardContent className="grid max-w-3xl gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Find student by search, batch &amp; year
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <FormField label="Search">
                    <div className="relative">
                      <Input
                        className="h-10 pr-9"
                        placeholder="Name, admission no., phone…"
                        value={pickerSearch}
                        onChange={(e) => {
                          setPickerSearch(e.target.value);
                          if (!editingScholarship) {
                            setScholarshipForm((f) => ({ ...f, studentId: "" }));
                          }
                        }}
                      />
                      {pickerSearch ? (
                        <button
                          type="button"
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                          onClick={() => {
                            setPickerSearch("");
                            if (!editingScholarship) {
                              setScholarshipForm((f) => ({ ...f, studentId: "" }));
                            }
                          }}
                          aria-label="Clear search"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </FormField>
                  <FormField label="Batch">
                    <Select
                      value={pickerBatchId}
                      onChange={(e) => {
                        setPickerBatchId(e.target.value);
                        setPickerYearId("");
                        if (!editingScholarship) {
                          setScholarshipForm((f) => ({ ...f, studentId: "" }));
                        }
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
                        if (!editingScholarship) {
                          setScholarshipForm((f) => ({ ...f, studentId: "" }));
                        }
                      }}
                    >
                      <option value="">
                        {pickerBatchId ? "All years in batch" : "All years"}
                      </option>
                      {yearsForPickerBatch.map((y) => (
                        <option key={y._id} value={y._id}>
                          {y.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      disabled={!pickerSearch && !pickerBatchId && !pickerYearId}
                      onClick={() => {
                        clearPickerFilters();
                        if (!editingScholarship) {
                          setScholarshipForm((f) => ({ ...f, studentId: "" }));
                        }
                      }}
                    >
                      <X className="mr-1.5 h-4 w-4" />
                      Clear
                    </Button>
                  </div>
                </div>
              </div>
              <FormField label="Student *">
                <Select
                  value={scholarshipForm.studentId}
                  disabled={Boolean(editingScholarship)}
                  onChange={(e) =>
                    setScholarshipForm((f) => ({ ...f, studentId: e.target.value }))
                  }
                >
                  <option value="">
                    {pickerStudents.length === 0 && !editingScholarship
                      ? "No students match search / batch / year"
                      : "Select student"}
                  </option>
                  {(() => {
                    const list = [...pickerStudents];
                    if (
                      editingScholarship &&
                      scholarshipForm.studentId &&
                      !list.some((s) => s._id === scholarshipForm.studentId)
                    ) {
                      const extra = students.find(
                        (s) => s._id === scholarshipForm.studentId,
                      );
                      if (extra) list.unshift(extra);
                    }
                    return list.map((s) => (
                      <option key={s._id} value={s._id}>
                        {s.user?.fullName} ({s.admissionNumber})
                      </option>
                    ));
                  })()}
                </Select>
              </FormField>
              <FormField label="Merit based on which year final? *">
                <Select
                  value={scholarshipForm.toppedProgramYear}
                  onChange={(e) => {
                    const topped = Number(e.target.value);
                    setScholarshipForm((f) => ({
                      ...f,
                      toppedProgramYear: String(topped),
                      coversProgramYear: String(defaultCoversFromTopped(topped)),
                      examName:
                        topped === 0
                          ? "Entrance"
                          : f.examName === "Entrance"
                            ? "Final Examination"
                            : f.examName,
                    }));
                  }}
                >
                  {TOPPED_EXAM_OPTIONS.map((y) => (
                    <option key={y.value} value={String(y.value)}>
                      {y.value === 0
                        ? "Entrance examination"
                        : `${y.label} final examination`}
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
              <div className="sm:col-span-2 flex flex-wrap justify-end gap-2">
                {editingScholarship ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={cancelEditScholarship}
                  >
                    Cancel
                  </Button>
                ) : null}
                <Button
                  type="button"
                  disabled={scholarshipMutation.isPending}
                  onClick={submitScholarship}
                >
                  <Award className="mr-1.5 h-4 w-4" />
                  {scholarshipMutation.isPending
                    ? "Saving…"
                    : editingScholarship
                      ? "Save scholarship changes"
                      : "Record merit scholarship"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Students with merit scholarship
              </CardTitle>
              <p className="text-sm text-slate-500">
                Active and applied awards only. Edit, revoke, or delete to correct the
                student fee ledger and profile balance.
              </p>
            </CardHeader>
            <CardContent>
              {scholarshipsQuery.isLoading ? (
                <LoadingState />
              ) : activeScholarshipAwards.length === 0 ? (
                <EmptyState
                  title="No merit scholarships yet"
                  description="Record a scholarship above. Students who receive one will appear here."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHead>
                      <tr>
                        <Th>Student</Th>
                        <Th>Batch / Year</Th>
                        <Th>Merit based on</Th>
                        <Th>Covers</Th>
                        <Th>Rank</Th>
                        <Th>Amount</Th>
                        <Th>Status</Th>
                        <Th>Actions</Th>
                      </tr>
                    </TableHead>
                    <TableBody>
                      {activeScholarshipAwards.map((award) => {
                        const meta = scholarshipStudentMeta(award);
                        return (
                          <tr key={award._id}>
                            <Td>
                              <div className="font-medium">{meta.name}</div>
                              <div className="text-xs text-slate-500">
                                Adm: {meta.admission}
                              </div>
                            </Td>
                            <Td className="text-sm">
                              {meta.batch}
                              {meta.year !== "—" ? ` / ${meta.year}` : ""}
                            </Td>
                            <Td className="text-sm">
                              {toppedExamLabel(Number(award.toppedProgramYear))}
                              {award.examName ? (
                                <div className="text-xs text-slate-500">
                                  {award.examName}
                                </div>
                              ) : null}
                            </Td>
                            <Td className="text-sm">
                              {coversYearLabel(Number(award.coversProgramYear))}
                            </Td>
                            <Td className="text-sm">{award.rank ?? "—"}</Td>
                            <Td className="text-sm">
                              {(award.amountNpr ?? 0) > 0
                                ? formatCurrencyNpr(award.amountNpr)
                                : "Full year"}
                            </Td>
                            <Td>
                              <Badge
                                className={
                                  award.status === "APPLIED"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-violet-100 text-violet-800"
                                }
                              >
                                {award.status}
                              </Badge>
                            </Td>
                            <Td>
                              <div className="flex flex-wrap gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => startEditScholarship(award)}
                                >
                                  <Pencil className="mr-1 h-3.5 w-3.5" />
                                  Edit
                                </Button>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={
                                    revokeScholarshipMutation.isPending ||
                                    award.status === "REVOKED"
                                  }
                                  onClick={() => {
                                    if (
                                      !window.confirm(
                                        `Revoke scholarship for ${meta.name}?\n\nThis restores fee dues for ${coversYearLabel(Number(award.coversProgramYear))} where the award was applied.`,
                                      )
                                    ) {
                                      return;
                                    }
                                    revokeScholarshipMutation.mutate(award._id);
                                  }}
                                >
                                  Revoke
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  disabled={deleteScholarshipMutation.isPending}
                                  onClick={() => {
                                    if (
                                      !window.confirm(
                                        `Delete scholarship for ${meta.name}?\n\nThis removes the award and corrects the student fee ledger.`,
                                      )
                                    ) {
                                      return;
                                    }
                                    deleteScholarshipMutation.mutate(award._id);
                                  }}
                                >
                                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                                  Delete
                                </Button>
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
        </div>
      ) : null}

      {/* ─── Receipts ─── */}
      {tab === "receipts" ? (
        <Card className="min-w-0 max-w-full overflow-hidden">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="text-base">All fee receipts</CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                Filter by batch, year, student search, and date range (BS or AD).
                {canAdminEdit
                  ? " Print PDF prints the filtered list as one table; each row’s Print opens a single receipt. Super Admin / College Admin can also edit or delete."
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canAdminEdit ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    filteredReceipts.length === 0 ||
                    printingBulkList ||
                    Boolean(printingReceiptId)
                  }
                  onClick={() => printAllFilteredReceipts()}
                  title="Print all filtered receipts as one table (Save as PDF from the print dialog)"
                >
                  <Printer className="mr-1 h-4 w-4" />
                  {printingBulkList ? "Preparing…" : "Print PDF"}
                </Button>
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={exportExcel}>
                <FileDown className="mr-1 h-4 w-4" />
                Excel
              </Button>
            </div>
          </CardHeader>
          <CardContent className="min-w-0 space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                <FormField label="Search student / receipt">
                  <div className="relative">
                    <Input
                      className="h-10 pr-9"
                      placeholder="Name, admission no., receipt…"
                      value={receiptSearch}
                      onChange={(e) => setReceiptSearch(e.target.value)}
                    />
                    {receiptSearch ? (
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                        onClick={() => setReceiptSearch("")}
                        aria-label="Clear search"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                </FormField>
                <FormField label="Batch">
                  <Select
                    value={receiptBatchId}
                    onChange={(e) => {
                      setReceiptBatchId(e.target.value);
                      setReceiptYearId("");
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
                    value={receiptYearId}
                    onChange={(e) => setReceiptYearId(e.target.value)}
                    disabled={
                      Boolean(receiptBatchId) && yearsForReceiptBatch.length === 0
                    }
                  >
                    <option value="">
                      {receiptBatchId ? "All years in batch" : "All years"}
                    </option>
                    {yearsForReceiptBatch.map((y) => (
                      <option key={y._id} value={y._id}>
                        {y.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Payment method">
                  <Select
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                  >
                    <option value="">All methods</option>
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {paymentMethodLabel(m)}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="From date (BS)">
                  <NepaliDateField
                    value={receiptFromBs}
                    onChange={(v) => {
                      setReceiptFromBs(v);
                      setReceiptFromAd(v ? bsDateToAdString(v) : "");
                    }}
                  />
                </FormField>
                <FormField label="From date (AD)">
                  <Input
                    type="date"
                    value={receiptFromAd}
                    onChange={(e) => {
                      const v = e.target.value;
                      setReceiptFromAd(v);
                      setReceiptFromBs(v ? adDateToBsString(v) : "");
                    }}
                  />
                </FormField>
                <FormField label="To date (BS)">
                  <NepaliDateField
                    value={receiptToBs}
                    onChange={(v) => {
                      setReceiptToBs(v);
                      setReceiptToAd(v ? bsDateToAdString(v) : "");
                    }}
                  />
                </FormField>
                <FormField label="To date (AD)">
                  <Input
                    type="date"
                    value={receiptToAd}
                    onChange={(e) => {
                      const v = e.target.value;
                      setReceiptToAd(v);
                      setReceiptToBs(v ? adDateToBsString(v) : "");
                    }}
                  />
                </FormField>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-500">
                  Showing {filteredReceipts.length} receipt
                  {filteredReceipts.length === 1 ? "" : "s"}
                  {hasReceiptFilters ? " (filtered)" : ""}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!hasReceiptFilters}
                  onClick={clearReceiptFilters}
                >
                  <X className="mr-1.5 h-4 w-4" />
                  Clear filters
                </Button>
              </div>
            </div>

            {filteredReceipts.length === 0 ? (
              <EmptyState
                title="No fee records"
                description={
                  hasReceiptFilters
                    ? "No receipts match these filters — try clearing batch, year, search, or dates."
                    : "Record a payment to build the student fee history."
                }
              />
            ) : (
              <ReceiptsTableScroll>
                <Table className="w-max min-w-full border-separate border-spacing-0">
                  <TableHead>
                    <tr>
                      <Th className="whitespace-nowrap bg-slate-50 md:sticky md:left-0 md:z-20 md:min-w-[8rem] md:max-w-[8rem] md:shadow-[2px_0_6px_-4px_rgba(0,0,0,0.15)]">
                        Receipt
                      </Th>
                      <Th className="whitespace-nowrap bg-slate-50 md:sticky md:left-32 md:z-20 md:min-w-[12rem] md:shadow-[2px_0_6px_-4px_rgba(0,0,0,0.15)]">
                        Student
                      </Th>
                      <Th className="whitespace-nowrap">Batch / Year</Th>
                      <Th className="whitespace-nowrap">Program year</Th>
                      <Th className="whitespace-nowrap">Category</Th>
                      <Th className="whitespace-nowrap">Fee paid</Th>
                      <Th className="whitespace-nowrap">Deposit</Th>
                      <Th className="whitespace-nowrap">Scholarship</Th>
                      <Th
                        className="whitespace-nowrap"
                        title="Remaining balance for this receipt’s program year only (not all years)"
                      >
                        Remaining (year)
                      </Th>
                      <Th className="whitespace-nowrap">Method</Th>
                      <Th className="whitespace-nowrap">Received by</Th>
                      <Th className="whitespace-nowrap">Paid by</Th>
                      <Th className="whitespace-nowrap">Date (BS / AD)</Th>
                      <Th className="whitespace-nowrap">Proof</Th>
                      <Th className="whitespace-nowrap bg-slate-50 md:sticky md:right-0 md:z-20 md:shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.12)]">
                        Actions
                      </Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {filteredReceipts.map((row) => {
                      const st = resolveStudent(row);
                      return (
                        <tr key={row._id} className="group">
                          <Td className="whitespace-nowrap bg-white font-mono text-sm group-hover:bg-slate-50 md:sticky md:left-0 md:z-10 md:min-w-[8rem] md:max-w-[8rem] md:truncate md:shadow-[2px_0_6px_-4px_rgba(0,0,0,0.12)]">
                            {row.receiptNumber}
                          </Td>
                          <Td className="min-w-[12rem] bg-white group-hover:bg-slate-50 md:sticky md:left-32 md:z-10 md:shadow-[2px_0_6px_-4px_rgba(0,0,0,0.12)]">
                            <div className="font-medium text-slate-900">
                              {st.name}
                            </div>
                            <div className="text-xs text-slate-500">
                              {st.admission}
                            </div>
                          </Td>
                          <Td className="whitespace-nowrap text-sm">
                            {st.batch}
                            {st.year !== "—" ? ` / ${st.year}` : ""}
                          </Td>
                          <Td className="whitespace-nowrap text-sm">
                            {row.programYear
                              ? PROGRAM_YEARS.find((y) => y.value === row.programYear)
                                  ?.label ?? `Y${row.programYear}`
                              : "—"}
                          </Td>
                          <Td className="max-w-[10rem] truncate text-sm">
                            {feeCategory(row)}
                          </Td>
                          <Td className="whitespace-nowrap">
                            {formatCurrencyNpr(row.amountPaidNpr)}
                          </Td>
                          <Td className="whitespace-nowrap">
                            {(row.securityDepositPaidNpr ?? 0) > 0
                              ? formatCurrencyNpr(row.securityDepositPaidNpr ?? 0)
                              : "—"}
                          </Td>
                          <Td className="whitespace-nowrap">
                            {formatCurrencyNpr(row.scholarshipNpr ?? 0)}
                          </Td>
                          <Td className="whitespace-nowrap">
                            {formatCurrencyNpr(row.remainingDueNpr ?? 0)}
                          </Td>
                          <Td className="whitespace-nowrap text-sm">
                            {paymentMethodLabel(row.paymentMethod)}
                          </Td>
                          <Td className="whitespace-nowrap text-sm">
                            {row.receivedByName?.trim() || "—"}
                          </Td>
                          <Td className="whitespace-nowrap text-sm">
                            {row.paidByName?.trim() || "—"}
                          </Td>
                          <Td className="whitespace-nowrap">
                            <DualDateCell
                              dateBs={row.paidDateBs}
                              dateAd={row.paidDateAd}
                            />
                          </Td>
                          <Td className="whitespace-nowrap">
                            {(row.attachments?.length ?? 0) > 0 ? (
                              <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                                <FileText className="h-3.5 w-3.5" />
                                {row.attachments!.length}
                              </span>
                            ) : (
                              "—"
                            )}
                          </Td>
                          <Td className="whitespace-nowrap bg-white group-hover:bg-slate-50 md:sticky md:right-0 md:z-20 md:min-w-[14rem] md:shadow-[-6px_0_10px_-4px_rgba(0,0,0,0.15)]">
                            <div className="flex min-w-[14rem] flex-wrap items-center justify-end gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                title="Print / download receipt PDF"
                                disabled={printingReceiptId === row._id}
                                onClick={() =>
                                  void downloadReceiptPdf(
                                    row._id,
                                    row.receiptNumber,
                                  )
                                }
                              >
                                <Printer className="mr-1 h-3.5 w-3.5" />
                                {printingReceiptId === row._id ? "…" : "Print"}
                              </Button>
                              {canAdminEdit ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="default"
                                    title="Edit amount paid, deposit, charges, date…"
                                    onClick={() => startEditReceipt(row)}
                                  >
                                    <Pencil className="mr-1 h-3.5 w-3.5" />
                                    Edit
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    title="Delete this payment and reverse accounts"
                                    disabled={
                                      deleteCollectionMutation.isPending
                                    }
                                    onClick={() => confirmDeleteReceipt(row)}
                                  >
                                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                                    Delete
                                  </Button>
                                </>
                              ) : null}
                            </div>
                          </Td>
                        </tr>
                      );
                    })}
                  </TableBody>
                </Table>
              </ReceiptsTableScroll>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};
