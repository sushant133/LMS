import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getTodayBs } from "@munatech/nepali-datepicker";
import { libraryReturnSchema, type LibraryIssueRecord } from "@phit-erp/shared";
import {
  AlertCircle,
  CheckCircle2,
  Printer,
  RotateCcw,
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
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import {
  borrowerTypeLabel,
  filterLibraryIssues,
  formatIssuedByLabel,
} from "features/library/libraryUtils";
import { useAuth } from "features/auth/AuthProvider";
import { api, unwrap } from "lib/api";
import {
  buildPrintInstitutionHeaderHtml,
  PRINT_INSTITUTION_HEADER_CSS,
} from "lib/printBranding";
import { canManageInstitution, normalizeUserRole } from "lib/roles";
import { resolveStudentId } from "lib/resolveStudentId";
import { queryClient } from "lib/queryClient";
import { cn, parseErrorMessage } from "lib/utils";

const RETURN_HISTORY_ID = "library-return-history";

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Reliable print without popup blockers (hidden iframe). */
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

  window.setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch {
      cleanup();
      throw new Error("Print failed");
    }
    window.setTimeout(cleanup, 60_000);
  }, 350);
};

const buildIssuesPrintHtml = (opts: {
  title: string;
  subtitle?: string;
  columns: string[];
  rows: string[][];
  footerNote?: string;
}): string => {
  const headerCells = opts.columns
    .map((c) => `<th>${escapeHtml(c)}</th>`)
    .join("");
  const bodyRows = opts.rows
    .map(
      (row, i) =>
        `<tr><td class="num">${i + 1}</td>${row
          .map((cell, idx) =>
            idx === 1
              ? `<td class="mono">${escapeHtml(cell)}</td>`
              : `<td>${escapeHtml(cell)}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");
  const printedAt = new Date().toLocaleString();
  const institutionHeader = buildPrintInstitutionHeaderHtml();
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(opts.title)}</title>
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
  <h1>${escapeHtml(opts.title)}</h1>
  <div class="meta">
    ${opts.rows.length} record${opts.rows.length === 1 ? "" : "s"}
    · Printed ${escapeHtml(printedAt)}
    ${opts.subtitle ? ` · ${escapeHtml(opts.subtitle)}` : ""}
  </div>
  <table>
    <thead>
      <tr>
        <th class="num">#</th>
        ${headerCells}
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
    <tfoot>
      <tr>
        <td colspan="${opts.columns.length + 1}">
          Total rows: ${opts.rows.length}${
            opts.footerNote ? ` · ${escapeHtml(opts.footerNote)}` : ""
          }
        </td>
      </tr>
    </tfoot>
  </table>
</body>
</html>`;
};

const issueStatusStyles: Record<string, string> = {
  ISSUED: "bg-sky-100 text-sky-800",
  RETURNED: "bg-brand-100 text-brand-800",
  OVERDUE: "bg-rose-100 text-rose-800",
};

const formatTodayBs = (): string => {
  const today = getTodayBs();
  return `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;
};

const defaultReturnDateBs = () => formatTodayBs();

type LibraryReturnsPanelProps = {
  /**
   * When true (e.g. from Dashboard “Returned” / “View returns”),
   * scroll straight to Return History.
   */
  focusReturnHistory?: boolean;
};

export const LibraryReturnsPanel = ({
  focusReturnHistory = false,
}: LibraryReturnsPanelProps) => {
  const { user } = useAuth();
  /** Super Admin / College Admin (primary or secondary role). */
  const canPrint = Boolean(
    user &&
      (canManageInstitution(user.role) ||
        (user.secondaryRoles ?? []).some((role) =>
          canManageInstitution(normalizeUserRole(role)),
        )),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [returnedDateBs, setReturnedDateBs] = useState(defaultReturnDateBs);
  const [historyHighlight, setHistoryHighlight] = useState(focusReturnHistory);
  const [printingKey, setPrintingKey] = useState<"to-return" | "history" | null>(
    null,
  );

  useEffect(() => {
    if (!focusReturnHistory) return;
    setHistoryHighlight(true);
    // Wait for layout after tab switch / data paint
    const timer = window.setTimeout(() => {
      const el = document.getElementById(RETURN_HISTORY_ID);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 80);
    const clearHighlight = window.setTimeout(() => {
      setHistoryHighlight(false);
    }, 2500);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(clearHighlight);
    };
  }, [focusReturnHistory]);

  const activeIssuesQuery = useQuery({
    queryKey: ["library-issues", "active"],
    queryFn: () =>
      unwrap<LibraryIssueRecord[]>(
        api.get("/library/issues", { params: { status: "active" } }),
      ),
  });

  const returnedIssuesQuery = useQuery({
    queryKey: ["library-issues", "returned"],
    queryFn: () =>
      unwrap<LibraryIssueRecord[]>(
        api.get("/library/issues", { params: { status: "returned" } }),
      ),
  });

  const activeIssues = activeIssuesQuery.data ?? [];
  const filteredActiveIssues = useMemo(
    () => filterLibraryIssues(activeIssues, searchQuery),
    [activeIssues, searchQuery],
  );

  const selectedIssue =
    activeIssues.find((issue) => issue._id === selectedIssueId) ?? null;

  const overdueCount = activeIssues.filter(
    (issue) => issue.status === "OVERDUE",
  ).length;
  const returnedCount = returnedIssuesQuery.data?.length ?? 0;

  const invalidateLibrary = async () => {
    await queryClient.invalidateQueries({ queryKey: ["library-issues"] });
    await queryClient.invalidateQueries({ queryKey: ["library-books"] });
    await queryClient.invalidateQueries({ queryKey: ["library-dashboard"] });
  };

  const returnBook = useMutation({
    mutationFn: ({
      id,
      returnedDateBs,
    }: {
      id: string;
      returnedDateBs: string;
    }) =>
      unwrap(
        api.put(`/library/issues/${id}/return`, { returnedDateBs, fineNpr: 0 }),
      ),
    onSuccess: async () => {
      toast.success("Book returned and cleared from active borrowing");
      setSelectedIssueId(null);
      setReturnedDateBs(defaultReturnDateBs());
      await invalidateLibrary();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const selectIssue = (issue: LibraryIssueRecord) => {
    setSelectedIssueId(issue._id);
    setReturnedDateBs(defaultReturnDateBs());
  };

  const clearSelection = () => {
    setSelectedIssueId(null);
    setReturnedDateBs(defaultReturnDateBs());
  };

  const processReturn = () => {
    if (!selectedIssue) {
      return toast.error("Select a borrowed book to process the return");
    }

    const parsed = libraryReturnSchema.safeParse({
      returnedDateBs,
      fineNpr: 0,
    });
    if (!parsed.success) {
      return toast.error("Enter a valid return date");
    }

    returnBook.mutate({
      id: selectedIssue._id,
      returnedDateBs: parsed.data.returnedDateBs,
    });
  };

  const runPrint = (
    key: "to-return" | "history",
    title: string,
    columns: string[],
    rows: string[][],
    subtitle?: string,
  ) => {
    if (!canPrint) {
      toast.error("Only college admin or super admin can print");
      return;
    }
    if (rows.length === 0) {
      toast.error("No records to print");
      return;
    }
    setPrintingKey(key);
    try {
      const html = buildIssuesPrintHtml({
        title,
        subtitle,
        columns,
        rows,
      });
      printHtmlViaIframe(html);
      toast.success("Print dialog opening — choose printer or Save as PDF");
    } catch (e) {
      toast.error(parseErrorMessage(e) || "Could not print");
    } finally {
      window.setTimeout(() => setPrintingKey(null), 500);
    }
  };

  const printBooksToReturn = () => {
    const rows = filteredActiveIssues.map((issue) => [
      issue.bookTitle ?? "—",
      issue.bookCode ?? "—",
      issue.borrowerName?.trim() || "—",
      issue.issuedDateBs ?? "—",
      issue.dueDateBs ?? "—",
      formatIssuedByLabel(issue),
      issue.status ?? "—",
    ]);
    runPrint(
      "to-return",
      "Library — Books to return",
      ["Book", "Code", "Borrower", "Issued", "Due", "Issued by", "Status"],
      rows,
      searchQuery.trim()
        ? `Filter: ${searchQuery.trim()} · ${overdueCount} overdue among all active`
        : `${overdueCount} overdue among all active`,
    );
  };

  const printReturnHistory = () => {
    const history = returnedIssuesQuery.data ?? [];
    const rows = history.map((issue) => [
      issue.bookTitle ?? "—",
      issue.bookCode ?? "—",
      issue.borrowerName?.trim() || "—",
      issue.issuedDateBs ?? "—",
      issue.dueDateBs ?? "—",
      issue.returnedDateBs ?? "—",
      formatIssuedByLabel(issue),
    ]);
    runPrint(
      "history",
      "Library — Return history",
      ["Book", "Code", "Borrower", "Issued", "Due", "Returned", "Issued by"],
      rows,
      "Complete returned books history",
    );
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-[linear-gradient(135deg,_white_0%,_#eef3fb_100%)]">
          <CardContent className="py-5">
            <p className="text-sm text-slate-500">Active borrows</p>
            <p className="text-3xl font-semibold text-slate-900">
              {activeIssues.length}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-[linear-gradient(135deg,_white_0%,_#fef2f2_100%)]">
          <CardContent className="py-5">
            <p className="text-sm text-slate-500">Overdue</p>
            <p className="text-3xl font-semibold text-rose-600">
              {overdueCount}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-[linear-gradient(135deg,_white_0%,_#ecfdf5_100%)]">
          <CardContent className="py-5">
            <p className="text-sm text-slate-500">Returned (all time)</p>
            <p className="text-3xl font-semibold text-brand-700">
              {returnedCount}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[360px_1fr] xl:items-start">
        {/* Process return: sticky on desktop so controls stay near viewport top */}
        <Card
          className={
            selectedIssue
              ? "border-brand-200 xl:sticky xl:top-4 xl:z-10"
              : "xl:sticky xl:top-4 xl:z-10"
          }
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-brand-600" />
              Process return
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedIssue ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="font-medium text-slate-900">
                  {selectedIssue.bookTitle ?? "Book"}
                  {selectedIssue.bookCode ? (
                    <span className="ml-2 font-mono text-sm text-brand-700">
                      [{selectedIssue.bookCode}]
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-slate-600">
                  Borrower:{" "}
                  {selectedIssue.borrowerType === "STUDENT" &&
                  resolveStudentId(selectedIssue.studentId) ? (
                    <StudentNameLink
                      studentId={resolveStudentId(selectedIssue.studentId)!}
                      name={selectedIssue.borrowerName?.trim() || "Student"}
                    />
                  ) : (
                    <>
                      {selectedIssue.borrowerName?.trim() || "—"}
                      {selectedIssue.borrowerType === "TEACHER" ||
                      selectedIssue.borrowerType === "STAFF"
                        ? ` (${borrowerTypeLabel(selectedIssue.borrowerType)})`
                        : null}
                    </>
                  )}
                </p>
                <p className="text-slate-600">
                  Issued: {selectedIssue.issuedDateBs}
                </p>
                <p className="text-slate-600">Due: {selectedIssue.dueDateBs}</p>
                <p className="text-slate-600">
                  Issued by: {formatIssuedByLabel(selectedIssue)}
                </p>
                <div className="mt-2">
                  <Badge
                    className={issueStatusStyles[selectedIssue.status] ?? ""}
                  >
                    {selectedIssue.status}
                  </Badge>
                </div>
                {selectedIssue.status === "OVERDUE" ? (
                  <p className="mt-3 flex items-start gap-2 text-amber-800">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    This book is overdue. Confirm the return date to clear the
                    borrow record.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                Select an active borrow from the list to record the return,
                update stock, and clear the borrow record.
              </p>
            )}

            <FormField label="Return date (BS)">
              <NepaliDateField
                value={returnedDateBs}
                onChange={setReturnedDateBs}
              />
            </FormField>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={processReturn}
                disabled={!selectedIssue || returnBook.isPending}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Confirm return
              </Button>
              <Button
                variant="secondary"
                onClick={clearSelection}
                disabled={!selectedIssue}
              >
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle>Books to return</CardTitle>
            <div className="flex w-full max-w-md flex-wrap items-center gap-2 sm:w-auto">
              <div className="relative min-w-[12rem] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  className="pl-9"
                  placeholder="Search book, code, or borrower..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              {canPrint ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={
                    filteredActiveIssues.length === 0 ||
                    printingKey === "to-return"
                  }
                  onClick={printBooksToReturn}
                  title="Print books to return list"
                >
                  <Printer className="mr-1.5 h-4 w-4" />
                  {printingKey === "to-return" ? "Printing…" : "Print"}
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            {/*
              Constrained height so horizontal/vertical sliders sit at the bottom
              of this table viewport (near the desktop bottom when focused),
              not at the far bottom of the whole page after return history.
            */}
            <div className="max-h-[min(calc(100vh-16rem),560px)] overflow-auto overscroll-contain border-t border-slate-100">
              <Table className="min-w-[720px]">
                <TableHead className="sticky top-0 z-10 bg-slate-50 shadow-sm">
                  <tr>
                    <Th>Book</Th>
                    <Th>Code</Th>
                    <Th>Borrower</Th>
                    <Th>Issued</Th>
                    <Th>Due</Th>
                    <Th>Issued by</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </TableHead>
                <TableBody>
                  {filteredActiveIssues.length === 0 ? (
                    <tr>
                      <Td
                        colSpan={8}
                        className="py-8 text-center text-slate-500"
                      >
                        {activeIssues.length === 0
                          ? "No books are currently borrowed."
                          : "No active borrows match your search."}
                      </Td>
                    </tr>
                  ) : (
                    filteredActiveIssues.map((issue) => (
                      <tr
                        key={issue._id}
                        className={
                          selectedIssueId === issue._id
                            ? "bg-brand-50/60"
                            : undefined
                        }
                      >
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
                              studentId={resolveStudentId(issue.studentId)!}
                              name={issue.borrowerName?.trim() || "Student"}
                            />
                          ) : (
                            <>
                              {issue.borrowerName?.trim() || "—"}
                              {issue.borrowerType === "TEACHER" ||
                              issue.borrowerType === "STAFF"
                                ? ` (${borrowerTypeLabel(issue.borrowerType)})`
                                : null}
                            </>
                          )}
                        </Td>
                        <Td>{issue.issuedDateBs}</Td>
                        <Td>{issue.dueDateBs}</Td>
                        <Td className="max-w-[10rem] truncate text-sm">
                          {formatIssuedByLabel(issue)}
                        </Td>
                        <Td>
                          <Badge
                            className={issueStatusStyles[issue.status] ?? ""}
                          >
                            {issue.status}
                          </Badge>
                        </Td>
                        <Td>
                          <Button
                            size="sm"
                            variant={
                              selectedIssueId === issue._id
                                ? "default"
                                : "secondary"
                            }
                            onClick={() => selectIssue(issue)}
                          >
                            {selectedIssueId === issue._id
                              ? "Selected"
                              : "Return"}
                          </Button>
                        </Td>
                      </tr>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card
        id={RETURN_HISTORY_ID}
        className={cn(
          "scroll-mt-4 transition ring-offset-2",
          historyHighlight && "ring-2 ring-emerald-400",
        )}
      >
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              Return history
            </CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              All books marked returned (complete history).
            </p>
          </div>
          {canPrint ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0"
              disabled={
                (returnedIssuesQuery.data ?? []).length === 0 ||
                printingKey === "history"
              }
              onClick={printReturnHistory}
              title="Print return history"
            >
              <Printer className="mr-1.5 h-4 w-4" />
              {printingKey === "history" ? "Printing…" : "Print"}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[min(60vh,520px)] overflow-auto">
            <Table className="min-w-[640px]">
              <TableHead className="sticky top-0 z-10 bg-slate-50 shadow-sm">
                <tr>
                  <Th>Book</Th>
                  <Th>Code</Th>
                  <Th>Borrower</Th>
                  <Th>Issued</Th>
                  <Th>Due</Th>
                  <Th>Returned</Th>
                  <Th>Issued by</Th>
                </tr>
              </TableHead>
              <TableBody>
                {(returnedIssuesQuery.data ?? []).length === 0 ? (
                  <tr>
                    <Td colSpan={7} className="py-8 text-center text-slate-500">
                      No returned books recorded yet.
                    </Td>
                  </tr>
                ) : (
                  (returnedIssuesQuery.data ?? []).map((issue) => (
                    <tr key={issue._id}>
                      <Td className="font-medium">{issue.bookTitle ?? "—"}</Td>
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
                          <>
                            {issue.borrowerName?.trim() || "—"}
                            {issue.borrowerType === "TEACHER" ||
                            issue.borrowerType === "STAFF"
                              ? ` (${borrowerTypeLabel(issue.borrowerType)})`
                              : null}
                          </>
                        )}
                      </Td>
                      <Td>{issue.issuedDateBs}</Td>
                      <Td>{issue.dueDateBs}</Td>
                      <Td>{issue.returnedDateBs ?? "—"}</Td>
                      <Td className="text-sm">
                        {formatIssuedByLabel(issue)}
                      </Td>
                    </tr>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
