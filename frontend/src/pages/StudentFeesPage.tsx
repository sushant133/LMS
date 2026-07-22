import { useQuery } from "@tanstack/react-query";
import type { ProgramYearFeeSummary, StudentFinancialHistory } from "@phit-erp/shared";
import { Award, Receipt } from "lucide-react";
import { PageHeader } from "components/shared/PageHeader";
import { LoadingState } from "components/shared/LoadingState";
import { Badge } from "components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { formatCurrencyNpr } from "lib/utils";

const yearStatusClass = (status: ProgramYearFeeSummary["status"]) => {
  switch (status) {
    case "PAID":
      return "bg-emerald-100 text-emerald-800";
    case "SCHOLARSHIP":
      return "bg-violet-100 text-violet-800";
    case "PARTIAL":
      return "bg-amber-100 text-amber-900";
    case "DUE":
      return "bg-rose-100 text-rose-800";
    default:
      return "bg-slate-100 text-slate-600";
  }
};

export const StudentFeesPage = () => {
  const historyQuery = useQuery({
    queryKey: ["student-financial-history"],
    queryFn: () =>
      unwrap<StudentFinancialHistory>(api.get("/student/financial-history")),
  });

  if (historyQuery.isLoading) {
    return <LoadingState />;
  }

  const history = historyQuery.data;

  if (!history) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="My fees"
          description="Your payment records and outstanding dues."
        />
        <Card>
          <CardContent className="py-8 text-center text-slate-500">
            No financial records found.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="My fees"
        description="HA fee account — paid, remaining, and year-wise scholarship status."
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-500">Outstanding due</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-rose-600">
            {formatCurrencyNpr(history.outstandingDueNpr)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-500">Total paid</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-brand-600">
            {formatCurrencyNpr(history.totalPaidNpr)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-500">Scholarships</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-violet-700">
            {formatCurrencyNpr(history.totalScholarshipNpr)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-500">Discounts</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {formatCurrencyNpr(history.totalDiscountNpr)}
          </CardContent>
        </Card>
      </div>

      {(history.yearWise?.length ?? 0) > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Year-wise fee status</CardTitle>
            <p className="text-sm text-slate-500">
              {history.scholarshipStatus && history.scholarshipStatus !== "None"
                ? history.scholarshipStatus
                : "1st / 2nd / 3rd year paid, scholarship, and remaining"}
            </p>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            {history.yearWise!.map((y) => (
              <div
                key={y.programYear}
                className="rounded-xl border border-slate-200 p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-slate-900">{y.label}</p>
                  <Badge className={yearStatusClass(y.status)}>
                    {y.status.replace(/_/g, " ")}
                  </Badge>
                </div>
                <dl className="mt-3 space-y-1 text-sm text-slate-600">
                  <div className="flex justify-between">
                    <dt>Paid</dt>
                    <dd className="font-medium text-emerald-700">
                      {formatCurrencyNpr(y.paidNpr)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Scholarship</dt>
                    <dd>{formatCurrencyNpr(y.scholarshipNpr)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Remaining</dt>
                    <dd className="font-medium text-rose-700">
                      {formatCurrencyNpr(y.remainingNpr)}
                    </dd>
                  </div>
                </dl>
                {y.scholarshipNote ? (
                  <p className="mt-2 text-xs text-violet-700">{y.scholarshipNote}</p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {(history.scholarshipAwards?.length ?? 0) > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Award className="h-4 w-4 text-violet-600" />
              Scholarship awards
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {history.scholarshipAwards!.map((a) => (
              <div
                key={a._id}
                className="rounded-xl border border-violet-100 bg-violet-50/50 px-3 py-2 text-sm"
              >
                <p className="font-medium text-violet-950">
                  {a.reason ||
                    `Topped year ${a.toppedProgramYear} → year ${a.coversProgramYear} scholarship`}
                </p>
                <p className="text-xs text-violet-800">
                  Status: {a.status}
                  {a.examName ? ` · ${a.examName}` : ""}
                  {a.rank ? ` · Rank ${a.rank}` : ""}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Payment history
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {history.collections.length === 0 ? (
            <p className="text-sm text-slate-500">No payments recorded yet.</p>
          ) : (
            <Table>
              <TableHead>
                <tr>
                  <Th>Receipt</Th>
                  <Th>Date</Th>
                  <Th>Year</Th>
                  <Th>Amount paid</Th>
                  <Th>Scholarship</Th>
                  <Th>Remaining</Th>
                  <Th>Method</Th>
                </tr>
              </TableHead>
              <TableBody>
                {history.collections.map((collection) => (
                  <tr key={collection._id}>
                    <Td className="font-medium">{collection.receiptNumber}</Td>
                    <Td>{collection.paidDateBs}</Td>
                    <Td>
                      {collection.programYear
                        ? `${collection.programYear}${
                            collection.programYear === 1
                              ? "st"
                              : collection.programYear === 2
                                ? "nd"
                                : "rd"
                          } Year`
                        : "—"}
                    </Td>
                    <Td>{formatCurrencyNpr(collection.amountPaidNpr)}</Td>
                    <Td>
                      {formatCurrencyNpr(collection.scholarshipNpr ?? 0)}
                    </Td>
                    <Td>
                      <Badge
                        className={
                          (collection.remainingDueNpr ?? 0) > 0
                            ? "bg-rose-100 text-rose-800"
                            : undefined
                        }
                      >
                        {formatCurrencyNpr(collection.remainingDueNpr ?? 0)}
                      </Badge>
                    </Td>
                    <Td>
                      {(collection.paymentMethod ?? "CASH").replace(/_/g, " ")}
                    </Td>
                  </tr>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};