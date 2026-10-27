import { useQuery } from "@tanstack/react-query";
import type { LibraryIssueRecord } from "@phit-erp/shared";
import { BookOpen } from "lucide-react";
import { PageContent } from "components/layout/PageContent";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { formatCurrencyNpr } from "lib/utils";

/** Overdue fine for one book: growing while out, then to pay / paid / waived. */
const FineCell = ({ issue }: { issue: LibraryIssueRecord }) => {
  const fine = issue.fine;
  if (!fine || fine.amountNpr <= 0) {
    return <span className="text-slate-400">—</span>;
  }
  if (fine.status === "ACCRUING") {
    return (
      <div>
        <span className="font-semibold text-amber-800">
          {formatCurrencyNpr(fine.outstandingNpr)} to pay
        </span>
        <div className="text-xs text-slate-500">
          {formatCurrencyNpr(fine.ratePerDayNpr)}/day · growing until returned
          {(fine.paidNpr ?? 0) > 0 ? ` · ${formatCurrencyNpr(fine.paidNpr ?? 0)} already paid` : ""}
        </div>
      </div>
    );
  }
  const label =
    fine.status === "PAID" ? "Paid" : fine.status === "WAIVED" ? "Waived" : "To pay";
  const tone =
    fine.status === "PAID"
      ? "text-emerald-700"
      : fine.status === "WAIVED"
        ? "text-sky-700"
        : "text-rose-700";
  return (
    <div>
      <span className="font-semibold text-slate-900">{formatCurrencyNpr(fine.amountNpr)}</span>
      <div className={`text-xs font-medium ${tone}`}>{label}</div>
    </div>
  );
};

const issueStatusStyles: Record<string, string> = {
  ISSUED: "bg-sky-100 text-sky-800",
  RETURNED: "bg-brand-100 text-brand-800",
  OVERDUE: "bg-rose-100 text-rose-800",
};

export const LibraryPortal = () => {
  const booksQuery = useQuery({
    queryKey: ["library-my-books"],
    queryFn: () => unwrap<LibraryIssueRecord[]>(api.get("/library/my-books")),
  });

  const issues = booksQuery.data ?? [];
  const active = issues.filter((issue) => issue.status !== "RETURNED");
  const history = issues.filter((issue) => issue.status === "RETURNED");
  /** Still owed: fines growing on books out + returned fines not yet paid. */
  const fineOwed = issues.reduce((sum, issue) => sum + (issue.fine?.outstandingNpr ?? 0), 0);

  return (
    <PageContent className="space-y-6">
      <PageHeader
        title="My Library"
        description="View books currently borrowed and your complete borrowing history."
      />

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        <Card className="bg-[linear-gradient(135deg,_white_0%,_#eef3fb_100%)]">
          <CardContent className="flex items-center gap-4 py-6">
            <div className="rounded-2xl bg-brand-100 p-3">
              <BookOpen className="h-6 w-6 text-brand-700" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Currently borrowed</p>
              <p className="text-2xl font-semibold text-slate-900">
                {active.length}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-slate-500">Overdue</p>
            <p className="text-2xl font-semibold text-rose-600">
              {active.filter((i) => i.status === "OVERDUE").length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-slate-500">Returned (all time)</p>
            <p className="text-2xl font-semibold text-slate-900">
              {history.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-slate-500">Library fine to pay</p>
            <p
              className={`text-2xl font-semibold ${fineOwed > 0 ? "text-rose-600" : "text-slate-900"}`}
            >
              {formatCurrencyNpr(fineOwed)}
            </p>
            {fineOwed > 0 ? (
              <p className="mt-1 text-xs text-slate-500">
                Overdue books keep adding a fine each day until returned.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Borrowed books</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHead>
                <tr>
                  <Th>Book</Th>
                  <Th>Code</Th>
                  <Th>Issued</Th>
                  <Th>Due</Th>
                  <Th>Returned</Th>
                  <Th>Status</Th>
                  <Th>Fine</Th>
                </tr>
              </TableHead>
              <TableBody>
                {active.length === 0 ? (
                  <tr>
                    <Td
                      colSpan={7}
                      className="py-8 text-center text-sm text-slate-500"
                    >
                      No books currently borrowed.
                    </Td>
                  </tr>
                ) : (
                  active.map((issue) => (
                    <tr key={issue._id}>
                      <Td className="font-medium">{issue.bookTitle ?? "—"}</Td>
                      <Td className="font-mono text-sm">
                        {issue.bookCode ?? "—"}
                      </Td>
                      <Td>{issue.issuedDateBs}</Td>
                      <Td>{issue.dueDateBs}</Td>
                      <Td>{issue.returnedDateBs ?? "—"}</Td>
                      <Td>
                        <Badge
                          className={issueStatusStyles[issue.status] ?? ""}
                        >
                          {issue.status}
                        </Badge>
                      </Td>
                      <Td>
                        <FineCell issue={issue} />
                      </Td>
                    </tr>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Borrowing history</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHead>
                <tr>
                  <Th>Book</Th>
                  <Th>Code</Th>
                  <Th>Issued</Th>
                  <Th>Due</Th>
                  <Th>Returned</Th>
                  <Th>Status</Th>
                  <Th>Fine</Th>
                </tr>
              </TableHead>
              <TableBody>
                {history.length === 0 ? (
                  <tr>
                    <Td
                      colSpan={7}
                      className="py-8 text-center text-sm text-slate-500"
                    >
                      No borrowing history yet.
                    </Td>
                  </tr>
                ) : (
                  history.map((issue) => (
                    <tr key={issue._id}>
                      <Td className="font-medium">{issue.bookTitle ?? "—"}</Td>
                      <Td className="font-mono text-sm">
                        {issue.bookCode ?? "—"}
                      </Td>
                      <Td>{issue.issuedDateBs}</Td>
                      <Td>{issue.dueDateBs}</Td>
                      <Td>{issue.returnedDateBs ?? "—"}</Td>
                      <Td>
                        <Badge
                          className={issueStatusStyles[issue.status] ?? ""}
                        >
                          {issue.status}
                        </Badge>
                      </Td>
                      <Td>
                        <FineCell issue={issue} />
                      </Td>
                    </tr>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </PageContent>
  );
};
