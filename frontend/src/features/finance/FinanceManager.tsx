import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  FINANCE_EXPENSE_TYPES,
  FINANCE_OWNER_SCOPES,
  FINANCE_PAYMENT_METHODS,
  FINANCE_TRANSACTION_TYPES,
  canManageInstitution,
  financeCategorySchema,
  financeTransactionSchema,
  isCollegeViewer,
  type CollegeAdministratorRecord,
  type FinanceAttachment,
  type FinanceCategoryInput,
  type FinanceCategoryRecord,
  type FinanceDashboardResponse,
  type FinanceExpenseType,
  type FinancePaymentMethod,
  type FinanceReportResponse,
  type FinanceStaffAccessRecord,
  type FinanceTransactionInput,
  type FinanceTransactionRecord,
  type FinanceTransactionType,
} from "@phit-erp/shared";
import {
  Download,
  FileText,
  FolderOpen,
  LayoutDashboard,
  List,
  Paperclip,
  Plus,
  Printer,
  Search,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { PageHeader } from "components/shared/PageHeader";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { Textarea } from "components/ui/textarea";
import { StickyTableScroll } from "components/ui/StickyTableScroll";
import { useAuth } from "features/auth/AuthProvider";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { cn, parseErrorMessage } from "lib/utils";
import {
  attachmentStatusLabel,
  expenseTypeLabel,
  exportFinanceReportExcel,
  exportFinanceReportLedgerExcel,
  exportFinanceReportLedgerPdf,
  exportTransactionsExcel,
  exportTransactionsLedgerExcel,
  exportTransactionsLedgerPdf,
  formatFinanceAmount,
  isImageAttachment,
  isPdfAttachment,
  mediaHref,
  ownerScopeLabel,
  paymentMethodLabel,
  printFinanceReport,
  printTransactionsLedger,
  summarizeTransactionTotals,
  transactionTypeLabel,
  uploadFinanceAttachments,
} from "./financeUtils";

type Tab =
  | "dashboard"
  | "transactions"
  | "entry"
  | "categories"
  | "staff-access"
  | "reports";

const allTabs: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "transactions", label: "Transactions", icon: List },
  { id: "entry", label: "Record entry", icon: Plus },
  { id: "categories", label: "Categories", icon: FolderOpen },
  { id: "staff-access", label: "Staff access", icon: Users },
  { id: "reports", label: "Reports", icon: FileText },
];

const emptyEntry = (
  type: FinanceTransactionType = "EXPENSE",
): FinanceTransactionInput => ({
  transactionType: type,
  dateBs: "",
  title: "",
  categoryId: "",
  expenseType: type === "EXPENSE" ? "COLLEGE_EXPENSE" : undefined,
  incomeSource: "",
  description: "",
  vendorPayee: "",
  amountNpr: 0,
  // Credit entries are not cash-settled; default method still satisfies schema.
  paymentMethod: type === "CREDIT" ? "OTHER" : "CASH",
  referenceNumber: "",
  remarks: "",
  attachments: [],
});

const transactionTypeBadgeClass = (type: string) => {
  if (type === "INCOME") return "bg-emerald-100 text-emerald-800";
  if (type === "CREDIT") return "bg-amber-100 text-amber-900";
  return "bg-rose-100 text-rose-800";
};

export const FinanceManager = () => {
  const { user } = useAuth();
  const isAdmin = canManageInstitution(user?.role ?? "");
  const isCollegeAdminUser = isCollegeViewer(user?.role ?? "");
  /** Staff with Admin-granted personal finance book (create + view only). */
  const isStaffFinanceUser =
    Boolean(user?.personalFinanceAccess) && !isAdmin && !isCollegeAdminUser;
  /**
   * Admin, Superadmin, College Administrator, or staff with personalFinanceAccess.
   */
  const canAccessFinance = isAdmin || isCollegeAdminUser || isStaffFinanceUser;
  /** Staff cannot edit/delete — Admin/Superadmin and College Administrators can. */
  const canEditTransactions = isAdmin || isCollegeAdminUser;

  const [tab, setTab] = useState<Tab>("dashboard");
  const [entryForm, setEntryForm] = useState<FinanceTransactionInput>(emptyEntry());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [staffAccessSearch, setStaffAccessSearch] = useState("");

  // Filters
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("");
  const [fromDateBs, setFromDateBs] = useState("");
  const [toDateBs, setToDateBs] = useState("");
  const [ownerScopeFilter, setOwnerScopeFilter] = useState("");
  const [createdByFilter, setCreatedByFilter] = useState("");
  const [dashYear, setDashYear] = useState("");
  const [dashMonth, setDashMonth] = useState("");
  const [reportType, setReportType] = useState("ALL");

  const [categoryForm, setCategoryForm] = useState<FinanceCategoryInput>({
    name: "",
    kind: "EXPENSE",
    description: "",
    isActive: true,
  });
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);

  const tabs = useMemo(() => {
    if (isAdmin) return allTabs;
    // College admin + staff: no categories / staff-access management
    return allTabs.filter(
      (item) => item.id !== "categories" && item.id !== "staff-access",
    );
  }, [isAdmin]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["finance"] }),
    ]);
  };

  const categoriesQuery = useQuery({
    queryKey: ["finance", "categories", isAdmin ? "all" : "active"],
    queryFn: () =>
      unwrap<FinanceCategoryRecord[]>(
        api.get("/finance/categories", {
          params: isAdmin ? { includeInactive: "true" } : undefined,
        }),
      ),
    enabled: canAccessFinance,
  });

  /** Admins can filter by which College Administrator recorded a personal-book entry. */
  const collegeAdminsQuery = useQuery({
    queryKey: ["college-administrators", "finance-filter"],
    queryFn: () =>
      unwrap<CollegeAdministratorRecord[]>(api.get("/college-administrators")),
    enabled: isAdmin,
  });

  /** Admin Staff Access panel + filter for staff books. */
  const staffAccessQuery = useQuery({
    queryKey: ["finance", "staff-access", staffAccessSearch],
    queryFn: () =>
      unwrap<FinanceStaffAccessRecord[]>(
        api.get("/finance/staff-access", {
          params: { search: staffAccessSearch || undefined },
        }),
      ),
    enabled: isAdmin && (tab === "staff-access" || tab === "transactions" || tab === "dashboard" || tab === "reports"),
  });

  const staffWithAccess = useMemo(
    () =>
      (staffAccessQuery.data ?? []).filter(
        (s) => s.financeAccessEnabled && s.userId,
      ),
    [staffAccessQuery.data],
  );

  const setStaffAccess = useMutation({
    mutationFn: ({
      userId,
      enabled,
    }: {
      userId: string;
      enabled: boolean;
    }) =>
      unwrap(api.put(`/finance/staff-access/${userId}`, { enabled })),
    onSuccess: async (_data, vars) => {
      toast.success(
        vars.enabled
          ? "Finance access granted — staff will see Finance Management after refresh/login"
          : "Finance access revoked",
      );
      await queryClient.invalidateQueries({ queryKey: ["finance", "staff-access"] });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const activeCategories = useMemo(
    () => (categoriesQuery.data ?? []).filter((c) => c.isActive),
    [categoriesQuery.data],
  );

  const entryCategories = useMemo(() => {
    // Credit can use any category (purchase or receivable on credit).
    if (entryForm.transactionType === "CREDIT") return activeCategories;
    return activeCategories.filter(
      (c) => c.kind === "BOTH" || c.kind === entryForm.transactionType,
    );
  }, [activeCategories, entryForm.transactionType]);

  const filterParams = useMemo(
    () => ({
      search: search || undefined,
      transactionType: typeFilter || undefined,
      categoryId: categoryFilter || undefined,
      paymentMethod: paymentFilter || undefined,
      fromDateBs: fromDateBs || undefined,
      toDateBs: toDateBs || undefined,
      ownerScope: isAdmin ? ownerScopeFilter || undefined : undefined,
      createdBy: isAdmin ? createdByFilter || undefined : undefined,
    }),
    [
      search,
      typeFilter,
      categoryFilter,
      paymentFilter,
      fromDateBs,
      toDateBs,
      ownerScopeFilter,
      createdByFilter,
      isAdmin,
    ],
  );

  const transactionsQuery = useQuery({
    queryKey: ["finance", "transactions", filterParams],
    queryFn: () =>
      unwrap<FinanceTransactionRecord[]>(
        api.get("/finance/transactions", { params: filterParams }),
      ),
    enabled: canAccessFinance && (tab === "transactions" || tab === "entry"),
  });

  const dashboardQuery = useQuery({
    queryKey: [
      "finance",
      "dashboard",
      dashYear,
      dashMonth,
      categoryFilter,
      ownerScopeFilter,
      createdByFilter,
    ],
    queryFn: () =>
      unwrap<FinanceDashboardResponse>(
        api.get("/finance/dashboard", {
          params: {
            yearBs: dashYear || undefined,
            monthBs: dashMonth || undefined,
            categoryId: categoryFilter || undefined,
            ownerScope: isAdmin ? ownerScopeFilter || undefined : undefined,
            createdBy: isAdmin ? createdByFilter || undefined : undefined,
          },
        }),
      ),
    enabled: canAccessFinance && tab === "dashboard",
  });

  const reportQuery = useQuery({
    queryKey: ["finance", "report", reportType, filterParams, dashYear, dashMonth],
    queryFn: () =>
      unwrap<FinanceReportResponse>(
        api.get("/finance/report", {
          params: {
            reportType,
            ...filterParams,
            yearBs: dashYear || undefined,
            monthBs: dashMonth || undefined,
          },
        }),
      ),
    enabled: canAccessFinance && tab === "reports",
  });

  const saveTransaction = useMutation({
    mutationFn: (payload: FinanceTransactionInput) =>
      editingId
        ? unwrap(api.put(`/finance/transactions/${editingId}`, payload))
        : unwrap(api.post("/finance/transactions", payload)),
    onSuccess: async () => {
      toast.success(editingId ? "Transaction updated" : "Transaction recorded");
      setEntryForm(emptyEntry(entryForm.transactionType));
      setEditingId(null);
      await invalidate();
      setTab("transactions");
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const deleteTransaction = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/finance/transactions/${id}`)),
    onSuccess: async () => {
      toast.success("Transaction deleted");
      await invalidate();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const saveCategory = useMutation({
    mutationFn: (payload: FinanceCategoryInput) =>
      editingCategoryId
        ? unwrap(api.put(`/finance/categories/${editingCategoryId}`, payload))
        : unwrap(api.post("/finance/categories", payload)),
    onSuccess: async () => {
      toast.success(editingCategoryId ? "Category updated" : "Category created");
      setCategoryForm({ name: "", kind: "EXPENSE", description: "", isActive: true });
      setEditingCategoryId(null);
      await invalidate();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const toggleCategoryActive = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: FinanceCategoryInput;
    }) => unwrap(api.put(`/finance/categories/${id}`, payload)),
    onSuccess: async (_data, vars) => {
      toast.success(vars.payload.isActive ? "Category enabled" : "Category disabled");
      await invalidate();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const deleteCategory = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/finance/categories/${id}`)),
    onSuccess: async () => {
      toast.success("Category deleted");
      await invalidate();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  if (!canAccessFinance) {
    return (
      <EmptyState
        title="Access restricted"
        description="Finance Management is available to Administrator and College Administrator. Staff can use it only when an Administrator grants access."
      />
    );
  }

  const submitEntry = () => {
    const parsed = financeTransactionSchema.safeParse(entryForm);
    if (!parsed.success) {
      return toast.error(parsed.error.issues[0]?.message ?? "Invalid entry");
    }
    saveTransaction.mutate(parsed.data);
  };

  const startEdit = (tx: FinanceTransactionRecord) => {
    if (!canEditTransactions) {
      toast.error("You cannot edit finance records. Contact Administrator.");
      return;
    }
    setEditingId(tx._id);
    setEntryForm({
      transactionType: tx.transactionType,
      dateBs: tx.dateBs,
      title: tx.title,
      categoryId: tx.categoryId,
      expenseType: tx.expenseType,
      incomeSource: tx.incomeSource ?? "",
      description: tx.description ?? "",
      vendorPayee: tx.vendorPayee ?? "",
      amountNpr: tx.amountNpr,
      paymentMethod: tx.paymentMethod,
      referenceNumber: tx.referenceNumber ?? "",
      remarks: tx.remarks ?? "",
      attachments: tx.attachments ?? [],
    });
    setTab("entry");
  };

  const onPickFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    setUploading(true);
    try {
      const uploaded = await uploadFinanceAttachments(fileList);
      setEntryForm((c) => ({
        ...c,
        attachments: [...(c.attachments ?? []), ...uploaded],
      }));
      toast.success(`${uploaded.length} file(s) uploaded`);
    } catch (e) {
      toast.error(parseErrorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = (index: number) => {
    setEntryForm((c) => ({
      ...c,
      attachments: (c.attachments ?? []).filter((_, i) => i !== index),
    }));
  };

  const dash = dashboardQuery.data;
  const transactions = transactionsQuery.data ?? [];
  const transactionTotals = useMemo(
    () => summarizeTransactionTotals(transactions),
    [transactions],
  );
  const report = reportQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance Management"
        description="Institutional expenses, income, and supporting documents — independent of Accounting ledgers, fees, and payroll."
      />

      <div className="flex flex-wrap gap-2">
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              key={item.id}
              size="sm"
              variant={tab === item.id ? "default" : "secondary"}
              className={cn(tab === item.id && "bg-brand-600 hover:bg-brand-700")}
              onClick={() => setTab(item.id)}
            >
              <Icon className="mr-2 h-4 w-4" />
              {item.label}
            </Button>
          );
        })}
      </div>

      {/* ─── Dashboard ───────────────────────────────────────────── */}
      {tab === "dashboard" && (
        <div className="space-y-6">
          <Card>
            <CardContent className="grid gap-3 py-4 md:grid-cols-3 xl:grid-cols-5">
              <FormField label="Year (BS)">
                <Input
                  placeholder="e.g. 2082"
                  value={dashYear}
                  onChange={(e) => setDashYear(e.target.value)}
                />
              </FormField>
              <FormField label="Month (1–12)">
                <Input
                  placeholder="Optional"
                  value={dashMonth}
                  onChange={(e) => setDashMonth(e.target.value)}
                />
              </FormField>
              <FormField label="Category">
                <Select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                >
                  <option value="">All categories</option>
                  {activeCategories.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              {isAdmin ? (
                <>
                  <FormField label="Record source">
                    <Select
                      value={ownerScopeFilter}
                      onChange={(e) => setOwnerScopeFilter(e.target.value)}
                    >
                      <option value="">All sources</option>
                      {FINANCE_OWNER_SCOPES.map((scope) => (
                        <option key={scope} value={scope}>
                          {ownerScopeLabel(scope)}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Recorded by">
                    <Select
                      value={createdByFilter}
                      onChange={(e) => setCreatedByFilter(e.target.value)}
                    >
                      <option value="">Anyone</option>
                      {ownerScopeFilter === "STAFF" || !ownerScopeFilter ? (
                        <optgroup label="Staff (with access)">
                          {staffWithAccess.map((s) => (
                            <option key={s.userId} value={s.userId}>
                              {s.fullName}
                              {s.staffCode ? ` (${s.staffCode})` : ""}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      {ownerScopeFilter === "COLLEGE_ADMINISTRATOR" ||
                      !ownerScopeFilter ? (
                        <optgroup label="College Administrators">
                          {(collegeAdminsQuery.data ?? [])
                            .filter((a) => !a.isDeleted)
                            .map((a) => (
                              <option key={a._id} value={a._id}>
                                {a.fullName}
                              </option>
                            ))}
                        </optgroup>
                      ) : null}
                    </Select>
                  </FormField>
                </>
              ) : null}
            </CardContent>
          </Card>

          {dashboardQuery.isLoading ? (
            <LoadingState />
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                {[
                  {
                    label: "College expenses",
                    value: dash?.totalCollegeExpensesNpr ?? 0,
                    tone: "text-rose-700",
                  },
                  {
                    label: "Other / external expenses",
                    value:
                      (dash?.totalOtherExpensesNpr ?? 0) +
                      (dash?.totalExternalExpensesNpr ?? 0),
                    tone: "text-orange-700",
                  },
                  {
                    label: "Total income",
                    value: dash?.totalIncomeNpr ?? 0,
                    tone: "text-emerald-700",
                  },
                  {
                    label: "Credit (unsettled)",
                    value: dash?.totalCreditNpr ?? 0,
                    tone: "text-amber-800",
                  },
                  {
                    label: "Net position",
                    value: dash?.netPositionNpr ?? 0,
                    tone: "text-brand-700",
                  },
                ].map((stat) => (
                  <Card
                    key={stat.label}
                    className="bg-[linear-gradient(135deg,_white_0%,_#eef3fb_100%)]"
                  >
                    <CardContent className="py-5">
                      <p className="text-sm text-slate-500">{stat.label}</p>
                      <p className={cn("text-2xl font-semibold", stat.tone)}>
                        {formatFinanceAmount(stat.value)}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="grid gap-6 xl:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Monthly expense summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {(dash?.monthlyExpenseSummary ?? []).length === 0 ? (
                      <p className="text-sm text-slate-500">No expense data.</p>
                    ) : (
                      <ul className="divide-y divide-slate-100 text-sm">
                        {dash?.monthlyExpenseSummary.map((row) => (
                          <li
                            key={row.month}
                            className="flex justify-between py-2"
                          >
                            <span>{row.month}</span>
                            <span className="font-medium text-rose-700">
                              {formatFinanceAmount(row.amountNpr)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Monthly income summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {(dash?.monthlyIncomeSummary ?? []).length === 0 ? (
                      <p className="text-sm text-slate-500">No income data.</p>
                    ) : (
                      <ul className="divide-y divide-slate-100 text-sm">
                        {dash?.monthlyIncomeSummary.map((row) => (
                          <li
                            key={row.month}
                            className="flex justify-between py-2"
                          >
                            <span>{row.month}</span>
                            <span className="font-medium text-emerald-700">
                              {formatFinanceAmount(row.amountNpr)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Recent transactions</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {(dash?.recentTransactions ?? []).length === 0 ? (
                    <div className="p-6">
                      <EmptyState
                        title="No recent transactions"
                        description="New finance entries will appear here."
                      />
                    </div>
                  ) : (
                    <StickyTableScroll
                      maxHeightClassName="max-h-[min(40vh,360px)]"
                      header={
                        <Table className="w-full min-w-[900px] table-fixed">
                          <colgroup>
                            <col className="w-[14%]" />
                            <col className="w-[12%]" />
                            <col className="w-[22%]" />
                            <col className="w-[20%]" />
                            <col className="w-[16%]" />
                            <col className="w-[16%]" />
                          </colgroup>
                          <TableHead>
                            <tr>
                              <Th className="bg-slate-50 whitespace-nowrap">Date</Th>
                              <Th className="bg-slate-50 whitespace-nowrap">Type</Th>
                              <Th className="bg-slate-50 whitespace-nowrap">Title</Th>
                              <Th className="bg-slate-50 whitespace-nowrap">Vendor</Th>
                              <Th className="bg-slate-50 whitespace-nowrap">Category</Th>
                              <Th className="bg-slate-50 whitespace-nowrap text-right">
                                Amount
                              </Th>
                            </tr>
                          </TableHead>
                        </Table>
                      }
                      body={
                        <Table className="w-full min-w-[900px] table-fixed">
                          <colgroup>
                            <col className="w-[14%]" />
                            <col className="w-[12%]" />
                            <col className="w-[22%]" />
                            <col className="w-[20%]" />
                            <col className="w-[16%]" />
                            <col className="w-[16%]" />
                          </colgroup>
                          <TableBody>
                            {(dash?.recentTransactions ?? []).map((tx) => {
                              const vendorLabel =
                                tx.transactionType === "INCOME"
                                  ? tx.vendorPayee?.trim() ||
                                    tx.incomeSource?.trim() ||
                                    "—"
                                  : tx.vendorPayee?.trim() || "—";
                              return (
                                <tr key={tx._id} className="align-top">
                                  <Td className="whitespace-nowrap tabular-nums text-sm">
                                    {tx.dateBs}
                                  </Td>
                                  <Td>
                                    <Badge
                                      className={transactionTypeBadgeClass(
                                        tx.transactionType,
                                      )}
                                    >
                                      {transactionTypeLabel(tx.transactionType)}
                                    </Badge>
                                  </Td>
                                  <Td
                                    className="truncate font-medium"
                                    title={tx.title}
                                  >
                                    {tx.title}
                                  </Td>
                                  <Td
                                    className="truncate text-sm text-slate-700"
                                    title={
                                      vendorLabel !== "—"
                                        ? vendorLabel
                                        : undefined
                                    }
                                  >
                                    {vendorLabel}
                                  </Td>
                                  <Td
                                    className="truncate text-sm"
                                    title={tx.categoryName ?? undefined}
                                  >
                                    {tx.categoryName ?? "—"}
                                  </Td>
                                  <Td className="whitespace-nowrap text-right tabular-nums text-sm font-medium">
                                    {formatFinanceAmount(tx.amountNpr)}
                                  </Td>
                                </tr>
                              );
                            })}
                          </TableBody>
                        </Table>
                      }
                    />
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      {/* ─── Transactions ────────────────────────────────────────── */}
      {tab === "transactions" && (
        <div className="space-y-4">
          <Card>
            <CardContent className="grid gap-3 py-4 md:grid-cols-2 xl:grid-cols-4">
              <FormField label="Search">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    className="pl-9"
                    placeholder="Title, vendor, reference…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </FormField>
              <FormField label="Type">
                <Select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                >
                  <option value="">All types</option>
                  {FINANCE_TRANSACTION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {transactionTypeLabel(t)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Category">
                <Select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                >
                  <option value="">All categories</option>
                  {(categoriesQuery.data ?? []).map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Payment method">
                <Select
                  value={paymentFilter}
                  onChange={(e) => setPaymentFilter(e.target.value)}
                >
                  <option value="">All methods</option>
                  {FINANCE_PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {paymentMethodLabel(m)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="From date (BS)">
                <NepaliDateField value={fromDateBs} onChange={setFromDateBs} />
              </FormField>
              <FormField label="To date (BS)">
                <NepaliDateField value={toDateBs} onChange={setToDateBs} />
              </FormField>
              {isAdmin ? (
                <>
                  <FormField label="Record source">
                    <Select
                      value={ownerScopeFilter}
                      onChange={(e) => setOwnerScopeFilter(e.target.value)}
                    >
                      <option value="">All sources</option>
                      {FINANCE_OWNER_SCOPES.map((scope) => (
                        <option key={scope} value={scope}>
                          {ownerScopeLabel(scope)}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Recorded by">
                    <Select
                      value={createdByFilter}
                      onChange={(e) => setCreatedByFilter(e.target.value)}
                    >
                      <option value="">Anyone</option>
                      <optgroup label="Staff (with access)">
                        {staffWithAccess.map((s) => (
                          <option key={s.userId} value={s.userId}>
                            {s.fullName}
                            {s.staffCode ? ` (${s.staffCode})` : ""}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="College Administrators">
                        {(collegeAdminsQuery.data ?? [])
                          .filter((a) => !a.isDeleted)
                          .map((a) => (
                            <option key={a._id} value={a._id}>
                              {a.fullName}
                            </option>
                          ))}
                      </optgroup>
                    </Select>
                  </FormField>
                </>
              ) : null}
              <div className="flex flex-wrap items-end gap-2 md:col-span-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch("");
                    setTypeFilter("");
                    setCategoryFilter("");
                    setPaymentFilter("");
                    setFromDateBs("");
                    setToDateBs("");
                    setOwnerScopeFilter("");
                    setCreatedByFilter("");
                  }}
                >
                  Clear filters
                </Button>
                <Button
                  variant="secondary"
                  disabled={transactions.length === 0}
                  onClick={() => {
                    try {
                      exportTransactionsExcel(transactions);
                      toast.success("Exported list to Excel");
                    } catch (e) {
                      toast.error(parseErrorMessage(e));
                    }
                  }}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Export list
                </Button>
                <Button
                  variant="secondary"
                  disabled={transactions.length === 0}
                  onClick={() => {
                    try {
                      exportTransactionsLedgerExcel(transactions, {
                        title: "Finance Management — Transaction Ledger",
                        fromDateBs: fromDateBs || undefined,
                        toDateBs: toDateBs || undefined,
                        generatedAt: new Date().toLocaleString(),
                      });
                      toast.success("Ledger exported to Excel");
                    } catch (e) {
                      toast.error(parseErrorMessage(e));
                    }
                  }}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Ledger Excel
                </Button>
                <Button
                  variant="secondary"
                  disabled={transactions.length === 0}
                  onClick={() => {
                    void (async () => {
                      const toastId = toast.loading("Preparing ledger PDF…");
                      try {
                        await exportTransactionsLedgerPdf(transactions, {
                          title: "Finance Management — Transaction Ledger",
                          fromDateBs: fromDateBs || undefined,
                          toDateBs: toDateBs || undefined,
                          generatedAt: new Date().toLocaleString(),
                        });
                        toast.success("Ledger PDF downloaded", { id: toastId });
                      } catch (e) {
                        toast.error(parseErrorMessage(e), { id: toastId });
                      }
                    })();
                  }}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  Ledger PDF
                </Button>
                <Button
                  variant="outline"
                  disabled={transactions.length === 0}
                  onClick={() => {
                    try {
                      printTransactionsLedger(transactions, {
                        title: "Finance Management — Transaction Ledger",
                        fromDateBs: fromDateBs || undefined,
                        toDateBs: toDateBs || undefined,
                        generatedAt: new Date().toLocaleString(),
                      });
                    } catch (e) {
                      toast.error(parseErrorMessage(e));
                    }
                  }}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Print ledger
                </Button>
                <Button onClick={() => setTab("entry")}>
                  <Plus className="mr-2 h-4 w-4" />
                  New entry
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                All transactions ({transactions.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {transactionsQuery.isLoading ? (
                <div className="p-6">
                  <LoadingState />
                </div>
              ) : transactions.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No transactions"
                    description="Record an expense or income entry to build the finance archive."
                  />
                </div>
              ) : (
                <StickyTableScroll
                  maxHeightClassName="max-h-[min(70vh,640px)]"
                  header={
                    <Table
                      className={cn(
                        "w-full table-fixed",
                        isAdmin ? "min-w-[1400px]" : "min-w-[1280px]",
                      )}
                    >
                      <colgroup>
                        <col className="w-[7%]" />
                        <col className="w-[7%]" />
                        {isAdmin ? <col className="w-[9%]" /> : null}
                        <col className="w-[10%]" />
                        <col className="w-[12%]" />
                        <col className="w-[10%]" />
                        <col className="w-[9%]" />
                        <col className="w-[8%]" />
                        <col className="w-[8%]" />
                        <col className="w-[7%]" />
                        <col className="w-[8%]" />
                        <col className="w-[8%]" />
                      </colgroup>
                      <TableHead>
                        <tr>
                          <Th className="bg-slate-50 whitespace-nowrap">Date</Th>
                          <Th className="bg-slate-50 whitespace-nowrap">Type</Th>
                          {isAdmin ? (
                            <Th className="bg-slate-50 whitespace-nowrap">Source</Th>
                          ) : null}
                          <Th className="bg-slate-50 whitespace-nowrap">Category</Th>
                          <Th className="bg-slate-50 whitespace-nowrap">Title</Th>
                          <Th className="bg-slate-50 whitespace-nowrap">Vendor</Th>
                          <Th className="bg-slate-50 whitespace-nowrap text-right">
                            Amount
                          </Th>
                          <Th className="bg-slate-50 whitespace-nowrap">Payment</Th>
                          <Th className="bg-slate-50 whitespace-nowrap">Reference</Th>
                          <Th className="bg-slate-50 whitespace-nowrap">
                            Attachments
                          </Th>
                          <Th className="bg-slate-50 whitespace-nowrap">Created by</Th>
                          <Th className="bg-slate-50 whitespace-nowrap text-right">
                            Actions
                          </Th>
                        </tr>
                      </TableHead>
                    </Table>
                  }
                  body={
                    <Table
                      className={cn(
                        "w-full table-fixed",
                        isAdmin ? "min-w-[1400px]" : "min-w-[1280px]",
                      )}
                    >
                      <colgroup>
                        <col className="w-[7%]" />
                        <col className="w-[7%]" />
                        {isAdmin ? <col className="w-[9%]" /> : null}
                        <col className="w-[10%]" />
                        <col className="w-[12%]" />
                        <col className="w-[10%]" />
                        <col className="w-[9%]" />
                        <col className="w-[8%]" />
                        <col className="w-[8%]" />
                        <col className="w-[7%]" />
                        <col className="w-[8%]" />
                        <col className="w-[8%]" />
                      </colgroup>
                      <TableBody>
                        {transactions.map((tx) => {
                          const vendorLabel =
                            tx.transactionType === "INCOME"
                              ? tx.vendorPayee?.trim() ||
                                tx.incomeSource?.trim() ||
                                "—"
                              : tx.vendorPayee?.trim() || "—";
                          return (
                            <tr key={tx._id} className="align-top">
                              <Td className="whitespace-nowrap tabular-nums text-sm">
                                {tx.dateBs}
                              </Td>
                              <Td>
                                <Badge
                                  className={transactionTypeBadgeClass(
                                    tx.transactionType,
                                  )}
                                >
                                  {transactionTypeLabel(tx.transactionType)}
                                </Badge>
                              </Td>
                              {isAdmin ? (
                                <Td className="text-sm">
                                  <Badge
                                    className={
                                      tx.ownerScope === "COLLEGE_ADMINISTRATOR"
                                        ? "bg-violet-100 text-violet-800"
                                        : tx.ownerScope === "STAFF"
                                          ? "bg-sky-100 text-sky-800"
                                          : "bg-slate-100 text-slate-700"
                                    }
                                  >
                                    {ownerScopeLabel(tx.ownerScope)}
                                  </Badge>
                                </Td>
                              ) : null}
                              <Td
                                className="truncate text-sm"
                                title={tx.categoryName ?? undefined}
                              >
                                {tx.categoryName ?? "—"}
                              </Td>
                              <Td
                                className="truncate font-medium"
                                title={tx.title}
                              >
                                {tx.title}
                              </Td>
                              <Td
                                className="truncate text-sm text-slate-700"
                                title={
                                  vendorLabel !== "—" ? vendorLabel : undefined
                                }
                              >
                                {vendorLabel}
                              </Td>
                              <Td className="whitespace-nowrap text-right tabular-nums text-sm font-medium">
                                {formatFinanceAmount(tx.amountNpr)}
                              </Td>
                              <Td className="truncate text-sm">
                                {paymentMethodLabel(tx.paymentMethod)}
                              </Td>
                              <Td
                                className="truncate text-sm"
                                title={tx.referenceNumber || undefined}
                              >
                                {tx.referenceNumber || "—"}
                              </Td>
                              <Td className="text-sm">
                                {attachmentStatusLabel(
                                  tx.attachments?.length ?? 0,
                                )}
                              </Td>
                              <Td className="text-sm text-slate-600">
                                <div
                                  className="truncate"
                                  title={tx.createdByName ?? undefined}
                                >
                                  {tx.createdByName ?? "—"}
                                </div>
                                {tx.updatedAt ? (
                                  <div className="truncate text-xs text-slate-400">
                                    Upd.{" "}
                                    {new Date(
                                      tx.updatedAt,
                                    ).toLocaleDateString()}
                                  </div>
                                ) : null}
                              </Td>
                              <Td className="whitespace-nowrap text-right">
                                {canEditTransactions ? (
                                  <div className="inline-flex flex-wrap justify-end gap-1">
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      onClick={() => startEdit(tx)}
                                    >
                                      Edit
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="border-rose-200 text-rose-700"
                                      onClick={() => {
                                        if (
                                          window.confirm(
                                            `Delete "${tx.title}" (${tx.dateBs})? Attachments will be removed.`,
                                          )
                                        ) {
                                          deleteTransaction.mutate(tx._id);
                                        }
                                      }}
                                    >
                                      Delete
                                    </Button>
                                  </div>
                                ) : (
                                  <span className="text-xs text-slate-400">View only</span>
                                )}
                              </Td>
                            </tr>
                          );
                        })}
                      </TableBody>
                    </Table>
                  }
                />
              )}
              {transactions.length > 0 ? (
                <div className="border-t border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-xl border border-emerald-100 bg-white px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Total income
                      </p>
                      <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-700">
                        {formatFinanceAmount(transactionTotals.totalIncomeNpr)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-rose-100 bg-white px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Total expenses
                      </p>
                      <p className="mt-1 text-lg font-semibold tabular-nums text-rose-700">
                        {formatFinanceAmount(transactionTotals.totalExpensesNpr)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-amber-100 bg-white px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Total credit
                      </p>
                      <p className="mt-1 text-lg font-semibold tabular-nums text-amber-800">
                        {formatFinanceAmount(transactionTotals.totalCreditNpr)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-brand-100 bg-white px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Total amount (net)
                      </p>
                      <p
                        className={cn(
                          "mt-1 text-lg font-semibold tabular-nums",
                          transactionTotals.totalAmountNpr >= 0
                            ? "text-brand-700"
                            : "text-rose-700",
                        )}
                      >
                        {formatFinanceAmount(transactionTotals.totalAmountNpr)}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        Income − expenses · credit excluded
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── Entry form ──────────────────────────────────────────── */}
      {tab === "entry" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-brand-600" />
              {editingId
                ? "Edit transaction"
                : "Record expense, income, or credit"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <FormField label="Transaction type">
                <Select
                  value={entryForm.transactionType}
                  onChange={(e) => {
                    const type = e.target.value as FinanceTransactionType;
                    setEntryForm((c) => ({
                      ...c,
                      transactionType: type,
                      expenseType:
                        type === "EXPENSE"
                          ? c.expenseType ?? "COLLEGE_EXPENSE"
                          : undefined,
                      incomeSource: type === "INCOME" ? c.incomeSource : "",
                      categoryId: "",
                      paymentMethod:
                        type === "CREDIT" && c.paymentMethod === "CASH"
                          ? "OTHER"
                          : c.paymentMethod,
                    }));
                  }}
                >
                  {FINANCE_TRANSACTION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {transactionTypeLabel(t)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Date (BS)">
                <NepaliDateField
                  value={entryForm.dateBs}
                  onChange={(v) => setEntryForm((c) => ({ ...c, dateBs: v }))}
                />
              </FormField>
              <FormField label="Title">
                <Input
                  value={entryForm.title}
                  onChange={(e) =>
                    setEntryForm((c) => ({ ...c, title: e.target.value }))
                  }
                  placeholder="e.g. Lab equipment purchase"
                />
              </FormField>
              <FormField label="Category">
                <Select
                  value={entryForm.categoryId}
                  onChange={(e) =>
                    setEntryForm((c) => ({ ...c, categoryId: e.target.value }))
                  }
                >
                  <option value="">Select category</option>
                  {entryCategories.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              {entryForm.transactionType === "EXPENSE" ? (
                <FormField label="Expense type">
                  <Select
                    value={entryForm.expenseType ?? "COLLEGE_EXPENSE"}
                    onChange={(e) =>
                      setEntryForm((c) => ({
                        ...c,
                        expenseType: e.target.value as FinanceExpenseType,
                      }))
                    }
                  >
                    {FINANCE_EXPENSE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {expenseTypeLabel(t)}
                      </option>
                    ))}
                  </Select>
                </FormField>
              ) : entryForm.transactionType === "INCOME" ? (
                <FormField label="Income source">
                  <Input
                    value={entryForm.incomeSource ?? ""}
                    onChange={(e) =>
                      setEntryForm((c) => ({
                        ...c,
                        incomeSource: e.target.value,
                      }))
                    }
                    placeholder="e.g. Donor name / program"
                  />
                </FormField>
              ) : (
                <FormField label="Credit party / notes">
                  <Input
                    value={entryForm.vendorPayee ?? ""}
                    onChange={(e) =>
                      setEntryForm((c) => ({
                        ...c,
                        vendorPayee: e.target.value,
                      }))
                    }
                    placeholder="Supplier or party the credit is with"
                  />
                </FormField>
              )}
              {entryForm.transactionType !== "CREDIT" ? (
                <FormField label="Vendor / payee">
                  <Input
                    value={entryForm.vendorPayee ?? ""}
                    onChange={(e) =>
                      setEntryForm((c) => ({
                        ...c,
                        vendorPayee: e.target.value,
                      }))
                    }
                  />
                </FormField>
              ) : null}
              <FormField label="Amount (NPR)">
                <NumberInput
                  min={0}
                  value={entryForm.amountNpr || ""}
                  onChange={(e) =>
                    setEntryForm((c) => ({
                      ...c,
                      amountNpr: e.target.valueAsNumber || 0,
                    }))
                  }
                />
              </FormField>
              <FormField label="Payment method">
                <Select
                  value={entryForm.paymentMethod}
                  onChange={(e) =>
                    setEntryForm((c) => ({
                      ...c,
                      paymentMethod: e.target.value as FinancePaymentMethod,
                    }))
                  }
                >
                  {FINANCE_PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {paymentMethodLabel(m)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Reference number">
                <Input
                  value={entryForm.referenceNumber ?? ""}
                  onChange={(e) =>
                    setEntryForm((c) => ({
                      ...c,
                      referenceNumber: e.target.value,
                    }))
                  }
                  placeholder="Cheque / invoice / receipt no."
                />
              </FormField>
            </div>
            <FormField label="Description">
              <Textarea
                value={entryForm.description ?? ""}
                onChange={(e) =>
                  setEntryForm((c) => ({ ...c, description: e.target.value }))
                }
                rows={3}
              />
            </FormField>
            <FormField label="Remarks">
              <Textarea
                value={entryForm.remarks ?? ""}
                onChange={(e) =>
                  setEntryForm((c) => ({ ...c, remarks: e.target.value }))
                }
                rows={2}
              />
            </FormField>

            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-800">
                  <Paperclip className="mr-1 inline h-4 w-4" />
                  Attachments (bills, receipts, invoices, PDFs, images)
                </p>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">
                  {uploading ? "Uploading…" : "Upload files"}
                  <input
                    type="file"
                    className="hidden"
                    multiple
                    accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx,image/*,application/pdf"
                    disabled={uploading}
                    onChange={(e) => {
                      void onPickFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              {(entryForm.attachments ?? []).length === 0 ? (
                <p className="text-xs text-slate-500">
                  No files attached yet. Images and documents are stored via the
                  project upload service.
                </p>
              ) : (
                <ul className="space-y-2">
                  {(entryForm.attachments as FinanceAttachment[]).map(
                    (file, index) => (
                      <li
                        key={`${file.url}-${index}`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{file.originalName}</p>
                          <p className="text-xs text-slate-500">
                            {file.mimeType} · {(file.size / 1024).toFixed(1)} KB
                          </p>
                        </div>
                        <div className="flex gap-1">
                          {isImageAttachment(file.mimeType, file.originalName) ||
                          isPdfAttachment(file.mimeType, file.originalName) ? (
                            <Button size="sm" variant="outline" asChild>
                              <a
                                href={mediaHref(file.url)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open
                              </a>
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" asChild>
                              <a href={mediaHref(file.url)} download>
                                Download
                              </a>
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-rose-200 text-rose-700"
                            onClick={() => removeAttachment(index)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </li>
                    ),
                  )}
                </ul>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={submitEntry}
                disabled={saveTransaction.isPending || uploading}
              >
                {editingId ? "Update transaction" : "Save transaction"}
              </Button>
              {editingId ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditingId(null);
                    setEntryForm(emptyEntry());
                  }}
                >
                  Cancel edit
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Categories ──────────────────────────────────────────── */}
      {tab === "staff-access" && isAdmin && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-5 w-5 text-brand-600" />
                Staff Finance Access
              </CardTitle>
              <p className="text-sm text-slate-500">
                Grant Finance Management to individual college staff. When enabled,
                they can record and view their own personal transactions only.
                Edit and delete remain Administrator-only.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField label="Search staff">
                <div className="relative max-w-md">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    className="pl-9"
                    placeholder="Name, staff ID, email, department…"
                    value={staffAccessSearch}
                    onChange={(e) => setStaffAccessSearch(e.target.value)}
                  />
                </div>
              </FormField>

              {staffAccessQuery.isLoading ? (
                <LoadingState />
              ) : (staffAccessQuery.data ?? []).length === 0 ? (
                <EmptyState
                  title="No college staff found"
                  description="Add staff under Staff Management, then grant finance access here."
                />
              ) : (
                <StickyTableScroll
                  maxHeightClassName="max-h-[min(70vh,640px)]"
                  header={
                    <Table className="w-full min-w-[1100px] table-fixed">
                      <colgroup>
                        <col className="w-[10%]" />
                        <col className="w-[16%]" />
                        <col className="w-[14%]" />
                        <col className="w-[12%]" />
                        <col className="w-[12%]" />
                        <col className="w-[10%]" />
                        <col className="w-[10%]" />
                        <col className="w-[16%]" />
                      </colgroup>
                      <TableHead>
                        <tr>
                          <Th className="bg-slate-50">Staff ID</Th>
                          <Th className="bg-slate-50">Name</Th>
                          <Th className="bg-slate-50">Designation</Th>
                          <Th className="bg-slate-50">Department</Th>
                          <Th className="bg-slate-50">Category</Th>
                          <Th className="bg-slate-50">Login</Th>
                          <Th className="bg-slate-50">Status</Th>
                          <Th className="bg-slate-50 text-right">Finance access</Th>
                        </tr>
                      </TableHead>
                    </Table>
                  }
                  body={
                    <Table className="w-full min-w-[1100px] table-fixed">
                      <colgroup>
                        <col className="w-[10%]" />
                        <col className="w-[16%]" />
                        <col className="w-[14%]" />
                        <col className="w-[12%]" />
                        <col className="w-[12%]" />
                        <col className="w-[10%]" />
                        <col className="w-[10%]" />
                        <col className="w-[16%]" />
                      </colgroup>
                      <TableBody>
                        {(staffAccessQuery.data ?? []).map((staff) => (
                          <tr key={staff.staffId} className="align-middle">
                            <Td className="text-sm tabular-nums">{staff.staffCode}</Td>
                            <Td>
                              <div className="font-medium">{staff.fullName}</div>
                              <div className="truncate text-xs text-slate-500">
                                {staff.email || staff.phone || "—"}
                              </div>
                            </Td>
                            <Td className="truncate text-sm">{staff.designation}</Td>
                            <Td className="truncate text-sm">{staff.department || "—"}</Td>
                            <Td className="truncate text-sm">
                              {staff.categoryLabel || staff.category}
                            </Td>
                            <Td className="text-sm">
                              {staff.hasLogin ? (
                                <Badge className="bg-emerald-100 text-emerald-800">
                                  Linked
                                </Badge>
                              ) : (
                                <Badge className="bg-slate-100 text-slate-600">
                                  No login
                                </Badge>
                              )}
                            </Td>
                            <Td className="text-sm">
                              <Badge
                                className={
                                  staff.status === "ACTIVE"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-amber-100 text-amber-800"
                                }
                              >
                                {staff.status}
                              </Badge>
                            </Td>
                            <Td className="text-right">
                              {staff.hasLogin && staff.userId ? (
                                <Button
                                  size="sm"
                                  variant={
                                    staff.financeAccessEnabled
                                      ? "outline"
                                      : "default"
                                  }
                                  className={
                                    staff.financeAccessEnabled
                                      ? "border-rose-200 text-rose-700"
                                      : "bg-brand-600 hover:bg-brand-700"
                                  }
                                  disabled={setStaffAccess.isPending}
                                  onClick={() => {
                                    if (!staff.userId) return;
                                    const next = !staff.financeAccessEnabled;
                                    const ok = window.confirm(
                                      next
                                        ? `Grant Finance Management to ${staff.fullName}? They will be able to record personal transactions only.`
                                        : `Revoke Finance Management from ${staff.fullName}? They will no longer see the menu.`,
                                    );
                                    if (!ok) return;
                                    setStaffAccess.mutate({
                                      userId: staff.userId,
                                      enabled: next,
                                    });
                                  }}
                                >
                                  {staff.financeAccessEnabled
                                    ? "Revoke access"
                                    : "Grant access"}
                                </Button>
                              ) : (
                                <span className="text-xs text-slate-400">
                                  Enable staff login first
                                </span>
                              )}
                            </Td>
                          </tr>
                        ))}
                      </TableBody>
                    </Table>
                  }
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "categories" && isAdmin && (
        <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {editingCategoryId ? "Edit category" : "Create category"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <FormField label="Name">
                <Input
                  value={categoryForm.name}
                  onChange={(e) =>
                    setCategoryForm((c) => ({ ...c, name: e.target.value }))
                  }
                />
              </FormField>
              <FormField label="Kind">
                <Select
                  value={categoryForm.kind}
                  onChange={(e) =>
                    setCategoryForm((c) => ({
                      ...c,
                      kind: e.target.value as FinanceCategoryInput["kind"],
                    }))
                  }
                >
                  <option value="EXPENSE">Expense</option>
                  <option value="INCOME">Income</option>
                  <option value="BOTH">Both</option>
                </Select>
              </FormField>
              <FormField label="Description">
                <Textarea
                  value={categoryForm.description ?? ""}
                  onChange={(e) =>
                    setCategoryForm((c) => ({
                      ...c,
                      description: e.target.value,
                    }))
                  }
                />
              </FormField>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={categoryForm.isActive ?? true}
                  onChange={(e) =>
                    setCategoryForm((c) => ({
                      ...c,
                      isActive: e.target.checked,
                    }))
                  }
                />
                Active
              </label>
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    const parsed = financeCategorySchema.safeParse(categoryForm);
                    if (!parsed.success) {
                      return toast.error(
                        parsed.error.issues[0]?.message ?? "Invalid category",
                      );
                    }
                    saveCategory.mutate(parsed.data);
                  }}
                  disabled={saveCategory.isPending}
                >
                  {editingCategoryId ? "Update" : "Create"}
                </Button>
                {editingCategoryId ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setEditingCategoryId(null);
                      setCategoryForm({
                        name: "",
                        kind: "EXPENSE",
                        description: "",
                        isActive: true,
                      });
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Categories ({categoriesQuery.data?.length ?? 0})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <StickyTableScroll
                maxHeightClassName="max-h-[min(60vh,560px)]"
                header={
                  <Table className="w-full min-w-[640px]">
                    <TableHead>
                      <tr>
                        <Th className="bg-slate-50">Name</Th>
                        <Th className="bg-slate-50">Kind</Th>
                        <Th className="bg-slate-50">Status</Th>
                        <Th className="bg-slate-50 text-right">Actions</Th>
                      </tr>
                    </TableHead>
                  </Table>
                }
                body={
                  <Table className="w-full min-w-[640px]">
                    <TableBody>
                      {(categoriesQuery.data ?? []).map((cat) => (
                        <tr key={cat._id}>
                          <Td>
                            <div className="font-medium">{cat.name}</div>
                            {cat.isSystem ? (
                              <span className="text-xs text-slate-400">
                                Default
                              </span>
                            ) : null}
                          </Td>
                          <Td>{cat.kind}</Td>
                          <Td>
                            <Badge
                              className={
                                cat.isActive
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-slate-100 text-slate-600"
                              }
                            >
                              {cat.isActive ? "Active" : "Disabled"}
                            </Badge>
                          </Td>
                          <Td className="space-x-1 text-right whitespace-nowrap">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setEditingCategoryId(cat._id);
                                setCategoryForm({
                                  name: cat.name,
                                  kind: cat.kind,
                                  description: cat.description ?? "",
                                  isActive: cat.isActive,
                                  sortOrder: cat.sortOrder,
                                });
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={toggleCategoryActive.isPending}
                              onClick={() =>
                                toggleCategoryActive.mutate({
                                  id: cat._id,
                                  payload: {
                                    name: cat.name,
                                    kind: cat.kind,
                                    description: cat.description ?? "",
                                    isActive: !cat.isActive,
                                    sortOrder: cat.sortOrder,
                                  },
                                })
                              }
                            >
                              {cat.isActive ? "Disable" : "Enable"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-rose-200 text-rose-700"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Delete category "${cat.name}"? Only unused categories can be deleted.`,
                                  )
                                ) {
                                  deleteCategory.mutate(cat._id);
                                }
                              }}
                            >
                              Delete
                            </Button>
                          </Td>
                        </tr>
                      ))}
                    </TableBody>
                  </Table>
                }
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── Reports ─────────────────────────────────────────────── */}
      {tab === "reports" && (
        <div className="space-y-4">
          <Card>
            <CardContent className="grid gap-3 py-4 md:grid-cols-2 xl:grid-cols-4">
              <FormField label="Report type">
                <Select
                  value={reportType}
                  onChange={(e) => setReportType(e.target.value)}
                >
                  <option value="ALL">All transactions</option>
                  <option value="COLLEGE_EXPENSES">College expenses</option>
                  <option value="OTHER_EXPENSES">Other / external expenses</option>
                  <option value="EXPENSES">All expenses</option>
                  <option value="INCOME">Income records</option>
                  <option value="CREDIT">Credit transactions</option>
                  <option value="CATEGORY">Category-wise</option>
                  <option value="MONTHLY">Monthly</option>
                  <option value="YEARLY">Yearly</option>
                </Select>
              </FormField>
              <FormField label="Category">
                <Select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                >
                  <option value="">All</option>
                  {(categoriesQuery.data ?? []).map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="From (BS)">
                <NepaliDateField value={fromDateBs} onChange={setFromDateBs} />
              </FormField>
              <FormField label="To (BS)">
                <NepaliDateField value={toDateBs} onChange={setToDateBs} />
              </FormField>
              <FormField label="Year (BS)">
                <Input
                  value={dashYear}
                  onChange={(e) => setDashYear(e.target.value)}
                  placeholder="e.g. 2082"
                />
              </FormField>
              <FormField label="Month">
                <Input
                  value={dashMonth}
                  onChange={(e) => setDashMonth(e.target.value)}
                  placeholder="1–12"
                />
              </FormField>
              {isAdmin ? (
                <>
                  <FormField label="Record source">
                    <Select
                      value={ownerScopeFilter}
                      onChange={(e) => setOwnerScopeFilter(e.target.value)}
                    >
                      <option value="">All sources</option>
                      {FINANCE_OWNER_SCOPES.map((scope) => (
                        <option key={scope} value={scope}>
                          {ownerScopeLabel(scope)}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Recorded by">
                    <Select
                      value={createdByFilter}
                      onChange={(e) => setCreatedByFilter(e.target.value)}
                    >
                      <option value="">Anyone</option>
                      <optgroup label="Staff (with access)">
                        {staffWithAccess.map((s) => (
                          <option key={s.userId} value={s.userId}>
                            {s.fullName}
                            {s.staffCode ? ` (${s.staffCode})` : ""}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="College Administrators">
                        {(collegeAdminsQuery.data ?? [])
                          .filter((a) => !a.isDeleted)
                          .map((a) => (
                            <option key={a._id} value={a._id}>
                              {a.fullName}
                            </option>
                          ))}
                      </optgroup>
                    </Select>
                  </FormField>
                </>
              ) : null}
              <div className="flex flex-wrap items-end gap-2 md:col-span-2">
                <Button
                  variant="outline"
                  disabled={!report?.rows.length}
                  onClick={() => {
                    if (!report) return;
                    try {
                      printFinanceReport(report);
                    } catch (e) {
                      toast.error(parseErrorMessage(e));
                    }
                  }}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Print list
                </Button>
                <Button
                  variant="outline"
                  disabled={!report?.rows.length}
                  onClick={() => {
                    if (!report) return;
                    try {
                      exportFinanceReportExcel(report);
                      toast.success("Report list exported");
                    } catch (e) {
                      toast.error(parseErrorMessage(e));
                    }
                  }}
                >
                  <Download className="mr-2 h-4 w-4" />
                  List Excel
                </Button>
                <Button
                  variant="secondary"
                  disabled={!report?.rows.length}
                  onClick={() => {
                    if (!report) return;
                    try {
                      exportFinanceReportLedgerExcel(report, {
                        fromDateBs: fromDateBs || undefined,
                        toDateBs: toDateBs || undefined,
                      });
                      toast.success("Ledger exported to Excel");
                    } catch (e) {
                      toast.error(parseErrorMessage(e));
                    }
                  }}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Ledger Excel
                </Button>
                <Button
                  variant="secondary"
                  disabled={!report?.rows.length}
                  onClick={() => {
                    if (!report) return;
                    void (async () => {
                      const toastId = toast.loading("Preparing ledger PDF…");
                      try {
                        await exportFinanceReportLedgerPdf(report, {
                          fromDateBs: fromDateBs || undefined,
                          toDateBs: toDateBs || undefined,
                        });
                        toast.success("Ledger PDF downloaded", { id: toastId });
                      } catch (e) {
                        toast.error(parseErrorMessage(e), { id: toastId });
                      }
                    })();
                  }}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  Ledger PDF
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {report?.title ?? "Finance report"}
              </CardTitle>
              {report ? (
                <p className="text-sm text-slate-500">
                  {report.totals.count} row(s) · Expenses{" "}
                  {formatFinanceAmount(report.totals.expenseNpr)} · Income{" "}
                  {formatFinanceAmount(report.totals.incomeNpr)} · Net{" "}
                  {formatFinanceAmount(report.totals.netNpr)}
                </p>
              ) : null}
            </CardHeader>
            <CardContent className="p-0">
              {reportQuery.isLoading ? (
                <div className="p-6">
                  <LoadingState />
                </div>
              ) : !report?.rows.length ? (
                <div className="p-6">
                  <EmptyState
                    title="No rows"
                    description="Adjust filters to generate a report."
                  />
                </div>
              ) : (
                <StickyTableScroll
                  header={
                    <Table className="w-full min-w-[1100px] table-fixed">
                      <colgroup>
                        <col className="w-[10%]" />
                        <col className="w-[10%]" />
                        <col className="w-[12%]" />
                        <col className="w-[16%]" />
                        <col className="w-[14%]" />
                        <col className="w-[12%]" />
                        <col className="w-[10%]" />
                        <col className="w-[10%]" />
                        <col className="w-[6%]" />
                      </colgroup>
                      <TableHead>
                        <tr>
                          <Th className="bg-slate-50 whitespace-nowrap">Date</Th>
                          <Th className="bg-slate-50 whitespace-nowrap">Type</Th>
                          <Th className="bg-slate-50 whitespace-nowrap">Category</Th>
                          <Th className="bg-slate-50 whitespace-nowrap">Title</Th>
                          <Th className="bg-slate-50 whitespace-nowrap">Vendor</Th>
                          <Th className="bg-slate-50 whitespace-nowrap text-right">
                            Amount
                          </Th>
                          <Th className="bg-slate-50 whitespace-nowrap">Payment</Th>
                          <Th className="bg-slate-50 whitespace-nowrap">Reference</Th>
                          <Th className="bg-slate-50 whitespace-nowrap">Files</Th>
                        </tr>
                      </TableHead>
                    </Table>
                  }
                  body={
                    <Table className="w-full min-w-[1100px] table-fixed">
                      <colgroup>
                        <col className="w-[10%]" />
                        <col className="w-[10%]" />
                        <col className="w-[12%]" />
                        <col className="w-[16%]" />
                        <col className="w-[14%]" />
                        <col className="w-[12%]" />
                        <col className="w-[10%]" />
                        <col className="w-[10%]" />
                        <col className="w-[6%]" />
                      </colgroup>
                      <TableBody>
                        {report.rows.map((row, index) => {
                          const vendorLabel =
                            row.transactionType === "INCOME"
                              ? row.vendorPayee?.trim() ||
                                row.incomeSource?.trim() ||
                                "—"
                              : row.vendorPayee?.trim() || "—";
                          return (
                            <tr
                              key={`${row.dateBs}-${row.title}-${index}`}
                              className="align-top"
                            >
                              <Td className="whitespace-nowrap tabular-nums text-sm">
                                {row.dateBs}
                              </Td>
                              <Td className="text-sm">
                                {transactionTypeLabel(row.transactionType)}
                              </Td>
                              <Td
                                className="truncate text-sm"
                                title={row.categoryName}
                              >
                                {row.categoryName}
                              </Td>
                              <Td
                                className="truncate font-medium"
                                title={row.title}
                              >
                                {row.title}
                              </Td>
                              <Td
                                className="truncate text-sm text-slate-700"
                                title={
                                  vendorLabel !== "—" ? vendorLabel : undefined
                                }
                              >
                                {vendorLabel}
                              </Td>
                              <Td className="whitespace-nowrap text-right tabular-nums text-sm font-medium">
                                {formatFinanceAmount(row.amountNpr)}
                              </Td>
                              <Td className="truncate text-sm">
                                {paymentMethodLabel(row.paymentMethod)}
                              </Td>
                              <Td
                                className="truncate text-sm"
                                title={row.referenceNumber || undefined}
                              >
                                {row.referenceNumber || "—"}
                              </Td>
                              <Td className="text-sm">{row.attachmentCount}</Td>
                            </tr>
                          );
                        })}
                      </TableBody>
                    </Table>
                  }
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};
