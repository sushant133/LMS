import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LibraryIssueRecord } from "@phit-erp/shared";
import { BookMarked, Search } from "lucide-react";
import { StudentNameLink } from "components/shared/StudentNameLink";
import { Badge } from "components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import {
  filterIssuedBooks,
  formatIssuedByLabel,
  uniqueBatchOptionsFromIssues,
  uniqueClassOptionsFromIssues,
  uniqueSectionOptionsFromIssues,
  uniqueYearOptionsFromIssues,
} from "features/library/libraryUtils";
import { useIsCollege } from "hooks/useInstitutionType";
import { api, unwrap } from "lib/api";
import { resolveStudentId } from "lib/resolveStudentId";

const issueStatusStyles: Record<string, string> = {
  ISSUED: "bg-sky-100 text-sky-800",
  RETURNED: "bg-brand-100 text-brand-800",
  OVERDUE: "bg-rose-100 text-rose-800",
};

export const LibraryIssuedBooksPanel = () => {
  const isCollege = useIsCollege();
  const [searchQuery, setSearchQuery] = useState("");
  const [batchId, setBatchId] = useState("");
  const [yearId, setYearId] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ISSUED" | "OVERDUE">(
    "ALL",
  );

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

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-[linear-gradient(135deg,_white_0%,_#eef3fb_100%)]">
          <CardContent className="py-5">
            <p className="text-sm text-slate-500">Currently issued</p>
            <p className="text-3xl font-semibold text-slate-900">
              {activeIssues.length}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-[linear-gradient(135deg,_white_0%,_#fef2f2_100%)]">
          <CardContent className="py-5">
            <p className="text-sm text-slate-500">Overdue</p>
            <p className="text-3xl font-semibold text-rose-600">{overdueCount}</p>
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

      <Card>
        <CardHeader className="space-y-4">
          <CardTitle className="flex items-center gap-2">
            <BookMarked className="h-5 w-5 text-brand-600" />
            All issued books
          </CardTitle>
          <p className="text-sm text-slate-500">
            Search students by name and filter by{" "}
            {isCollege ? "batch and year" : "class and section"} to see which
            books they currently hold, and who issued each copy.
          </p>
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
                  setStatusFilter(e.target.value as "ALL" | "ISSUED" | "OVERDUE")
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
          {/* Scrollable region keeps the slider near the bottom of the visible table area */}
          <div className="max-h-[min(70vh,640px)] overflow-auto">
            <Table className="min-w-[960px]">
              <TableHead className="sticky top-0 z-10 bg-slate-50 shadow-sm">
                <tr>
                  <Th>Book</Th>
                  <Th>Code</Th>
                  <Th>Student / Borrower</Th>
                  <Th>{isCollege ? "Batch · Year" : "Class · Section"}</Th>
                  <Th>Issued</Th>
                  <Th>Due</Th>
                  <Th>Status</Th>
                  <Th>Issued by</Th>
                </tr>
              </TableHead>
              <TableBody>
                {issuesQuery.isLoading ? (
                  <tr>
                    <Td colSpan={8} className="py-10 text-center text-slate-500">
                      Loading issued books…
                    </Td>
                  </tr>
                ) : filteredIssues.length === 0 ? (
                  <tr>
                    <Td colSpan={8} className="py-10 text-center text-slate-500">
                      {activeIssues.length === 0
                        ? "No books are currently issued."
                        : "No issued books match your filters."}
                    </Td>
                  </tr>
                ) : (
                  filteredIssues.map((issue) => (
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
                        <Badge className={issueStatusStyles[issue.status] ?? ""}>
                          {issue.status}
                        </Badge>
                      </Td>
                      <Td className="text-sm text-slate-700">
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
