import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ACCOUNTING_MANAGER_ROLES, EXPENSE_CATEGORIES, FEE_TYPES, INCOME_CATEGORIES, PAYMENT_METHODS, PAYMENT_STATUSES, PURCHASE_CATEGORIES, accountantSchema, accountingExpenseSchema, accountingIncomeSchema, accountingPurchaseSchema, accountingSettingsSchema, bankAccountSchema, cashBookEntrySchema, enhancedFeeCollectionSchema, extendedFeeStructureSchema, salaryPaymentSchema } from "@nepal-school-erp/shared";
import { Banknote, BarChart3, BookOpen, Building2, LayoutDashboard, Receipt, Settings, ShoppingCart, TrendingDown, TrendingUp, UserCog, Users, Wallet } from "lucide-react";
import { toast } from "sonner";
import { AddressFields } from "components/shared/AddressFields";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { PageHeader } from "components/shared/PageHeader";
import { useAuth } from "features/auth/AuthProvider";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { Textarea } from "components/ui/textarea";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { cn, formatCurrencyNpr, parseErrorMessage } from "lib/utils";
const tabs = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "fee-collection", label: "Fee Collection", icon: Wallet },
    { id: "receipts", label: "Fee Receipts", icon: Receipt },
    { id: "student-accounts", label: "Student Accounts", icon: Users },
    { id: "salaries", label: "Salary Management", icon: Banknote },
    { id: "purchases", label: "Purchases", icon: ShoppingCart },
    { id: "expenses", label: "Expenses", icon: TrendingDown },
    { id: "income", label: "Income", icon: TrendingUp },
    { id: "cash-book", label: "Cash Book", icon: BookOpen },
    { id: "bank-accounts", label: "Bank Accounts", icon: Building2 },
    { id: "reports", label: "Reports", icon: BarChart3 },
    { id: "settings", label: "Settings", icon: Settings, adminOnly: true },
    { id: "accountants", label: "Accountants", icon: UserCog, adminOnly: true }
];
const reportTypes = [
    { id: "daily-fee-collection", label: "Daily Fee Collection" },
    { id: "monthly-fee-collection", label: "Monthly Fee Collection" },
    { id: "pending-fees", label: "Pending Fees" },
    { id: "fee-defaulters", label: "Fee Defaulters" },
    { id: "salary-payments", label: "Salary Payments" },
    { id: "expenses", label: "Expenses" },
    { id: "purchases", label: "Purchases" },
    { id: "income", label: "Income" },
    { id: "cash-summary", label: "Cash Summary" }
];
const defaultStructure = {
    title: "",
    classIds: [],
    feeType: "MONTHLY",
    frequency: "MONTHLY",
    academicYearBs: "2083/2084",
    amountNpr: 0,
    isOptional: false
};
const defaultCollection = {
    studentId: "",
    feeStructureId: "",
    paidDateBs: "",
    currentChargesNpr: 0,
    amountPaidNpr: 0,
    discountNpr: 0,
    scholarshipNpr: 0,
    lateFeeNpr: 0,
    advancePaymentNpr: 0,
    paymentMethod: "CASH",
    feeBreakdown: [],
    isInstallment: false,
    notes: ""
};
const defaultExpense = {
    category: "Office Expenses",
    vendor: "",
    dateBs: "",
    amountNpr: 0,
    paymentMethod: "CASH",
    description: ""
};
const defaultPurchase = {
    category: "Books",
    vendor: "",
    purchaseDateBs: "",
    invoiceNumber: "",
    quantity: 1,
    unitPriceNpr: 0,
    paymentStatus: "PENDING",
    paymentMethod: "CASH",
    description: ""
};
const defaultIncome = {
    category: "Donations",
    source: "",
    dateBs: "",
    amountNpr: 0,
    paymentMethod: "CASH",
    description: ""
};
const defaultSalary = {
    employeeType: "TEACHER",
    teacherId: "",
    monthBs: "2082-01",
    basicSalaryNpr: 0,
    allowancesNpr: 0,
    bonusNpr: 0,
    advanceSalaryNpr: 0,
    loanDeductionNpr: 0,
    taxNpr: 0,
    otherDeductionsNpr: 0,
    status: "DRAFT",
    paidDateBs: "",
    paymentMethod: "BANK_TRANSFER"
};
const defaultBank = {
    bankName: "",
    accountName: "",
    accountNumber: "",
    branch: "",
    openingBalanceNpr: 0,
    isActive: true
};
const defaultCashEntry = {
    dateBs: "",
    entryType: "CREDIT",
    category: "",
    description: "",
    amountNpr: 0,
    paymentMethod: "CASH"
};
const defaultSettings = {
    lateFinePercent: 0,
    lateFineGraceDays: 0,
    receiptPrefix: "RCPT",
    autoReceiptNumber: true,
    defaultPaymentMethod: "CASH"
};
const defaultAccountant = {
    fullName: "",
    email: "",
    phone: "",
    employeeId: "",
    gender: "Male",
    address: { province: "", district: "", municipality: "", ward: "", streetAddress: "" },
    joinedDateBs: "",
    status: "ACTIVE"
};
export const AccountingManager = () => {
    const { user } = useAuth();
    const isAdmin = user?.role === "SCHOOL_ADMIN" || user?.role === "SUPER_ADMIN";
    const [tab, setTab] = useState("dashboard");
    const [structureForm, setStructureForm] = useState(defaultStructure);
    const [collectionForm, setCollectionForm] = useState(defaultCollection);
    const [expenseForm, setExpenseForm] = useState(defaultExpense);
    const [purchaseForm, setPurchaseForm] = useState(defaultPurchase);
    const [incomeForm, setIncomeForm] = useState(defaultIncome);
    const [salaryForm, setSalaryForm] = useState(defaultSalary);
    const [bankForm, setBankForm] = useState(defaultBank);
    const [cashForm, setCashForm] = useState(defaultCashEntry);
    const [settingsForm, setSettingsForm] = useState(defaultSettings);
    const [accountantForm, setAccountantForm] = useState(defaultAccountant);
    const [editingAccountant, setEditingAccountant] = useState(null);
    const [selectedReport, setSelectedReport] = useState("daily-fee-collection");
    const [reportMonth, setReportMonth] = useState("2081-09");
    const [reportDate, setReportDate] = useState("2081-09-01");
    const [selectedStudentId, setSelectedStudentId] = useState(null);
    const visibleTabs = tabs.filter((item) => !item.adminOnly || isAdmin);
    const dashboardQuery = useQuery({
        queryKey: ["accounting-dashboard"],
        queryFn: () => unwrap(api.get("/accounting/dashboard")),
        enabled: tab === "dashboard"
    });
    const structuresQuery = useQuery({
        queryKey: ["accounting-structures"],
        queryFn: () => unwrap(api.get("/accounting/structures"))
    });
    const studentsQuery = useQuery({
        queryKey: ["students"],
        queryFn: () => unwrap(api.get("/students"))
    });
    const classesQuery = useQuery({
        queryKey: ["classes"],
        queryFn: () => unwrap(api.get("/academics/classes"))
    });
    const receiptsQuery = useQuery({
        queryKey: ["accounting-receipts"],
        queryFn: () => unwrap(api.get("/accounting/receipts")),
        enabled: tab === "receipts" || tab === "fee-collection"
    });
    const studentAccountsQuery = useQuery({
        queryKey: ["accounting-student-accounts"],
        queryFn: () => unwrap(api.get("/accounting/student-accounts")),
        enabled: tab === "student-accounts" || tab === "fee-collection"
    });
    const expensesQuery = useQuery({
        queryKey: ["accounting-expenses"],
        queryFn: () => unwrap(api.get("/accounting/expenses")),
        enabled: tab === "expenses"
    });
    const purchasesQuery = useQuery({
        queryKey: ["accounting-purchases"],
        queryFn: () => unwrap(api.get("/accounting/purchases")),
        enabled: tab === "purchases"
    });
    const incomeQuery = useQuery({
        queryKey: ["accounting-income"],
        queryFn: () => unwrap(api.get("/accounting/income")),
        enabled: tab === "income"
    });
    const salariesQuery = useQuery({
        queryKey: ["accounting-salaries"],
        queryFn: () => unwrap(api.get("/accounting/salaries")),
        enabled: tab === "salaries"
    });
    const salaryEmployeesQuery = useQuery({
        queryKey: ["accounting-salary-employees"],
        queryFn: () => unwrap(api.get("/accounting/salary-employees")),
        enabled: tab === "salaries"
    });
    const cashBookQuery = useQuery({
        queryKey: ["accounting-cash-book"],
        queryFn: () => unwrap(api.get("/accounting/cash-book")),
        enabled: tab === "cash-book"
    });
    const bankAccountsQuery = useQuery({
        queryKey: ["accounting-bank-accounts"],
        queryFn: () => unwrap(api.get("/accounting/bank-accounts")),
        enabled: tab === "bank-accounts"
    });
    const settingsQuery = useQuery({
        queryKey: ["accounting-settings"],
        queryFn: () => unwrap(api.get("/accounting/settings")),
        enabled: isAdmin && tab === "settings"
    });
    const accountantsQuery = useQuery({
        queryKey: ["accounting-accountants"],
        queryFn: () => unwrap(api.get("/accounting/accountants")),
        enabled: isAdmin && tab === "accountants"
    });
    const reportQuery = useQuery({
        queryKey: ["accounting-report", selectedReport, reportMonth, reportDate],
        queryFn: () => unwrap(api.get(`/accounting/reports/${selectedReport}`, {
            params: {
                monthBs: selectedReport.includes("monthly") || selectedReport === "salary-payments" ? reportMonth : undefined,
                dateBs: selectedReport === "daily-fee-collection" ? reportDate : undefined
            }
        })),
        enabled: tab === "reports"
    });
    const studentHistoryQuery = useQuery({
        queryKey: ["student-financial-history", selectedStudentId],
        queryFn: () => unwrap(api.get(`/accounting/student-accounts/${selectedStudentId}/financial-history`)),
        enabled: Boolean(selectedStudentId) && tab === "student-accounts"
    });
    const invalidateAccounting = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["accounting-dashboard"] }),
            queryClient.invalidateQueries({ queryKey: ["accounting-structures"] }),
            queryClient.invalidateQueries({ queryKey: ["accounting-receipts"] }),
            queryClient.invalidateQueries({ queryKey: ["accounting-student-accounts"] }),
            queryClient.invalidateQueries({ queryKey: ["accounting-expenses"] }),
            queryClient.invalidateQueries({ queryKey: ["accounting-purchases"] }),
            queryClient.invalidateQueries({ queryKey: ["accounting-income"] }),
            queryClient.invalidateQueries({ queryKey: ["accounting-salaries"] }),
            queryClient.invalidateQueries({ queryKey: ["accounting-cash-book"] }),
            queryClient.invalidateQueries({ queryKey: ["accounting-bank-accounts"] }),
            queryClient.invalidateQueries({ queryKey: ["students"] })
        ]);
    };
    const createStructure = useMutation({
        mutationFn: (payload) => unwrap(api.post("/accounting/structures", payload)),
        onSuccess: async () => {
            toast.success("Fee structure created");
            setStructureForm(defaultStructure);
            await invalidateAccounting();
        },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    const collectFee = useMutation({
        mutationFn: (payload) => unwrap(api.post("/accounting/collections", payload)),
        onSuccess: async () => {
            toast.success("Fee collected successfully");
            setCollectionForm(defaultCollection);
            await invalidateAccounting();
        },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    const createExpense = useMutation({
        mutationFn: (payload) => unwrap(api.post("/accounting/expenses", payload)),
        onSuccess: async () => {
            toast.success("Expense recorded");
            setExpenseForm(defaultExpense);
            await invalidateAccounting();
        },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    const createPurchase = useMutation({
        mutationFn: (payload) => unwrap(api.post("/accounting/purchases", payload)),
        onSuccess: async () => {
            toast.success("Purchase recorded");
            setPurchaseForm(defaultPurchase);
            await invalidateAccounting();
        },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    const createIncome = useMutation({
        mutationFn: (payload) => unwrap(api.post("/accounting/income", payload)),
        onSuccess: async () => {
            toast.success("Income recorded");
            setIncomeForm(defaultIncome);
            await invalidateAccounting();
        },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    const createSalary = useMutation({
        mutationFn: (payload) => unwrap(api.post("/accounting/salaries", payload)),
        onSuccess: async () => {
            toast.success("Salary payment recorded");
            setSalaryForm(defaultSalary);
            await invalidateAccounting();
        },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    const createBank = useMutation({
        mutationFn: (payload) => unwrap(api.post("/accounting/bank-accounts", payload)),
        onSuccess: async () => {
            toast.success("Bank account created");
            setBankForm(defaultBank);
            await invalidateAccounting();
        },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    const createCashEntry = useMutation({
        mutationFn: (payload) => unwrap(api.post("/accounting/cash-book", payload)),
        onSuccess: async () => {
            toast.success("Cash book entry created");
            setCashForm(defaultCashEntry);
            await invalidateAccounting();
        },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    const saveSettings = useMutation({
        mutationFn: (payload) => unwrap(api.put("/accounting/settings", payload)),
        onSuccess: async () => {
            toast.success("Settings updated");
            await queryClient.invalidateQueries({ queryKey: ["accounting-settings"] });
        },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    const saveAccountant = useMutation({
        mutationFn: (payload) => editingAccountant
            ? unwrap(api.put(`/accounting/accountants/${editingAccountant._id}`, payload))
            : unwrap(api.post("/accounting/accountants", payload)),
        onSuccess: async () => {
            toast.success(editingAccountant ? "Accountant updated" : "Accountant created");
            setAccountantForm(defaultAccountant);
            setEditingAccountant(null);
            await queryClient.invalidateQueries({ queryKey: ["accounting-accountants"] });
        },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    const deactivateAccountant = useMutation({
        mutationFn: (id) => unwrap(api.delete(`/accounting/accountants/${id}`)),
        onSuccess: async () => {
            toast.success("Accountant deactivated");
            await queryClient.invalidateQueries({ queryKey: ["accounting-accountants"] });
        },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    const resetPassword = useMutation({
        mutationFn: (id) => unwrap(api.post(`/accounting/accountants/${id}/reset-password`, {})),
        onSuccess: () => toast.success("Password reset"),
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    const selectedStudentAccount = useMemo(() => (studentAccountsQuery.data ?? []).find((item) => item.student._id === collectionForm.studentId), [studentAccountsQuery.data, collectionForm.studentId]);
    const selectedStructure = useMemo(() => (structuresQuery.data ?? []).find((item) => item._id === collectionForm.feeStructureId), [structuresQuery.data, collectionForm.feeStructureId]);
    if (!user || (!ACCOUNTING_MANAGER_ROLES.includes(user.role) && user.role !== "SUPER_ADMIN")) {
        return null;
    }
    const downloadReceipt = (id) => {
        window.open(`${api.defaults.baseURL}/accounting/collections/${id}/receipt`, "_blank");
    };
    const exportReport = (format) => {
        const params = new URLSearchParams({ format });
        if (selectedReport.includes("monthly") || selectedReport === "salary-payments")
            params.set("monthBs", reportMonth);
        if (selectedReport === "daily-fee-collection")
            params.set("dateBs", reportDate);
        window.open(`${api.defaults.baseURL}/accounting/reports/${selectedReport}?${params.toString()}`, "_blank");
    };
    return (_jsxs("div", { className: "space-y-6", children: [_jsx(PageHeader, { title: "Accounting & Finance", description: "Fee collection, salaries, expenses, purchases, income, cash book, bank accounts, and financial reports." }), _jsx("div", { className: "flex flex-wrap gap-2", children: visibleTabs.map((item) => {
                    const Icon = item.icon;
                    return (_jsxs(Button, { variant: tab === item.id ? "default" : "outline", size: "sm", className: cn(tab === item.id && "bg-emerald-600 hover:bg-emerald-700"), onClick: () => setTab(item.id), children: [_jsx(Icon, { className: "mr-2 h-4 w-4" }), item.label] }, item.id));
                }) }), tab === "dashboard" ? (_jsxs("div", { className: "grid gap-4 md:grid-cols-2 xl:grid-cols-4", children: [(dashboardQuery.data?.stats ?? []).map((stat) => (_jsxs(Card, { children: [_jsx(CardHeader, { className: "pb-2", children: _jsx(CardTitle, { className: "text-sm text-slate-500", children: stat.label }) }), _jsx(CardContent, { className: "text-2xl font-semibold", children: stat.label.includes("Students") ? stat.value : formatCurrencyNpr(stat.value) })] }, stat.label))), _jsxs(Card, { className: "md:col-span-2", children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Cash Balance" }) }), _jsx(CardContent, { className: "text-2xl font-semibold text-emerald-700", children: formatCurrencyNpr(dashboardQuery.data?.cashBalanceNpr ?? 0) })] }), _jsxs(Card, { className: "md:col-span-2", children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Bank Balance" }) }), _jsx(CardContent, { className: "text-2xl font-semibold text-sky-700", children: formatCurrencyNpr(dashboardQuery.data?.bankBalanceNpr ?? 0) })] })] })) : null, tab === "fee-collection" ? (_jsxs("div", { className: "grid gap-6 xl:grid-cols-2", children: [isAdmin ? (_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Fee Structure" }) }), _jsx(CardContent, { children: _jsxs("form", { className: "grid gap-3 md:grid-cols-2", onSubmit: (e) => {
                                        e.preventDefault();
                                        const parsed = extendedFeeStructureSchema.safeParse(structureForm);
                                        if (!parsed.success)
                                            return toast.error(parsed.error.issues[0]?.message ?? "Invalid structure");
                                        void createStructure.mutateAsync(parsed.data);
                                    }, children: [_jsx("div", { className: "md:col-span-2", children: _jsx(FormField, { label: "Title", children: _jsx(Input, { value: structureForm.title, onChange: (e) => setStructureForm((c) => ({ ...c, title: e.target.value })) }) }) }), _jsx(FormField, { label: "Fee Type", children: _jsx(Select, { value: structureForm.feeType, onChange: (e) => setStructureForm((c) => ({ ...c, feeType: e.target.value })), children: FEE_TYPES.map((t) => _jsx("option", { value: t, children: t }, t)) }) }), _jsx(FormField, { label: "Amount (NPR)", children: _jsx(Input, { type: "number", value: structureForm.amountNpr, onChange: (e) => setStructureForm((c) => ({ ...c, amountNpr: Number(e.target.value) })) }) }), _jsx("div", { className: "md:col-span-2", children: _jsx(FormField, { label: "Classes", children: _jsxs(Select, { value: structureForm.classIds[0] ?? "", onChange: (e) => setStructureForm((c) => ({ ...c, classIds: e.target.value ? [e.target.value] : [] })), children: [_jsx("option", { value: "", children: "All classes" }), (classesQuery.data ?? []).map((cls) => _jsx("option", { value: cls._id, children: cls.name }, cls._id))] }) }) }), _jsx("div", { className: "md:col-span-2 flex justify-end", children: _jsx(Button, { type: "submit", children: "Create Structure" }) })] }) })] })) : null, _jsxs(Card, { className: isAdmin ? "" : "xl:col-span-2", children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Collect Fee" }) }), _jsx(CardContent, { children: _jsxs("form", { className: "grid gap-3 md:grid-cols-2", onSubmit: (e) => {
                                        e.preventDefault();
                                        const parsed = enhancedFeeCollectionSchema.safeParse(collectionForm);
                                        if (!parsed.success)
                                            return toast.error(parsed.error.issues[0]?.message ?? "Invalid collection");
                                        void collectFee.mutateAsync(parsed.data);
                                    }, children: [_jsx(FormField, { label: "Student", children: _jsxs(Select, { value: collectionForm.studentId, onChange: (e) => {
                                                    const studentId = e.target.value;
                                                    const account = (studentAccountsQuery.data ?? []).find((item) => item.student._id === studentId);
                                                    setCollectionForm((c) => ({
                                                        ...c,
                                                        studentId,
                                                        currentChargesNpr: selectedStructure?.amountNpr ?? c.currentChargesNpr
                                                    }));
                                                    if (account) {
                                                        setCollectionForm((c) => ({ ...c, studentId }));
                                                    }
                                                }, children: [_jsx("option", { value: "", children: "Select student" }), (studentsQuery.data ?? []).map((s) => (_jsxs("option", { value: s._id, children: [s.user.fullName, " \u2014 ", s.admissionNumber] }, s._id)))] }) }), _jsx(FormField, { label: "Fee Structure", children: _jsxs(Select, { value: collectionForm.feeStructureId ?? "", onChange: (e) => {
                                                    const structure = (structuresQuery.data ?? []).find((item) => item._id === e.target.value);
                                                    setCollectionForm((c) => ({
                                                        ...c,
                                                        feeStructureId: e.target.value,
                                                        currentChargesNpr: structure?.amountNpr ?? 0
                                                    }));
                                                }, children: [_jsx("option", { value: "", children: "Select structure" }), (structuresQuery.data ?? []).map((s) => _jsx("option", { value: s._id, children: s.title }, s._id))] }) }), selectedStudentAccount ? (_jsxs("div", { className: "md:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm", children: ["Previous Due: ", _jsx("strong", { children: formatCurrencyNpr(selectedStudentAccount.remainingDueNpr) }), selectedStructure ? _jsxs(_Fragment, { children: [" \u00B7 Current Charge: ", _jsx("strong", { children: formatCurrencyNpr(selectedStructure.amountNpr) })] }) : null] })) : null, _jsx(FormField, { label: "Paid Date (BS)", children: _jsx(NepaliDateField, { value: collectionForm.paidDateBs, onChange: (v) => setCollectionForm((c) => ({ ...c, paidDateBs: v })) }) }), _jsx(FormField, { label: "Payment Method", children: _jsx(Select, { value: collectionForm.paymentMethod, onChange: (e) => setCollectionForm((c) => ({ ...c, paymentMethod: e.target.value })), children: PAYMENT_METHODS.map((m) => _jsx("option", { value: m, children: m.replace(/_/g, " ") }, m)) }) }), _jsx(FormField, { label: "Current Charges", children: _jsx(Input, { type: "number", value: collectionForm.currentChargesNpr, onChange: (e) => setCollectionForm((c) => ({ ...c, currentChargesNpr: Number(e.target.value) })) }) }), _jsx(FormField, { label: "Amount Paid", children: _jsx(Input, { type: "number", value: collectionForm.amountPaidNpr, onChange: (e) => setCollectionForm((c) => ({ ...c, amountPaidNpr: Number(e.target.value) })) }) }), _jsx(FormField, { label: "Discount", children: _jsx(Input, { type: "number", value: collectionForm.discountNpr, onChange: (e) => setCollectionForm((c) => ({ ...c, discountNpr: Number(e.target.value) })) }) }), _jsx(FormField, { label: "Scholarship", children: _jsx(Input, { type: "number", value: collectionForm.scholarshipNpr, onChange: (e) => setCollectionForm((c) => ({ ...c, scholarshipNpr: Number(e.target.value) })) }) }), _jsx(FormField, { label: "Late Fine", children: _jsx(Input, { type: "number", value: collectionForm.lateFeeNpr, onChange: (e) => setCollectionForm((c) => ({ ...c, lateFeeNpr: Number(e.target.value) })) }) }), _jsx(FormField, { label: "Installment", children: _jsxs(Select, { value: collectionForm.isInstallment ? "yes" : "no", onChange: (e) => setCollectionForm((c) => ({ ...c, isInstallment: e.target.value === "yes" })), children: [_jsx("option", { value: "no", children: "Full Payment" }), _jsx("option", { value: "yes", children: "Installment" })] }) }), _jsx("div", { className: "md:col-span-2 flex justify-end", children: _jsx(Button, { type: "submit", disabled: collectFee.isPending, children: "Collect Fee" }) })] }) })] })] })) : null, tab === "receipts" ? (_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Fee Receipts" }) }), _jsx(CardContent, { className: "overflow-x-auto", children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Receipt" }), _jsx(Th, { children: "Student" }), _jsx(Th, { children: "Date" }), _jsx(Th, { children: "Paid" }), _jsx(Th, { children: "Remaining" }), _jsx(Th, { children: "Method" }), _jsx(Th, {})] }) }), _jsx(TableBody, { children: (receiptsQuery.data ?? []).map((row) => {
                                        const student = row.studentId;
                                        const studentName = typeof student === "object" ? student.user?.fullName ?? "—" : "—";
                                        return (_jsxs("tr", { children: [_jsx(Td, { children: String(row.receiptNumber) }), _jsx(Td, { children: studentName }), _jsx(Td, { children: String(row.paidDateBs) }), _jsx(Td, { children: formatCurrencyNpr(Number(row.amountPaidNpr)) }), _jsx(Td, { children: formatCurrencyNpr(Number(row.remainingDueNpr ?? 0)) }), _jsx(Td, { children: String(row.paymentMethod ?? "CASH").replace(/_/g, " ") }), _jsx(Td, { children: _jsx(Button, { size: "sm", variant: "outline", onClick: () => downloadReceipt(String(row._id)), children: "PDF" }) })] }, String(row._id)));
                                    }) })] }) })] })) : null, tab === "student-accounts" ? (_jsxs("div", { className: "grid gap-6 xl:grid-cols-2", children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Student Accounts" }) }), _jsx(CardContent, { className: "overflow-x-auto", children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Student" }), _jsx(Th, { children: "Class" }), _jsx(Th, { children: "Due" }), _jsx(Th, { children: "Paid" }), _jsx(Th, {})] }) }), _jsx(TableBody, { children: (studentAccountsQuery.data ?? []).map((account) => (_jsxs("tr", { children: [_jsxs(Td, { children: [_jsx("div", { className: "font-medium", children: account.student.user.fullName }), _jsx("div", { className: "text-xs text-slate-500", children: account.student.admissionNumber })] }), _jsxs(Td, { children: [account.className, " ", account.sectionName] }), _jsx(Td, { children: _jsx(Badge, { className: account.remainingDueNpr > 0 ? "bg-rose-100 text-rose-800" : undefined, children: formatCurrencyNpr(account.remainingDueNpr) }) }), _jsx(Td, { children: formatCurrencyNpr(account.totalPaidNpr) }), _jsx(Td, { children: _jsx(Button, { size: "sm", variant: "outline", onClick: () => setSelectedStudentId(account.student._id), children: "History" }) })] }, account.student._id))) })] }) })] }), selectedStudentId && studentHistoryQuery.data ? (_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Financial History" }) }), _jsxs(CardContent, { className: "space-y-3", children: [_jsxs("div", { className: "grid grid-cols-2 gap-2 text-sm", children: [_jsxs("div", { children: ["Outstanding: ", _jsx("strong", { children: formatCurrencyNpr(Number(studentHistoryQuery.data.outstandingDueNpr)) })] }), _jsxs("div", { children: ["Total Paid: ", _jsx("strong", { children: formatCurrencyNpr(Number(studentHistoryQuery.data.totalPaidNpr)) })] })] }), (studentHistoryQuery.data.collections ?? []).map((c) => (_jsxs("div", { className: "rounded-xl border p-3 text-sm", children: [_jsx("div", { className: "font-medium", children: String(c.receiptNumber) }), _jsxs("div", { className: "text-slate-500", children: [String(c.paidDateBs), " \u00B7 ", formatCurrencyNpr(Number(c.amountPaidNpr))] })] }, String(c._id))))] })] })) : null] })) : null, tab === "salaries" ? (_jsxs("div", { className: "grid gap-6 lg:grid-cols-2", children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Pay Salary" }) }), _jsxs(CardContent, { className: "space-y-3", children: [_jsx(FormField, { label: "Teacher", children: _jsxs(Select, { value: salaryForm.teacherId ?? "", onChange: (e) => {
                                                const teacher = (salaryEmployeesQuery.data ?? []).find((t) => t._id === e.target.value);
                                                setSalaryForm((c) => ({ ...c, teacherId: e.target.value, basicSalaryNpr: teacher?.basicSalaryNpr ?? c.basicSalaryNpr }));
                                            }, children: [_jsx("option", { value: "", children: "Select teacher" }), (salaryEmployeesQuery.data ?? []).map((t) => _jsx("option", { value: t._id, children: t.user.fullName }, t._id))] }) }), _jsx(FormField, { label: "Month", children: _jsx(Input, { value: salaryForm.monthBs, onChange: (e) => setSalaryForm((c) => ({ ...c, monthBs: e.target.value })) }) }), _jsx(FormField, { label: "Basic Salary", children: _jsx(Input, { type: "number", value: salaryForm.basicSalaryNpr, onChange: (e) => setSalaryForm((c) => ({ ...c, basicSalaryNpr: Number(e.target.value) })) }) }), _jsx(FormField, { label: "Allowances", children: _jsx(Input, { type: "number", value: salaryForm.allowancesNpr, onChange: (e) => setSalaryForm((c) => ({ ...c, allowancesNpr: Number(e.target.value) })) }) }), _jsx(FormField, { label: "Bonus", children: _jsx(Input, { type: "number", value: salaryForm.bonusNpr, onChange: (e) => setSalaryForm((c) => ({ ...c, bonusNpr: Number(e.target.value) })) }) }), _jsx(FormField, { label: "Loan Deduction", children: _jsx(Input, { type: "number", value: salaryForm.loanDeductionNpr, onChange: (e) => setSalaryForm((c) => ({ ...c, loanDeductionNpr: Number(e.target.value) })) }) }), _jsx(FormField, { label: "Tax", children: _jsx(Input, { type: "number", value: salaryForm.taxNpr, onChange: (e) => setSalaryForm((c) => ({ ...c, taxNpr: Number(e.target.value) })) }) }), _jsx(Button, { onClick: () => {
                                            const parsed = salaryPaymentSchema.safeParse(salaryForm);
                                            if (!parsed.success)
                                                return toast.error("Invalid salary data");
                                            void createSalary.mutateAsync(parsed.data);
                                        }, children: "Record Salary" })] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Salary History" }) }), _jsx(CardContent, { className: "overflow-x-auto", children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Month" }), _jsx(Th, { children: "Employee" }), _jsx(Th, { children: "Net Salary" }), _jsx(Th, { children: "Status" })] }) }), _jsx(TableBody, { children: (salariesQuery.data ?? []).map((row) => {
                                                const teacher = row.teacherId;
                                                return (_jsxs("tr", { children: [_jsx(Td, { children: String(row.monthBs) }), _jsx(Td, { children: teacher?.user?.fullName ?? String(row.staffName ?? "—") }), _jsx(Td, { children: formatCurrencyNpr(Number(row.netSalaryNpr)) }), _jsx(Td, { children: _jsx(Badge, { children: String(row.status) }) })] }, String(row._id)));
                                            }) })] }) })] })] })) : null, tab === "expenses" ? (_jsxs("div", { className: "grid gap-6 lg:grid-cols-2", children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Record Expense" }) }), _jsxs(CardContent, { className: "space-y-3", children: [_jsx(FormField, { label: "Category", children: _jsx(Select, { value: expenseForm.category, onChange: (e) => setExpenseForm((c) => ({ ...c, category: e.target.value })), children: EXPENSE_CATEGORIES.map((c) => _jsx("option", { value: c, children: c }, c)) }) }), _jsx(FormField, { label: "Vendor", children: _jsx(Input, { value: expenseForm.vendor, onChange: (e) => setExpenseForm((c) => ({ ...c, vendor: e.target.value })) }) }), _jsx(FormField, { label: "Date", children: _jsx(NepaliDateField, { value: expenseForm.dateBs, onChange: (v) => setExpenseForm((c) => ({ ...c, dateBs: v })) }) }), _jsx(FormField, { label: "Amount", children: _jsx(Input, { type: "number", value: expenseForm.amountNpr, onChange: (e) => setExpenseForm((c) => ({ ...c, amountNpr: Number(e.target.value) })) }) }), _jsx(FormField, { label: "Description", children: _jsx(Textarea, { value: expenseForm.description, onChange: (e) => setExpenseForm((c) => ({ ...c, description: e.target.value })) }) }), _jsx(Button, { onClick: () => {
                                            const parsed = accountingExpenseSchema.safeParse(expenseForm);
                                            if (!parsed.success)
                                                return toast.error("Invalid expense");
                                            void createExpense.mutateAsync(parsed.data);
                                        }, children: "Save Expense" })] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Expense Records" }) }), _jsx(CardContent, { className: "overflow-x-auto", children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Date" }), _jsx(Th, { children: "Category" }), _jsx(Th, { children: "Vendor" }), _jsx(Th, { children: "Amount" })] }) }), _jsx(TableBody, { children: (expensesQuery.data ?? []).map((row) => (_jsxs("tr", { children: [_jsx(Td, { children: String(row.dateBs) }), _jsx(Td, { children: String(row.category) }), _jsx(Td, { children: String(row.vendor) }), _jsx(Td, { children: formatCurrencyNpr(Number(row.amountNpr)) })] }, String(row._id)))) })] }) })] })] })) : null, tab === "purchases" ? (_jsxs("div", { className: "grid gap-6 lg:grid-cols-2", children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Record Purchase" }) }), _jsxs(CardContent, { className: "space-y-3", children: [_jsx(FormField, { label: "Category", children: _jsx(Select, { value: purchaseForm.category, onChange: (e) => setPurchaseForm((c) => ({ ...c, category: e.target.value })), children: PURCHASE_CATEGORIES.map((c) => _jsx("option", { value: c, children: c }, c)) }) }), _jsx(FormField, { label: "Vendor", children: _jsx(Input, { value: purchaseForm.vendor, onChange: (e) => setPurchaseForm((c) => ({ ...c, vendor: e.target.value })) }) }), _jsx(FormField, { label: "Invoice", children: _jsx(Input, { value: purchaseForm.invoiceNumber, onChange: (e) => setPurchaseForm((c) => ({ ...c, invoiceNumber: e.target.value })) }) }), _jsx(FormField, { label: "Date", children: _jsx(NepaliDateField, { value: purchaseForm.purchaseDateBs, onChange: (v) => setPurchaseForm((c) => ({ ...c, purchaseDateBs: v })) }) }), _jsx(FormField, { label: "Quantity", children: _jsx(Input, { type: "number", value: purchaseForm.quantity, onChange: (e) => setPurchaseForm((c) => ({ ...c, quantity: Number(e.target.value) })) }) }), _jsx(FormField, { label: "Unit Price", children: _jsx(Input, { type: "number", value: purchaseForm.unitPriceNpr, onChange: (e) => setPurchaseForm((c) => ({ ...c, unitPriceNpr: Number(e.target.value) })) }) }), _jsx(FormField, { label: "Payment Status", children: _jsx(Select, { value: purchaseForm.paymentStatus, onChange: (e) => setPurchaseForm((c) => ({ ...c, paymentStatus: e.target.value })), children: PAYMENT_STATUSES.map((s) => _jsx("option", { value: s, children: s }, s)) }) }), _jsx(Button, { onClick: () => {
                                            const parsed = accountingPurchaseSchema.safeParse(purchaseForm);
                                            if (!parsed.success)
                                                return toast.error("Invalid purchase");
                                            void createPurchase.mutateAsync(parsed.data);
                                        }, children: "Save Purchase" })] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Purchase Records" }) }), _jsx(CardContent, { className: "overflow-x-auto", children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Date" }), _jsx(Th, { children: "Category" }), _jsx(Th, { children: "Invoice" }), _jsx(Th, { children: "Total" }), _jsx(Th, { children: "Status" })] }) }), _jsx(TableBody, { children: (purchasesQuery.data ?? []).map((row) => (_jsxs("tr", { children: [_jsx(Td, { children: String(row.purchaseDateBs) }), _jsx(Td, { children: String(row.category) }), _jsx(Td, { children: String(row.invoiceNumber) }), _jsx(Td, { children: formatCurrencyNpr(Number(row.totalAmountNpr)) }), _jsx(Td, { children: _jsx(Badge, { children: String(row.paymentStatus) }) })] }, String(row._id)))) })] }) })] })] })) : null, tab === "income" ? (_jsxs("div", { className: "grid gap-6 lg:grid-cols-2", children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Record Income" }) }), _jsxs(CardContent, { className: "space-y-3", children: [_jsx(FormField, { label: "Category", children: _jsx(Select, { value: incomeForm.category, onChange: (e) => setIncomeForm((c) => ({ ...c, category: e.target.value })), children: INCOME_CATEGORIES.map((c) => _jsx("option", { value: c, children: c }, c)) }) }), _jsx(FormField, { label: "Source", children: _jsx(Input, { value: incomeForm.source, onChange: (e) => setIncomeForm((c) => ({ ...c, source: e.target.value })) }) }), _jsx(FormField, { label: "Date", children: _jsx(NepaliDateField, { value: incomeForm.dateBs, onChange: (v) => setIncomeForm((c) => ({ ...c, dateBs: v })) }) }), _jsx(FormField, { label: "Amount", children: _jsx(Input, { type: "number", value: incomeForm.amountNpr, onChange: (e) => setIncomeForm((c) => ({ ...c, amountNpr: Number(e.target.value) })) }) }), _jsx(Button, { onClick: () => {
                                            const parsed = accountingIncomeSchema.safeParse(incomeForm);
                                            if (!parsed.success)
                                                return toast.error("Invalid income");
                                            void createIncome.mutateAsync(parsed.data);
                                        }, children: "Save Income" })] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Income Records" }) }), _jsx(CardContent, { className: "overflow-x-auto", children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Date" }), _jsx(Th, { children: "Category" }), _jsx(Th, { children: "Source" }), _jsx(Th, { children: "Amount" })] }) }), _jsx(TableBody, { children: (incomeQuery.data ?? []).map((row) => (_jsxs("tr", { children: [_jsx(Td, { children: String(row.dateBs) }), _jsx(Td, { children: String(row.category) }), _jsx(Td, { children: String(row.source) }), _jsx(Td, { children: formatCurrencyNpr(Number(row.amountNpr)) })] }, String(row._id)))) })] }) })] })] })) : null, tab === "cash-book" ? (_jsxs("div", { className: "grid gap-6 lg:grid-cols-2", children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Add Cash Entry" }) }), _jsxs(CardContent, { className: "space-y-3", children: [_jsx(FormField, { label: "Date", children: _jsx(NepaliDateField, { value: cashForm.dateBs, onChange: (v) => setCashForm((c) => ({ ...c, dateBs: v })) }) }), _jsx(FormField, { label: "Type", children: _jsxs(Select, { value: cashForm.entryType, onChange: (e) => setCashForm((c) => ({ ...c, entryType: e.target.value })), children: [_jsx("option", { value: "CREDIT", children: "Credit (In)" }), _jsx("option", { value: "DEBIT", children: "Debit (Out)" })] }) }), _jsx(FormField, { label: "Category", children: _jsx(Input, { value: cashForm.category, onChange: (e) => setCashForm((c) => ({ ...c, category: e.target.value })) }) }), _jsx(FormField, { label: "Description", children: _jsx(Textarea, { value: cashForm.description, onChange: (e) => setCashForm((c) => ({ ...c, description: e.target.value })) }) }), _jsx(FormField, { label: "Amount", children: _jsx(Input, { type: "number", value: cashForm.amountNpr, onChange: (e) => setCashForm((c) => ({ ...c, amountNpr: Number(e.target.value) })) }) }), _jsx(Button, { onClick: () => {
                                            const parsed = cashBookEntrySchema.safeParse(cashForm);
                                            if (!parsed.success)
                                                return toast.error("Invalid entry");
                                            void createCashEntry.mutateAsync(parsed.data);
                                        }, children: "Add Entry" })] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Cash Book" }) }), _jsx(CardContent, { className: "overflow-x-auto", children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Date" }), _jsx(Th, { children: "Type" }), _jsx(Th, { children: "Description" }), _jsx(Th, { children: "Amount" }), _jsx(Th, { children: "Balance" })] }) }), _jsx(TableBody, { children: (cashBookQuery.data ?? []).map((row) => (_jsxs("tr", { children: [_jsx(Td, { children: String(row.dateBs) }), _jsx(Td, { children: _jsx(Badge, { className: row.entryType === "CREDIT" ? undefined : "bg-rose-100 text-rose-800", children: String(row.entryType) }) }), _jsx(Td, { children: String(row.description) }), _jsx(Td, { children: formatCurrencyNpr(Number(row.amountNpr)) }), _jsx(Td, { children: formatCurrencyNpr(Number(row.balanceAfterNpr)) })] }, String(row._id)))) })] }) })] })] })) : null, tab === "bank-accounts" ? (_jsxs("div", { className: "grid gap-6 lg:grid-cols-2", children: [isAdmin ? (_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Add Bank Account" }) }), _jsxs(CardContent, { className: "space-y-3", children: [_jsx(FormField, { label: "Bank Name", children: _jsx(Input, { value: bankForm.bankName, onChange: (e) => setBankForm((c) => ({ ...c, bankName: e.target.value })) }) }), _jsx(FormField, { label: "Account Name", children: _jsx(Input, { value: bankForm.accountName, onChange: (e) => setBankForm((c) => ({ ...c, accountName: e.target.value })) }) }), _jsx(FormField, { label: "Account Number", children: _jsx(Input, { value: bankForm.accountNumber, onChange: (e) => setBankForm((c) => ({ ...c, accountNumber: e.target.value })) }) }), _jsx(FormField, { label: "Opening Balance", children: _jsx(Input, { type: "number", value: bankForm.openingBalanceNpr, onChange: (e) => setBankForm((c) => ({ ...c, openingBalanceNpr: Number(e.target.value) })) }) }), _jsx(Button, { onClick: () => {
                                            const parsed = bankAccountSchema.safeParse(bankForm);
                                            if (!parsed.success)
                                                return toast.error("Invalid bank account");
                                            void createBank.mutateAsync(parsed.data);
                                        }, children: "Save Account" })] })] })) : null, _jsxs(Card, { className: isAdmin ? "" : "lg:col-span-2", children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Bank Accounts" }) }), _jsx(CardContent, { className: "overflow-x-auto", children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Bank" }), _jsx(Th, { children: "Account" }), _jsx(Th, { children: "Number" }), _jsx(Th, { children: "Balance" }), _jsx(Th, { children: "Status" })] }) }), _jsx(TableBody, { children: (bankAccountsQuery.data ?? []).map((row) => (_jsxs("tr", { children: [_jsx(Td, { children: String(row.bankName) }), _jsx(Td, { children: String(row.accountName) }), _jsx(Td, { children: String(row.accountNumber) }), _jsx(Td, { children: formatCurrencyNpr(Number(row.currentBalanceNpr)) }), _jsx(Td, { children: _jsx(Badge, { children: row.isActive ? "Active" : "Inactive" }) })] }, String(row._id)))) })] }) })] })] })) : null, tab === "reports" ? (_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Financial Reports" }) }), _jsxs(CardContent, { className: "space-y-4", children: [_jsxs("div", { className: "flex flex-wrap gap-3", children: [_jsx(Select, { value: selectedReport, onChange: (e) => setSelectedReport(e.target.value), children: reportTypes.map((r) => _jsx("option", { value: r.id, children: r.label }, r.id)) }), selectedReport === "daily-fee-collection" ? (_jsx(Input, { value: reportDate, onChange: (e) => setReportDate(e.target.value), placeholder: "YYYY-MM-DD" })) : null, selectedReport.includes("monthly") || selectedReport === "salary-payments" ? (_jsx(Input, { value: reportMonth, onChange: (e) => setReportMonth(e.target.value), placeholder: "YYYY-MM" })) : null, _jsx(Button, { variant: "outline", onClick: () => exportReport("csv"), children: "Export CSV" })] }), _jsx("div", { className: "overflow-x-auto", children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsx("tr", { children: reportQuery.data?.data?.[0]
                                                    ? Object.keys(reportQuery.data.data[0]).slice(0, 6).map((key) => _jsx(Th, { children: key }, key))
                                                    : _jsx(Th, { children: "No data" }) }) }), _jsx(TableBody, { children: (reportQuery.data?.data ?? []).slice(0, 20).map((row, index) => (_jsx("tr", { children: Object.values(row).slice(0, 6).map((value, i) => (_jsx(Td, { children: typeof value === "number" ? formatCurrencyNpr(value) : String(value ?? "") }, i))) }, index))) })] }) })] })] })) : null, tab === "settings" && isAdmin ? (_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Accounting Settings" }) }), _jsx(CardContent, { className: "grid gap-3 md:grid-cols-2", children: settingsQuery.data ? (_jsxs(_Fragment, { children: [_jsx(FormField, { label: "Late Fine %", children: _jsx(Input, { type: "number", value: settingsForm.lateFinePercent || settingsQuery.data.lateFinePercent, onChange: (e) => setSettingsForm((c) => ({ ...c, lateFinePercent: Number(e.target.value) })) }) }), _jsx(FormField, { label: "Grace Days", children: _jsx(Input, { type: "number", value: settingsForm.lateFineGraceDays || settingsQuery.data.lateFineGraceDays, onChange: (e) => setSettingsForm((c) => ({ ...c, lateFineGraceDays: Number(e.target.value) })) }) }), _jsx(FormField, { label: "Receipt Prefix", children: _jsx(Input, { value: settingsForm.receiptPrefix || settingsQuery.data.receiptPrefix, onChange: (e) => setSettingsForm((c) => ({ ...c, receiptPrefix: e.target.value })) }) }), _jsx("div", { className: "md:col-span-2", children: _jsx(Button, { onClick: () => {
                                            const parsed = accountingSettingsSchema.safeParse({ ...settingsQuery.data, ...settingsForm });
                                            if (!parsed.success)
                                                return toast.error("Invalid settings");
                                            void saveSettings.mutateAsync(parsed.data);
                                        }, children: "Save Settings" }) })] })) : null })] })) : null, tab === "accountants" && isAdmin ? (_jsxs("div", { className: "grid gap-6 lg:grid-cols-2", children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: editingAccountant ? "Edit Accountant" : "Add Accountant" }) }), _jsxs(CardContent, { className: "space-y-3", children: [_jsx(FormField, { label: "Full Name", children: _jsx(Input, { value: accountantForm.fullName, onChange: (e) => setAccountantForm((c) => ({ ...c, fullName: e.target.value })) }) }), _jsx(FormField, { label: "Employee ID", children: _jsx(Input, { value: accountantForm.employeeId, onChange: (e) => setAccountantForm((c) => ({ ...c, employeeId: e.target.value })) }) }), _jsx(FormField, { label: "Email", children: _jsx(Input, { type: "email", value: accountantForm.email, onChange: (e) => setAccountantForm((c) => ({ ...c, email: e.target.value })) }) }), _jsx(FormField, { label: "Phone", children: _jsx(Input, { value: accountantForm.phone ?? "", onChange: (e) => setAccountantForm((c) => ({ ...c, phone: e.target.value })) }) }), _jsx(FormField, { label: "Gender", children: _jsxs(Select, { value: accountantForm.gender, onChange: (e) => setAccountantForm((c) => ({ ...c, gender: e.target.value })), children: [_jsx("option", { value: "Male", children: "Male" }), _jsx("option", { value: "Female", children: "Female" }), _jsx("option", { value: "Other", children: "Other" })] }) }), _jsx(FormField, { label: "Joining Date", children: _jsx(NepaliDateField, { value: accountantForm.joinedDateBs, onChange: (v) => setAccountantForm((c) => ({ ...c, joinedDateBs: v })) }) }), _jsx(AddressFields, { value: accountantForm.address, onChange: (address) => setAccountantForm((c) => ({ ...c, address })) }), _jsxs(Button, { onClick: () => {
                                            const parsed = accountantSchema.safeParse(accountantForm);
                                            if (!parsed.success)
                                                return toast.error(parsed.error.issues[0]?.message ?? "Invalid accountant");
                                            void saveAccountant.mutateAsync(parsed.data);
                                        }, children: [editingAccountant ? "Update" : "Create", " Accountant"] })] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Accountants" }) }), _jsx(CardContent, { className: "overflow-x-auto", children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Name" }), _jsx(Th, { children: "ID" }), _jsx(Th, { children: "Email" }), _jsx(Th, { children: "Status" }), _jsx(Th, {})] }) }), _jsx(TableBody, { children: (accountantsQuery.data ?? []).map((accountant) => (_jsxs("tr", { children: [_jsx(Td, { children: accountant.user.fullName }), _jsx(Td, { children: accountant.employeeId }), _jsx(Td, { children: accountant.user.email }), _jsx(Td, { children: _jsx(Badge, { children: accountant.status }) }), _jsx(Td, { children: _jsxs("div", { className: "flex gap-1", children: [_jsx(Button, { size: "sm", variant: "outline", onClick: () => {
                                                                        setEditingAccountant(accountant);
                                                                        setAccountantForm({
                                                                            fullName: accountant.user.fullName,
                                                                            email: accountant.user.email,
                                                                            phone: accountant.user.phone ?? "",
                                                                            employeeId: accountant.employeeId,
                                                                            gender: accountant.gender,
                                                                            address: accountant.address,
                                                                            joinedDateBs: accountant.joinedDateBs,
                                                                            photoUrl: accountant.photoUrl ?? "",
                                                                            status: accountant.status
                                                                        });
                                                                    }, children: "Edit" }), _jsx(Button, { size: "sm", variant: "outline", onClick: () => void resetPassword.mutateAsync(accountant._id), children: "Reset PW" }), _jsx(Button, { size: "sm", variant: "destructive", onClick: () => void deactivateAccountant.mutateAsync(accountant._id), children: "Deactivate" })] }) })] }, accountant._id))) })] }) })] })] })) : null] }));
};
