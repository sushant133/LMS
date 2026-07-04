import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { LEAVE_TYPES, leaveRequestSchema, payrollSchema, type LeaveRequestInput, type PayrollInput } from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Textarea } from "components/ui/textarea";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { formatCurrencyNpr, parseErrorMessage } from "lib/utils";

export const HrManager = () => {
  const [leaveForm, setLeaveForm] = useState<LeaveRequestInput>({ teacherId: "", type: "CASUAL", startDateBs: "", endDateBs: "", reason: "" });
  const [payrollForm, setPayrollForm] = useState<PayrollInput>({ teacherId: "", monthBs: "2082-01", basicSalaryNpr: 0, allowancesNpr: 0, deductionsNpr: 0, status: "DRAFT", paidDateBs: "" });

  const teachersQuery = useQuery({
    queryKey: ["teachers"],
    queryFn: () => unwrap<Array<{ _id: string; user: { fullName: string }; basicSalaryNpr: number }>>(api.get("/teachers"))
  });
  const leavesQuery = useQuery({
    queryKey: ["hr-leaves"],
    queryFn: () =>
      unwrap<Array<{ _id: string; teacherId?: { user: { fullName: string } }; type: string; startDateBs: string; endDateBs: string; status: string }>>(
        api.get("/hr/leaves")
      )
  });
  const payrollQuery = useQuery({
    queryKey: ["hr-payroll"],
    queryFn: () =>
      unwrap<Array<{ _id: string; teacherId?: { user: { fullName: string } }; monthBs: string; netSalaryNpr: number; status: string }>>(
        api.get("/hr/payroll")
      )
  });

  const createLeave = useMutation({
    mutationFn: (payload: LeaveRequestInput) => unwrap(api.post("/hr/leaves", payload)),
    onSuccess: async () => { toast.success("Leave submitted"); await queryClient.invalidateQueries({ queryKey: ["hr-leaves"] }); },
    onError: (e) => toast.error(parseErrorMessage(e))
  });

  const updateLeave = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "APPROVED" | "REJECTED" }) => unwrap(api.put(`/hr/leaves/${id}/status`, { status })),
    onSuccess: async () => { toast.success("Leave updated"); await queryClient.invalidateQueries({ queryKey: ["hr-leaves"] }); },
    onError: (e) => toast.error(parseErrorMessage(e))
  });

  const createPayroll = useMutation({
    mutationFn: (payload: PayrollInput) => unwrap(api.post("/hr/payroll", payload)),
    onSuccess: async () => { toast.success("Payroll created"); await queryClient.invalidateQueries({ queryKey: ["hr-payroll"] }); },
    onError: (e) => toast.error(parseErrorMessage(e))
  });

  return (
    <div className="space-y-6">
      <PageHeader title="HR & Payroll" description="Leave requests, approvals, and monthly salary processing." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Leave request</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <FormField label="Teacher">
              <Select value={leaveForm.teacherId} onChange={(e) => setLeaveForm((c) => ({ ...c, teacherId: e.target.value }))}>
                <option value="">Select teacher</option>
                {(teachersQuery.data ?? []).map((t: { _id: string; user: { fullName: string } }) => <option key={t._id} value={t._id}>{t.user.fullName}</option>)}
              </Select>
            </FormField>
            <FormField label="Type">
              <Select value={leaveForm.type} onChange={(e) => setLeaveForm((c) => ({ ...c, type: e.target.value as LeaveRequestInput["type"] }))}>
                {LEAVE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </FormField>
            <FormField label="Start (BS)"><NepaliDateField value={leaveForm.startDateBs} onChange={(v) => setLeaveForm((c) => ({ ...c, startDateBs: v }))} /></FormField>
            <FormField label="End (BS)"><NepaliDateField value={leaveForm.endDateBs} onChange={(v) => setLeaveForm((c) => ({ ...c, endDateBs: v }))} /></FormField>
            <FormField label="Reason"><Textarea value={leaveForm.reason} onChange={(e) => setLeaveForm((c) => ({ ...c, reason: e.target.value }))} /></FormField>
            <Button onClick={() => { const p = leaveRequestSchema.safeParse(leaveForm); if (!p.success) return toast.error("Invalid leave"); createLeave.mutate(p.data); }}>Submit leave</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Process payroll</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <FormField label="Teacher">
              <Select value={payrollForm.teacherId} onChange={(e) => setPayrollForm((c) => ({ ...c, teacherId: e.target.value }))}>
                <option value="">Select teacher</option>
                {(teachersQuery.data ?? []).map((t: { _id: string; user: { fullName: string }; basicSalaryNpr: number }) => (
                  <option key={t._id} value={t._id}>{t.user.fullName}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="Month (YYYY-MM)"><Input value={payrollForm.monthBs} onChange={(e) => setPayrollForm((c) => ({ ...c, monthBs: e.target.value }))} /></FormField>
            <FormField label="Basic salary"><Input type="number" value={payrollForm.basicSalaryNpr} onChange={(e) => setPayrollForm((c) => ({ ...c, basicSalaryNpr: e.target.valueAsNumber }))} /></FormField>
            <FormField label="Allowances"><Input type="number" value={payrollForm.allowancesNpr} onChange={(e) => setPayrollForm((c) => ({ ...c, allowancesNpr: e.target.valueAsNumber }))} /></FormField>
            <FormField label="Deductions"><Input type="number" value={payrollForm.deductionsNpr} onChange={(e) => setPayrollForm((c) => ({ ...c, deductionsNpr: e.target.valueAsNumber }))} /></FormField>
            <Button onClick={() => { const p = payrollSchema.safeParse(payrollForm); if (!p.success) return toast.error("Invalid payroll"); createPayroll.mutate(p.data); }}>Create payroll</Button>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Leave requests</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHead><tr><Th>Teacher</Th><Th>Type</Th><Th>Dates</Th><Th>Status</Th><Th /></tr></TableHead>
            <TableBody>
              {(leavesQuery.data ?? []).map((l: { _id: string; teacherId?: { user: { fullName: string } }; type: string; startDateBs: string; endDateBs: string; status: string }) => (
                <tr key={l._id}>
                  <Td>{l.teacherId?.user?.fullName}</Td><Td>{l.type}</Td><Td>{l.startDateBs} – {l.endDateBs}</Td><Td>{l.status}</Td>
                  <Td>{l.status === "PENDING" ? (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => updateLeave.mutate({ id: l._id, status: "APPROVED" })}>Approve</Button>
                      <Button size="sm" variant="secondary" onClick={() => updateLeave.mutate({ id: l._id, status: "REJECTED" })}>Reject</Button>
                    </div>
                  ) : null}</Td>
                </tr>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Payroll records</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHead><tr><Th>Teacher</Th><Th>Month</Th><Th>Net salary</Th><Th>Status</Th></tr></TableHead>
            <TableBody>
              {(payrollQuery.data ?? []).map((p: { _id: string; teacherId?: { user: { fullName: string } }; monthBs: string; netSalaryNpr: number; status: string }) => (
                <tr key={p._id}><Td>{p.teacherId?.user?.fullName}</Td><Td>{p.monthBs}</Td><Td>{formatCurrencyNpr(p.netSalaryNpr)}</Td><Td>{p.status}</Td></tr>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};