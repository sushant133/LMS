import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTranslation } from "react-i18next";
import type { DashboardResponse } from "@nepal-school-erp/shared";
import { useAuth } from "features/auth/AuthProvider";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { PageContent } from "components/layout/PageContent";
import { LoadingState } from "components/shared/LoadingState";
import { PageHeader } from "components/shared/PageHeader";
import { api, unwrap } from "lib/api";
import { getSchoolDisplayName } from "lib/auth";
import { formatCurrencyNpr } from "lib/utils";

export const DashboardPage = () => {
  const { role } = useParams();
  const { t } = useTranslation();
  const { user, activeSchoolId, availableSchools } = useAuth();
  const dashboardQuery = useQuery({
    queryKey: ["dashboard", activeSchoolId],
    queryFn: () => unwrap<DashboardResponse>(api.get("/dashboard")),
    enabled: Boolean(user && (user.role !== "SUPER_ADMIN" || activeSchoolId))
  });

  if (user?.role === "SUPER_ADMIN" && !activeSchoolId) {
    return (
      <div className="space-y-6">
        <PageHeader title={`${t("dashboard")} / ${role ?? "overview"}`} description="Select a school context to view isolated tenant metrics, or open the school directory to create a new tenant." />
        <Card>
          <CardContent className="py-10 text-center">
            <h2 className="text-2xl font-semibold text-slate-900">Choose a school to continue</h2>
            <p className="mt-3 text-sm text-slate-600">Use the selector in the top bar to enter a school context. Super admin school creation is available from the school directory.</p>
            <Button className="mt-5" asChild>
              <Link to="/schools">Open School Directory</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (dashboardQuery.isLoading) {
    return <LoadingState />;
  }

  if (dashboardQuery.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title={t("dashboard")} description="We could not load your dashboard data. Your session may have expired." />
        <Card>
          <CardContent className="py-8 text-center text-sm text-slate-600">
            Please try logging in again. Demo student: student01@demoerp.nepal-school.com / Demo@123456
          </CardContent>
        </Card>
      </div>
    );
  }

  const data = dashboardQuery.data;
  if (!data) {
    return <LoadingState />;
  }

  if (user?.role === "STUDENT") {
    const schoolName = getSchoolDisplayName(availableSchools, user);

    return (
      <PageContent className="space-y-6">
        <PageHeader title="Student Dashboard" description="View your enrolled subjects, attendance, marks, and assignments." />
        <Card>
          <CardContent className="flex flex-col gap-4 py-8 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm text-slate-500">Welcome back</p>
              <p className="text-2xl font-semibold text-slate-900">{user.fullName}</p>
              <p className="mt-1 text-sm font-medium text-emerald-700">{schoolName}</p>
              <p className="mt-1 text-sm text-slate-600">{data.stats.map((stat) => `${stat.label}: ${stat.value}`).join(" · ")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link to="/homework-view">Assignments & CAS Stream</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/my-library">My Library</Link>
              </Button>
              <Button asChild>
                <Link to="/my-subjects">Open My Subjects</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </PageContent>
    );
  }

  const isSchoolAdmin = user?.role === "SCHOOL_ADMIN";
  const isAdminLike = user?.role === "SCHOOL_ADMIN" || user?.role === "SUPER_ADMIN";
  const isTeacher = user?.role === "TEACHER";

  return (
    <div className="space-y-6">
      <PageHeader 
        title={`${t("dashboard")} / ${role ?? "overview"}`} 
        description={
          isSchoolAdmin
            ? "Welcome back! Here's a quick overview of your school."
            : isTeacher
              ? "Your teaching overview: assigned classes, attendance trends, and school notices."
              : "Role-based overview of attendance, student volume, and recent notices."
        } 
      />

      {isSchoolAdmin && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-emerald-700">Currently managing</p>
              <p className="text-lg font-semibold text-emerald-950">
                {getSchoolDisplayName(availableSchools, user)}
              </p>
            </div>
            <div className="text-xs text-emerald-600">
              Academic Year: {data.stats.find(s => s.label.includes("Year"))?.value || "Current"}
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.stats.map((stat) => (
          <Card key={stat.label} className="overflow-hidden bg-[linear-gradient(135deg,_white_0%,_#ecfdf5_100%)]">
            <CardContent className="py-6">
              <p className="text-sm text-slate-500">{stat.label}</p>
              <p className="mt-2 text-3xl font-semibold text-slate-900">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {isSchoolAdmin && (
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="outline" size="sm">
            <Link to="/attendance-view">View Attendance</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/fees">Record Fee Collection</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/exams-view">View Exams & Results</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/reports">IEMIS Reports</Link>
          </Button>
        </div>
      )}

      {isTeacher && (
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="outline" size="sm">
            <Link to="/attendance">Mark Attendance</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/homework">Assignments</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/timetable">Timetable</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/exams">Exams & Results</Link>
          </Button>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <Card>
          <CardHeader>
            <CardTitle>Attendance Trend</CardTitle>
          </CardHeader>
          <CardContent className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.attendanceChart}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="present" fill="#10b981" radius={[12, 12, 0, 0]} />
                <Bar dataKey="absent" fill="#fb7185" radius={[12, 12, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {data.counts.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{isTeacher ? "Teaching Load" : "Institution Mix"}</CardTitle>
            </CardHeader>
            <CardContent className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.counts} dataKey="value" nameKey="name" outerRadius={110} fill="#0f766e" label />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div className={isAdminLike ? "grid gap-6 xl:grid-cols-[1fr_1fr]" : "grid gap-6"}>
        {isAdminLike ? (
          <Card>
            <CardHeader>
              <CardTitle>Fee Collection</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.feeChart.map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                  <span className="font-medium text-slate-700">{item.label}</span>
                  <Badge>{formatCurrencyNpr(item.amount)}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>{t("noticeBoard")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.notices.map((notice) => (
              <div key={notice._id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-4">
                  <h3 className="font-semibold text-slate-900">{notice.title}</h3>
                  <Badge>{notice.publishDateBs}</Badge>
                </div>
                <p className="mt-2 text-sm text-slate-600">{notice.content}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
