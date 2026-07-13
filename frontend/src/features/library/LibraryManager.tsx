import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  canManageInstitution,
  LIBRARY_YEAR_LEVELS,
  libraryBookSchema,
  libraryIssueSchema,
  moduleStaffSchema,
  type LibraryBookCopyRecord,
  type LibraryBookInput,
  type LibraryBookRecord,
  type LibraryCopyStatus,
  type LibraryDashboardResponse,
  type LibraryInventoryAccessResponse,
  type LibraryIssueInput,
  type LibraryYearLevel,
  type ModuleStaffInput,
  type UserProfile,
} from "@phit-erp/shared";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  History,
  LayoutDashboard,
  Lock,
  Package,
  RotateCcw,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { StudentNameLink } from "components/shared/StudentNameLink";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { ModuleReadOnlyBanner } from "components/shared/ModuleReadOnlyBanner";
import { PageHeader } from "components/shared/PageHeader";
import { useAuth } from "features/auth/AuthProvider";
import { LibraryReturnsPanel } from "features/library/LibraryReturnsPanel";
import { StockStatusBadge } from "features/library/StockStatusBadge";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";

import { api, unwrap } from "lib/api";
import { resolveStudentId } from "lib/resolveStudentId";
import { queryClient } from "lib/queryClient";
import { cn, parseErrorMessage } from "lib/utils";

type Tab = "dashboard" | "inventory" | "issue" | "returns" | "staff";

type CopyDraft = { bookCode: string; shelfLocation: string; condition: string };

const emptyCopy = (): CopyDraft => ({
  bookCode: "",
  shelfLocation: "",
  condition: "",
});

const resizeCopies = (current: CopyDraft[], total: number): CopyDraft[] => {
  const count = Math.max(1, Math.min(200, total || 1));
  if (current.length === count) return current;
  if (current.length < count) {
    return [
      ...current,
      ...Array.from({ length: count - current.length }, () => emptyCopy()),
    ];
  }
  return current.slice(0, count);
};

const defaultBook: LibraryBookInput = {
  title: "",
  author: "",
  isbn: "",
  category: "General",
  yearLevel: "1st Year",
  totalCopies: 1,
  shelfLocation: "",
  copies: [{ bookCode: "" }],
};

const defaultIssue: LibraryIssueInput = {
  bookId: "",
  copyId: "",
  borrowerType: "STUDENT",
  studentId: "",
  teacherId: "",
  issuedDateBs: "",
  dueDateBs: "",
};

const defaultStaff: ModuleStaffInput = {
  fullName: "",
  email: "",
  phone: "",
};

const issueStatusStyles: Record<string, string> = {
  ISSUED: "bg-sky-100 text-sky-800",
  RETURNED: "bg-brand-100 text-brand-800",
  OVERDUE: "bg-rose-100 text-rose-800",
};

const copyStatusStyles: Record<LibraryCopyStatus, string> = {
  AVAILABLE: "bg-emerald-100 text-emerald-800",
  ISSUED: "bg-sky-100 text-sky-800",
  LOST: "bg-rose-100 text-rose-800",
  DAMAGED: "bg-orange-100 text-orange-800",
  MAINTENANCE: "bg-amber-100 text-amber-800",
};

const tabs: Array<{
  id: Tab;
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
}> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "inventory", label: "Inventory", icon: Package },
  { id: "issue", label: "Issue Books", icon: BookOpen },
  { id: "returns", label: "Returns", icon: RotateCcw },
  { id: "staff", label: "Staff", icon: Users, adminOnly: true },
];

export const LibraryManager = () => {
  const { user } = useAuth();
  const isAdmin = canManageInstitution(user?.role ?? "");
  const [tab, setTab] = useState<Tab>("dashboard");
  const [bookForm, setBookForm] = useState<LibraryBookInput>(defaultBook);
  const [copyDrafts, setCopyDrafts] = useState<CopyDraft[]>([emptyCopy()]);
  const [addCopyDrafts, setAddCopyDrafts] = useState<CopyDraft[]>([]);
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [expandedBookId, setExpandedBookId] = useState<string | null>(null);
  const [issueForm, setIssueForm] = useState<LibraryIssueInput>(defaultIssue);
  const [staffForm, setStaffForm] = useState<ModuleStaffInput>(defaultStaff);
  const [inventorySearch, setInventorySearch] = useState("");
  const [yearFilter, setYearFilter] = useState<"ALL" | LibraryYearLevel>("ALL");

  const dashboardQuery = useQuery({
    queryKey: ["library-dashboard"],
    queryFn: () =>
      unwrap<LibraryDashboardResponse>(api.get("/library/dashboard")),
    enabled: tab === "dashboard",
  });

  const booksQuery = useQuery({
    queryKey: ["library-books"],
    queryFn: () => unwrap<LibraryBookRecord[]>(api.get("/library/books")),
  });

  const inventoryAccessQuery = useQuery({
    queryKey: ["library-inventory-access"],
    queryFn: () =>
      unwrap<LibraryInventoryAccessResponse>(
        api.get("/library/inventory-access"),
      ),
  });

  const inventoryAccessEnabled = inventoryAccessQuery.data?.enabled ?? false;
  const libraryModuleWrite =
    isAdmin ||
    ((user?.moduleAccess?.library ?? "WRITE") !== "READ_ONLY" &&
      (user?.moduleAccess?.inventory ?? "WRITE") !== "READ_ONLY");
  const canManageInventory =
    isAdmin || (inventoryAccessEnabled && libraryModuleWrite);
  const libraryReadOnly = !libraryModuleWrite;

  const studentsQuery = useQuery({
    queryKey: ["students"],
    queryFn: () =>
      unwrap<Array<{ _id: string; user: { fullName: string } }>>(
        api.get("/students"),
      ),
  });

  const teachersQuery = useQuery({
    queryKey: ["teachers"],
    queryFn: () =>
      unwrap<Array<{ _id: string; user: { fullName: string } }>>(
        api.get("/teachers"),
      ),
  });

  const staffQuery = useQuery({
    queryKey: ["library-staff"],
    queryFn: () => unwrap<UserProfile[]>(api.get("/library/staff")),
    enabled: isAdmin && tab === "staff",
  });

  const selectedBook = useMemo(
    () =>
      (booksQuery.data ?? []).find((b) => b._id === issueForm.bookId) ?? null,
    [booksQuery.data, issueForm.bookId],
  );

  const availableCopies = useMemo(
    () =>
      (selectedBook?.copies ?? []).filter(
        (c) => c.status === "AVAILABLE",
      ) as LibraryBookCopyRecord[],
    [selectedBook],
  );

  const filteredBooks = useMemo(() => {
    const q = inventorySearch.trim().toLowerCase();
    let books = booksQuery.data ?? [];
    if (yearFilter !== "ALL") {
      books = books.filter(
        (book) => (book.yearLevel ?? "All Years") === yearFilter,
      );
    }
    if (!q) return books;
    return books.filter((book) => {
      const year = (book.yearLevel ?? "All Years").toLowerCase();
      const inTitle =
        book.title.toLowerCase().includes(q) ||
        book.author.toLowerCase().includes(q) ||
        book.category.toLowerCase().includes(q) ||
        year.includes(q) ||
        (book.isbn ?? "").toLowerCase().includes(q);
      const inCodes = (book.copies ?? []).some((c) =>
        c.bookCode.toLowerCase().includes(q),
      );
      return inTitle || inCodes;
    });
  }, [booksQuery.data, inventorySearch, yearFilter]);

  useEffect(() => {
    if (!editingBookId) {
      setCopyDrafts((prev) => resizeCopies(prev, bookForm.totalCopies));
    }
  }, [bookForm.totalCopies, editingBookId]);

  const invalidateLibrary = async () => {
    await queryClient.invalidateQueries({ queryKey: ["library-books"] });
    await queryClient.invalidateQueries({ queryKey: ["library-issues"] });
    await queryClient.invalidateQueries({ queryKey: ["library-dashboard"] });
    await queryClient.invalidateQueries({
      queryKey: ["library-inventory-access"],
    });
  };

  const toggleInventoryAccess = useMutation({
    mutationFn: (enabled: boolean) =>
      unwrap<LibraryInventoryAccessResponse>(
        api.put("/library/inventory-access", { enabled }),
      ),
    onSuccess: async (_data, enabled) => {
      toast.success(
        enabled
          ? "Inventory access enabled for library staff"
          : "Inventory access disabled",
      );
      await queryClient.invalidateQueries({
        queryKey: ["library-inventory-access"],
      });
      await queryClient.invalidateQueries({ queryKey: ["library-dashboard"] });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const saveBook = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editingBookId
        ? unwrap(api.put(`/library/books/${editingBookId}`, payload))
        : unwrap(api.post("/library/books", payload)),
    onSuccess: async () => {
      toast.success(
        editingBookId
          ? "Book updated"
          : "Book added with all physical copy codes",
      );
      setBookForm(defaultBook);
      setCopyDrafts([emptyCopy()]);
      setAddCopyDrafts([]);
      setEditingBookId(null);
      await invalidateLibrary();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const deleteBook = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/library/books/${id}`)),
    onSuccess: async () => {
      toast.success("Book deleted");
      await invalidateLibrary();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const issueBook = useMutation({
    mutationFn: (payload: LibraryIssueInput) =>
      unwrap(api.post("/library/issues", payload)),
    onSuccess: async () => {
      toast.success("Book issued by copy code");
      setIssueForm(defaultIssue);
      await invalidateLibrary();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const createStaff = useMutation({
    mutationFn: (payload: ModuleStaffInput) =>
      unwrap<{
        loginEmail?: string;
        defaultPassword?: string;
        credentialsEmail?: import("lib/credentialsEmail").CredentialsEmailResult;
      }>(api.post("/library/staff", payload)),
    onSuccess: async (data) => {
      const { toastCredentialCreateResult } =
        await import("lib/credentialsEmail");
      toastCredentialCreateResult(data ?? {}, {
        successTitle: "Library staff created successfully",
      });
      setStaffForm(defaultStaff);
      await queryClient.invalidateQueries({ queryKey: ["library-staff"] });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const visibleTabs = tabs.filter((item) => !item.adminOnly || isAdmin);

  const submitBook = () => {
    if (editingBookId) {
      const addCopies = addCopyDrafts
        .filter((c) => c.bookCode.trim())
        .map((c) => ({
          bookCode: c.bookCode.trim(),
          shelfLocation: c.shelfLocation.trim() || bookForm.shelfLocation || "",
          condition: c.condition.trim() || "",
        }));
      saveBook.mutate({
        title: bookForm.title,
        author: bookForm.author,
        isbn: bookForm.isbn,
        category: bookForm.category,
        yearLevel: bookForm.yearLevel,
        shelfLocation: bookForm.shelfLocation,
        ...(addCopies.length ? { addCopies } : {}),
      });
      return;
    }

    const copies = copyDrafts.map((c) => ({
      bookCode: c.bookCode.trim(),
      shelfLocation: c.shelfLocation.trim() || bookForm.shelfLocation || "",
      condition: c.condition.trim() || "",
    }));

    const payload: LibraryBookInput = {
      ...bookForm,
      totalCopies: copies.length,
      copies,
    };

    const parsed = libraryBookSchema.safeParse(payload);
    if (!parsed.success) {
      const msg =
        parsed.error.issues[0]?.message ??
        "Enter a unique book code for every physical copy";
      return toast.error(msg);
    }
    saveBook.mutate(parsed.data);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Library"
        description="Register each physical book with a unique code, issue by code, and track which student has which copy."
      />

      <ModuleReadOnlyBanner show={libraryReadOnly} />

      <div className="flex flex-wrap gap-2">
        {visibleTabs.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              key={item.id}
              variant={tab === item.id ? "default" : "secondary"}
              size="sm"
              onClick={() => setTab(item.id)}
              className={cn(
                tab === item.id && "bg-brand-600 hover:bg-brand-700",
              )}
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
              {
                label: "Total Physical Books",
                value: dashboardQuery.data?.totalBooks ?? 0,
              },
              {
                label: "Available",
                value: dashboardQuery.data?.availableBooks ?? 0,
              },
              { label: "Issued", value: dashboardQuery.data?.issuedBooks ?? 0 },
              {
                label: "Overdue",
                value: dashboardQuery.data?.overdueBooks ?? 0,
              },
            ].map((stat) => (
              <Card
                key={stat.label}
                className="bg-[linear-gradient(135deg,_white_0%,_#eef3fb_100%)]"
              >
                <CardContent className="py-6">
                  <p className="text-sm text-slate-500">{stat.label}</p>
                  <p className="text-3xl font-semibold text-slate-900">
                    {stat.value}
                  </p>
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
                    <Th>Code</Th>
                    <Th>Borrower</Th>
                    <Th>Due</Th>
                    <Th>Status</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {(dashboardQuery.data?.recentlyIssued ?? []).map((issue) => (
                    <tr key={issue._id}>
                      <Td>{issue.bookTitle ?? "—"}</Td>
                      <Td className="font-mono text-sm">
                        {issue.bookCode ?? "—"}
                      </Td>
                      <Td>
                        {issue.borrowerType === "STUDENT" &&
                        resolveStudentId(issue.studentId) ? (
                          <StudentNameLink
                            studentId={resolveStudentId(issue.studentId)!}
                            name={issue.borrowerName?.trim() || "Student"}
                          />
                        ) : (
                          (issue.borrowerName?.trim() || "—")
                        )}
                      </Td>
                      <Td>{issue.dueDateBs}</Td>
                      <Td>
                        <Badge
                          className={issueStatusStyles[issue.status] ?? ""}
                        >
                          {issue.status}
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

      {tab === "inventory" && (
        <div className="space-y-4">
          {isAdmin ? (
            <Card className="border-brand-200 bg-[linear-gradient(135deg,_white_0%,_#eef3fb_100%)]">
              <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
                <div>
                  <p className="font-medium text-slate-900">
                    Inventory access for library staff
                  </p>
                  <p className="text-sm text-slate-500">
                    Turn on when new stock arrives so staff can add, edit, or
                    remove books. Turn off to freeze inventory changes.
                  </p>
                </div>
                <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={inventoryAccessEnabled}
                    disabled={
                      toggleInventoryAccess.isPending ||
                      inventoryAccessQuery.isLoading
                    }
                    onChange={(event) =>
                      toggleInventoryAccess.mutate(event.target.checked)
                    }
                  />
                  {inventoryAccessEnabled
                    ? "Access enabled"
                    : "Access disabled"}
                </label>
              </CardContent>
            </Card>
          ) : null}

          {!canManageInventory ? (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="flex items-start gap-3 py-4">
                <Lock className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                <div>
                  <p className="font-medium text-amber-900">
                    Inventory is frozen
                  </p>
                  <p className="text-sm text-amber-800">
                    You can view the catalog, but adding, editing, or deleting
                    books is disabled until an administrator enables inventory
                    access.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div
            className={cn(
              "grid gap-6",
              canManageInventory && "xl:grid-cols-[420px_1fr]",
            )}
          >
            {canManageInventory ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    {editingBookId
                      ? "Edit book / add more copies"
                      : "Add book with physical copies"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-slate-500">
                    {editingBookId
                      ? "Update title details, or add extra physical copies with new unique codes."
                      : "Enter title once, set how many physical books you have, then type a unique code for each copy (e.g. ANA001, ANA002)."}
                  </p>
                  <FormField label="Title">
                    <Input
                      value={bookForm.title}
                      onChange={(e) =>
                        setBookForm((c) => ({ ...c, title: e.target.value }))
                      }
                      placeholder="e.g. Human Anatomy & Physiology"
                    />
                  </FormField>
                  <FormField label="Author">
                    <Input
                      value={bookForm.author}
                      onChange={(e) =>
                        setBookForm((c) => ({ ...c, author: e.target.value }))
                      }
                    />
                  </FormField>
                  <FormField label="Category">
                    <Input
                      value={bookForm.category}
                      onChange={(e) =>
                        setBookForm((c) => ({ ...c, category: e.target.value }))
                      }
                      placeholder="e.g. Anatomy, Physiology"
                    />
                  </FormField>
                  <FormField label="Year">
                    <Select
                      value={bookForm.yearLevel ?? "1st Year"}
                      onChange={(e) =>
                        setBookForm((c) => ({
                          ...c,
                          yearLevel: e.target.value as LibraryYearLevel,
                        }))
                      }
                    >
                      {LIBRARY_YEAR_LEVELS.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <p className="text-xs text-slate-500 -mt-1">
                    Assign books to 1st, 2nd, or 3rd Year so staff can filter the
                    catalog by year. Use “All Years” for shared/reference books.
                  </p>
                  <FormField label="ISBN (optional)">
                    <Input
                      value={bookForm.isbn}
                      onChange={(e) =>
                        setBookForm((c) => ({ ...c, isbn: e.target.value }))
                      }
                    />
                  </FormField>
                  <FormField label="Default shelf (optional)">
                    <Input
                      value={bookForm.shelfLocation ?? ""}
                      onChange={(e) =>
                        setBookForm((c) => ({
                          ...c,
                          shelfLocation: e.target.value,
                        }))
                      }
                      placeholder="e.g. A-12"
                    />
                  </FormField>

                  {!editingBookId ? (
                    <>
                      <FormField label="Number of physical copies">
                        <NumberInput
                          min={1}
                          max={200}
                          value={bookForm.totalCopies}
                          onChange={(e) => {
                            const n = e.target.valueAsNumber || 1;
                            setBookForm((c) => ({ ...c, totalCopies: n }));
                            setCopyDrafts((prev) => resizeCopies(prev, n));
                          }}
                        />
                      </FormField>
                      <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="text-sm font-medium text-slate-800">
                          Book codes ({copyDrafts.length})
                        </p>
                        <p className="text-xs text-slate-500">
                          Each physical book needs its own code. Codes must be
                          unique (e.g. ANA001 … ANA030).
                        </p>
                        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                          {copyDrafts.map((copy, index) => (
                            <div
                              key={index}
                              className="grid gap-2 rounded-md border border-slate-200 bg-white p-2 sm:grid-cols-[1fr_1fr]"
                            >
                              <FormField label={`Copy ${index + 1} code *`}>
                                <Input
                                  value={copy.bookCode}
                                  placeholder={`e.g. ANA${String(index + 1).padStart(3, "0")}`}
                                  onChange={(e) =>
                                    setCopyDrafts((rows) =>
                                      rows.map((row, i) =>
                                        i === index
                                          ? {
                                              ...row,
                                              bookCode: e.target.value,
                                            }
                                          : row,
                                      ),
                                    )
                                  }
                                />
                              </FormField>
                              <FormField label="Shelf (optional)">
                                <Input
                                  value={copy.shelfLocation}
                                  placeholder={
                                    bookForm.shelfLocation || "Shelf"
                                  }
                                  onChange={(e) =>
                                    setCopyDrafts((rows) =>
                                      rows.map((row, i) =>
                                        i === index
                                          ? {
                                              ...row,
                                              shelfLocation: e.target.value,
                                            }
                                          : row,
                                      ),
                                    )
                                  }
                                />
                              </FormField>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-slate-800">
                          Add more physical copies
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            setAddCopyDrafts((rows) => [...rows, emptyCopy()])
                          }
                        >
                          + Add copy row
                        </Button>
                      </div>
                      {addCopyDrafts.length === 0 ? (
                        <p className="text-xs text-slate-500">
                          Existing copies stay as-is. Use “+ Add copy row” to
                          register extra volumes with new codes.
                        </p>
                      ) : (
                        <div className="max-h-56 space-y-2 overflow-y-auto">
                          {addCopyDrafts.map((copy, index) => (
                            <div
                              key={index}
                              className="grid gap-2 rounded-md border border-slate-200 bg-white p-2 sm:grid-cols-[1fr_auto]"
                            >
                              <Input
                                value={copy.bookCode}
                                placeholder="New book code"
                                onChange={(e) =>
                                  setAddCopyDrafts((rows) =>
                                    rows.map((row, i) =>
                                      i === index
                                        ? { ...row, bookCode: e.target.value }
                                        : row,
                                    ),
                                  )
                                }
                              />
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setAddCopyDrafts((rows) =>
                                    rows.filter((_, i) => i !== index),
                                  )
                                }
                              >
                                Remove
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button onClick={submitBook} disabled={saveBook.isPending}>
                      {editingBookId ? "Update" : "Add book & codes"}
                    </Button>
                    {editingBookId ? (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setEditingBookId(null);
                          setBookForm(defaultBook);
                          setCopyDrafts([emptyCopy()]);
                          setAddCopyDrafts([]);
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
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                <CardTitle>Library inventory</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    className="w-auto min-w-[140px]"
                    value={yearFilter}
                    onChange={(e) =>
                      setYearFilter(
                        e.target.value as "ALL" | LibraryYearLevel,
                      )
                    }
                  >
                    <option value="ALL">All years</option>
                    {LIBRARY_YEAR_LEVELS.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </Select>
                  <Input
                    className="max-w-xs"
                    placeholder="Search title, author, year, or book code…"
                    value={inventorySearch}
                    onChange={(e) => setInventorySearch(e.target.value)}
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {filteredBooks.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-500">
                    No books match this year filter or search.
                  </p>
                ) : (
                  filteredBooks.map((book) => {
                    const expanded = expandedBookId === book._id;
                    const copies = book.copies ?? [];
                    return (
                      <div
                        key={book._id}
                        className="rounded-lg border border-slate-200"
                      >
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-3 text-left hover:bg-slate-50"
                          onClick={() =>
                            setExpandedBookId(expanded ? null : book._id)
                          }
                        >
                          {expanded ? (
                            <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                          ) : (
                            <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-slate-900">
                                {book.title}
                              </p>
                              <Badge className="bg-indigo-100 text-indigo-800">
                                {book.yearLevel ?? "All Years"}
                              </Badge>
                            </div>
                            <p className="text-xs text-slate-500">
                              {book.author} · {book.category} ·{" "}
                              {book.totalCopies} copies ·{" "}
                              {book.availableCopies} available ·{" "}
                              {book.issuedCopies} issued
                            </p>
                          </div>
                          <StockStatusBadge status={book.status} />
                          {canManageInventory ? (
                            <div
                              className="flex gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
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
                                    yearLevel:
                                      book.yearLevel ?? "All Years",
                                    totalCopies: book.totalCopies,
                                    shelfLocation: book.shelfLocation ?? "",
                                  });
                                  setAddCopyDrafts([]);
                                }}
                              >
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Delete "${book.title}" and all its physical copies?`,
                                    )
                                  ) {
                                    deleteBook.mutate(book._id);
                                  }
                                }}
                              >
                                Delete
                              </Button>
                            </div>
                          ) : null}
                        </button>
                        {expanded ? (
                          <div className="border-t border-slate-100 px-3 py-2">
                            {copies.length === 0 ? (
                              <p className="py-2 text-sm text-amber-700">
                                No coded copies yet for this title (legacy
                                stock). Re-add with codes for full tracking.
                              </p>
                            ) : (
                              <Table>
                                <TableHead>
                                  <tr>
                                    <Th>Book code</Th>
                                    <Th>Status</Th>
                                    <Th>Shelf</Th>
                                  </tr>
                                </TableHead>
                                <TableBody>
                                  {copies.map((copy) => (
                                    <tr key={copy._id}>
                                      <Td className="font-mono font-medium">
                                        {copy.bookCode}
                                      </Td>
                                      <Td>
                                        <Badge
                                          className={
                                            copyStatusStyles[copy.status] ?? ""
                                          }
                                        >
                                          {copy.status}
                                        </Badge>
                                      </Td>
                                      <Td>
                                        {copy.shelfLocation ||
                                          book.shelfLocation ||
                                          "—"}
                                      </Td>
                                    </tr>
                                  ))}
                                </TableBody>
                              </Table>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {tab === "issue" && (
        <Card>
          <CardHeader>
            <CardTitle>Issue book by code</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <FormField label="Book title">
              <Select
                value={issueForm.bookId}
                onChange={(e) =>
                  setIssueForm((c) => ({
                    ...c,
                    bookId: e.target.value,
                    copyId: "",
                  }))
                }
              >
                <option value="">Select book</option>
                {(booksQuery.data ?? [])
                  .filter(
                    (b) =>
                      (b.copies ?? []).some((c) => c.status === "AVAILABLE") ||
                      b.availableCopies > 0,
                  )
                  .map((b) => (
                    <option key={b._id} value={b._id}>
                      [{b.yearLevel ?? "All Years"}] {b.title} (
                      {(b.copies ?? []).filter((c) => c.status === "AVAILABLE")
                        .length || b.availableCopies}{" "}
                      available)
                    </option>
                  ))}
              </Select>
            </FormField>
            <FormField label="Physical book code">
              <Select
                value={issueForm.copyId ?? ""}
                onChange={(e) =>
                  setIssueForm((c) => ({ ...c, copyId: e.target.value }))
                }
                disabled={!issueForm.bookId}
              >
                <option value="">Select code to issue</option>
                {availableCopies.map((copy) => (
                  <option key={copy._id} value={copy._id}>
                    {copy.bookCode}
                    {copy.shelfLocation ? ` · ${copy.shelfLocation}` : ""}
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
                    teacherId: "",
                  }))
                }
              >
                <option value="STUDENT">Student</option>
                <option value="TEACHER">Teacher</option>
              </Select>
            </FormField>
            {issueForm.borrowerType === "STUDENT" ? (
              <FormField label="Student">
                <Select
                  value={issueForm.studentId}
                  onChange={(e) =>
                    setIssueForm((c) => ({ ...c, studentId: e.target.value }))
                  }
                >
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
                <Select
                  value={issueForm.teacherId}
                  onChange={(e) =>
                    setIssueForm((c) => ({ ...c, teacherId: e.target.value }))
                  }
                >
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
              <NepaliDateField
                value={issueForm.issuedDateBs}
                onChange={(v) =>
                  setIssueForm((c) => ({ ...c, issuedDateBs: v }))
                }
              />
            </FormField>
            <FormField label="Due (BS)">
              <NepaliDateField
                value={issueForm.dueDateBs}
                onChange={(v) => setIssueForm((c) => ({ ...c, dueDateBs: v }))}
              />
            </FormField>
            <div className="flex items-end">
              <Button
                onClick={() => {
                  const parsed = libraryIssueSchema.safeParse(issueForm);
                  if (!parsed.success) {
                    return toast.error(
                      parsed.error.issues[0]?.message ??
                        "Select book, code, borrower, and dates",
                    );
                  }
                  issueBook.mutate(parsed.data);
                }}
                disabled={issueBook.isPending}
              >
                Issue this copy
              </Button>
            </div>
            {issueForm.copyId && selectedBook ? (
              <p className="md:col-span-2 xl:col-span-3 text-sm text-slate-600">
                Issuing{" "}
                <span className="font-mono font-semibold">
                  {
                    availableCopies.find((c) => c._id === issueForm.copyId)
                      ?.bookCode
                  }
                </span>{" "}
                of <strong>{selectedBook.title}</strong>. Only this code will
                become ISSUED; other copies stay available.
              </p>
            ) : null}
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
                <Input
                  value={staffForm.fullName}
                  onChange={(e) =>
                    setStaffForm((c) => ({ ...c, fullName: e.target.value }))
                  }
                />
              </FormField>
              <FormField label="Email">
                <Input
                  value={staffForm.email}
                  onChange={(e) =>
                    setStaffForm((c) => ({ ...c, email: e.target.value }))
                  }
                />
              </FormField>
              <FormField label="Phone">
                <Input
                  value={staffForm.phone}
                  onChange={(e) =>
                    setStaffForm((c) => ({ ...c, phone: e.target.value }))
                  }
                />
              </FormField>
              <Button
                onClick={() => {
                  const parsed = moduleStaffSchema.safeParse(staffForm);
                  if (!parsed.success)
                    return toast.error("Invalid staff details");
                  createStaff.mutate(parsed.data);
                }}
              >
                Create account
              </Button>
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
                        <Badge
                          className={
                            member.isActive
                              ? "bg-brand-100 text-brand-800"
                              : "bg-slate-100 text-slate-600"
                          }
                        >
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
