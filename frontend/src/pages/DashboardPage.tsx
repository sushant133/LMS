import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  ClipboardList,
  GraduationCap,
  Megaphone,
  Receipt,
  Sparkles,
  Users,
  Wallet
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTranslation } from "react-i18next";
import {
  isInstitutionAdmin,
  type DashboardHighlight,
  type DashboardMetric,
  type DashboardNotificationItem,
  type DashboardResponse,
  type NoticeRecord
} from "@phit-erp/shared";
import { useAuth } from "features/auth/AuthProvider";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { PageContent } from "components/layout/PageContent";
import { LoadingState } from "components/shared/LoadingState";
import { StudentNameLink } from "components/shared/StudentNameLink";
import { api, unwrap } from "lib/api";
import { getCollegeDisplayName, roleLabelMap } from "lib/auth";
import { DashboardBannerStrip } from "features/notices/DashboardBannerStrip";
import { cn, formatCurrencyNpr } from "lib/utils";

const INSTITUTION_MIX_COLORS = ["#10b981", "#3b82f6", "#f59e0b"];

const statIconMap: Record<string, typeof Users> = {
  Students: Users,
  Teachers: GraduationCap,
  Batches: BookOpen,
  Classes: BookOpen,
  Notices: Megaphone,
  "Unread Alerts": Bell,
  "Enrolled Subjects": BookOpen,
  "Attendance Days": CalendarDays,
  "Visible Notices": Megaphone,
  "Assigned Batches": BookOpen,
  "Assigned Classes": BookOpen,
  "Assigned Subjects": ClipboardList,
  "Linked Children": Users,
  "Children with Fees Due": Wallet,
  "Fee Entries": Receipt
};

const highlightToneClass: Record<NonNullable<DashboardHighlight["tone"]>, string> = {
  default: "border-slate-200 bg-white",
  info: "border-sky-200 bg-sky-50/70",
  success: "border-emerald-200 bg-emerald-50/70",
  warning: "border-amber-200 bg-amber-50/70"
};

const formatNotificationTime = (value?: string): string => {
  if (!value) {
    return "Recently";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Recently";
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
};

const DashboardHero = ({
  title,
  description,
  userName,
  roleLabel,
  institutionName,
  unreadCount
}: {
  title: string;
  description: string;
  userName: string;
  roleLabel: string;
  institutionName?: string;
  unreadCount: number;
}) => (
  <section className="overflow-hidden rounded-3xl border border-emerald-100 bg-[linear-gradient(135deg,_#ecfdf5_0%,_#ffffff_45%,_#eff6ff_100%)] p-6 shadow-sm md:p-8">
    <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-emerald-600 text-white">{roleLabel}</Badge>
          {unreadCount > 0 ? (
            <Badge className="bg-amber-100 text-amber-800">
              {unreadCount} unread notification{unreadCount === 1 ? "" : "s"}
            </Badge>
          ) : null}
        </div>
        <div>
          <p className="text-sm font-medium text-emerald-800">{title}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 md:text-4xl">
            Welcome back, {userName}
          </h1>
          {institutionName ? <p className="mt-2 text-sm font-medium text-slate-600">{institutionName}</p> : null}
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">{description}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link to="/notifications">
            <Bell className="mr-2 h-4 w-4" />
            Notifications
          </Link>
        </Button>
        <Button asChild>
          <Link to="/notices">
            <Megaphone className="mr-2 h-4 w-4" />
            Notice Board
          </Link>
        </Button>
      </div>
    </div>
  </section>
);

const StatGrid = ({ stats }: { stats: DashboardMetric[] }) => (
  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    {stats.map((stat) => {
      const Icon = statIconMap[stat.label] ?? Sparkles;
      return (
        <Card key={stat.label} className="overflow-hidden border-slate-200/80 shadow-sm">
          <CardContent className="flex items-start justify-between gap-4 py-5">
            <div>
              <p className="text-sm font-medium text-slate-500">{stat.label}</p>
              <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{stat.value}</p>
              {stat.change ? <p className="mt-1 text-xs text-emerald-700">{stat.change}</p> : null}
            </div>
            <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700">
              <Icon className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      );
    })}
  </div>
);

const HighlightsRow = ({ highlights }: { highlights: DashboardHighlight[] }) => {
  if (highlights.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {highlights.map((highlight) => {
        const content = (
          <Card className={cn("h-full border shadow-sm transition hover:shadow-md", highlightToneClass[highlight.tone ?? "default"])}>
            <CardContent className="flex items-center justify-between gap-4 py-5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-500">{highlight.label}</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{highlight.value}</p>
              </div>
              {highlight.href ? <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" /> : null}
            </CardContent>
          </Card>
        );

        return highlight.href ? (
          <Link key={`${highlight.label}-${highlight.value}`} to={highlight.href} className="block">
            {content}
          </Link>
        ) : (
          <div key={`${highlight.label}-${highlight.value}`}>{content}</div>
        );
      })}
    </div>
  );
};

const NotificationsPanel = ({
  notifications,
  unreadCount
}: {
  notifications: DashboardNotificationItem[];
  unreadCount: number;
}) => (
  <Card className="border-slate-200/80 shadow-sm">
    <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
      <div>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-emerald-700" />
          Latest Notifications
        </CardTitle>
        <p className="mt-1 text-sm text-slate-500">Recent alerts for attendance, fees, assignments, and notices.</p>
      </div>
      {unreadCount > 0 ? <Badge className="bg-amber-100 text-amber-800">{unreadCount} unread</Badge> : null}
    </CardHeader>
    <CardContent className="space-y-3">
      {notifications.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
          No notifications yet. Important updates will appear here.
        </div>
      ) : (
        notifications.map((notification) => (
          <div
            key={notification._id}
            className={cn(
              "rounded-2xl border px-4 py-3",
              notification.read ? "border-slate-200 bg-slate-50/60" : "border-emerald-200 bg-emerald-50/50"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-slate-900">{notification.title}</p>
                  <Badge>{notification.type}</Badge>
                  {!notification.read ? <Badge className="bg-emerald-600 text-white">New</Badge> : null}
                </div>
                <p className="mt-1 text-sm leading-6 text-slate-600">{notification.message}</p>
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">{formatNotificationTime(notification.createdAt)}</p>
          </div>
        ))
      )}
      <Button asChild variant="outline" className="w-full">
        <Link to="/notifications">View all notifications</Link>
      </Button>
    </CardContent>
  </Card>
);

const NoticesPanel = ({ notices, title }: { notices: NoticeRecord[]; title?: string }) => (
  <Card className="border-slate-200/80 shadow-sm">
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <Megaphone className="h-5 w-5 text-emerald-700" />
        {title ?? "Notice Board"}
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-3">
      {notices.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
          No notices published right now.
        </div>
      ) : (
        notices.map((notice) => (
          <div key={notice._id} className="rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-4">
              <h3 className="font-semibold text-slate-900">{notice.title}</h3>
              <Badge>{notice.publishDateBs}</Badge>
            </div>
            <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{notice.content}</p>
          </div>
        ))
      )}
      <Button asChild variant="outline" className="w-full">
        <Link to="/notices">Open notice board</Link>
      </Button>
    </CardContent>
  </Card>
);

const QuickActions = ({ actions }: { actions: Array<{ label: string; href: string }> }) => (
  <div className="flex flex-wrap gap-2">
    {actions.map((action) => (
      <Button key={action.href} asChild variant="outline" size="sm">
        <Link to={action.href}>{action.label}</Link>
      </Button>
    ))}
  </div>
);

export const DashboardPage = () => {
  const { role } = useParams();
  const { t } = useTranslation();
  const { user, activeSchoolId, availableSchools } = useAuth();
  const dashboardQuery = useQuery({
    queryKey: ["dashboard", activeSchoolId],
    queryFn: () => unwrap<DashboardResponse>(api.get("/dashboard")),
    enabled: Boolean(user)
  });

  if (dashboardQuery.isLoading) {
    return <LoadingState />;
  }

  if (dashboardQuery.isError) {
    return (
      <PageContent className="space-y-4">
        <DashboardHero
          title="Dashboard unavailable"
          description="We could not load your dashboard data. Your session may have expired."
          userName={user?.fullName ?? "User"}
          roleLabel={roleLabelMap[user?.role ?? "STUDENT"] ?? "User"}
          unreadCount={0}
        />
        <Card>
          <CardContent className="py-8 text-center text-sm text-slate-600">
            Please try logging in again. If the problem persists, contact the system administrator.
          </CardContent>
        </Card>
      </PageContent>
    );
  }

  const data = dashboardQuery.data;
  if (!data || !user) {
    return <LoadingState />;
  }

  const institutionName = getCollegeDisplayName(availableSchools, user);
  const roleLabel = roleLabelMap[user.role] ?? user.role;
  const unreadCount = data.unreadNotificationCount ?? 0;

  if (user.role === "COLLEGE_STAFF") {
    return (
      <PageContent className="space-y-6">
        <DashboardBannerStrip banners={data.banners} />
        <DashboardHero
          title="Staff Dashboard"
          description="College announcements, notifications, and operational updates relevant to your role."
          userName={user.fullName}
          roleLabel={roleLabel}
          institutionName={institutionName}
          unreadCount={unreadCount}
        />
        <StatGrid stats={data.stats} />
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <NotificationsPanel notifications={data.notifications} unreadCount={unreadCount} />
          <NoticesPanel notices={data.notices} />
        </div>
      </PageContent>
    );
  }

  if (user.role === "STUDENT") {
    return (
      <PageContent className="space-y-6">
        <DashboardBannerStrip banners={data.banners} />
        <DashboardHero
          title="Student Dashboard"
          description="Track your subjects, attendance trend, fee status, assignments, and college alerts in one place."
          userName={user.fullName}
          roleLabel={roleLabel}
          institutionName={institutionName}
          unreadCount={unreadCount}
        />
        <StatGrid stats={data.stats} />
        <HighlightsRow highlights={data.highlights} />
        <QuickActions
          actions={[
            { label: "My Subjects", href: "/my-subjects" },
            { label: "Assignments", href: "/homework-view" },
            { label: "My Fees", href: "/my-fees" },
            { label: "My Library", href: "/my-library" },
            { label: "Exams", href: "/exams" }
          ]}
        />
        <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
          <Card className="border-slate-200/80 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-emerald-700" />
                Attendance Trend
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[300px]">
              {data.attendanceChart.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  Attendance records will appear here once classes are marked.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.attendanceChart}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="present" fill="#10b981" radius={[10, 10, 0, 0]} />
                    <Bar dataKey="absent" fill="#fb7185" radius={[10, 10, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          <div className="space-y-6">
            <NotificationsPanel notifications={data.notifications} unreadCount={unreadCount} />
            <NoticesPanel notices={data.notices} />
          </div>
        </div>
      </PageContent>
    );
  }

  if (user.role === "PARENT") {
    return (
      <PageContent className="space-y-6">
        <DashboardBannerStrip banners={data.banners} />
        <DashboardHero
          title="Parent Dashboard"
          description="Monitor your children's attendance, fees, assignments, and college notifications from one professional overview."
          userName={user.fullName}
          roleLabel={roleLabel}
          institutionName={institutionName}
          unreadCount={unreadCount}
        />
        <StatGrid stats={data.stats} />
        <HighlightsRow highlights={data.highlights} />
        <QuickActions
          actions={[
            { label: "Parent Portal", href: "/parent-portal" },
            { label: "Assignments", href: "/homework-view" },
            { label: "Exams", href: "/exams" },
            { label: "Notices", href: "/notices" }
          ]}
        />
        {(data.children ?? []).length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {(data.children ?? []).map((child) => (
              <Card key={child.studentId} className="border-slate-200/80 shadow-sm">
                <CardContent className="py-5">
                  <p className="text-sm text-slate-500">Linked child</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">
                    <StudentNameLink studentId={child.studentId} name={child.fullName} />
                  </p>
                  <p className="mt-3 text-sm text-slate-600">
                    Fees due: <span className="font-semibold text-slate-900">{formatCurrencyNpr(child.feesDueNpr)}</span>
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : null}
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <NotificationsPanel notifications={data.notifications} unreadCount={unreadCount} />
          <NoticesPanel notices={data.notices} />
        </div>
      </PageContent>
    );
  }

  const isCollegeAdmin = isInstitutionAdmin(user.role);
  const isTeacher = user.role === "TEACHER";

  return (
    <PageContent className="space-y-6">
      <DashboardBannerStrip banners={data.banners} />
      <DashboardHero
        title={`${t("dashboard")} / ${role ?? "overview"}`}
        description={
          isCollegeAdmin
            ? "Institution-wide overview with student volume, fee health, attendance trends, notices, and the latest operational alerts."
            : isTeacher
              ? "Your teaching command center for classes, attendance, assignments, exams, and college communication."
              : "Role-based overview with attendance trends, notices, and the latest notifications."
        }
        userName={user.fullName}
        roleLabel={roleLabel}
        institutionName={institutionName}
        unreadCount={unreadCount}
      />

      <StatGrid stats={data.stats} />
      <HighlightsRow highlights={data.highlights} />

      {isCollegeAdmin ? (
        <QuickActions
          actions={[
            { label: "Students", href: "/students" },
            { label: "Attendance", href: "/attendance-view" },
            { label: "Fee Collection", href: "/accounting" },
            { label: "Exams & Results", href: "/exams-view" },
            { label: "IEMIS Reports", href: "/reports" },
            { label: "Parent Links", href: "/parent-links" }
          ]}
        />
      ) : null}

      {isTeacher ? (
        <QuickActions
          actions={[
            { label: "Mark Attendance", href: "/attendance" },
            { label: "Assignments", href: "/homework" },
            { label: "Timetable", href: "/timetable" },
            { label: "Exams", href: "/exams" }
          ]}
        />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.45fr_0.55fr]">
        <div className="space-y-6">
          <Card className="border-slate-200/80 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-emerald-700" />
                Attendance Trend
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[320px]">
              {data.attendanceChart.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  Attendance analytics will appear once records are available for your scope.
                </div>
              ) : (
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
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {isCollegeAdmin ? (
              <Card className="border-slate-200/80 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Wallet className="h-5 w-5 text-emerald-700" />
                    Fee Collection
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.feeChart.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                      Fee collection summaries will appear after payments are recorded.
                    </div>
                  ) : (
                    data.feeChart.map((item) => (
                      <div key={item.label} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                        <span className="font-medium text-slate-700">BS {item.label}</span>
                        <Badge>{formatCurrencyNpr(item.amount)}</Badge>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            ) : null}

            {data.counts.length > 0 ? (
              <Card className="border-slate-200/80 shadow-sm">
                <CardHeader>
                  <CardTitle>{isTeacher ? "Teaching Load" : "Institution Mix"}</CardTitle>
                </CardHeader>
                <CardContent className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={data.counts} dataKey="value" nameKey="name" outerRadius={95} label>
                        {data.counts.map((entry, index) => (
                          <Cell key={entry.name} fill={INSTITUTION_MIX_COLORS[index % INSTITUTION_MIX_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>

        <div className="space-y-6">
          <NotificationsPanel notifications={data.notifications} unreadCount={unreadCount} />
          <NoticesPanel notices={data.notices} title={t("noticeBoard")} />
        </div>
      </div>
    </PageContent>
  );
};