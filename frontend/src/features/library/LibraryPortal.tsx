import { useQuery } from "@tanstack/react-query";
import type { LibraryIssueRecord } from "@phit-erp/shared";
import { BookOpen } from "lucide-react";
import { PageContent } from "components/layout/PageContent";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";

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

  return (
    <PageContent className="space-y-6">
      <PageHeader
        title="My Library"
        description="View books currently borrowed and your complete borrowing history."
      />

      <div className="grid gap-4 md:grid-cols-3">
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
                </tr>
              </TableHead>
              <TableBody>
                {active.length === 0 ? (
                  <tr>
                    <Td
                      colSpan={6}
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
                </tr>
              </TableHead>
              <TableBody>
                {history.length === 0 ? (
                  <tr>
                    <Td
                      colSpan={6}
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
