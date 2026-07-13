import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getTodayBs } from "@munatech/nepali-datepicker";
import { libraryReturnSchema, type LibraryIssueRecord } from "@phit-erp/shared";
import { AlertCircle, CheckCircle2, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { StudentNameLink } from "components/shared/StudentNameLink";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { filterLibraryIssues } from "features/library/libraryUtils";
import { api, unwrap } from "lib/api";
import { resolveStudentId } from "lib/resolveStudentId";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";

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

export const LibraryReturnsPanel = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [returnedDateBs, setReturnedDateBs] = useState(defaultReturnDateBs);

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

      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <Card className={selectedIssue ? "border-brand-200" : ""}>
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
                    (selectedIssue.borrowerName?.trim() || "—")
                  )}
                </p>
                <p className="text-slate-600">
                  Issued: {selectedIssue.issuedDateBs}
                </p>
                <p className="text-slate-600">Due: {selectedIssue.dueDateBs}</p>
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

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle>Books to return</CardTitle>
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="pl-9"
                placeholder="Search book, code, or borrower..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHead>
                <tr>
                  <Th>Book</Th>
                  <Th>Code</Th>
                  <Th>Borrower</Th>
                  <Th>Issued</Th>
                  <Th>Due</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </TableHead>
              <TableBody>
                {filteredActiveIssues.length === 0 ? (
                  <tr>
                    <Td colSpan={7} className="py-8 text-center text-slate-500">
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
                          (issue.borrowerName?.trim() || "—")
                        )}
                      </Td>
                      <Td>{issue.issuedDateBs}</Td>
                      <Td>{issue.dueDateBs}</Td>
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
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Return history</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHead>
              <tr>
                <Th>Book</Th>
                <Th>Code</Th>
                <Th>Borrower</Th>
                <Th>Issued</Th>
                <Th>Due</Th>
                <Th>Returned</Th>
              </tr>
            </TableHead>
            <TableBody>
              {(returnedIssuesQuery.data ?? []).length === 0 ? (
                <tr>
                  <Td colSpan={6} className="py-8 text-center text-slate-500">
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
                        (issue.borrowerName?.trim() || "—")
                      )}
                    </Td>
                    <Td>{issue.issuedDateBs}</Td>
                    <Td>{issue.dueDateBs}</Td>
                    <Td>{issue.returnedDateBs ?? "—"}</Td>
                  </tr>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};
