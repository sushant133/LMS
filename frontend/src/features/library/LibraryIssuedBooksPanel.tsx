import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { LibraryIssueRecord } from "@phit-erp/shared";
import {
  BookMarked,
  ChevronLeft,
  ChevronRight,
  Printer,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { StudentNameLink } from "components/shared/StudentNameLink";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { StickyTableScroll } from "components/ui/StickyTableScroll";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import {
  filterIssuedBooks,
  formatIssuedByLabel,
  uniqueBatchOptionsFromIssues,
  uniqueClassOptionsFromIssues,
  uniqueSectionOptionsFromIssues,
  uniqueYearOptionsFromIssues,
} from "features/library/libraryUtils";
import { useAuth } from "features/auth/AuthProvider";
import { useIsCollege } from "hooks/useInstitutionType";
import { api, unwrap } from "lib/api";
import {
  buildPrintInstitutionHeaderHtml,
  PRINT_INSTITUTION_HEADER_CSS,
} from "lib/printBranding";
import { canManageInstitution, normalizeUserRole } from "lib/roles";
import { resolveStudentId } from "lib/resolveStudentId";
import { queryClient } from "lib/queryClient";
import { cn, parseErrorMessage } from "lib/utils";

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Print HTML via a hidden iframe (no popup, no noopener null window).
 * More reliable than window.open + document.write.
 */
const printHtmlViaIframe = (html: string): void => {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    throw new Error("Could not open print preview");
  }

  doc.open();
  doc.write(html);
  doc.close();

  const cleanup = () => {
    try {
      iframe.remove();
    } catch {
      /* ignore */
    }
  };

  const runPrint = () => {
    try {
      win.focus();
      win.print();
    } catch (err) {
      cleanup();
      throw err;
    }
    // Keep iframe until print dialog is done (user may cancel)
    window.setTimeout(cleanup, 60_000);
  };

  // Wait for document to settle before printing
  window.setTimeout(runPrint, 350);
};

const issueStatusStyles: Record<string, string> = {
  ISSUED: "bg-sky-100 text-sky-800",
  RETURNED: "bg-brand-100 text-brand-800",
  OVERDUE: "bg-rose-100 text-rose-800",
};

/** 0 = Issued list, 1 = Manage issue (detail / due date) */
type IssuedSlide = 0 | 1;

type StatusFilter = "ALL" | "ISSUED" | "OVERDUE";

interface LibraryIssuedBooksPanelProps {
  /** From dashboard: ALL (issued card) or OVERDUE (overdue card only). */
  initialStatusFilter?: StatusFilter;
}

export const LibraryIssuedBooksPanel = ({
  initialStatusFilter = "ALL",
}: LibraryIssuedBooksPanelProps) => {
  const { user } = useAuth();
  const isCollege = useIsCollege();
  /** Super Admin / College Admin (primary or secondary role). */
  const canManageIssues = Boolean(
    user &&
      (canManageInstitution(user.role) ||
        (user.secondaryRoles ?? []).some((role) =>
          canManageInstitution(normalizeUserRole(role)),
        )),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [printing, setPrinting] = useState(false);
  const [batchId, setBatchId] = useState("");
  const [yearId, setYearId] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    initialStatusFilter,
  );
  const [issuedSlide, setIssuedSlide] = useState<IssuedSlide>(0);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [editDueDateBs, setEditDueDateBs] = useState("");

  const issuesQuery = useQuery({
    queryKey: ["library-issues", "active"],
    queryFn: () =>
      unwrap<LibraryIssueRecord[]>(
        api.get("/library/issues", { params: { status: "active" } }),
      ),
  });

  const activeIssues = issuesQuery.data ?? [];

  const batchOptions = useMemo(
    () => uniqueBatchOptionsFromIssues(activeIssues),
    [activeIssues],
  );
  const yearOptions = useMemo(
    () => uniqueYearOptionsFromIssues(activeIssues, batchId || undefined),
    [activeIssues, batchId],
  );
  const classOptions = useMemo(
    () => uniqueClassOptionsFromIssues(activeIssues),
    [activeIssues],
  );
  const sectionOptions = useMemo(
    () => uniqueSectionOptionsFromIssues(activeIssues, classId || undefined),
    [activeIssues, classId],
  );

  const filteredIssues = useMemo(
    () =>
      filterIssuedBooks(activeIssues, {
        searchQuery,
        batchId: batchId || undefined,
        yearId: yearId || undefined,
        classId: classId || undefined,
        sectionId: sectionId || undefined,
        status: statusFilter,
      }),
    [
      activeIssues,
      searchQuery,
      batchId,
      yearId,
      classId,
      sectionId,
      statusFilter,
    ],
  );

  const overdueCount = activeIssues.filter((i) => i.status === "OVERDUE").length;

  const selectedIssue = useMemo(
    () =>
      activeIssues.find((i) => i._id === selectedIssueId) ??
      filteredIssues.find((i) => i._id === selectedIssueId) ??
      null,
    [activeIssues, filteredIssues, selectedIssueId],
  );

  const colCount = canManageIssues ? 10 : 9;
  const tableMinClass = canManageIssues ? "min-w-[1120px]" : "min-w-[960px]";

  const invalidateLibrary = async () => {
    await queryClient.invalidateQueries({ queryKey: ["library-issues"] });
    await queryClient.invalidateQueries({ queryKey: ["library-books"] });
    await queryClient.invalidateQueries({ queryKey: ["library-dashboard"] });
  };

  const updateDueDate = useMutation({
    mutationFn: ({ id, dueDateBs }: { id: string; dueDateBs: string }) =>
      unwrap(api.put(`/library/issues/${id}`, { dueDateBs })),
    onSuccess: async () => {
      toast.success("Due date updated");
      await invalidateLibrary();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const deleteIssue = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/library/issues/${id}`)),
    onSuccess: async () => {
      toast.success("Issue removed — book restored to inventory");
      if (selectedIssueId) {
        setSelectedIssueId(null);
        setEditDueDateBs("");
        setIssuedSlide(0);
      }
      await invalidateLibrary();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const openManageIssue = (issue: LibraryIssueRecord) => {
    setSelectedIssueId(issue._id);
    setEditDueDateBs(issue.dueDateBs);
    setIssuedSlide(1);
  };

  const clearSelection = () => {
    setSelectedIssueId(null);
    setEditDueDateBs("");
    setIssuedSlide(0);
  };

  const placementLabel = (issue: LibraryIssueRecord): string => {
    if (isCollege) {
      const parts = [issue.studentBatchName, issue.studentYearName].filter(
        Boolean,
      );
      return parts.length ? parts.join(" · ") : "—";
    }
    const parts = [issue.studentClassName, issue.studentSectionName].filter(
      Boolean,
    );
    return parts.length ? parts.join(" · ") : "—";
  };

  /** College admin / Super admin only — print currently filtered issued list. */
  const printIssuedList = () => {
    if (!canManageIssues) {
      toast.error("Only college admin or super admin can print");
      return;
    }
    if (filteredIssues.length === 0) {
      toast.error("No issued books to print");
      return;
    }

    const placementHeader = isCollege ? "Batch · Year" : "Class · Section";
    const statusLabel =
      statusFilter === "OVERDUE"
        ? "Overdue books only"
        : statusFilter === "ISSUED"
          ? "Issued (not overdue)"
          : "All issued books";

    const rowsHtml = filteredIssues
      .map((issue, index) => {
        const borrower =
          issue.borrowerName?.trim() ||
          (issue.borrowerType === "TEACHER" ? "Teacher" : "Student");
        const typeNote =
          issue.borrowerType === "TEACHER"
            ? " (Teacher)"
            : issue.borrowerType === "STUDENT"
              ? " (Student)"
              : "";
        return `<tr>
          <td class="num">${index + 1}</td>
          <td>${escapeHtml(issue.bookTitle ?? "—")}</td>
          <td class="mono">${escapeHtml(issue.bookCode ?? "—")}</td>
          <td>${escapeHtml(borrower)}${escapeHtml(typeNote)}</td>
          <td>${escapeHtml(placementLabel(issue))}</td>
          <td>${escapeHtml(issue.issuedDateBs ?? "—")}</td>
          <td>${escapeHtml(issue.dueDateBs ?? "—")}</td>
          <td>${escapeHtml(issue.status ?? "—")}</td>
          <td>${escapeHtml(formatIssuedByLabel(issue))}</td>
        </tr>`;
      })
      .join("");

    const filterBits = [
      searchQuery.trim() ? `Search: ${searchQuery.trim()}` : null,
      isCollege && batchId
        ? `Batch: ${batchOptions.find((b) => b._id === batchId)?.name ?? batchId}`
        : null,
      isCollege && yearId
        ? `Year: ${yearOptions.find((y) => y._id === yearId)?.name ?? yearId}`
        : null,
      !isCollege && classId
        ? `Class: ${classOptions.find((c) => c._id === classId)?.name ?? classId}`
        : null,
      !isCollege && sectionId
        ? `Section: ${sectionOptions.find((s) => s._id === sectionId)?.name ?? sectionId}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const printedAt = new Date().toLocaleString();
    const institutionHeader = buildPrintInstitutionHeaderHtml();
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Issued Books — ${escapeHtml(statusLabel)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      margin: 0;
      padding: 12mm 10mm;
      color: #0f172a;
      background: #fff;
    }
    h1 { font-size: 15px; margin: 8px 0 4px; font-weight: 700; }
    .meta { font-size: 11px; color: #475569; margin-bottom: 12px; line-height: 1.4; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    th, td {
      border: 1px solid #94a3b8;
      padding: 4px 6px;
      text-align: left;
      vertical-align: top;
    }
    th { background: #f1f5f9; font-weight: 600; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    .num { text-align: center; width: 28px; }
    .mono { font-family: ui-monospace, Consolas, monospace; font-weight: 600; }
    tfoot td { font-weight: 600; background: #f8fafc; }
    @page { size: A4 landscape; margin: 8mm; }
    ${PRINT_INSTITUTION_HEADER_CSS}
  </style>
</head>
<body>
  ${institutionHeader}
  <h1>Library — ${escapeHtml(statusLabel)}</h1>
  <div class="meta">
    ${filteredIssues.length} record${filteredIssues.length === 1 ? "" : "s"}
    · Overdue (all active): ${overdueCount}
    · Printed ${escapeHtml(printedAt)}
    ${filterBits ? ` · ${escapeHtml(filterBits)}` : ""}
  </div>
  <table>
    <thead>
      <tr>
        <th class="num">#</th>
        <th>Book</th>
        <th>Code</th>
        <th>Student / Borrower</th>
        <th>${escapeHtml(placementHeader)}</th>
        <th>Issued</th>
        <th>Due</th>
        <th>Status</th>
        <th>Issued by</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot>
      <tr>
        <td colspan="9">Total rows: ${filteredIssues.length}</td>
      </tr>
    </tfoot>
  </table>
</body>
</html>`;

    setPrinting(true);
    try {
      printHtmlViaIframe(html);
      toast.success("Print dialog opening — choose printer or Save as PDF");
    } catch (e) {
      toast.error(parseErrorMessage(e) || "Could not print issued books");
    } finally {
      window.setTimeout(() => setPrinting(false), 500);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card
          className={cn(
            "cursor-pointer bg-[linear-gradient(135deg,_white_0%,_#eef3fb_100%)] transition hover:ring-2 hover:ring-brand-200",
            statusFilter === "ALL" && "ring-2 ring-brand-300",
          )}
          onClick={() => setStatusFilter("ALL")}
        >
          <CardContent className="py-5">
            <p className="text-sm text-slate-500">Currently issued (all out)</p>
            <p className="text-3xl font-semibold text-slate-900">
              {activeIssues.length}
            </p>
            <p className="mt-1 text-xs text-brand-600">Show all out books</p>
          </CardContent>
        </Card>
        <Card
          className={cn(
            "cursor-pointer bg-[linear-gradient(135deg,_white_0%,_#fef2f2_100%)] transition hover:ring-2 hover:ring-rose-200",
            statusFilter === "OVERDUE" && "ring-2 ring-rose-400",
          )}
          onClick={() => setStatusFilter("OVERDUE")}
        >
          <CardContent className="py-5">
            <p className="text-sm text-slate-500">Overdue only</p>
            <p className="text-3xl font-semibold text-rose-600">{overdueCount}</p>
            <p className="mt-1 text-xs text-rose-600">Show overdue books only</p>
          </CardContent>
        </Card>
        <Card className="bg-[linear-gradient(135deg,_white_0%,_#ecfdf5_100%)]">
          <CardContent className="py-5">
            <p className="text-sm text-slate-500">Matching filters</p>
            <p className="text-3xl font-semibold text-brand-700">
              {filteredIssues.length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Left–right slider: Issued list ↔ Manage issue */}
      <div
        id="library-issued-slider"
        className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/80 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
            <button
              type="button"
              onClick={() => setIssuedSlide(0)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                issuedSlide === 0
                  ? "bg-brand-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100",
              )}
            >
              Issued list
            </button>
            <button
              type="button"
              onClick={() => setIssuedSlide(1)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                issuedSlide === 1
                  ? "bg-brand-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100",
              )}
            >
              Manage issue
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 w-8 p-0"
              title="Previous panel"
              aria-label="Previous panel"
              disabled={issuedSlide === 0}
              onClick={() => setIssuedSlide(0)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[4.5rem] text-center text-[11px] font-medium tabular-nums text-slate-500">
              {issuedSlide + 1} / 2
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 w-8 p-0"
              title="Next panel"
              aria-label="Next panel"
              disabled={issuedSlide === 1}
              onClick={() => setIssuedSlide(1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="relative overflow-hidden">
          <div
            className="flex w-[200%] transition-transform duration-300 ease-out"
            style={{
              transform: `translateX(-${issuedSlide * 50}%)`,
            }}
          >
            {/* Panel 1: Issued list */}
            <div className="w-1/2 shrink-0 min-w-0">
              <Card className="border-0 shadow-none">
                <CardHeader className="space-y-4 border-b border-slate-100">
                  <div className="flex flex-row flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <BookMarked className="h-5 w-5 text-brand-600" />
                        {statusFilter === "OVERDUE"
                          ? "Overdue books only"
                          : statusFilter === "ISSUED"
                            ? "Issued (not overdue)"
                            : "All issued books"}
                      </CardTitle>
                      <p className="mt-1 text-sm text-slate-500">
                        {statusFilter === "OVERDUE"
                          ? "Books past their due date only. Change status filter to see all issued books."
                          : `Search and filter by ${isCollege ? "batch and year" : "class and section"}. Select a row or use Manage to open the detail panel.`}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {canManageIssues ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={filteredIssues.length === 0 || printing}
                          onClick={printIssuedList}
                          title="Print issued books list"
                        >
                          <Printer className="mr-1.5 h-4 w-4" />
                          {printing ? "Printing…" : "Print"}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setIssuedSlide(1)}
                      >
                        Manage issue
                        <ChevronRight className="ml-1 h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    {isCollege ? (
                      <>
                        <div className="min-w-[140px] flex-1 sm:flex-none">
                          <label className="mb-1 block text-xs font-medium text-slate-600">
                            Batch
                          </label>
                          <Select
                            value={batchId}
                            onChange={(e) => {
                              setBatchId(e.target.value);
                              setYearId("");
                            }}
                          >
                            <option value="">All batches</option>
                            {batchOptions.map((b) => (
                              <option key={b._id} value={b._id}>
                                {b.name}
                              </option>
                            ))}
                          </Select>
                        </div>
                        <div className="min-w-[140px] flex-1 sm:flex-none">
                          <label className="mb-1 block text-xs font-medium text-slate-600">
                            Year
                          </label>
                          <Select
                            value={yearId}
                            onChange={(e) => setYearId(e.target.value)}
                          >
                            <option value="">All years</option>
                            {yearOptions.map((y) => (
                              <option key={y._id} value={y._id}>
                                {y.name}
                              </option>
                            ))}
                          </Select>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="min-w-[140px] flex-1 sm:flex-none">
                          <label className="mb-1 block text-xs font-medium text-slate-600">
                            Class
                          </label>
                          <Select
                            value={classId}
                            onChange={(e) => {
                              setClassId(e.target.value);
                              setSectionId("");
                            }}
                          >
                            <option value="">All classes</option>
                            {classOptions.map((c) => (
                              <option key={c._id} value={c._id}>
                                {c.name}
                              </option>
                            ))}
                          </Select>
                        </div>
                        <div className="min-w-[140px] flex-1 sm:flex-none">
                          <label className="mb-1 block text-xs font-medium text-slate-600">
                            Section
                          </label>
                          <Select
                            value={sectionId}
                            onChange={(e) => setSectionId(e.target.value)}
                          >
                            <option value="">All sections</option>
                            {sectionOptions.map((s) => (
                              <option key={s._id} value={s._id}>
                                {s.name}
                              </option>
                            ))}
                          </Select>
                        </div>
                      </>
                    )}
                    <div className="min-w-[120px] flex-1 sm:flex-none">
                      <label className="mb-1 block text-xs font-medium text-slate-600">
                        Status
                      </label>
                      <Select
                        value={statusFilter}
                        onChange={(e) =>
                          setStatusFilter(
                            e.target.value as "ALL" | "ISSUED" | "OVERDUE",
                          )
                        }
                      >
                        <option value="ALL">All active</option>
                        <option value="ISSUED">Issued</option>
                        <option value="OVERDUE">Overdue</option>
                      </Select>
                    </div>
                    <div className="min-w-[200px] flex-1">
                      <label className="mb-1 block text-xs font-medium text-slate-600">
                        Search student / book
                      </label>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                          className="pl-9"
                          placeholder="Student name, book title, or code…"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <StickyTableScroll
                    maxHeightClassName="max-h-[min(70vh,560px)]"
                    header={
                      <Table className={cn("w-full table-fixed", tableMinClass)}>
                        <TableHead>
                          <tr>
                            <Th className="w-14 bg-slate-50 text-center">S.N.</Th>
                            <Th className="bg-slate-50">Book</Th>
                            <Th className="bg-slate-50">Code</Th>
                            <Th className="bg-slate-50">Student / Borrower</Th>
                            <Th className="bg-slate-50">
                              {isCollege ? "Batch · Year" : "Class · Section"}
                            </Th>
                            <Th className="bg-slate-50">Issued</Th>
                            <Th className="bg-slate-50">Due</Th>
                            <Th className="bg-slate-50">Status</Th>
                            <Th className="bg-slate-50">Issued by</Th>
                            {canManageIssues ? (
                              <Th className="bg-slate-50 text-right">Actions</Th>
                            ) : null}
                          </tr>
                        </TableHead>
                      </Table>
                    }
                    body={
                      <Table className={cn("w-full table-fixed", tableMinClass)}>
                        <TableBody>
                          {issuesQuery.isLoading ? (
                            <tr>
                              <Td
                                colSpan={colCount}
                                className="py-10 text-center text-slate-500"
                              >
                                Loading issued books…
                              </Td>
                            </tr>
                          ) : filteredIssues.length === 0 ? (
                            <tr>
                              <Td
                                colSpan={colCount}
                                className="py-10 text-center text-slate-500"
                              >
                                {activeIssues.length === 0
                                  ? "No books are currently issued."
                                  : "No issued books match your filters."}
                              </Td>
                            </tr>
                          ) : (
                            filteredIssues.map((issue, index) => (
                              <tr
                                key={issue._id}
                                className={cn(
                                  "cursor-pointer transition-colors",
                                  selectedIssueId === issue._id
                                    ? "bg-brand-50/70"
                                    : "hover:bg-slate-50/80",
                                )}
                                onClick={() => openManageIssue(issue)}
                              >
                                <Td className="text-center tabular-nums text-slate-500">
                                  {index + 1}
                                </Td>
                                <Td className="font-medium">
                                  {issue.bookTitle ?? "—"}
                                </Td>
                                <Td className="font-mono text-sm">
                                  {issue.bookCode ?? "—"}
                                </Td>
                                <Td>
                                  {issue.borrowerType === "STUDENT" &&
                                  resolveStudentId(issue.studentId) ? (
                                    <StudentNameLink
                                      studentId={
                                        resolveStudentId(issue.studentId)!
                                      }
                                      name={
                                        issue.borrowerName?.trim() || "Student"
                                      }
                                    />
                                  ) : (
                                    <span>
                                      {issue.borrowerName?.trim() || "—"}
                                      {issue.borrowerType === "TEACHER" ? (
                                        <span className="ml-1 text-xs text-slate-400">
                                          (Teacher)
                                        </span>
                                      ) : null}
                                    </span>
                                  )}
                                </Td>
                                <Td className="text-sm text-slate-600">
                                  {placementLabel(issue)}
                                </Td>
                                <Td>{issue.issuedDateBs}</Td>
                                <Td>{issue.dueDateBs}</Td>
                                <Td>
                                  <Badge
                                    className={
                                      issueStatusStyles[issue.status] ?? ""
                                    }
                                  >
                                    {issue.status}
                                  </Badge>
                                </Td>
                                <Td className="text-sm text-slate-700">
                                  {formatIssuedByLabel(issue)}
                                </Td>
                                {canManageIssues ? (
                                  <Td
                                    className="text-right"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <div className="flex flex-wrap justify-end gap-1.5">
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        onClick={() => openManageIssue(issue)}
                                      >
                                        Manage
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="destructive"
                                        disabled={deleteIssue.isPending}
                                        onClick={() => {
                                          const label =
                                            issue.bookCode ||
                                            issue.bookTitle ||
                                            "this book";
                                          if (
                                            !window.confirm(
                                              `Delete issue for "${label}"?\n\nThis removes the issue record and returns the copy to inventory as available. This cannot be undone.`,
                                            )
                                          ) {
                                            return;
                                          }
                                          deleteIssue.mutate(issue._id);
                                        }}
                                      >
                                        Delete
                                      </Button>
                                    </div>
                                  </Td>
                                ) : null}
                              </tr>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    }
                  />
                </CardContent>
              </Card>
            </div>

            {/* Panel 2: Manage issue */}
            <div className="w-1/2 shrink-0 min-w-0">
              <Card className="border-0 shadow-none">
                <CardHeader className="space-y-3 border-b border-slate-100 bg-[linear-gradient(135deg,_#eef3fb_0%,_white_100%)]">
                  <div className="flex flex-row flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">Manage issue</CardTitle>
                      <p className="mt-1 text-sm text-slate-500">
                        View borrower and dates
                        {canManageIssues
                          ? "; admins can extend the due date or void the issue."
                          : "."}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setIssuedSlide(0)}
                    >
                      <ChevronLeft className="mr-1 h-4 w-4" />
                      Issued list
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-4">
                  {!selectedIssue ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                      Select an issued book from the{" "}
                      <button
                        type="button"
                        className="font-medium text-brand-700 underline-offset-2 hover:underline"
                        onClick={() => setIssuedSlide(0)}
                      >
                        Issued list
                      </button>{" "}
                      to view details here.
                    </div>
                  ) : (
                    <>
                      <div className="rounded-xl border border-brand-100 bg-brand-50/50 px-4 py-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Book
                        </p>
                        <p className="mt-0.5 text-lg font-semibold text-slate-900">
                          {selectedIssue.bookTitle ?? "—"}
                        </p>
                        <p className="font-mono text-sm text-slate-600">
                          {selectedIssue.bookCode ?? "—"}
                        </p>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-xl border border-slate-200 px-3 py-2.5">
                          <p className="text-xs text-slate-500">Borrower</p>
                          <p className="mt-0.5 font-medium text-slate-900">
                            {selectedIssue.borrowerType === "STUDENT" &&
                            resolveStudentId(selectedIssue.studentId) ? (
                              <StudentNameLink
                                studentId={
                                  resolveStudentId(selectedIssue.studentId)!
                                }
                                name={
                                  selectedIssue.borrowerName?.trim() || "Student"
                                }
                              />
                            ) : (
                              <>
                                {selectedIssue.borrowerName?.trim() || "—"}
                                {selectedIssue.borrowerType === "TEACHER"
                                  ? " (Teacher)"
                                  : null}
                              </>
                            )}
                          </p>
                        </div>
                        <div className="rounded-xl border border-slate-200 px-3 py-2.5">
                          <p className="text-xs text-slate-500">
                            {isCollege ? "Batch · Year" : "Class · Section"}
                          </p>
                          <p className="mt-0.5 font-medium text-slate-900">
                            {placementLabel(selectedIssue)}
                          </p>
                        </div>
                        <div className="rounded-xl border border-slate-200 px-3 py-2.5">
                          <p className="text-xs text-slate-500">Issued date</p>
                          <p className="mt-0.5 font-medium text-slate-900">
                            {selectedIssue.issuedDateBs}
                          </p>
                        </div>
                        <div className="rounded-xl border border-slate-200 px-3 py-2.5">
                          <p className="text-xs text-slate-500">Status</p>
                          <div className="mt-1">
                            <Badge
                              className={
                                issueStatusStyles[selectedIssue.status] ?? ""
                              }
                            >
                              {selectedIssue.status}
                            </Badge>
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-200 px-3 py-2.5 sm:col-span-2">
                          <p className="text-xs text-slate-500">Issued by</p>
                          <p className="mt-0.5 font-medium text-slate-900">
                            {formatIssuedByLabel(selectedIssue)}
                          </p>
                        </div>
                      </div>

                      {canManageIssues ? (
                        <div className="space-y-3 rounded-xl border border-slate-200 p-4">
                          <FormField label="Due date (BS)">
                            <NepaliDateField
                              value={editDueDateBs}
                              onChange={setEditDueDateBs}
                            />
                          </FormField>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              disabled={
                                updateDueDate.isPending ||
                                !editDueDateBs.trim()
                              }
                              onClick={() => {
                                if (!editDueDateBs.trim()) {
                                  toast.error("Select a due date");
                                  return;
                                }
                                updateDueDate.mutate({
                                  id: selectedIssue._id,
                                  dueDateBs: editDueDateBs.trim(),
                                });
                              }}
                            >
                              {updateDueDate.isPending
                                ? "Saving…"
                                : "Save due date"}
                            </Button>
                            <Button
                              variant="destructive"
                              disabled={
                                deleteIssue.isPending || updateDueDate.isPending
                              }
                              onClick={() => {
                                const label =
                                  selectedIssue.bookCode ||
                                  selectedIssue.bookTitle ||
                                  "this book";
                                if (
                                  !window.confirm(
                                    `Delete issue for "${label}"?\n\nThis removes the issue record and returns the copy to inventory as available. This cannot be undone.`,
                                  )
                                ) {
                                  return;
                                }
                                deleteIssue.mutate(selectedIssue._id);
                              }}
                            >
                              Delete issue
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={clearSelection}
                            >
                              Clear selection
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-xl border border-slate-200 px-3 py-2.5">
                          <p className="text-xs text-slate-500">Due date</p>
                          <p className="mt-0.5 font-medium text-slate-900">
                            {selectedIssue.dueDateBs}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
