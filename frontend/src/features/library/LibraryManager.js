import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { libraryBookSchema, libraryIssueSchema, moduleStaffSchema } from "@nepal-school-erp/shared";
import { BookOpen, History, LayoutDashboard, Package, Users } from "lucide-react";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { PageHeader } from "components/shared/PageHeader";
import { useAuth } from "features/auth/AuthProvider";
import { StockStatusBadge } from "features/library/StockStatusBadge";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { cn, parseErrorMessage } from "lib/utils";
const defaultBook = {
    title: "",
    author: "",
    isbn: "",
    category: "General",
    totalCopies: 1,
    shelfLocation: ""
};
const defaultIssue = {
    bookId: "",
    borrowerType: "STUDENT",
    studentId: "",
    teacherId: "",
    issuedDateBs: "",
    dueDateBs: ""
};
const defaultStaff = {
    fullName: "",
    email: "",
    phone: ""
};
const issueStatusStyles = {
    ISSUED: "bg-sky-100 text-sky-800",
    RETURNED: "bg-emerald-100 text-emerald-800",
    OVERDUE: "bg-rose-100 text-rose-800"
};
const tabs = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "inventory", label: "Inventory", icon: Package },
    { id: "issues", label: "Issue & Return", icon: BookOpen },
    { id: "staff", label: "Staff", icon: Users, adminOnly: true }
];
export const LibraryManager = () => {
    const { user } = useAuth();
    const isAdmin = user?.role === "SCHOOL_ADMIN" || user?.role === "SUPER_ADMIN";
    const [tab, setTab] = useState("dashboard");
    const [bookForm, setBookForm] = useState(defaultBook);
    const [editingBookId, setEditingBookId] = useState(null);
    const [issueForm, setIssueForm] = useState(defaultIssue);
    const [returnDateBs, setReturnDateBs] = useState("");
    const [staffForm, setStaffForm] = useState(defaultStaff);
    const dashboardQuery = useQuery({
        queryKey: ["library-dashboard"],
        queryFn: () => unwrap(api.get("/library/dashboard")),
        enabled: tab === "dashboard"
    });
    const booksQuery = useQuery({
        queryKey: ["library-books"],
        queryFn: () => unwrap(api.get("/library/books"))
    });
    const issuesQuery = useQuery({
        queryKey: ["library-issues"],
        queryFn: () => unwrap(api.get("/library/issues"))
    });
    const studentsQuery = useQuery({
        queryKey: ["students"],
        queryFn: () => unwrap(api.get("/students"))
    });
    const teachersQuery = useQuery({
        queryKey: ["teachers"],
        queryFn: () => unwrap(api.get("/teachers"))
    });
    const staffQuery = useQuery({
        queryKey: ["library-staff"],
        queryFn: () => unwrap(api.get("/library/staff")),
        enabled: isAdmin && tab === "staff"
    });
    const invalidateLibrary = async () => {
        await queryClient.invalidateQueries({ queryKey: ["library-books"] });
        await queryClient.invalidateQueries({ queryKey: ["library-issues"] });
        await queryClient.invalidateQueries({ queryKey: ["library-dashboard"] });
    };
    const saveBook = useMutation({
        mutationFn: (payload) => editingBookId
            ? unwrap(api.put(`/library/books/${editingBookId}`, payload))
            : unwrap(api.post("/library/books", payload)),
        onSuccess: async () => {
            toast.success(editingBookId ? "Book updated" : "Book added");
            setBookForm(defaultBook);
            setEditingBookId(null);
            await invalidateLibrary();
        },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    const deleteBook = useMutation({
        mutationFn: (id) => unwrap(api.delete(`/library/books/${id}`)),
        onSuccess: async () => {
            toast.success("Book deleted");
            await invalidateLibrary();
        },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    const issueBook = useMutation({
        mutationFn: (payload) => unwrap(api.post("/library/issues", payload)),
        onSuccess: async () => {
            toast.success("Book issued");
            setIssueForm(defaultIssue);
            await invalidateLibrary();
        },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    const returnBook = useMutation({
        mutationFn: ({ id, returnedDateBs }) => unwrap(api.put(`/library/issues/${id}/return`, { returnedDateBs, fineNpr: 0 })),
        onSuccess: async () => {
            toast.success("Book returned");
            await invalidateLibrary();
        },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    const createStaff = useMutation({
        mutationFn: (payload) => unwrap(api.post("/library/staff", payload)),
        onSuccess: async () => {
            toast.success("Library staff created");
            setStaffForm(defaultStaff);
            await queryClient.invalidateQueries({ queryKey: ["library-staff"] });
        },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    const visibleTabs = tabs.filter((item) => !item.adminOnly || isAdmin);
    return (_jsxs("div", { className: "space-y-6", children: [_jsx(PageHeader, { title: "Library", description: "Manage catalog, inventory, issue and return books, and track borrowing activity." }), _jsx("div", { className: "flex flex-wrap gap-2", children: visibleTabs.map((item) => {
                    const Icon = item.icon;
                    return (_jsxs(Button, { variant: tab === item.id ? "default" : "secondary", size: "sm", onClick: () => setTab(item.id), className: cn(tab === item.id && "bg-emerald-600 hover:bg-emerald-700"), children: [_jsx(Icon, { className: "mr-2 h-4 w-4" }), item.label] }, item.id));
                }) }), tab === "dashboard" && (_jsxs("div", { className: "space-y-6", children: [_jsx("div", { className: "grid gap-4 md:grid-cols-2 xl:grid-cols-4", children: [
                            { label: "Total Books", value: dashboardQuery.data?.totalBooks ?? 0 },
                            { label: "Available", value: dashboardQuery.data?.availableBooks ?? 0 },
                            { label: "Issued", value: dashboardQuery.data?.issuedBooks ?? 0 },
                            { label: "Overdue", value: dashboardQuery.data?.overdueBooks ?? 0 }
                        ].map((stat) => (_jsx(Card, { className: "bg-[linear-gradient(135deg,_white_0%,_#ecfdf5_100%)]", children: _jsxs(CardContent, { className: "py-6", children: [_jsx("p", { className: "text-sm text-slate-500", children: stat.label }), _jsx("p", { className: "text-3xl font-semibold text-slate-900", children: stat.value })] }) }, stat.label))) }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsxs(CardTitle, { className: "flex items-center gap-2", children: [_jsx(History, { className: "h-5 w-5 text-emerald-600" }), "Recently issued"] }) }), _jsx(CardContent, { children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Book" }), _jsx(Th, { children: "Borrower" }), _jsx(Th, { children: "Due" }), _jsx(Th, { children: "Status" })] }) }), _jsx(TableBody, { children: (dashboardQuery.data?.recentlyIssued ?? []).map((issue) => (_jsxs("tr", { children: [_jsx(Td, { children: issue.bookTitle ?? "—" }), _jsx(Td, { children: issue.borrowerName ?? "—" }), _jsx(Td, { children: issue.dueDateBs }), _jsx(Td, { children: _jsx(Badge, { className: issueStatusStyles[issue.status] ?? "", children: issue.status }) })] }, issue._id))) })] }) })] })] })), tab === "inventory" && (_jsxs("div", { className: "grid gap-6 xl:grid-cols-[360px_1fr]", children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: editingBookId ? "Edit book" : "Add book" }) }), _jsxs(CardContent, { className: "space-y-3", children: [_jsx(FormField, { label: "Title", children: _jsx(Input, { value: bookForm.title, onChange: (e) => setBookForm((c) => ({ ...c, title: e.target.value })) }) }), _jsx(FormField, { label: "Author", children: _jsx(Input, { value: bookForm.author, onChange: (e) => setBookForm((c) => ({ ...c, author: e.target.value })) }) }), _jsx(FormField, { label: "Category", children: _jsx(Input, { value: bookForm.category, onChange: (e) => setBookForm((c) => ({ ...c, category: e.target.value })) }) }), _jsx(FormField, { label: "ISBN (optional)", children: _jsx(Input, { value: bookForm.isbn, onChange: (e) => setBookForm((c) => ({ ...c, isbn: e.target.value })) }) }), _jsx(FormField, { label: "Total copies", children: _jsx(Input, { type: "number", value: bookForm.totalCopies, onChange: (e) => setBookForm((c) => ({ ...c, totalCopies: Number(e.target.value) })) }) }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { onClick: () => {
                                                    const parsed = libraryBookSchema.safeParse(bookForm);
                                                    if (!parsed.success)
                                                        return toast.error("Invalid book details");
                                                    saveBook.mutate(parsed.data);
                                                }, children: editingBookId ? "Update" : "Add book" }), editingBookId ? (_jsx(Button, { variant: "secondary", onClick: () => {
                                                    setEditingBookId(null);
                                                    setBookForm(defaultBook);
                                                }, children: "Cancel" })) : null] })] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Library inventory" }) }), _jsx(CardContent, { children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Book" }), _jsx(Th, { children: "Author" }), _jsx(Th, { children: "Category" }), _jsx(Th, { children: "Total" }), _jsx(Th, { children: "Available" }), _jsx(Th, { children: "Issued" }), _jsx(Th, { children: "Status" }), _jsx(Th, {})] }) }), _jsx(TableBody, { children: (booksQuery.data ?? []).map((book) => (_jsxs("tr", { children: [_jsx(Td, { className: "font-medium", children: book.title }), _jsx(Td, { children: book.author }), _jsx(Td, { children: book.category }), _jsx(Td, { children: book.totalCopies }), _jsx(Td, { children: book.availableCopies }), _jsx(Td, { children: book.issuedCopies }), _jsx(Td, { children: _jsx(StockStatusBadge, { status: book.status }) }), _jsx(Td, { children: _jsxs("div", { className: "flex gap-1", children: [_jsx(Button, { size: "sm", variant: "secondary", onClick: () => {
                                                                        setEditingBookId(book._id);
                                                                        setBookForm({
                                                                            title: book.title,
                                                                            author: book.author,
                                                                            isbn: book.isbn ?? "",
                                                                            category: book.category,
                                                                            totalCopies: book.totalCopies,
                                                                            shelfLocation: book.shelfLocation ?? ""
                                                                        });
                                                                    }, children: "Edit" }), _jsx(Button, { size: "sm", variant: "outline", onClick: () => deleteBook.mutate(book._id), children: "Delete" })] }) })] }, book._id))) })] }) })] })] })), tab === "issues" && (_jsxs("div", { className: "space-y-6", children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Issue book" }) }), _jsxs(CardContent, { className: "grid gap-3 md:grid-cols-2 xl:grid-cols-3", children: [_jsx(FormField, { label: "Book", children: _jsxs(Select, { value: issueForm.bookId, onChange: (e) => setIssueForm((c) => ({ ...c, bookId: e.target.value })), children: [_jsx("option", { value: "", children: "Select book" }), (booksQuery.data ?? [])
                                                    .filter((b) => b.availableCopies > 0)
                                                    .map((b) => (_jsxs("option", { value: b._id, children: [b.title, " (", b.availableCopies, " available)"] }, b._id)))] }) }), _jsx(FormField, { label: "Borrower type", children: _jsxs(Select, { value: issueForm.borrowerType, onChange: (e) => setIssueForm((c) => ({
                                                ...c,
                                                borrowerType: e.target.value,
                                                studentId: "",
                                                teacherId: ""
                                            })), children: [_jsx("option", { value: "STUDENT", children: "Student" }), _jsx("option", { value: "TEACHER", children: "Teacher" })] }) }), issueForm.borrowerType === "STUDENT" ? (_jsx(FormField, { label: "Student", children: _jsxs(Select, { value: issueForm.studentId, onChange: (e) => setIssueForm((c) => ({ ...c, studentId: e.target.value })), children: [_jsx("option", { value: "", children: "Select student" }), (studentsQuery.data ?? []).map((s) => (_jsx("option", { value: s._id, children: s.user.fullName }, s._id)))] }) })) : (_jsx(FormField, { label: "Teacher", children: _jsxs(Select, { value: issueForm.teacherId, onChange: (e) => setIssueForm((c) => ({ ...c, teacherId: e.target.value })), children: [_jsx("option", { value: "", children: "Select teacher" }), (teachersQuery.data ?? []).map((t) => (_jsx("option", { value: t._id, children: t.user.fullName }, t._id)))] }) })), _jsx(FormField, { label: "Issued (BS)", children: _jsx(NepaliDateField, { value: issueForm.issuedDateBs, onChange: (v) => setIssueForm((c) => ({ ...c, issuedDateBs: v })) }) }), _jsx(FormField, { label: "Due (BS)", children: _jsx(NepaliDateField, { value: issueForm.dueDateBs, onChange: (v) => setIssueForm((c) => ({ ...c, dueDateBs: v })) }) }), _jsx("div", { className: "flex items-end", children: _jsx(Button, { onClick: () => {
                                                const parsed = libraryIssueSchema.safeParse(issueForm);
                                                if (!parsed.success)
                                                    return toast.error("Invalid issue details");
                                                issueBook.mutate(parsed.data);
                                            }, children: "Issue book" }) })] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Borrowing history" }) }), _jsxs(CardContent, { children: [_jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Book" }), _jsx(Th, { children: "Borrower" }), _jsx(Th, { children: "Issued" }), _jsx(Th, { children: "Due" }), _jsx(Th, { children: "Returned" }), _jsx(Th, { children: "Status" }), _jsx(Th, {})] }) }), _jsx(TableBody, { children: (issuesQuery.data ?? []).map((issue) => (_jsxs("tr", { children: [_jsx(Td, { children: issue.bookTitle ?? "—" }), _jsx(Td, { children: issue.borrowerName ?? "—" }), _jsx(Td, { children: issue.issuedDateBs }), _jsx(Td, { children: issue.dueDateBs }), _jsx(Td, { children: issue.returnedDateBs ?? "—" }), _jsx(Td, { children: _jsx(Badge, { className: issueStatusStyles[issue.status] ?? "", children: issue.status }) }), _jsx(Td, { children: issue.status !== "RETURNED" ? (_jsx(Button, { size: "sm", variant: "secondary", onClick: () => {
                                                                    const date = returnDateBs || issue.issuedDateBs;
                                                                    returnBook.mutate({ id: issue._id, returnedDateBs: date });
                                                                }, children: "Return" })) : null })] }, issue._id))) })] }), _jsx("div", { className: "mt-4 max-w-xs", children: _jsx(FormField, { label: "Return date (BS)", children: _jsx(NepaliDateField, { value: returnDateBs, onChange: setReturnDateBs }) }) })] })] })] })), tab === "staff" && isAdmin && (_jsxs("div", { className: "grid gap-6 xl:grid-cols-[360px_1fr]", children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Create library staff" }) }), _jsxs(CardContent, { className: "space-y-3", children: [_jsx(FormField, { label: "Full name", children: _jsx(Input, { value: staffForm.fullName, onChange: (e) => setStaffForm((c) => ({ ...c, fullName: e.target.value })) }) }), _jsx(FormField, { label: "Email", children: _jsx(Input, { value: staffForm.email, onChange: (e) => setStaffForm((c) => ({ ...c, email: e.target.value })) }) }), _jsx(FormField, { label: "Phone", children: _jsx(Input, { value: staffForm.phone, onChange: (e) => setStaffForm((c) => ({ ...c, phone: e.target.value })) }) }), _jsx(Button, { onClick: () => {
                                            const parsed = moduleStaffSchema.safeParse(staffForm);
                                            if (!parsed.success)
                                                return toast.error("Invalid staff details");
                                            createStaff.mutate(parsed.data);
                                        }, children: "Create account" }), _jsx("p", { className: "text-xs text-slate-500", children: "Default password applies unless you set a custom one via API." })] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Library staff accounts" }) }), _jsx(CardContent, { children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Name" }), _jsx(Th, { children: "Email" }), _jsx(Th, { children: "Phone" }), _jsx(Th, { children: "Status" })] }) }), _jsx(TableBody, { children: (staffQuery.data ?? []).map((member) => (_jsxs("tr", { children: [_jsx(Td, { children: member.fullName }), _jsx(Td, { children: member.email }), _jsx(Td, { children: member.phone ?? "—" }), _jsx(Td, { children: _jsx(Badge, { className: member.isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600", children: member.isActive ? "Active" : "Inactive" }) })] }, member._id))) })] }) })] })] }))] }));
};
