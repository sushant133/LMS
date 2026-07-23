import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  canManageInstitution,
  LIBRARY_YEAR_LEVELS,
  libraryBookSchema,
  libraryIssueSchema,
  moduleStaffSchema,
  type LibraryBookCopyRecord,
  type LibraryBookCopyUpdateInput,
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
import { useIsCollege } from "hooks/useInstitutionType";
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

/** Student fields used for issue-book borrower filtering (limited library roster). */
type IssueStudentRow = {
  _id: string;
  admissionNumber?: string;
  rollNumber?: number;
  batchId?: string;
  batchName?: string;
  yearId?: string;
  yearName?: string;
  classId?: string;
  className?: string;
  sectionId?: string;
  sectionName?: string;
  user?: { fullName?: string } | null;
};

type IssueTeacherRow = {
  _id: string;
  user?: { fullName?: string } | null;
};

type Tab = "dashboard" | "inventory" | "issue" | "returns" | "staff";

type CopyDraft = {
  bookCode: string;
  shelfLocation: string;
  condition: string;
  publication: string;
  priceNpr: number;
};

/** Editable inventory fields for an existing physical copy (status optional). */
type CopyEditDraft = CopyDraft & {
  status: Exclude<LibraryCopyStatus, "ISSUED"> | "ISSUED";
};

const emptyCopy = (): CopyDraft => ({
  bookCode: "",
  shelfLocation: "",
  condition: "",
  publication: "",
  priceNpr: 0,
});

const inventoryCopyStatuses: Array<Exclude<LibraryCopyStatus, "ISSUED">> = [
  "AVAILABLE",
  "LOST",
  "DAMAGED",
  "MAINTENANCE",
];

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
  copies: [{ bookCode: "", priceNpr: 0 }],
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
  const isCollege = useIsCollege();
  const isAdmin = canManageInstitution(user?.role ?? "");
  const [tab, setTab] = useState<Tab>("dashboard");
  const [bookForm, setBookForm] = useState<LibraryBookInput>(defaultBook);
  const [copyDrafts, setCopyDrafts] = useState<CopyDraft[]>([emptyCopy()]);
  const [addCopyDrafts, setAddCopyDrafts] = useState<CopyDraft[]>([]);
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [expandedBookId, setExpandedBookId] = useState<string | null>(null);
  const [editingCopyId, setEditingCopyId] = useState<string | null>(null);
  const [copyEditDraft, setCopyEditDraft] = useState<CopyEditDraft | null>(null);
  const [issueForm, setIssueForm] = useState<LibraryIssueInput>(defaultIssue);
  const [staffForm, setStaffForm] = useState<ModuleStaffInput>(defaultStaff);
  const [inventorySearch, setInventorySearch] = useState("");
  const [yearFilter, setYearFilter] = useState<"ALL" | LibraryYearLevel>("ALL");

  // Issue-book filters & search
  const [issueStudentSearch, setIssueStudentSearch] = useState("");
  const [issueTeacherSearch, setIssueTeacherSearch] = useState("");
  const [issueBookSearch, setIssueBookSearch] = useState("");
  const [issueBatchId, setIssueBatchId] = useState("");
  const [issueYearId, setIssueYearId] = useState("");
  const [issueClassId, setIssueClassId] = useState("");
  const [issueSectionId, setIssueSectionId] = useState("");

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
    queryKey: ["students", "library-issue"],
    queryFn: () => unwrap<IssueStudentRow[]>(api.get("/students")),
    enabled: tab === "issue",
  });

  const teachersQuery = useQuery({
    queryKey: ["teachers", "library-issue"],
    queryFn: () => unwrap<IssueTeacherRow[]>(api.get("/teachers")),
    enabled: tab === "issue",
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

  /** Filter options derived from the student roster (works for library staff without academics module). */
  const issueBatchOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of studentsQuery.data ?? []) {
      if (s.batchId) map.set(s.batchId, s.batchName || "Batch");
    }
    return [...map.entries()]
      .map(([id, name]) => ({ _id: id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [studentsQuery.data]);

  const issueYearOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of studentsQuery.data ?? []) {
      if (issueBatchId && s.batchId !== issueBatchId) continue;
      if (s.yearId) map.set(s.yearId, s.yearName || "Year");
    }
    return [...map.entries()]
      .map(([id, name]) => ({ _id: id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [studentsQuery.data, issueBatchId]);

  const issueClassOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of studentsQuery.data ?? []) {
      if (s.classId) map.set(s.classId, s.className || "Class");
    }
    return [...map.entries()]
      .map(([id, name]) => ({ _id: id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [studentsQuery.data]);

  const issueSectionOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of studentsQuery.data ?? []) {
      if (issueClassId && s.classId !== issueClassId) continue;
      if (s.sectionId) map.set(s.sectionId, s.sectionName || "Section");
    }
    return [...map.entries()]
      .map(([id, name]) => ({ _id: id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [studentsQuery.data, issueClassId]);

  const filteredIssueStudents = useMemo(() => {
    let list = studentsQuery.data ?? [];
    if (isCollege) {
      if (issueBatchId) {
        list = list.filter((s) => s.batchId === issueBatchId);
      }
      if (issueYearId) {
        list = list.filter((s) => s.yearId === issueYearId);
      }
    } else {
      if (issueClassId) {
        list = list.filter((s) => s.classId === issueClassId);
      }
      if (issueSectionId) {
        list = list.filter((s) => s.sectionId === issueSectionId);
      }
    }
    const q = issueStudentSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((s) => {
      const name = (s.user?.fullName ?? "").toLowerCase();
      const admission = (s.admissionNumber ?? "").toLowerCase();
      const roll = String(s.rollNumber ?? "");
      return (
        name.includes(q) ||
        admission.includes(q) ||
        roll.includes(q)
      );
    });
  }, [
    studentsQuery.data,
    isCollege,
    issueBatchId,
    issueYearId,
    issueClassId,
    issueSectionId,
    issueStudentSearch,
  ]);

  const filteredIssueTeachers = useMemo(() => {
    const list = teachersQuery.data ?? [];
    const q = issueTeacherSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((t) =>
      (t.user?.fullName ?? "").toLowerCase().includes(q),
    );
  }, [teachersQuery.data, issueTeacherSearch]);

  /** Books with at least one available copy, filtered by title/author/isbn/code. */
  const filteredIssueBooks = useMemo(() => {
    const q = issueBookSearch.trim().toLowerCase();
    const books = (booksQuery.data ?? []).filter(
      (b) =>
        (b.copies ?? []).some((c) => c.status === "AVAILABLE") ||
        b.availableCopies > 0,
    );
    if (!q) return books;
    return books.filter((book) => {
      const inMeta =
        book.title.toLowerCase().includes(q) ||
        book.author.toLowerCase().includes(q) ||
        (book.isbn ?? "").toLowerCase().includes(q) ||
        book.category.toLowerCase().includes(q) ||
        (book.yearLevel ?? "").toLowerCase().includes(q);
      const inCodes = (book.copies ?? []).some((c) =>
        c.bookCode.toLowerCase().includes(q),
      );
      return inMeta || inCodes;
    });
  }, [booksQuery.data, issueBookSearch]);

  /** Flat available copies matching book search (for quick pick by code). */
  const matchingAvailableCopies = useMemo(() => {
    const q = issueBookSearch.trim().toLowerCase();
    if (!q) return [] as Array<LibraryBookCopyRecord & { bookTitle: string; bookId: string }>;
    const out: Array<LibraryBookCopyRecord & { bookTitle: string; bookId: string }> = [];
    for (const book of booksQuery.data ?? []) {
      for (const copy of book.copies ?? []) {
        if (copy.status !== "AVAILABLE") continue;
        if (
          copy.bookCode.toLowerCase().includes(q) ||
          book.title.toLowerCase().includes(q)
        ) {
          out.push({
            ...copy,
            bookTitle: book.title,
            bookId: book._id,
          });
        }
      }
    }
    return out.slice(0, 40);
  }, [booksQuery.data, issueBookSearch]);

  const selectedStudent = useMemo(() => {
    if (!issueForm.studentId) return null;
    return (
      (studentsQuery.data ?? []).find((s) => s._id === issueForm.studentId) ??
      null
    );
  }, [studentsQuery.data, issueForm.studentId]);

  const selectedTeacher = useMemo(() => {
    if (!issueForm.teacherId) return null;
    return (
      (teachersQuery.data ?? []).find((t) => t._id === issueForm.teacherId) ??
      null
    );
  }, [teachersQuery.data, issueForm.teacherId]);

  const selectBookForIssue = (bookId: string) => {
    setIssueForm((c) => ({
      ...c,
      bookId,
      copyId: "",
      bookCode: "",
    }));
  };

  const selectCopyForIssue = (bookId: string, copyId: string, bookCode?: string) => {
    setIssueForm((c) => ({
      ...c,
      bookId,
      copyId,
      bookCode: bookCode ?? "",
    }));
  };

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

  const updateCopy = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: LibraryBookCopyUpdateInput;
    }) => unwrap(api.put(`/library/copies/${id}`, payload)),
    onSuccess: async () => {
      toast.success("Copy updated");
      setEditingCopyId(null);
      setCopyEditDraft(null);
      await invalidateLibrary();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const deleteCopy = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/library/copies/${id}`)),
    onSuccess: async () => {
      toast.success("Copy deleted");
      if (editingCopyId) {
        setEditingCopyId(null);
        setCopyEditDraft(null);
      }
      await invalidateLibrary();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const startEditCopy = (copy: LibraryBookCopyRecord) => {
    setEditingCopyId(copy._id);
    setCopyEditDraft({
      bookCode: copy.bookCode,
      shelfLocation: copy.shelfLocation ?? "",
      condition: copy.condition ?? "",
      publication: copy.publication ?? "",
      priceNpr: typeof copy.priceNpr === "number" ? copy.priceNpr : 0,
      status: copy.status,
    });
  };

  const cancelEditCopy = () => {
    setEditingCopyId(null);
    setCopyEditDraft(null);
  };

  const submitCopyEdit = () => {
    if (!editingCopyId || !copyEditDraft) return;
    if (!copyEditDraft.bookCode.trim()) {
      toast.error("Book code is required");
      return;
    }
    const payload: LibraryBookCopyUpdateInput = {
      bookCode: copyEditDraft.bookCode.trim(),
      shelfLocation: copyEditDraft.shelfLocation.trim(),
      condition: copyEditDraft.condition.trim(),
      publication: copyEditDraft.publication.trim(),
      priceNpr:
        Number.isFinite(copyEditDraft.priceNpr) && copyEditDraft.priceNpr >= 0
          ? copyEditDraft.priceNpr
          : 0,
    };
    if (copyEditDraft.status !== "ISSUED") {
      payload.status = copyEditDraft.status;
    }
    updateCopy.mutate({ id: editingCopyId, payload });
  };

  const issueBook = useMutation({
    mutationFn: (payload: LibraryIssueInput) =>
      unwrap(api.post("/library/issues", payload)),
    onSuccess: async () => {
      toast.success("Book issued by copy code");
      setIssueForm(defaultIssue);
      setIssueStudentSearch("");
      setIssueTeacherSearch("");
      setIssueBookSearch("");
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
          publication: c.publication.trim() || "",
          priceNpr: Number.isFinite(c.priceNpr) && c.priceNpr >= 0 ? c.priceNpr : 0,
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
      publication: c.publication.trim() || "",
      priceNpr: Number.isFinite(c.priceNpr) && c.priceNpr >= 0 ? c.priceNpr : 0,
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
                        <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                          {copyDrafts.map((copy, index) => (
                            <div
                              key={index}
                              className="grid gap-2 rounded-md border border-slate-200 bg-white p-2 sm:grid-cols-2"
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
                              <FormField label="Publication (optional)">
                                <Input
                                  value={copy.publication}
                                  placeholder="e.g. Oxford University Press"
                                  onChange={(e) =>
                                    setCopyDrafts((rows) =>
                                      rows.map((row, i) =>
                                        i === index
                                          ? {
                                              ...row,
                                              publication: e.target.value,
                                            }
                                          : row,
                                      ),
                                    )
                                  }
                                />
                              </FormField>
                              <FormField label="Price (NPR, optional)">
                                <NumberInput
                                  min={0}
                                  step={1}
                                  value={copy.priceNpr || ""}
                                  placeholder="0"
                                  onChange={(e) =>
                                    setCopyDrafts((rows) =>
                                      rows.map((row, i) =>
                                        i === index
                                          ? {
                                              ...row,
                                              priceNpr:
                                                e.target.valueAsNumber >= 0
                                                  ? e.target.valueAsNumber
                                                  : 0,
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
                        <div className="max-h-72 space-y-2 overflow-y-auto">
                          {addCopyDrafts.map((copy, index) => (
                            <div
                              key={index}
                              className="grid gap-2 rounded-md border border-slate-200 bg-white p-2 sm:grid-cols-2"
                            >
                              <FormField label="Book code *">
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
                              </FormField>
                              <FormField label="Shelf (optional)">
                                <Input
                                  value={copy.shelfLocation}
                                  placeholder={bookForm.shelfLocation || "Shelf"}
                                  onChange={(e) =>
                                    setAddCopyDrafts((rows) =>
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
                              <FormField label="Publication (optional)">
                                <Input
                                  value={copy.publication}
                                  placeholder="Publisher / publication"
                                  onChange={(e) =>
                                    setAddCopyDrafts((rows) =>
                                      rows.map((row, i) =>
                                        i === index
                                          ? {
                                              ...row,
                                              publication: e.target.value,
                                            }
                                          : row,
                                      ),
                                    )
                                  }
                                />
                              </FormField>
                              <FormField label="Price (NPR, optional)">
                                <NumberInput
                                  min={0}
                                  step={1}
                                  value={copy.priceNpr || ""}
                                  placeholder="0"
                                  onChange={(e) =>
                                    setAddCopyDrafts((rows) =>
                                      rows.map((row, i) =>
                                        i === index
                                          ? {
                                              ...row,
                                              priceNpr:
                                                e.target.valueAsNumber >= 0
                                                  ? e.target.valueAsNumber
                                                  : 0,
                                            }
                                          : row,
                                      ),
                                    )
                                  }
                                />
                              </FormField>
                              <div className="sm:col-span-2">
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
                                  Remove row
                                </Button>
                              </div>
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
                                    <Th>Publication</Th>
                                    <Th>Price (NPR)</Th>
                                    {canManageInventory ? (
                                      <Th className="text-right">Actions</Th>
                                    ) : null}
                                  </tr>
                                </TableHead>
                                <TableBody>
                                  {copies.map((copy) => {
                                    const isEditing =
                                      editingCopyId === copy._id &&
                                      copyEditDraft !== null;
                                    const isIssued = copy.status === "ISSUED";
                                    return (
                                      <tr key={copy._id}>
                                        {isEditing && copyEditDraft ? (
                                          <>
                                            <Td colSpan={canManageInventory ? 6 : 5}>
                                              <div className="space-y-3 rounded-md border border-brand-200 bg-brand-50/40 p-3">
                                                <p className="text-sm font-medium text-slate-800">
                                                  Edit copy {copy.bookCode}
                                                </p>
                                                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                                  <FormField label="Book code *">
                                                    <Input
                                                      value={copyEditDraft.bookCode}
                                                      onChange={(e) =>
                                                        setCopyEditDraft((d) =>
                                                          d
                                                            ? {
                                                                ...d,
                                                                bookCode:
                                                                  e.target.value,
                                                              }
                                                            : d,
                                                        )
                                                      }
                                                    />
                                                  </FormField>
                                                  <FormField label="Status">
                                                    {isIssued ? (
                                                      <div className="flex h-10 items-center">
                                                        <Badge
                                                          className={
                                                            copyStatusStyles.ISSUED
                                                          }
                                                        >
                                                          ISSUED
                                                        </Badge>
                                                        <span className="ml-2 text-xs text-slate-500">
                                                          Return to change status
                                                        </span>
                                                      </div>
                                                    ) : (
                                                      <Select
                                                        value={
                                                          copyEditDraft.status ===
                                                          "ISSUED"
                                                            ? "AVAILABLE"
                                                            : copyEditDraft.status
                                                        }
                                                        onChange={(e) =>
                                                          setCopyEditDraft((d) =>
                                                            d
                                                              ? {
                                                                  ...d,
                                                                  status: e.target
                                                                    .value as Exclude<
                                                                    LibraryCopyStatus,
                                                                    "ISSUED"
                                                                  >,
                                                                }
                                                              : d,
                                                          )
                                                        }
                                                      >
                                                        {inventoryCopyStatuses.map(
                                                          (status) => (
                                                            <option
                                                              key={status}
                                                              value={status}
                                                            >
                                                              {status}
                                                            </option>
                                                          ),
                                                        )}
                                                      </Select>
                                                    )}
                                                  </FormField>
                                                  <FormField label="Shelf">
                                                    <Input
                                                      value={
                                                        copyEditDraft.shelfLocation
                                                      }
                                                      placeholder={
                                                        book.shelfLocation ||
                                                        "Shelf"
                                                      }
                                                      onChange={(e) =>
                                                        setCopyEditDraft((d) =>
                                                          d
                                                            ? {
                                                                ...d,
                                                                shelfLocation:
                                                                  e.target.value,
                                                              }
                                                            : d,
                                                        )
                                                      }
                                                    />
                                                  </FormField>
                                                  <FormField label="Publication">
                                                    <Input
                                                      value={
                                                        copyEditDraft.publication
                                                      }
                                                      onChange={(e) =>
                                                        setCopyEditDraft((d) =>
                                                          d
                                                            ? {
                                                                ...d,
                                                                publication:
                                                                  e.target.value,
                                                              }
                                                            : d,
                                                        )
                                                      }
                                                    />
                                                  </FormField>
                                                  <FormField label="Condition">
                                                    <Input
                                                      value={
                                                        copyEditDraft.condition
                                                      }
                                                      placeholder="e.g. Good, Fair"
                                                      onChange={(e) =>
                                                        setCopyEditDraft((d) =>
                                                          d
                                                            ? {
                                                                ...d,
                                                                condition:
                                                                  e.target.value,
                                                              }
                                                            : d,
                                                        )
                                                      }
                                                    />
                                                  </FormField>
                                                  <FormField label="Price (NPR)">
                                                    <NumberInput
                                                      min={0}
                                                      step={1}
                                                      value={
                                                        copyEditDraft.priceNpr ||
                                                        ""
                                                      }
                                                      onChange={(e) =>
                                                        setCopyEditDraft((d) =>
                                                          d
                                                            ? {
                                                                ...d,
                                                                priceNpr:
                                                                  e.target
                                                                    .valueAsNumber >=
                                                                  0
                                                                    ? e.target
                                                                        .valueAsNumber
                                                                    : 0,
                                                              }
                                                            : d,
                                                        )
                                                      }
                                                    />
                                                  </FormField>
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                  <Button
                                                    size="sm"
                                                    onClick={submitCopyEdit}
                                                    disabled={
                                                      updateCopy.isPending
                                                    }
                                                  >
                                                    Save copy
                                                  </Button>
                                                  <Button
                                                    size="sm"
                                                    variant="secondary"
                                                    onClick={cancelEditCopy}
                                                    disabled={
                                                      updateCopy.isPending
                                                    }
                                                  >
                                                    Cancel
                                                  </Button>
                                                </div>
                                              </div>
                                            </Td>
                                          </>
                                        ) : (
                                          <>
                                            <Td className="font-mono font-medium">
                                              {copy.bookCode}
                                            </Td>
                                            <Td>
                                              <Badge
                                                className={
                                                  copyStatusStyles[
                                                    copy.status
                                                  ] ?? ""
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
                                            <Td>
                                              {copy.publication?.trim() || "—"}
                                            </Td>
                                            <Td>
                                              {typeof copy.priceNpr ===
                                                "number" && copy.priceNpr > 0
                                                ? copy.priceNpr.toLocaleString(
                                                    "en-NP",
                                                  )
                                                : "—"}
                                            </Td>
                                            {canManageInventory ? (
                                              <Td className="text-right">
                                                <div className="flex justify-end gap-1">
                                                  <Button
                                                    size="sm"
                                                    variant="secondary"
                                                    onClick={() =>
                                                      startEditCopy(copy)
                                                    }
                                                  >
                                                    Edit
                                                  </Button>
                                                  <Button
                                                    size="sm"
                                                    variant="outline"
                                                    disabled={
                                                      isIssued ||
                                                      deleteCopy.isPending
                                                    }
                                                    title={
                                                      isIssued
                                                        ? "Return this copy before deleting"
                                                        : "Delete this physical copy"
                                                    }
                                                    onClick={() => {
                                                      if (
                                                        window.confirm(
                                                          `Delete copy "${copy.bookCode}" from "${book.title}"?`,
                                                        )
                                                      ) {
                                                        deleteCopy.mutate(
                                                          copy._id,
                                                        );
                                                      }
                                                    }}
                                                  >
                                                    Delete
                                                  </Button>
                                                </div>
                                              </Td>
                                            ) : null}
                                          </>
                                        )}
                                      </tr>
                                    );
                                  })}
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
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Issue book</CardTitle>
              <p className="text-sm text-slate-600">
                Search and filter students by batch/year, search books by name or
                code, pick a physical copy, then issue.
              </p>
            </CardHeader>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            {/* —— Borrower —— */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">1. Select borrower</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <FormField label="Borrower type">
                  <Select
                    value={issueForm.borrowerType}
                    onChange={(e) => {
                      setIssueForm((c) => ({
                        ...c,
                        borrowerType: e.target.value as "STUDENT" | "TEACHER",
                        studentId: "",
                        teacherId: "",
                      }));
                      setIssueStudentSearch("");
                      setIssueTeacherSearch("");
                    }}
                  >
                    <option value="STUDENT">Student</option>
                    <option value="TEACHER">Teacher</option>
                  </Select>
                </FormField>

                {issueForm.borrowerType === "STUDENT" ? (
                  <>
                    {isCollege ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <FormField label="Batch">
                          <Select
                            value={issueBatchId}
                            onChange={(e) => {
                              setIssueBatchId(e.target.value);
                              setIssueYearId("");
                              setIssueForm((c) => ({ ...c, studentId: "" }));
                            }}
                          >
                            <option value="">All batches</option>
                            {issueBatchOptions.map((b) => (
                              <option key={b._id} value={b._id}>
                                {b.name}
                              </option>
                            ))}
                          </Select>
                        </FormField>
                        <FormField label="Year">
                          <Select
                            value={issueYearId}
                            onChange={(e) => {
                              setIssueYearId(e.target.value);
                              setIssueForm((c) => ({ ...c, studentId: "" }));
                            }}
                          >
                            <option value="">All years</option>
                            {issueYearOptions.map((y) => (
                              <option key={y._id} value={y._id}>
                                {y.name}
                              </option>
                            ))}
                          </Select>
                        </FormField>
                      </div>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <FormField label="Class">
                          <Select
                            value={issueClassId}
                            onChange={(e) => {
                              setIssueClassId(e.target.value);
                              setIssueSectionId("");
                              setIssueForm((c) => ({ ...c, studentId: "" }));
                            }}
                          >
                            <option value="">All classes</option>
                            {issueClassOptions.map((c) => (
                              <option key={c._id} value={c._id}>
                                {c.name}
                              </option>
                            ))}
                          </Select>
                        </FormField>
                        <FormField label="Section">
                          <Select
                            value={issueSectionId}
                            onChange={(e) => {
                              setIssueSectionId(e.target.value);
                              setIssueForm((c) => ({ ...c, studentId: "" }));
                            }}
                          >
                            <option value="">All sections</option>
                            {issueSectionOptions.map((s) => (
                              <option key={s._id} value={s._id}>
                                {s.name}
                              </option>
                            ))}
                          </Select>
                        </FormField>
                      </div>
                    )}

                    <FormField label="Search student">
                      <Input
                        value={issueStudentSearch}
                        onChange={(e) =>
                          setIssueStudentSearch(e.target.value)
                        }
                        placeholder="Name, roll no., or admission no."
                      />
                    </FormField>

                    <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200">
                      {studentsQuery.isLoading ? (
                        <p className="p-3 text-sm text-slate-500">
                          Loading students…
                        </p>
                      ) : filteredIssueStudents.length === 0 ? (
                        <p className="p-3 text-sm text-slate-500">
                          No students match these filters. Adjust batch/year or
                          search.
                        </p>
                      ) : (
                        <ul className="divide-y divide-slate-100">
                          {filteredIssueStudents.slice(0, 80).map((s) => {
                            const selected = issueForm.studentId === s._id;
                            return (
                              <li key={s._id}>
                                <button
                                  type="button"
                                  className={cn(
                                    "flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition",
                                    selected
                                      ? "bg-brand-50 text-brand-900"
                                      : "hover:bg-slate-50",
                                  )}
                                  onClick={() =>
                                    setIssueForm((c) => ({
                                      ...c,
                                      studentId: s._id,
                                    }))
                                  }
                                >
                                  <span className="min-w-0 flex-1">
                                    <span className="block font-medium">
                                      {s.user?.fullName ?? "Student"}
                                    </span>
                                    <span className="block text-xs text-slate-500">
                                      Roll {s.rollNumber ?? "—"}
                                      {s.admissionNumber
                                        ? ` · ${s.admissionNumber}`
                                        : ""}
                                      {s.batchName ? ` · ${s.batchName}` : ""}
                                      {s.yearName ? ` · ${s.yearName}` : ""}
                                      {s.className ? ` · ${s.className}` : ""}
                                      {s.sectionName
                                        ? ` · ${s.sectionName}`
                                        : ""}
                                    </span>
                                  </span>
                                  {selected ? (
                                    <Badge className="bg-brand-100 text-brand-800">
                                      Selected
                                    </Badge>
                                  ) : null}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                    {filteredIssueStudents.length > 80 ? (
                      <p className="text-xs text-slate-500">
                        Showing first 80 of {filteredIssueStudents.length}.
                        Narrow batch/year or search.
                      </p>
                    ) : null}
                    {selectedStudent ? (
                      <p className="rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-sm text-emerald-900">
                        Borrower:{" "}
                        <strong>
                          {selectedStudent.user?.fullName ?? "Student"}
                        </strong>
                        {selectedStudent.rollNumber != null
                          ? ` · Roll ${selectedStudent.rollNumber}`
                          : ""}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <FormField label="Search teacher">
                      <Input
                        value={issueTeacherSearch}
                        onChange={(e) =>
                          setIssueTeacherSearch(e.target.value)
                        }
                        placeholder="Teacher name"
                      />
                    </FormField>
                    <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200">
                      {filteredIssueTeachers.length === 0 ? (
                        <p className="p-3 text-sm text-slate-500">
                          No teachers match this search.
                        </p>
                      ) : (
                        <ul className="divide-y divide-slate-100">
                          {filteredIssueTeachers.slice(0, 80).map((t) => {
                            const selected = issueForm.teacherId === t._id;
                            return (
                              <li key={t._id}>
                                <button
                                  type="button"
                                  className={cn(
                                    "flex w-full items-center justify-between px-3 py-2 text-left text-sm",
                                    selected
                                      ? "bg-brand-50 text-brand-900"
                                      : "hover:bg-slate-50",
                                  )}
                                  onClick={() =>
                                    setIssueForm((c) => ({
                                      ...c,
                                      teacherId: t._id,
                                    }))
                                  }
                                >
                                  <span className="font-medium">
                                    {t.user?.fullName ?? "Teacher"}
                                  </span>
                                  {selected ? (
                                    <Badge className="bg-brand-100 text-brand-800">
                                      Selected
                                    </Badge>
                                  ) : null}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                    {selectedTeacher ? (
                      <p className="rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-sm text-emerald-900">
                        Borrower:{" "}
                        <strong>
                          {selectedTeacher.user?.fullName ?? "Teacher"}
                        </strong>
                      </p>
                    ) : null}
                  </>
                )}
              </CardContent>
            </Card>

            {/* —— Book —— */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">2. Select book &amp; code</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <FormField label="Search book (name or code)">
                  <Input
                    value={issueBookSearch}
                    onChange={(e) => setIssueBookSearch(e.target.value)}
                    placeholder="e.g. Anatomy, ANA001, ISBN…"
                  />
                </FormField>

                {issueBookSearch.trim() && matchingAvailableCopies.length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                      Quick pick by code
                    </p>
                    <div className="max-h-36 overflow-y-auto rounded-xl border border-slate-200">
                      <ul className="divide-y divide-slate-100">
                        {matchingAvailableCopies.map((copy) => {
                          const selected = issueForm.copyId === copy._id;
                          return (
                            <li key={copy._id}>
                              <button
                                type="button"
                                className={cn(
                                  "flex w-full items-start gap-2 px-3 py-2 text-left text-sm",
                                  selected
                                    ? "bg-brand-50 text-brand-900"
                                    : "hover:bg-slate-50",
                                )}
                                onClick={() =>
                                  selectCopyForIssue(
                                    copy.bookId,
                                    copy._id,
                                    copy.bookCode,
                                  )
                                }
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="font-mono font-semibold">
                                    {copy.bookCode}
                                  </span>
                                  <span className="mt-0.5 block text-xs text-slate-500">
                                    {copy.bookTitle}
                                    {copy.shelfLocation
                                      ? ` · ${copy.shelfLocation}`
                                      : ""}
                                  </span>
                                </span>
                                {selected ? (
                                  <Badge className="bg-brand-100 text-brand-800">
                                    Selected
                                  </Badge>
                                ) : null}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                ) : null}

                <FormField label="Book title">
                  <Select
                    value={issueForm.bookId}
                    onChange={(e) => selectBookForIssue(e.target.value)}
                  >
                    <option value="">Select book</option>
                    {filteredIssueBooks.map((b) => (
                      <option key={b._id} value={b._id}>
                        [{b.yearLevel ?? "All Years"}] {b.title} (
                        {(b.copies ?? []).filter((c) => c.status === "AVAILABLE")
                          .length || b.availableCopies}{" "}
                        available)
                      </option>
                    ))}
                  </Select>
                </FormField>
                {issueBookSearch.trim() && filteredIssueBooks.length === 0 ? (
                  <p className="text-xs text-rose-600">
                    No available books match “{issueBookSearch.trim()}”.
                  </p>
                ) : null}

                <FormField label="Physical book code">
                  <Select
                    value={issueForm.copyId ?? ""}
                    onChange={(e) => {
                      const copyId = e.target.value;
                      const copy = availableCopies.find((c) => c._id === copyId);
                      setIssueForm((c) => ({
                        ...c,
                        copyId,
                        bookCode: copy?.bookCode ?? "",
                      }));
                    }}
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
                {issueForm.bookId && availableCopies.length === 0 ? (
                  <p className="text-xs text-amber-700">
                    This title has no available copies right now.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </div>

          {/* —— Dates & submit —— */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">3. Dates &amp; issue</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
                  onChange={(v) =>
                    setIssueForm((c) => ({ ...c, dueDateBs: v }))
                  }
                />
              </FormField>
              <div className="flex items-end md:col-span-2">
                <Button
                  className="w-full sm:w-auto"
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
                  {issueBook.isPending ? "Issuing…" : "Issue this copy"}
                </Button>
              </div>
              {issueForm.copyId && selectedBook ? (
                <p className="md:col-span-2 xl:col-span-4 text-sm text-slate-600">
                  Issuing{" "}
                  <span className="font-mono font-semibold">
                    {
                      availableCopies.find((c) => c._id === issueForm.copyId)
                        ?.bookCode
                    }
                  </span>{" "}
                  of <strong>{selectedBook.title}</strong>
                  {issueForm.borrowerType === "STUDENT" && selectedStudent
                    ? ` to ${selectedStudent.user?.fullName ?? "student"}`
                    : issueForm.borrowerType === "TEACHER" && selectedTeacher
                      ? ` to ${selectedTeacher.user?.fullName ?? "teacher"}`
                      : ""}
                  . Only this code will become ISSUED; other copies stay
                  available.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
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
