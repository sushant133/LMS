import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  canManageInstitution,
  libraryBookSchema,
  libraryIssueSchema,
  moduleStaffSchema,
  type LibraryBookInput,
  type LibraryBookRecord,
  type LibraryDashboardResponse,
  type LibraryInventoryAccessResponse,
  type LibraryIssueInput,
  type ModuleStaffInput,
  type UserProfile
} from "@phit-erp/shared";
import { BookOpen, History, LayoutDashboard, Lock, Package, RotateCcw, Users } from "lucide-react";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { StudentNameLink } from "components/shared/StudentNameLink";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { PageHeader } from "components/shared/PageHeader";
import { useAuth } from "features/auth/AuthProvider";
import { LibraryReturnsPanel } from "features/library/LibraryReturnsPanel";
import { StockStatusBadge } from "features/library/StockStatusBadge";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";

import { api, unwrap } from "lib/api";
import { resolveStudentId } from "lib/resolveStudentId";
import { queryClient } from "lib/queryClient";
import { cn, parseErrorMessage } from "lib/utils";

type Tab = "dashboard" | "inventory" | "issue" | "returns" | "staff";

const defaultBook: LibraryBookInput = {
  title: "",
  author: "",
  isbn: "",
  category: "General",
  totalCopies: 1,
  shelfLocation: ""
};

const defaultIssue: LibraryIssueInput = {
  bookId: "",
  borrowerType: "STUDENT",
  studentId: "",
  teacherId: "",
  issuedDateBs: "",
  dueDateBs: ""
};

const defaultStaff: ModuleStaffInput = {
  fullName: "",
  email: "",
  phone: ""
};

const issueStatusStyles: Record<string, string> = {
  ISSUED: "bg-sky-100 text-sky-800",
  RETURNED: "bg-brand-100 text-brand-800",
  OVERDUE: "bg-rose-100 text-rose-800"
};

const tabs: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard; adminOnly?: boolean }> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "inventory", label: "Inventory", icon: Package },
  { id: "issue", label: "Issue Books", icon: BookOpen },
  { id: "returns", label: "Returns", icon: RotateCcw },
  { id: "staff", label: "Staff", icon: Users, adminOnly: true }
];

export const LibraryManager = () => {
  const { user } = useAuth();
  const isAdmin = canManageInstitution(user?.role ?? "");
  const [tab, setTab] = useState<Tab>("dashboard");
  const [bookForm, setBookForm] = useState<LibraryBookInput>(defaultBook);
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [issueForm, setIssueForm] = useState<LibraryIssueInput>(defaultIssue);
  const [staffForm, setStaffForm] = useState<ModuleStaffInput>(defaultStaff);

  const dashboardQuery = useQuery({
    queryKey: ["library-dashboard"],
    queryFn: () => unwrap<LibraryDashboardResponse>(api.get("/library/dashboard")),
    enabled: tab === "dashboard"
  });

  const booksQuery = useQuery({
    queryKey: ["library-books"],
    queryFn: () => unwrap<LibraryBookRecord[]>(api.get("/library/books"))
  });

  const inventoryAccessQuery = useQuery({
    queryKey: ["library-inventory-access"],
    queryFn: () => unwrap<LibraryInventoryAccessResponse>(api.get("/library/inventory-access"))
  });

  const inventoryAccessEnabled = inventoryAccessQuery.data?.enabled ?? false;
  const canManageInventory = isAdmin || inventoryAccessEnabled;

  const studentsQuery = useQuery({
    queryKey: ["students"],
    queryFn: () => unwrap<Array<{ _id: string; user: { fullName: string } }>>(api.get("/students"))
  });

  const teachersQuery = useQuery({
    queryKey: ["teachers"],
    queryFn: () => unwrap<Array<{ _id: string; user: { fullName: string } }>>(api.get("/teachers"))
  });

  const staffQuery = useQuery({
    queryKey: ["library-staff"],
    queryFn: () => unwrap<UserProfile[]>(api.get("/library/staff")),
    enabled: isAdmin && tab === "staff"
  });

  const invalidateLibrary = async () => {
    await queryClient.invalidateQueries({ queryKey: ["library-books"] });
    await queryClient.invalidateQueries({ queryKey: ["library-issues"] });
    await queryClient.invalidateQueries({ queryKey: ["library-dashboard"] });
    await queryClient.invalidateQueries({ queryKey: ["library-inventory-access"] });
  };

  const toggleInventoryAccess = useMutation({
    mutationFn: (enabled: boolean) =>
      unwrap<LibraryInventoryAccessResponse>(api.put("/library/inventory-access", { enabled })),
    onSuccess: async (_data, enabled) => {
      toast.success(enabled ? "Inventory access enabled for library staff" : "Inventory access disabled");
      await queryClient.invalidateQueries({ queryKey: ["library-inventory-access"] });
      await queryClient.invalidateQueries({ queryKey: ["library-dashboard"] });
    },
    onError: (e) => toast.error(parseErrorMessage(e))
  });

  const saveBook = useMutation({
    mutationFn: (payload: LibraryBookInput) =>
      editingBookId
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
    mutationFn: (id: string) => unwrap(api.delete(`/library/books/${id}`)),
    onSuccess: async () => {
      toast.success("Book deleted");
      await invalidateLibrary();
    },
    onError: (e) => toast.error(parseErrorMessage(e))
  });

  const issueBook = useMutation({
    mutationFn: (payload: LibraryIssueInput) => unwrap(api.post("/library/issues", payload)),
    onSuccess: async () => {
      toast.success("Book issued");
      setIssueForm(defaultIssue);
      await invalidateLibrary();
    },
    onError: (e) => toast.error(parseErrorMessage(e))
  });

  const createStaff = useMutation({
    mutationFn: (payload: ModuleStaffInput) => unwrap(api.post("/library/staff", payload)),
    onSuccess: async () => {
      toast.success("Library staff created");
      setStaffForm(defaultStaff);
      await queryClient.invalidateQueries({ queryKey: ["library-staff"] });
    },
    onError: (e) => toast.error(parseErrorMessage(e))
  });

  const visibleTabs = tabs.filter((item) => !item.adminOnly || isAdmin);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Library"
        description="Manage catalog, inventory, issue books, process returns, and track borrowing activity."
      />



      <div className="flex flex-wrap gap-2">
        {visibleTabs.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              key={item.id}
              variant={tab === item.id ? "default" : "secondary"}
              size="sm"
              onClick={() => setTab(item.id)}
              className={cn(tab === item.id && "bg-brand-600 hover:bg-brand-700")}
            >
              <Icon className="mr-2 h-4 w-4" />
              {item.label}
            </Button>
          );
        })}
      </div>

      {tab === "dashboard" && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Total Books", value: dashboardQuery.data?.totalBooks ?? 0 },
              { label: "Available", value: dashboardQuery.data?.availableBooks ?? 0 },
              { label: "Issued", value: dashboardQuery.data?.issuedBooks ?? 0 },
              { label: "Overdue", value: dashboardQuery.data?.overdueBooks ?? 0 }
            ].map((stat) => (
              <Card key={stat.label} className="bg-[linear-gradient(135deg,_white_0%,_#eef3fb_100%)]">
                <CardContent className="py-6">
                  <p className="text-sm text-slate-500">{stat.label}</p>
                  <p className="text-3xl font-semibold text-slate-900">{stat.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5 text-brand-600" />
                Recently issued
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHead>
                  <tr>
                    <Th>Book</Th>
                    <Th>Borrower</Th>
                    <Th>Due</Th>
                    <Th>Status</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {(dashboardQuery.data?.recentlyIssued ?? []).map((issue) => (
                    <tr key={issue._id}>
                      <Td>{issue.bookTitle ?? "—"}</Td>
                      <Td>
                        {issue.borrowerType === "STUDENT" && resolveStudentId(issue.studentId) && issue.borrowerName ? (
                          <StudentNameLink studentId={resolveStudentId(issue.studentId)!} name={issue.borrowerName} />
                        ) : (
                          issue.borrowerName ?? "—"
                        )}
                      </Td>
                      <Td>{issue.dueDateBs}</Td>
                      <Td>
                        <Badge className={issueStatusStyles[issue.status] ?? ""}>{issue.status}</Badge>
                      </Td>
                    </tr>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "inventory" && (
        <div className="space-y-4">
          {isAdmin ? (
            <Card className="border-brand-200 bg-[linear-gradient(135deg,_white_0%,_#eef3fb_100%)]">
              <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
                <div>
                  <p className="font-medium text-slate-900">Inventory access for library staff</p>
                  <p className="text-sm text-slate-500">
                    Turn on when new stock arrives so staff can add, edit, or remove books. Turn off to freeze inventory
                    changes.
                  </p>
                </div>
                <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={inventoryAccessEnabled}
                    disabled={toggleInventoryAccess.isPending || inventoryAccessQuery.isLoading}
                    onChange={(event) => toggleInventoryAccess.mutate(event.target.checked)}
                  />
                  {inventoryAccessEnabled ? "Access enabled" : "Access disabled"}
                </label>
              </CardContent>
            </Card>
          ) : null}

          {!canManageInventory ? (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="flex items-start gap-3 py-4">
                <Lock className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                <div>
                  <p className="font-medium text-amber-900">Inventory is frozen</p>
                  <p className="text-sm text-amber-800">
                    You can view the catalog, but adding, editing, or deleting books is disabled until an administrator
                    enables inventory access.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div className={cn("grid gap-6", canManageInventory && "xl:grid-cols-[360px_1fr]")}>
            {canManageInventory ? (
              <Card>
                <CardHeader>
                  <CardTitle>{editingBookId ? "Edit book" : "Add book"}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <FormField label="Title">
                    <Input value={bookForm.title} onChange={(e) => setBookForm((c) => ({ ...c, title: e.target.value }))} />
                  </FormField>
                  <FormField label="Author">
                    <Input value={bookForm.author} onChange={(e) => setBookForm((c) => ({ ...c, author: e.target.value }))} />
                  </FormField>
                  <FormField label="Category">
                    <Input value={bookForm.category} onChange={(e) => setBookForm((c) => ({ ...c, category: e.target.value }))} />
                  </FormField>
                  <FormField label="ISBN (optional)">
                    <Input value={bookForm.isbn} onChange={(e) => setBookForm((c) => ({ ...c, isbn: e.target.value }))} />
                  </FormField>
                  <FormField label="Total copies">
                    <Input
                      type="number"
                      value={bookForm.totalCopies}
                      onChange={(e) => setBookForm((c) => ({ ...c, totalCopies: e.target.valueAsNumber }))}
                    />
                  </FormField>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => {
                        const parsed = libraryBookSchema.safeParse(bookForm);
                        if (!parsed.success) return toast.error("Invalid book details");
                        saveBook.mutate(parsed.data);
                      }}
                    >
                      {editingBookId ? "Update" : "Add book"}
                    </Button>
                    {editingBookId ? (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setEditingBookId(null);
                          setBookForm(defaultBook);
                        }}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle>Library inventory</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHead>
                    <tr>
                      <Th>Book</Th>
                      <Th>Author</Th>
                      <Th>Category</Th>
                      <Th>Total</Th>
                      <Th>Available</Th>
                      <Th>Issued</Th>
                      <Th>Status</Th>
                      {canManageInventory ? <Th /> : null}
                    </tr>
                  </TableHead>
                  <TableBody>
                    {(booksQuery.data ?? []).map((book) => (
                      <tr key={book._id}>
                        <Td className="font-medium">{book.title}</Td>
                        <Td>{book.author}</Td>
                        <Td>{book.category}</Td>
                        <Td>{book.totalCopies}</Td>
                        <Td>{book.availableCopies}</Td>
                        <Td>{book.issuedCopies}</Td>
                        <Td>
                          <StockStatusBadge status={book.status} />
                        </Td>
                        {canManageInventory ? (
                          <Td>
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  setEditingBookId(book._id);
                                  setBookForm({
                                    title: book.title,
                                    author: book.author,
                                    isbn: book.isbn ?? "",
                                    category: book.category,
                                    totalCopies: book.totalCopies,
                                    shelfLocation: book.shelfLocation ?? ""
                                  });
                                }}
                              >
                                Edit
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => deleteBook.mutate(book._id)}>
                                Delete
                              </Button>
                            </div>
                          </Td>
                        ) : null}
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {tab === "issue" && (
        <Card>
          <CardHeader>
            <CardTitle>Issue book</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <FormField label="Book">
              <Select value={issueForm.bookId} onChange={(e) => setIssueForm((c) => ({ ...c, bookId: e.target.value }))}>
                <option value="">Select book</option>
                {(booksQuery.data ?? [])
                  .filter((b) => b.availableCopies > 0)
                  .map((b) => (
                    <option key={b._id} value={b._id}>
                      {b.title} ({b.availableCopies} available)
                    </option>
                  ))}
              </Select>
            </FormField>
            <FormField label="Borrower type">
              <Select
                value={issueForm.borrowerType}
                onChange={(e) =>
                  setIssueForm((c) => ({
                    ...c,
                    borrowerType: e.target.value as "STUDENT" | "TEACHER",
                    studentId: "",
                    teacherId: ""
                  }))
                }
              >
                <option value="STUDENT">Student</option>
                <option value="TEACHER">Teacher</option>
              </Select>
            </FormField>
            {issueForm.borrowerType === "STUDENT" ? (
              <FormField label="Student">
                <Select value={issueForm.studentId} onChange={(e) => setIssueForm((c) => ({ ...c, studentId: e.target.value }))}>
                  <option value="">Select student</option>
                  {(studentsQuery.data ?? []).map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.user.fullName}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : (
              <FormField label="Teacher">
                <Select value={issueForm.teacherId} onChange={(e) => setIssueForm((c) => ({ ...c, teacherId: e.target.value }))}>
                  <option value="">Select teacher</option>
                  {(teachersQuery.data ?? []).map((t) => (
                    <option key={t._id} value={t._id}>
                      {t.user.fullName}
                    </option>
                  ))}
                </Select>
              </FormField>
            )}
            <FormField label="Issued (BS)">
              <NepaliDateField value={issueForm.issuedDateBs} onChange={(v) => setIssueForm((c) => ({ ...c, issuedDateBs: v }))} />
            </FormField>
            <FormField label="Due (BS)">
              <NepaliDateField value={issueForm.dueDateBs} onChange={(v) => setIssueForm((c) => ({ ...c, dueDateBs: v }))} />
            </FormField>
            <div className="flex items-end">
              <Button
                onClick={() => {
                  const parsed = libraryIssueSchema.safeParse(issueForm);
                  if (!parsed.success) return toast.error("Invalid issue details");
                  issueBook.mutate(parsed.data);
                }}
              >
                Issue book
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "returns" && <LibraryReturnsPanel />}

      {tab === "staff" && isAdmin && (
        <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Create library staff</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <FormField label="Full name">
                <Input value={staffForm.fullName} onChange={(e) => setStaffForm((c) => ({ ...c, fullName: e.target.value }))} />
              </FormField>
              <FormField label="Email">
                <Input value={staffForm.email} onChange={(e) => setStaffForm((c) => ({ ...c, email: e.target.value }))} />
              </FormField>
              <FormField label="Phone">
                <Input value={staffForm.phone} onChange={(e) => setStaffForm((c) => ({ ...c, phone: e.target.value }))} />
              </FormField>
              <Button
                onClick={() => {
                  const parsed = moduleStaffSchema.safeParse(staffForm);
                  if (!parsed.success) return toast.error("Invalid staff details");
                  createStaff.mutate(parsed.data);
                }}
              >
                Create account
              </Button>
              <p className="text-xs text-slate-500">Default password applies unless you set a custom one via API.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Library staff accounts</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Email</Th>
                    <Th>Phone</Th>
                    <Th>Status</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {(staffQuery.data ?? []).map((member) => (
                    <tr key={member._id}>
                      <Td>{member.fullName}</Td>
                      <Td>{member.email}</Td>
                      <Td>{member.phone ?? "—"}</Td>
                      <Td>
                        <Badge className={member.isActive ? "bg-brand-100 text-brand-800" : "bg-slate-100 text-slate-600"}>
                          {member.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </Td>
                    </tr>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};