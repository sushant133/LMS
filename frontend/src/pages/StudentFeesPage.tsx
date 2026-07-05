import { useQuery } from "@tanstack/react-query";
import { Download, Receipt } from "lucide-react";
import { PageHeader } from "components/shared/PageHeader";
import { LoadingState } from "components/shared/LoadingState";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { formatCurrencyNpr } from "lib/utils";
import type { StudentFinancialHistory } from "@phit-erp/shared";

export const StudentFeesPage = () => {
  const historyQuery = useQuery({
    queryKey: ["student-financial-history"],
    queryFn: () => unwrap<StudentFinancialHistory>(api.get("/student/financial-history"))
  });

  if (historyQuery.isLoading) {
    return <LoadingState />;
  }

  const history = historyQuery.data;

  if (!history) {
    return (
      <div className="space-y-6">
        <PageHeader title="Fee History" description="Your payment records and outstanding dues." />
        <Card>
          <CardContent className="py-8 text-center text-slate-500">No financial records found.</CardContent>
        </Card>
      </div>
    );
  }

  const downloadReceipt = (collectionId: string, receiptNumber: string) => {
    window.open(`${api.defaults.baseURL}/accounting/collections/${collectionId}/receipt`, "_blank", "noopener,noreferrer");
    void receiptNumber;
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Fee History" description="View your complete payment history, outstanding dues, and download receipts." />

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-500">Outstanding Due</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-rose-600">{formatCurrencyNpr(history.outstandingDueNpr)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-500">Total Paid</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-emerald-600">{formatCurrencyNpr(history.totalPaidNpr)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-500">Discounts</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{formatCurrencyNpr(history.totalDiscountNpr)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-500">Scholarships</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{formatCurrencyNpr(history.totalScholarshipNpr)}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Payment History
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
                  <Th>Amount Paid</Th>
                  <Th>Discount</Th>
                  <Th>Remaining Due</Th>
                  <Th>Method</Th>
                  <Th />
                </tr>
              </TableHead>
              <TableBody>
                {history.collections.map((collection) => (
                  <tr key={collection._id}>
                    <Td className="font-medium">{collection.receiptNumber}</Td>
                    <Td>{collection.paidDateBs}</Td>
                    <Td>{formatCurrencyNpr(collection.amountPaidNpr)}</Td>
                    <Td>{formatCurrencyNpr(collection.discountNpr ?? 0)}</Td>
                    <Td>
                      <Badge className={(collection.remainingDueNpr ?? 0) > 0 ? "bg-rose-100 text-rose-800" : undefined}>
                        {formatCurrencyNpr(collection.remainingDueNpr ?? 0)}
                      </Badge>
                    </Td>
                    <Td>{(collection.paymentMethod ?? "CASH").replace(/_/g, " ")}</Td>
                    <Td>
                      <Button size="sm" variant="outline" onClick={() => downloadReceipt(collection._id, collection.receiptNumber)}>
                        <Download className="mr-1 h-4 w-4" />
                        PDF
                      </Button>
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