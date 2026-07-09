import { useMutation, useQuery } from "@tanstack/react-query";
import type { JournalEntryRecord } from "@phit-erp/shared";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { formatCurrencyNpr, parseErrorMessage } from "lib/utils";

export const JournalEntriesPanel = ({ canWrite }: { canWrite: boolean }) => {
  const entriesQuery = useQuery({
    queryKey: ["journal-entries"],
    queryFn: () =>
      unwrap<JournalEntryRecord[]>(api.get("/accounting/journal-entries")),
  });

  const reverse = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.post(`/accounting/journal-entries/${id}/reverse`)),
    onSuccess: async () => {
      toast.success("Journal entry reversed");
      await queryClient.invalidateQueries({ queryKey: ["journal-entries"] });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  if (entriesQuery.isLoading) return <LoadingState />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Journal Entries (General Ledger)</CardTitle>
      </CardHeader>
      <CardContent>
        {(entriesQuery.data ?? []).length === 0 ? (
          <EmptyState
            title="No journal entries"
            description="Entries are auto-posted from fee collections, expenses, salaries, and purchases."
          />
        ) : (
          <Table>
            <TableHead>
              <tr>
                <Th>Voucher</Th>
                <Th>Date (BS)</Th>
                <Th>Type</Th>
                <Th>Narration</Th>
                <Th>Debit</Th>
                <Th>Credit</Th>
                <Th>Actions</Th>
              </tr>
            </TableHead>
            <TableBody>
              {(entriesQuery.data ?? []).map((entry) => (
                <tr key={entry._id}>
                  <Td className="font-mono text-sm">{entry.voucherNumber}</Td>
                  <Td>{entry.dateBs}</Td>
                  <Td>{entry.voucherType}</Td>
                  <Td className="max-w-xs truncate">{entry.narration}</Td>
                  <Td>{formatCurrencyNpr(entry.totalDebitNpr)}</Td>
                  <Td>{formatCurrencyNpr(entry.totalCreditNpr)}</Td>
                  <Td>
                    {canWrite && !entry.isReversal ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => reverse.mutate(entry._id)}
                        disabled={reverse.isPending}
                      >
                        Reverse
                      </Button>
                    ) : entry.isReversal ? (
                      "Reversal"
                    ) : (
                      "—"
                    )}
                  </Td>
                </tr>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};
