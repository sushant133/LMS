import { useQuery } from "@tanstack/react-query";
import type { ParentPortalResponse } from "@phit-erp/shared";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
import { PageHeader } from "components/shared/PageHeader";
import { StudentNameLink } from "components/shared/StudentNameLink";
import { Badge } from "components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { FieldDutyPortalPanel } from "features/attendance/FieldDutyPortalPanel";
import { useIsCollege } from "hooks/useInstitutionType";
import { api, unwrap } from "lib/api";
import { formatCurrencyNpr, parseErrorMessage } from "lib/utils";

export const ParentPortal = () => {
  const isCollege = useIsCollege();
  const primaryLabel = isCollege ? "Batch" : "Class";
  const secondaryLabel = isCollege ? "Year" : "Section";

  const portalQuery = useQuery({
    queryKey: ["parent-portal"],
    queryFn: () => unwrap<ParentPortalResponse>(api.get("/parent/portal")),
  });

  const data = portalQuery.data;
  const children = data?.children ?? [];

  if (portalQuery.isLoading) {
    return <LoadingState />;
  }

  if (portalQuery.isError) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Parent Portal"
          description="View your children's attendance, fees, assignments, and college alerts."
        />
        <EmptyState
          title="Could not load parent portal"
          description={
            parseErrorMessage(portalQuery.error) ||
            "Please try again, or contact the college administrator if this continues."
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Parent Portal"
        description="View your children's classroom and field attendance, fees, assignments, and college alerts."
      />

      {children.length === 0 ? (
        <EmptyState
          title="No children linked yet"
          description="Ask the college administrator to link your account to your child's student profile under Parent Links. Once linked, attendance, fees, and assignments will appear here."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {children.map((child) => (
            <Card key={child.studentId}>
              <CardHeader>
                <CardTitle>
                  <StudentNameLink
                    studentId={child.studentId}
                    name={child.fullName}
                  />
                </CardTitle>
                <p className="text-sm text-slate-500">
                  {primaryLabel} {child.className} · {secondaryLabel}{" "}
                  {child.sectionName} · Roll {child.rollNumber}
                </p>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-slate-500">Attendance</p>
                    <p className="font-semibold">{child.attendanceRate}%</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Fees remaining</p>
                    <p className="font-semibold text-rose-700">
                      {formatCurrencyNpr(child.feesDueNpr)}
                    </p>
                  </div>
                  {(child as { securityDepositNpr?: number }).securityDepositNpr ? (
                    <div>
                      <p className="text-slate-500">Security deposit</p>
                      <p className="font-semibold text-slate-800">
                        {formatCurrencyNpr(
                          (child as { securityDepositNpr?: number })
                            .securityDepositNpr ?? 0,
                        )}
                      </p>
                    </div>
                  ) : null}
                  <div>
                    <p className="text-slate-500">Total paid</p>
                    <p className="font-semibold text-emerald-700">
                      {formatCurrencyNpr(
                        (child as { totalPaidNpr?: number }).totalPaidNpr ?? 0,
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Scholarship</p>
                    <p className="font-semibold text-violet-700">
                      {formatCurrencyNpr(
                        (child as { totalScholarshipNpr?: number })
                          .totalScholarshipNpr ?? 0,
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Pending assignments</p>
                    <p className="font-semibold">{child.pendingHomework}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Relationship</p>
                    <p className="font-semibold">{child.relationship}</p>
                  </div>
                </div>
                {Array.isArray(
                  (child as { yearWise?: Array<Record<string, unknown>> })
                    .yearWise,
                ) &&
                (
                  (child as { yearWise?: Array<Record<string, unknown>> })
                    .yearWise ?? []
                ).length > 0 ? (
                  <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-2">
                    <p className="mb-1 text-xs font-medium text-slate-600">
                      Year-wise fees
                    </p>
                    <div className="grid gap-1 sm:grid-cols-3">
                      {(
                        (
                          child as {
                            yearWise: Array<{
                              label: string;
                              status: string;
                              paidNpr: number;
                              remainingNpr: number;
                              scholarshipNpr: number;
                            }>;
                          }
                        ).yearWise ?? []
                      ).map((y) => (
                        <div
                          key={y.label}
                          className="rounded-lg bg-white px-2 py-1.5 text-xs"
                        >
                          <p className="font-medium text-slate-800">{y.label}</p>
                          <p className="text-slate-500">
                            {String(y.status).replace(/_/g, " ")}
                          </p>
                          <p>
                            Paid {formatCurrencyNpr(y.paidNpr)}
                            {y.scholarshipNpr > 0
                              ? ` · Sch ${formatCurrencyNpr(y.scholarshipNpr)}`
                              : ""}
                          </p>
                          {y.remainingNpr > 0 ? (
                            <p className="text-rose-600">
                              Due {formatCurrencyNpr(y.remainingNpr)}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {children.map((child) => (
        <FieldDutyPortalPanel
          key={`field-${child.studentId}`}
          studentId={child.studentId}
          title={`Field Attendance · ${child.fullName}`}
        />
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Recent notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(data?.recentNotifications ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">No notifications yet.</p>
          ) : (
            (data?.recentNotifications ?? []).map((n) => (
              <div key={n._id} className="rounded-xl border border-slate-100 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{n.title}</p>
                  <Badge>{n.type}</Badge>
                </div>
                <p className="mt-1 text-sm text-slate-600">{n.message}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Upcoming assignments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(data?.upcomingHomework ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">
              No upcoming assignments for your linked children.
            </p>
          ) : (
            (data?.upcomingHomework ?? []).map((hw) => (
              <div
                key={hw._id}
                className="rounded-xl border border-slate-100 p-3"
              >
                <p className="font-medium">{hw.title}</p>
                <p className="text-sm text-slate-600">{hw.description}</p>
                {hw.dueDateBs ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Due {hw.dueDateBs}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
};
