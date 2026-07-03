import { useQuery } from "@tanstack/react-query";
import type { ParentPortalResponse } from "@nepal-school-erp/shared";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { api, unwrap } from "lib/api";
import { formatCurrencyNpr } from "lib/utils";

export const ParentPortal = () => {
  const portalQuery = useQuery({
    queryKey: ["parent-portal"],
    queryFn: () => unwrap<ParentPortalResponse>(api.get("/parent/portal"))
  });

  const data = portalQuery.data;

  if (portalQuery.isLoading) {
    return <p className="p-6 text-sm text-slate-500">Loading parent portal…</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Parent Portal" description="View your children's attendance, fees, assignments, and college alerts." />

      <div className="grid gap-4 md:grid-cols-2">
        {(data?.children ?? []).map((child) => (
          <Card key={child.studentId}>
            <CardHeader>
              <CardTitle>{child.fullName}</CardTitle>
              <p className="text-sm text-slate-500">{child.className} · Section {child.sectionName} · Roll {child.rollNumber}</p>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-slate-500">Attendance</p><p className="font-semibold">{child.attendanceRate}%</p></div>
              <div><p className="text-slate-500">Fees due</p><p className="font-semibold">{formatCurrencyNpr(child.feesDueNpr)}</p></div>
              <div><p className="text-slate-500">Pending assignments</p><p className="font-semibold">{child.pendingHomework}</p></div>
              <div><p className="text-slate-500">Relationship</p><p className="font-semibold">{child.relationship}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>Recent notifications</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {(data?.recentNotifications ?? []).map((n) => (
            <div key={n._id} className="rounded-xl border border-slate-100 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{n.title}</p>
                <Badge>{n.type}</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-600">{n.message}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Upcoming assignments</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {(data?.upcomingHomework ?? []).map((hw) => (
            <div key={hw._id} className="rounded-xl border border-slate-100 p-3">
              <p className="font-medium">{hw.title}</p>
              <p className="text-sm text-slate-600">{hw.description}</p>
              {hw.dueDateBs ? <p className="mt-1 text-xs text-slate-500">Due {hw.dueDateBs}</p> : null}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};