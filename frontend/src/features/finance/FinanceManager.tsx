import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  FINANCE_EXPENSE_TYPES,
  FINANCE_PAYMENT_METHODS,
  FINANCE_TRANSACTION_TYPES,
  canManageInstitution,
  financeCategorySchema,
  financeTransactionSchema,
  type FinanceAttachment,
  type FinanceCategoryInput,
  type FinanceCategoryRecord,
  type FinanceDashboardResponse,
  type FinanceExpenseType,
  type FinancePaymentMethod,
  type FinanceReportResponse,
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
  paymentMethodLabel,
  printFinanceReport,
  printTransactionsLedger,
  transactionTypeLabel,
  uploadFinanceAttachments,
} from "./financeUtils";

type Tab = "dashboard" | "transactions" | "entry" | "categories" | "reports";

const tabs: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "transactions", label: "Transactions", icon: List },
  { id: "entry", label: "Record entry", icon: Plus },
  { id: "categories", label: "Categories", icon: FolderOpen },
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
  paymentMethod: "CASH",
  referenceNumber: "",
  remarks: "",
  attachments: [],
});

export const FinanceManager = () => {
  const { user } = useAuth();
  const isAdmin = canManageInstitution(user?.role ?? "");

  const [tab, setTab] = useState<Tab>("dashboard");
  const [entryForm, setEntryForm] = useState<FinanceTransactionInput>(emptyEntry());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("");
  const [fromDateBs, setFromDateBs] = useState("");
  const [toDateBs, setToDateBs] = useState("");
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

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["finance"] }),
    ]);
  };

  const categoriesQuery = useQuery({
    queryKey: ["finance", "categories", "all"],
    queryFn: () =>
      unwrap<FinanceCategoryRecord[]>(
        api.get("/finance/categories", { params: { includeInactive: "true" } }),
      ),
    enabled: isAdmin,
  });

  const activeCategories = useMemo(
    () => (categoriesQuery.data ?? []).filter((c) => c.isActive),
    [categoriesQuery.data],
  );

  const entryCategories = useMemo(() => {
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
    }),
    [search, typeFilter, categoryFilter, paymentFilter, fromDateBs, toDateBs],
  );

  const transactionsQuery = useQuery({
    queryKey: ["finance", "transactions", filterParams],
    queryFn: () =>
      unwrap<FinanceTransactionRecord[]>(
        api.get("/finance/transactions", { params: filterParams }),
      ),
    enabled: isAdmin && (tab === "transactions" || tab === "entry"),
  });

  const dashboardQuery = useQuery({
    queryKey: ["finance", "dashboard", dashYear, dashMonth, categoryFilter],
    queryFn: () =>
      unwrap<FinanceDashboardResponse>(
        api.get("/finance/dashboard", {
          params: {
            yearBs: dashYear || undefined,
            monthBs: dashMonth || undefined,
            categoryId: categoryFilter || undefined,
          },
        }),
      ),
    enabled: isAdmin && tab === "dashboard",
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
    enabled: isAdmin && tab === "reports",
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

  if (!isAdmin) {
    return (
      <EmptyState
        title="Access restricted"
        description="Finance Management is available only to Administrator and System Administrator."
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
            <CardContent className="grid gap-3 py-4 md:grid-cols-3">
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
            </CardContent>
          </Card>

          {dashboardQuery.isLoading ? (
            <LoadingState />
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
                  <StickyTableScroll
                    maxHeightClassName="max-h-[min(40vh,360px)]"
                    header={
                      <Table className="w-full min-w-[800px]">
                        <TableHead>
                          <tr>
                            <Th className="bg-slate-50">Date</Th>
                            <Th className="bg-slate-50">Type</Th>
                            <Th className="bg-slate-50">Title</Th>
                            <Th className="bg-slate-50">Category</Th>
                            <Th className="bg-slate-50 text-right">Amount</Th>
                          </tr>
                        </TableHead>
                      </Table>
                    }
                    body={
                      <Table className="w-full min-w-[800px]">
                        <TableBody>
                          {(dash?.recentTransactions ?? []).map((tx) => (
                            <tr key={tx._id}>
                              <Td>{tx.dateBs}</Td>
                              <Td>{transactionTypeLabel(tx.transactionType)}</Td>
                              <Td className="font-medium">{tx.title}</Td>
                              <Td>{tx.categoryName ?? "—"}</Td>
                              <Td className="text-right tabular-nums">
                                {formatFinanceAmount(tx.amountNpr)}
                              </Td>
                            </tr>
                          ))}
                        </TableBody>
                      </Table>
                    }
                  />
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
                  }}
                >
                  Clear filters
                </Button>
                <Button
                  variant="secondary"
                  disabled={transactions.length === 0}
                  onClick={() => {
                    exportTransactionsExcel(transactions);
                    toast.success("Exported list to Excel");
                  }}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Export list
                </Button>
                <Button
                  variant="secondary"
                  disabled={transactions.length === 0}
                  onClick={() => {
                    exportTransactionsLedgerExcel(transactions, {
                      title: "Finance Management — Transaction Ledger",
                      fromDateBs: fromDateBs || undefined,
                      toDateBs: toDateBs || undefined,
                      generatedAt: new Date().toLocaleString(),
                    });
                    toast.success("Ledger exported to Excel");
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
                      try {
                        await exportTransactionsLedgerPdf(transactions, {
                          title: "Finance Management — Transaction Ledger",
                          fromDateBs: fromDateBs || undefined,
                          toDateBs: toDateBs || undefined,
                          generatedAt: new Date().toLocaleString(),
                        });
                        toast.success("Ledger PDF downloaded");
                      } catch (e) {
                        toast.error(parseErrorMessage(e));
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
                    printTransactionsLedger(transactions, {
                      title: "Finance Management — Transaction Ledger",
                      fromDateBs: fromDateBs || undefined,
                      toDateBs: toDateBs || undefined,
                      generatedAt: new Date().toLocaleString(),
                    });
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
                  header={
                    <Table className="w-full min-w-[1100px]">
                      <TableHead>
                        <tr>
                          <Th className="bg-slate-50">Date</Th>
                          <Th className="bg-slate-50">Type</Th>
                          <Th className="bg-slate-50">Category</Th>
                          <Th className="bg-slate-50">Title</Th>
                          <Th className="bg-slate-50 text-right">Amount</Th>
                          <Th className="bg-slate-50">Payment</Th>
                          <Th className="bg-slate-50">Reference</Th>
                          <Th className="bg-slate-50">Attachments</Th>
                          <Th className="bg-slate-50">Created by</Th>
                          <Th className="bg-slate-50 text-right">Actions</Th>
                        </tr>
                      </TableHead>
                    </Table>
                  }
                  body={
                    <Table className="w-full min-w-[1100px]">
                      <TableBody>
                        {transactions.map((tx) => (
                          <tr key={tx._id}>
                            <Td>{tx.dateBs}</Td>
                            <Td>
                              <Badge
                                className={
                                  tx.transactionType === "INCOME"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-rose-100 text-rose-800"
                                }
                              >
                                {transactionTypeLabel(tx.transactionType)}
                              </Badge>
                            </Td>
                            <Td>{tx.categoryName ?? "—"}</Td>
                            <Td className="font-medium">{tx.title}</Td>
                            <Td className="text-right tabular-nums">
                              {formatFinanceAmount(tx.amountNpr)}
                            </Td>
                            <Td>{paymentMethodLabel(tx.paymentMethod)}</Td>
                            <Td>{tx.referenceNumber || "—"}</Td>
                            <Td>
                              {attachmentStatusLabel(tx.attachments?.length ?? 0)}
                            </Td>
                            <Td className="text-sm text-slate-600">
                              {tx.createdByName ?? "—"}
                              {tx.updatedAt ? (
                                <div className="text-xs text-slate-400">
                                  Upd. {new Date(tx.updatedAt).toLocaleDateString()}
                                </div>
                              ) : null}
                            </Td>
                            <Td className="space-x-1 text-right whitespace-nowrap">
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

      {/* ─── Entry form ──────────────────────────────────────────── */}
      {tab === "entry" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-brand-600" />
              {editingId ? "Edit transaction" : "Record expense or income"}
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
                      categoryId: "",
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
              ) : (
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
              )}
              <FormField label="Vendor / payee">
                <Input
                  value={entryForm.vendorPayee ?? ""}
                  onChange={(e) =>
                    setEntryForm((c) => ({ ...c, vendorPayee: e.target.value }))
                  }
                />
              </FormField>
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
      {tab === "categories" && (
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
              <div className="flex flex-wrap items-end gap-2 md:col-span-2">
                <Button
                  variant="outline"
                  disabled={!report?.rows.length}
                  onClick={() => report && printFinanceReport(report)}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Print list
                </Button>
                <Button
                  variant="outline"
                  disabled={!report?.rows.length}
                  onClick={() => {
                    if (!report) return;
                    exportFinanceReportExcel(report);
                    toast.success("Report list exported");
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
                    exportFinanceReportLedgerExcel(report, {
                      fromDateBs: fromDateBs || undefined,
                      toDateBs: toDateBs || undefined,
                    });
                    toast.success("Ledger exported to Excel");
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
                      try {
                        await exportFinanceReportLedgerPdf(report, {
                          fromDateBs: fromDateBs || undefined,
                          toDateBs: toDateBs || undefined,
                        });
                        toast.success("Ledger PDF downloaded");
                      } catch (e) {
                        toast.error(parseErrorMessage(e));
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
                    <Table className="w-full min-w-[900px]">
                      <TableHead>
                        <tr>
                          <Th className="bg-slate-50">Date</Th>
                          <Th className="bg-slate-50">Type</Th>
                          <Th className="bg-slate-50">Category</Th>
                          <Th className="bg-slate-50">Title</Th>
                          <Th className="bg-slate-50 text-right">Amount</Th>
                          <Th className="bg-slate-50">Payment</Th>
                          <Th className="bg-slate-50">Reference</Th>
                          <Th className="bg-slate-50">Files</Th>
                        </tr>
                      </TableHead>
                    </Table>
                  }
                  body={
                    <Table className="w-full min-w-[900px]">
                      <TableBody>
                        {report.rows.map((row, index) => (
                          <tr key={`${row.dateBs}-${row.title}-${index}`}>
                            <Td>{row.dateBs}</Td>
                            <Td>{transactionTypeLabel(row.transactionType)}</Td>
                            <Td>{row.categoryName}</Td>
                            <Td className="font-medium">{row.title}</Td>
                            <Td className="text-right tabular-nums">
                              {formatFinanceAmount(row.amountNpr)}
                            </Td>
                            <Td>{paymentMethodLabel(row.paymentMethod)}</Td>
                            <Td>{row.referenceNumber || "—"}</Td>
                            <Td>{row.attachmentCount}</Td>
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
    </div>
  );
};
