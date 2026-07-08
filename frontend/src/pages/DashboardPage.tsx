import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
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
  hasInstitutionAccess,
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
import { StudentNameLink } from "components/shared/StudentNameLink";
import { api, unwrap } from "lib/api";
import { getCollegeDisplayName, roleLabelMap } from "lib/auth";
import { FeeDuesPanel } from "features/dashboard/FeeDuesPanel";
import { DashboardBannerPopup } from "features/notices/DashboardBannerPopup";
import { useNotificationBadge } from "hooks/useNotificationBadge";
import { applyNotificationReadLocally, invalidateNotificationQueries } from "lib/notificationQueries";
import { cn, formatCurrencyNpr } from "lib/utils";

const INSTITUTION_MIX_COLORS = ["#0c2d6b", "#3b82f6", "#f59e0b"];

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
  success: "border-brand-200 bg-brand-50/70",
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
  <section className="overflow-hidden rounded-3xl border border-brand-100 bg-[linear-gradient(135deg,_#eef3fb_0%,_#ffffff_45%,_#eff6ff_100%)] p-6 shadow-sm md:p-8">
    <div className="flex flex-col gap-5 lg:min-h-[11.5rem] lg:flex-row lg:items-start lg:justify-between lg:gap-8">
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex min-h-7 flex-wrap items-center gap-2">
          <Badge className="shrink-0 bg-brand-600 text-white">{roleLabel}</Badge>
          <Badge
            className={cn(
              "shrink-0 bg-amber-100 text-amber-800 transition-opacity",
              unreadCount > 0 ? "opacity-100" : "pointer-events-none opacity-0"
            )}
            aria-hidden={unreadCount === 0}
          >
            {unreadCount > 0
              ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
              : "No unread notifications"}
          </Badge>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-brand-800">{title}</p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl md:text-4xl">
            Welcome back, {userName}
          </h1>
          <p className="min-h-5 text-sm font-medium text-slate-600">{institutionName ?? "\u00A0"}</p>
          <p className="max-w-2xl text-sm leading-6 text-slate-600">{description}</p>
        </div>
      </div>
      <div className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto lg:pt-1">
        <Button asChild variant="outline" className="min-w-[9.75rem] justify-center">
          <Link to="/notifications">
            <Bell className="mr-2 h-4 w-4 shrink-0" />
            Notifications
          </Link>
        </Button>
        <Button asChild variant="outline" className="min-w-[9.75rem] justify-center">
          <Link to="/notices">
            <Megaphone className="mr-2 h-4 w-4 shrink-0" />
            Notice Board
          </Link>
        </Button>
      </div>
    </div>
  </section>
);

const DashboardHeroSkeleton = () => (
  <section className="overflow-hidden rounded-3xl border border-brand-100 bg-[linear-gradient(135deg,_#eef3fb_0%,_#ffffff_45%,_#eff6ff_100%)] p-6 shadow-sm md:p-8">
    <div className="flex flex-col gap-5 lg:min-h-[11.5rem] lg:flex-row lg:items-start lg:justify-between lg:gap-8">
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex min-h-7 gap-2">
          <div className="h-6 w-36 animate-pulse rounded-full bg-brand-100" />
        </div>
        <div className="space-y-2">
          <div className="h-4 w-40 animate-pulse rounded bg-brand-50" />
          <div className="h-9 w-3/4 max-w-lg animate-pulse rounded bg-slate-100" />
          <div className="h-4 w-56 animate-pulse rounded bg-slate-100" />
          <div className="h-16 w-full max-w-2xl animate-pulse rounded bg-slate-50" />
        </div>
      </div>
      <div className="flex w-full shrink-0 gap-2 sm:w-auto lg:pt-1">
        <div className="h-10 min-w-[9.75rem] flex-1 animate-pulse rounded-xl bg-slate-100 sm:flex-none" />
        <div className="h-10 min-w-[9.75rem] flex-1 animate-pulse rounded-xl bg-slate-100 sm:flex-none" />
      </div>
    </div>
  </section>
);

const StatGrid = ({ stats }: { stats: DashboardMetric[] }) => (
  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    {stats.map((stat) => {
      const Icon = statIconMap[stat.label] ?? Sparkles;
      const content = (
        <Card className="overflow-hidden border-slate-200/80 shadow-sm transition hover:shadow-md">
          <CardContent className="flex items-start justify-between gap-4 py-5">
            <div>
              <p className="text-sm font-medium text-slate-500">{stat.label}</p>
              <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{stat.value}</p>
              {stat.change ? <p className="mt-1 text-xs text-brand-700">{stat.change}</p> : null}
            </div>
            <div className="rounded-2xl bg-brand-50 p-3 text-brand-700">
              <Icon className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      );

      if (stat.label === "Unread Alerts") {
        return (
          <Link key={stat.label} to="/notifications" className="block">
            {content}
          </Link>
        );
      }

      return <div key={stat.label}>{content}</div>;
    })}
  </div>
);

const HighlightsRow = ({
  highlights,
  onAction
}: {
  highlights: DashboardHighlight[];
  onAction?: (action: NonNullable<DashboardHighlight["action"]>) => void;
}) => {
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
              {highlight.href || highlight.action ? <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" /> : null}
            </CardContent>
          </Card>
        );

        if (highlight.action) {
          return (
            <button
              key={`${highlight.label}-${highlight.value}`}
              type="button"
              className="block w-full text-left"
              onClick={() => onAction?.(highlight.action!)}
            >
              {content}
            </button>
          );
        }

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
}) => {
  const unreadNotifications = notifications.filter((notification) => !notification.read);

  const markRead = useMutation({
    mutationFn: (id: string) => unwrap(api.put(`/notifications/${id}/read`)),
    onMutate: (id) => {
      applyNotificationReadLocally(id);
    },
    onError: async () => {
      await invalidateNotificationQueries();
    },
    onSettled: async () => {
      await invalidateNotificationQueries();
    }
  });

  const markAllRead = useMutation({
    mutationFn: () => unwrap(api.put("/notifications/read-all")),
    onMutate: () => {
      applyNotificationReadLocally();
    },
    onError: async () => {
      await invalidateNotificationQueries();
    },
    onSettled: async () => {
      await invalidateNotificationQueries();
    }
  });

  return (
    <Card className="border-slate-200/80 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-brand-700" />
            Latest Notifications
          </CardTitle>
          <p className="mt-1 text-sm text-slate-500">Unread alerts for attendance, fees, assignments, and notices.</p>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 ? <Badge className="bg-amber-100 text-amber-800">{unreadCount} unread</Badge> : null}
          {unreadCount > 0 ? (
            <Button size="sm" variant="secondary" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
              Mark all read
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {unreadNotifications.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
            You&apos;re all caught up. No unread notifications.
          </div>
        ) : (
          unreadNotifications.map((notification) => (
            <button
              key={notification._id}
              type="button"
              className={cn(
                "w-full rounded-2xl border px-4 py-3 text-left transition hover:shadow-sm",
                "border-brand-200 bg-brand-50/50"
              )}
              onClick={() => markRead.mutate(notification._id)}
              disabled={markRead.isPending}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-900">{notification.title}</p>
                    <Badge>{notification.type}</Badge>
                    <Badge className="bg-brand-600 text-white">New</Badge>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{notification.message}</p>
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-500">{formatNotificationTime(notification.createdAt)}</p>
            </button>
          ))
        )}
        <Button asChild variant="outline" className="w-full">
          <Link to="/notifications">View all notifications</Link>
        </Button>
      </CardContent>
    </Card>
  );
};

const NoticesPanel = ({ notices, title }: { notices: NoticeRecord[]; title?: string }) => (
  <Card className="border-slate-200/80 bg-white shadow-sm">
    <CardHeader className="bg-white">
      <CardTitle className="flex items-center gap-2">
        <Megaphone className="h-5 w-5 text-slate-500" />
        {title ?? "Notice Board"}
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-3 bg-white">
      {notices.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
          No notices published right now.
        </div>
      ) : (
        notices.map((notice) => (
          <div key={notice._id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-4">
              <h3 className="font-semibold text-slate-900">{notice.title}</h3>
              <span className="shrink-0 text-xs text-slate-500">{notice.publishDateBs}</span>
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
  const { t } = useTranslation();
  const { user, activeSchoolId, availableSchools } = useAuth();
  const { unreadCount: liveUnreadCount } = useNotificationBadge();
  const [feeDuesOpen, setFeeDuesOpen] = useState(false);
  const dashboardQuery = useQuery({
    queryKey: ["dashboard", activeSchoolId],
    queryFn: () => unwrap<DashboardResponse>(api.get("/dashboard")),
    enabled: Boolean(user),
    placeholderData: keepPreviousData,
    staleTime: 60_000
  });

  const isInitialDashboardLoad = dashboardQuery.isPending && !dashboardQuery.data;

  if (isInitialDashboardLoad) {
    return (
      <PageContent className="space-y-6">
        <DashboardHeroSkeleton />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white" />
          ))}
        </div>
      </PageContent>
    );
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
    return (
      <PageContent className="space-y-6">
        <DashboardHeroSkeleton />
      </PageContent>
    );
  }

  const institutionName = getCollegeDisplayName(availableSchools, user);
  const roleLabel = roleLabelMap[user.role] ?? user.role;
  const unreadCount = liveUnreadCount;
  const statsWithLiveUnread = data.stats.map((stat) =>
    stat.label === "Unread Alerts" ? { ...stat, value: liveUnreadCount } : stat
  );

  if (user.role === "COLLEGE_STAFF") {
    return (
      <PageContent className="space-y-6">
        <DashboardBannerPopup banners={data.banners} />
        <DashboardHero
          title="Staff Dashboard"
          description="College announcements, notifications, and operational updates relevant to your role."
          userName={user.fullName}
          roleLabel={roleLabel}
          institutionName={institutionName}
          unreadCount={unreadCount}
        />
        <StatGrid stats={statsWithLiveUnread} />
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
        <DashboardBannerPopup banners={data.banners} />
        <DashboardHero
          title="Student Dashboard"
          description="Track your subjects, attendance trend, fee status, assignments, and college alerts in one place."
          userName={user.fullName}
          roleLabel={roleLabel}
          institutionName={institutionName}
          unreadCount={unreadCount}
        />
        <StatGrid stats={statsWithLiveUnread} />
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
                <BarChart3 className="h-5 w-5 text-brand-700" />
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
                    <Bar dataKey="present" fill="#0c2d6b" radius={[10, 10, 0, 0]} />
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
        <DashboardBannerPopup banners={data.banners} />
        <DashboardHero
          title="Parent Dashboard"
          description="Monitor your children's attendance, fees, assignments, and college notifications from one professional overview."
          userName={user.fullName}
          roleLabel={roleLabel}
          institutionName={institutionName}
          unreadCount={unreadCount}
        />
        <StatGrid stats={statsWithLiveUnread} />
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

  const isCollegeAdmin = hasInstitutionAccess(user.role);
  const isTeacher = user.role === "TEACHER";

  const handleHighlightAction = (action: NonNullable<DashboardHighlight["action"]>) => {
    if (action === "fee-dues") {
      setFeeDuesOpen(true);
    }
  };

  return (
    <PageContent className="space-y-6">
      <DashboardBannerPopup banners={data.banners} />
      <DashboardHero
        title={`${t("dashboard")} · ${roleLabel}`}
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

      <StatGrid stats={statsWithLiveUnread} />
      <HighlightsRow highlights={data.highlights} onAction={isCollegeAdmin ? handleHighlightAction : undefined} />
      <FeeDuesPanel open={feeDuesOpen && isCollegeAdmin} onClose={() => setFeeDuesOpen(false)} />

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
                <BarChart3 className="h-5 w-5 text-brand-700" />
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
                    <Bar dataKey="present" fill="#0c2d6b" radius={[12, 12, 0, 0]} />
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
                    <Wallet className="h-5 w-5 text-brand-700" />
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