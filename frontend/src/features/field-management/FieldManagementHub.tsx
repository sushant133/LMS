import { useMemo, useState } from "react";
import {
  Building2,
  ClipboardCheck,
  Hospital,
  MapPin,
  Users,
} from "lucide-react";
import {
  canManageInstitution,
  type FieldDutyDashboard,
  type FieldDutyPortalSummary,
  type FieldPostingSection,
} from "@phit-erp/shared";
import { PageHeader } from "components/shared/PageHeader";
import { LoadingState } from "components/shared/LoadingState";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { useAuth } from "features/auth/AuthProvider";
import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "lib/api";
import { FieldPostingSectionPanel } from "./FieldPostingSectionPanel";
import { FieldStudentAttendancePanel } from "./FieldStudentAttendancePanel";
import { sectionLabel } from "./fieldUtils";

type TopTab = "community" | "hospital" | "my-duties" | "my-attendance" | "monitoring";

export const FieldManagementHub = () => {
  const { user } = useAuth();
  const isAdmin = canManageInstitution(user?.role ?? "");
  const isViewer = user?.role === "COLLEGE_VIEWER";
  const isStudent = user?.role === "STUDENT";
  const isStaffOrTeacher =
    user?.role === "COLLEGE_STAFF" || user?.role === "TEACHER";

  const defaultTab: TopTab = isStudent
    ? "my-attendance"
    : isStaffOrTeacher
      ? "my-duties"
      : "community";

  const [topTab, setTopTab] = useState<TopTab>(defaultTab);

  const dashboardQuery = useQuery({
    queryKey: ["field-duty", "dashboard"],
    queryFn: () => unwrap<FieldDutyDashboard>(api.get("/field-duty/dashboard")),
    enabled: !isStudent,
  });

  const studentPortalQuery = useQuery({
    queryKey: ["field-duty", "portal", "me"],
    queryFn: () => unwrap<FieldDutyPortalSummary>(api.get("/field-duty/portal/me")),
    enabled: isStudent,
  });

  const tabs = useMemo(() => {
    if (isStudent) {
      return [{ id: "my-attendance" as const, label: "Field Attendance", icon: ClipboardCheck }];
    }
    if (isStaffOrTeacher && !isAdmin) {
      return [
        { id: "my-duties" as const, label: "My Field Duties", icon: MapPin },
        { id: "community" as const, label: "Community / PHC", icon: Building2 },
        { id: "hospital" as const, label: "Hospital", icon: Hospital },
      ];
    }
    return [
      { id: "community" as const, label: "Community / PHC Posting", icon: Building2 },
      { id: "hospital" as const, label: "Hospital Posting", icon: Hospital },
      ...(isAdmin || isViewer
        ? [{ id: "monitoring" as const, label: "Admin Monitoring", icon: Users }]
        : []),
      ...(isStaffOrTeacher
        ? [{ id: "my-duties" as const, label: "My Field Duties", icon: MapPin }]
        : []),
    ];
  }, [isAdmin, isViewer, isStudent, isStaffOrTeacher]);

  const section: FieldPostingSection | null =
    topTab === "community" ? "COMMUNITY_PHC" : topTab === "hospital" ? "HOSPITAL" : null;

  const dash = dashboardQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Field Management"
        description="Manage Community/PHC and Hospital postings — assignment, coordinator attendance, and monitoring. Independent from classroom and laboratory attendance."
      />

      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <Button
              key={tab.id}
              variant={topTab === tab.id ? "default" : "outline"}
              onClick={() => setTopTab(tab.id)}
            >
              <Icon className="mr-2 h-4 w-4" />
              {tab.label}
            </Button>
          );
        })}
      </div>

      {isStudent ? (
        studentPortalQuery.isLoading ? (
          <LoadingState />
        ) : (
          <FieldStudentAttendancePanel data={studentPortalQuery.data} />
        )
      ) : null}

      {!isStudent && topTab === "my-duties" ? (
        dashboardQuery.isLoading ? (
          <LoadingState />
        ) : (
          <CoordinatorDutiesOverview
            dash={dash}
            onOpenSection={(s) => setTopTab(s === "HOSPITAL" ? "hospital" : "community")}
          />
        )
      ) : null}

      {!isStudent && section ? (
        <FieldPostingSectionPanel
          section={section}
          isAdmin={isAdmin}
          canWrite={isAdmin || isStaffOrTeacher}
          isCoordinatorView={isStaffOrTeacher && !isAdmin}
        />
      ) : null}

      {!isStudent && topTab === "monitoring" && (isAdmin || isViewer) ? (
        <AdminMonitoringPanel />
      ) : null}
    </div>
  );
};

const CoordinatorDutiesOverview = ({
  dash,
  onOpenSection,
}: {
  dash?: FieldDutyDashboard;
  onOpenSection: (s: FieldPostingSection) => void;
}) => {
  const assignments = dash?.myAssignments ?? [];
  const upcoming = dash?.upcomingPostings ?? [];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Students on duty today", value: dash?.studentsOnDutyToday ?? 0 },
          { label: "Attendance pending", value: dash?.pendingSubmissions ?? 0 },
          { label: "Attendance submitted", value: dash?.submittedToday ?? 0 },
          { label: "Overall % today", value: `${dash?.overallAttendancePercent ?? 0}%` },
        ].map((c) => (
          <Card key={c.label}>
            <CardContent className="pt-4">
              <p className="text-xs text-slate-500">{c.label}</p>
              <p className="text-2xl font-semibold">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Today&apos;s postings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {assignments.length === 0 ? (
            <p className="text-sm text-slate-500">No active field postings assigned to you today.</p>
          ) : (
            assignments.map((a) => (
              <div
                key={a.scheduleId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3"
              >
                <div>
                  <p className="font-medium">
                    {a.siteName || a.hospitalName}
                    {a.postingType ? (
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        {a.postingType.replace(/_/g, " ")}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-slate-500">
                    {a.batchName} · {a.yearName} · {a.studentCount} students · Status:{" "}
                    {a.attendanceStatus ?? "NONE"}
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() =>
                    onOpenSection(
                      a.postingType === "HOSPITAL" ||
                        a.postingType === "CLINICAL_ROTATION" ||
                        a.postingType === "INTERNSHIP"
                        ? "HOSPITAL"
                        : "COMMUNITY_PHC",
                    )
                  }
                >
                  Open
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {upcoming.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upcoming posting schedule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {upcoming.map((u) => (
              <div
                key={u.scheduleId}
                className="flex flex-wrap justify-between gap-2 rounded-xl border border-slate-100 p-3 text-sm"
              >
                <span className="font-medium">{u.siteName}</span>
                <span className="text-slate-500">
                  {u.startDateBs} → {u.endDateBs} · {u.studentCount} students
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};

const AdminMonitoringPanel = () => {
  const monitoringQuery = useQuery({
    queryKey: ["field-duty", "monitoring"],
    queryFn: () =>
      unwrap<{
        overallAttendancePercent: number;
        pendingAttendance: number;
        submittedAttendance: number;
        missingAttendance: number;
        communityPostingAttendance: number;
        hospitalPostingAttendance: number;
        byCoordinator: Array<{
          coordinatorName: string;
          present: number;
          total: number;
          percent: number;
        }>;
        byBatch: Array<{ batchName: string; present: number; total: number; percent: number }>;
        byYear: Array<{ yearName: string; present: number; total: number; percent: number }>;
        byPosting: Array<{
          siteName: string;
          postingType: string;
          present: number;
          total: number;
          percent: number;
        }>;
        byDate: Array<{
          dateBs: string;
          present: number;
          absent: number;
          total: number;
          percent: number;
        }>;
      }>(api.get("/field-duty/monitoring")),
  });

  if (monitoringQuery.isLoading) return <LoadingState />;
  const m = monitoringQuery.data;
  if (!m) return null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Overall attendance %", value: `${m.overallAttendancePercent}%` },
          { label: "Pending today", value: m.pendingAttendance },
          { label: "Submitted today", value: m.submittedAttendance },
          { label: "Missing today", value: m.missingAttendance },
          { label: "Community/PHC marks", value: m.communityPostingAttendance },
          { label: "Hospital marks", value: m.hospitalPostingAttendance },
        ].map((c) => (
          <Card key={c.label}>
            <CardContent className="pt-4">
              <p className="text-xs text-slate-500">{c.label}</p>
              <p className="text-2xl font-semibold">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <MonitorTable
          title="Coordinator-wise"
          rows={m.byCoordinator.map((r) => ({
            label: r.coordinatorName,
            meta: `${r.present}/${r.total} · ${r.percent}%`,
          }))}
        />
        <MonitorTable
          title="Posting-wise"
          rows={m.byPosting.map((r) => ({
            label: `${r.siteName} (${r.postingType.replace(/_/g, " ")})`,
            meta: `${r.present}/${r.total} · ${r.percent}%`,
          }))}
        />
        <MonitorTable
          title="Batch-wise"
          rows={m.byBatch.map((r) => ({
            label: r.batchName,
            meta: `${r.present}/${r.total} · ${r.percent}%`,
          }))}
        />
        <MonitorTable
          title="Year-wise"
          rows={m.byYear.map((r) => ({
            label: r.yearName,
            meta: `${r.present}/${r.total} · ${r.percent}%`,
          }))}
        />
        <MonitorTable
          title="Date-wise"
          rows={m.byDate.slice(0, 14).map((r) => ({
            label: r.dateBs,
            meta: `P ${r.present} · A ${r.absent} · ${r.percent}%`,
          }))}
        />
      </div>
    </div>
  );
};

const MonitorTable = ({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; meta: string }>;
}) => (
  <Card>
    <CardHeader>
      <CardTitle className="text-base">{title}</CardTitle>
    </CardHeader>
    <CardContent className="max-h-64 space-y-1 overflow-y-auto">
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No data yet.</p>
      ) : (
        rows.map((r, i) => (
          <div
            key={`${r.label}-${i}`}
            className="flex items-center justify-between gap-2 border-b border-slate-100 py-1.5 text-sm last:border-0"
          >
            <span className="truncate font-medium">{r.label}</span>
            <span className="shrink-0 text-slate-500">{r.meta}</span>
          </div>
        ))
      )}
    </CardContent>
  </Card>
);

// silence unused import warning if tree-shaken oddly
void sectionLabel;
