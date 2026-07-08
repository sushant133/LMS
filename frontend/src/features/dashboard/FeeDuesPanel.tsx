import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Bell, ExternalLink, FileText, History, UserRound, X } from "lucide-react";
import type { DashboardFeeDueStudent } from "@phit-erp/shared";
import { canManageInstitution, hasAccountingPermission } from "@phit-erp/shared";
import { useAuth } from "features/auth/AuthProvider";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { LoadingState } from "components/shared/LoadingState";
import { useReadOnlyAccess } from "hooks/useNormalizedRole";
import { accountingFeeCollectionUrl, accountingStudentAccountsUrl } from "lib/accountingNav";
import { api, unwrap } from "lib/api";
import { invalidateDashboardQueries } from "lib/dashboardQueries";
import { invalidateNotificationQueries } from "lib/notificationQueries";
import { formatCurrencyNpr, parseErrorMessage } from "lib/utils";
import { toast } from "sonner";

const paymentStatusClass: Record<DashboardFeeDueStudent["paymentStatus"], string> = {
  PENDING: "bg-amber-100 text-amber-800",
  PARTIAL: "bg-sky-100 text-sky-800",
  OVERDUE: "bg-rose-100 text-rose-800"
};

const StudentAvatar = ({ photoUrl, name }: { photoUrl?: string; name: string }) =>
  photoUrl ? (
    <img src={photoUrl} alt={name} className="h-12 w-12 rounded-full object-cover" />
  ) : (
    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">
      <UserRound className="h-5 w-5" />
    </div>
  );

export const FeeDuesPanel = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { user } = useAuth();
  const canAccessAccounting = hasAccountingPermission(user?.role ?? "", "read");
  const canSendReminder = user ? canManageInstitution(user.role) : false;
  const { isReadOnly, readOnlyMessage } = useReadOnlyAccess();

  const feeDuesQuery = useQuery({
    queryKey: ["dashboard-fee-dues"],
    queryFn: () => unwrap<DashboardFeeDueStudent[]>(api.get("/dashboard/fee-dues")),
    enabled: open
  });

  const sendReminder = useMutation({
    mutationFn: (studentId: string) => unwrap(api.post(`/dashboard/fee-dues/${studentId}/remind`)),
    onSuccess: async () => {
      toast.success("Fee reminder sent");
      await Promise.all([invalidateDashboardQueries(), invalidateNotificationQueries()]);
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  if (!open) {
    return null;
  }

  const students = feeDuesQuery.data ?? [];

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
      <button type="button" aria-label="Close fee dues panel" className="absolute inset-0" onClick={onClose} />
      <Card className="relative flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden shadow-2xl">
        <CardHeader className="flex shrink-0 flex-row items-start justify-between gap-4 space-y-0 border-b border-slate-100">
          <div>
            <CardTitle>Students with Fee Dues</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              Outstanding balances, contact details, and quick actions for follow-up.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close fee dues panel">
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-y-auto py-5">
          {feeDuesQuery.isLoading ? (
            <LoadingState />
          ) : students.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-12 text-center text-sm text-slate-500">
              No students currently have outstanding fee dues.
            </div>
          ) : (
            <div className="space-y-4">
              {students.map((student) => (
                <div key={student.studentId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex min-w-0 gap-4">
                      <StudentAvatar photoUrl={student.photoUrl} name={student.fullName} />
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-lg font-semibold text-slate-900">{student.fullName}</p>
                          <Badge className={paymentStatusClass[student.paymentStatus]}>{student.paymentStatus}</Badge>
                        </div>
                        <p className="text-sm text-slate-500">
                          ID {student.admissionNumber} · Roll {student.rollNumber}
                        </p>
                        <p className="text-sm text-slate-600">
                          {student.courseName}
                          {student.yearName ? ` · Year ${student.yearName}` : ""}
                          {student.sectionName ? ` · Section ${student.sectionName}` : ""}
                        </p>
                        <p className="text-sm text-slate-600">
                          {student.parentName} · {student.contactNumber || "No contact"} · {student.email || "No email"}
                        </p>
                      </div>
                    </div>

                    <div className="grid shrink-0 gap-2 text-sm sm:grid-cols-2 lg:min-w-[280px]">
                      <div>
                        <p className="text-slate-500">Total Fee</p>
                        <p className="font-semibold text-slate-900">{formatCurrencyNpr(student.totalFeeNpr)}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Amount Paid</p>
                        <p className="font-semibold text-slate-900">{formatCurrencyNpr(student.amountPaidNpr)}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Outstanding</p>
                        <p className="font-semibold text-rose-700">{formatCurrencyNpr(student.outstandingAmountNpr)}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Pending Installments</p>
                        <p className="font-semibold text-slate-900">{student.pendingInstallments}</p>
                      </div>
                      {student.dueDateBs ? (
                        <div className="sm:col-span-2">
                          <p className="text-slate-500">Due Date (BS)</p>
                          <p className="font-semibold text-slate-900">{student.dueDateBs}</p>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/students/${student.studentId}/profile`}>
                        <UserRound className="mr-2 h-4 w-4" />
                        View Student Profile
                      </Link>
                    </Button>
                    {canAccessAccounting ? (
                      <>
                        <Button asChild size="sm" variant="outline">
                          <Link to={accountingFeeCollectionUrl(student.studentId)}>
                            <FileText className="mr-2 h-4 w-4" />
                            View Fee Details
                          </Link>
                        </Button>
                        <Button asChild size="sm" variant="outline">
                          <Link to={accountingStudentAccountsUrl(student.studentId)}>
                            <History className="mr-2 h-4 w-4" />
                            View Payment History
                          </Link>
                        </Button>
                        {student.lastReceiptId ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              window.open(`${api.defaults.baseURL}/accounting/collections/${student.lastReceiptId}/receipt`, "_blank")
                            }
                          >
                            <ExternalLink className="mr-2 h-4 w-4" />
                            Print Fee Statement
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                    {canSendReminder && student.recipientUserId ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={sendReminder.isPending || isReadOnly}
                        title={isReadOnly ? readOnlyMessage : undefined}
                        onClick={() => sendReminder.mutate(student.studentId)}
                      >
                        <Bell className="mr-2 h-4 w-4" />
                        Send Reminder
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};