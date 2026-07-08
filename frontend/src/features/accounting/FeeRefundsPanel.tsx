import { useMutation, useQuery } from "@tanstack/react-query";
import { feeRefundSchema, type FeeRefundInput, type FeeRefundRecord, type StudentRecord } from "@phit-erp/shared";
import { useState } from "react";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { Textarea } from "components/ui/textarea";
import { PAYMENT_METHODS } from "@phit-erp/shared";
import { api, unwrap } from "lib/api";
import { invalidateDashboardQueries } from "lib/dashboardQueries";
import { queryClient } from "lib/queryClient";
import { formatCurrencyNpr, parseErrorMessage } from "lib/utils";

const defaultForm: FeeRefundInput = {
  studentId: "",
  amountNpr: 0,
  dateBs: "",
  reason: "",
  paymentMethod: "CASH",
  transactionNumber: "",
  notes: ""
};

export const FeeRefundsPanel = ({ canWrite }: { canWrite: boolean }) => {
  const [form, setForm] = useState(defaultForm);

  const refundsQuery = useQuery({
    queryKey: ["fee-refunds"],
    queryFn: () => unwrap<FeeRefundRecord[]>(api.get("/accounting/refunds"))
  });

  const studentsQuery = useQuery({
    queryKey: ["students"],
    queryFn: () => unwrap<StudentRecord[]>(api.get("/students"))
  });

  const create = useMutation({
    mutationFn: (payload: FeeRefundInput) => unwrap(api.post("/accounting/refunds", payload)),
    onSuccess: async () => {
      toast.success("Refund processed");
      setForm(defaultForm);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["fee-refunds"] }),
        queryClient.invalidateQueries({ queryKey: ["accounting-student-accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["accounting-dashboard"] }),
        invalidateDashboardQueries()
      ]);
    },
    onError: (e) => toast.error(parseErrorMessage(e))
  });

  if (refundsQuery.isLoading || studentsQuery.isLoading) return <LoadingState />;

  return (
    <div className="space-y-6">
      {canWrite ? (
        <Card>
          <CardHeader><CardTitle>Process Refund</CardTitle></CardHeader>
          <CardContent>
            <form
              className="grid gap-3 md:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                const parsed = feeRefundSchema.safeParse(form);
                if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Invalid refund");
                void create.mutateAsync(parsed.data);
              }}
            >
              <FormField label="Student">
                <Select value={form.studentId} onChange={(e) => setForm((c) => ({ ...c, studentId: e.target.value }))}>
                  <option value="">Select student</option>
                  {(studentsQuery.data ?? []).map((s) => (
                    <option key={s._id} value={s._id}>{s.admissionNumber} — Roll {s.rollNumber}</option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Amount (NPR)"><Input type="number" value={form.amountNpr || ""} onChange={(e) => setForm((c) => ({ ...c, amountNpr: Number(e.target.value) }))} /></FormField>
              <FormField label="Date (BS)"><NepaliDateField value={form.dateBs} onChange={(v) => setForm((c) => ({ ...c, dateBs: v }))} /></FormField>
              <FormField label="Payment Method">
                <Select value={form.paymentMethod} onChange={(e) => setForm((c) => ({ ...c, paymentMethod: e.target.value as FeeRefundInput["paymentMethod"] }))}>
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}
                </Select>
              </FormField>
              <div className="md:col-span-2">
                <FormField label="Reason"><Textarea value={form.reason} onChange={(e) => setForm((c) => ({ ...c, reason: e.target.value }))} /></FormField>
              </div>
              <div className="md:col-span-2"><Button type="submit" disabled={create.isPending}>Process Refund</Button></div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle>Refund History</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHead><tr><Th>Refund No.</Th><Th>Date</Th><Th>Amount</Th><Th>Reason</Th><Th>Method</Th></tr></TableHead>
            <TableBody>
              {(refundsQuery.data ?? []).map((refund) => (
                <tr key={refund._id}>
                  <Td>{refund.refundNumber}</Td>
                  <Td>{refund.dateBs}</Td>
                  <Td>{formatCurrencyNpr(refund.amountNpr)}</Td>
                  <Td>{refund.reason}</Td>
                  <Td>{refund.paymentMethod.replace(/_/g, " ")}</Td>
                </tr>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};