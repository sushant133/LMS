import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { Table, TableBody, TableHead, Th, Td } from "components/ui/table";
import { Textarea } from "components/ui/textarea";
import { formatCurrencyNpr } from "lib/utils";
import { api, unwrap } from "lib/api";

interface FinancialApprovalRecord {
  _id: string;
  entityType: string;
  entityId: string;
  actionType: string;
  amountNpr: number;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedBy?: { fullName?: string };
  createdAt: string;
}

interface Props {
  canApprove: boolean;
}

export const FinancialApprovalsPanel = ({ canApprove }: Props) => {
  const queryClient = useQueryClient();
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const approvalsQuery = useQuery({
    queryKey: ["accounting-approvals"],
    queryFn: () => unwrap<FinancialApprovalRecord[]>(api.get("/accounting/approvals", { params: { status: "PENDING" } }))
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => unwrap(api.post(`/accounting/approvals/${id}/approve`)),
    onSuccess: () => {
      toast.success("Transaction approved and processed");
      void queryClient.invalidateQueries({ queryKey: ["accounting-approvals"] });
      void queryClient.invalidateQueries({ queryKey: ["accounting-dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["accounting-receipts"] });
      void queryClient.invalidateQueries({ queryKey: ["accounting-audit-logs"] });
    },
    onError: (error: Error) => toast.error(error.message)
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      unwrap(api.post(`/accounting/approvals/${id}/reject`, { rejectionReason: reason })),
    onSuccess: () => {
      toast.success("Approval request rejected");
      setRejectId(null);
      setRejectionReason("");
      void queryClient.invalidateQueries({ queryKey: ["accounting-approvals"] });
    },
    onError: (error: Error) => toast.error(error.message)
  });

  const pending = approvalsQuery.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending Approvals</CardTitle>
        <p className="text-sm text-slate-500">
          High-value reversals and voids require Principal or Finance Administrator approval.
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {approvalsQuery.isLoading ? (
          <LoadingState />
        ) : pending.length === 0 ? (
          <EmptyState title="No pending approvals" description="All financial actions are up to date." />
        ) : (
          <Table>
            <TableHead>
              <tr>
                <Th>Type</Th>
                <Th>Action</Th>
                <Th>Amount</Th>
                <Th>Reason</Th>
                <Th>Requested By</Th>
                <Th />
              </tr>
            </TableHead>
            <TableBody>
              {pending.map((row) => (
                <tr key={row._id}>
                  <Td>{row.entityType}</Td>
                  <Td>{row.actionType}</Td>
                  <Td>{formatCurrencyNpr(row.amountNpr)}</Td>
                  <Td className="max-w-[200px] truncate">{row.reason}</Td>
                  <Td>{row.requestedBy?.fullName ?? "—"}</Td>
                  <Td>
                    {canApprove ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700"
                          disabled={approveMutation.isPending}
                          onClick={() => approveMutation.mutate(row._id)}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRejectId(row._id)}
                        >
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <span className="text-sm text-amber-600">Awaiting approval</span>
                    )}
                  </Td>
                </tr>
              ))}
            </TableBody>
          </Table>
        )}

        {rejectId ? (
          <div className="mt-6 space-y-3 rounded-lg border border-slate-200 p-4">
            <FormField label="Rejection reason">
              <Textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Explain why this request is rejected"
              />
            </FormField>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                disabled={rejectMutation.isPending || rejectionReason.length < 3}
                onClick={() => rejectMutation.mutate({ id: rejectId, reason: rejectionReason })}
              >
                Confirm Reject
              </Button>
              <Button size="sm" variant="outline" onClick={() => setRejectId(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};