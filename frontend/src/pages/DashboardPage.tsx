import type { ReactNode } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
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
  COLLEGE_STAFF_CATEGORY_LABELS,
  hasInstitutionAccess,
  type CollegeStaffCategory,
  type CollegeStaffRecord,
  type DashboardHighlight,
  type DashboardMetric,
  type DashboardNotificationItem,
  type DashboardResponse,
  type NoticeRecord,
  type UserProfile
} from "@phit-erp/shared";
import { useAuth } from "features/auth/AuthProvider";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { PageContent } from "components/layout/PageContent";
import { StudentNameLink } from "components/shared/StudentNameLink";
import { api, unwrap } from "lib/api";
import { appConfig } from "lib/config";
import {
  getCollegeDisplayName,
  getUserDisplayTitle,
  getUserRoleSubtitle,
  roleLabelMap,
} from "lib/auth";
import { AcademicCalendarWidgets } from "features/dashboard/AcademicCalendarWidgets";
import { DashboardSchedulePanels } from "features/dashboard/DashboardSchedulePanels";
import { DashboardBannerPopup } from "features/notices/DashboardBannerPopup";
import { useNotificationBadge } from "hooks/useNotificationBadge";
import { applyNotificationReadLocally, invalidateNotificationQueries } from "lib/notificationQueries";
import { cn, formatCurrencyNpr } from "lib/utils";

const INSTITUTION_MIX_COLORS = ["#0c2d6b", "#3b82f6", "#f59e0b"];
/** Male / Female / Other pie colors */
const GENDER_CHART_COLORS: Record<string, string> = {
  Male: "#2563eb",
  Female: "#db2777",
  "Other / Unset": "#94a3b8",
  Other: "#94a3b8",
};

/** Ethnicity category palette (stable by index for unknown labels) */
const ETHNICITY_CHART_COLORS = [
  "#0c2d6b",
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#ea580c",
  "#059669",
  "#ca8a04",
  "#64748b",
  "#0891b2",
];

const ethnicityColor = (name: string, index: number): string => {
  const fixed: Record<string, string> = {
    "Brahmin / Chhetri": "#0c2d6b",
    Dalit: "#7c3aed",
    "Janajati / Indigenous": "#059669",
    Madhesi: "#ea580c",
    Muslim: "#0891b2",
    Other: "#ca8a04",
    "Prefer not to say": "#94a3b8",
    Unset: "#cbd5e1",
  };
  return fixed[name] ?? ETHNICITY_CHART_COLORS[index % ETHNICITY_CHART_COLORS.length]!;
};

type BreakdownSlice = { name: string; value: number };

/** Clean donut + legend with full category names (Male, Female, Madhesi, …). */
const BreakdownDonutCard = ({
  title,
  scope,
  icon,
  data,
  colorFor,
  emptyMessage,
}: {
  title: string;
  scope?: string;
  icon: ReactNode;
  data: BreakdownSlice[];
  colorFor: (name: string, index: number) => string;
  emptyMessage: string;
}) => {
  const slices = data.filter((s) => s.value > 0);
  const total = data.reduce((sum, s) => sum + s.value, 0);
  const hasData = slices.length > 0 && total > 0;

  /** Full word labels on slices large enough to read (e.g. "Male", "Madhesi"). */
  const renderSliceLabel = (props: {
    cx?: number;
    cy?: number;
    midAngle?: number;
    outerRadius?: number;
    percent?: number;
    name?: string;
    value?: number;
  }) => {
    const { cx = 0, cy = 0, midAngle = 0, outerRadius = 0, percent = 0, name = "", value = 0 } =
      props;
    // Hide only tiny slivers so short labels stay readable
    if (percent < 0.04 || !name) return null;
    const RADIAN = Math.PI / 180;
    const radius = outerRadius + 18;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    return (
      <text
        x={x}
        y={y}
        fill="#334155"
        textAnchor={x > cx ? "start" : "end"}
        dominantBaseline="central"
        className="text-[11px] font-semibold"
      >
        {`${name} (${value})`}
      </text>
    );
  };

  return (
    <Card className="border-slate-200/80 shadow-sm">
      <CardHeader className="space-y-1 pb-2">
        <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
          {icon}
          {title}
        </CardTitle>
        {scope ? (
          <p className="text-xs font-normal text-slate-500 sm:text-sm">{scope}</p>
        ) : null}
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex h-[220px] items-center justify-center text-sm text-slate-500">
            {emptyMessage}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Extra height so full-word labels outside the ring are not clipped */}
            <div className="relative mx-auto h-[240px] w-full max-w-[320px] sm:h-[260px] sm:max-w-[360px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 20, right: 28, bottom: 20, left: 28 }}>
                  <Pie
                    data={slices}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius="62%"
                    innerRadius="40%"
                    paddingAngle={slices.length > 1 ? 3 : 0}
                    stroke="#ffffff"
                    strokeWidth={2}
                    isAnimationActive={false}
                    label={renderSliceLabel}
                    labelLine={{
                      stroke: "#94a3b8",
                      strokeWidth: 1,
                    }}
                  >
                    {slices.map((entry, index) => (
                      <Cell
                        key={entry.name}
                        fill={colorFor(entry.name, index)}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid #e2e8f0",
                      fontSize: 13,
                    }}
                    formatter={(value: number | string, name: string) => {
                      const n = typeof value === "number" ? value : Number(value);
                      const pct =
                        total > 0 ? ((n / total) * 100).toFixed(0) : "0";
                      // Keep full category name in tooltip (Male, Female, Madhesi, …)
                      return [`${n} student${n === 1 ? "" : "s"} (${pct}%)`, name];
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  Total
                </span>
                <span className="text-2xl font-bold tabular-nums text-slate-900">
                  {total}
                </span>
              </div>
            </div>

            {/* Full-word legend — never truncated */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {slices.map((entry, index) => {
                const pct =
                  total > 0 ? Math.round((entry.value / total) * 100) : 0;
                return (
                  <div
                    key={entry.name}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white"
                        style={{ backgroundColor: colorFor(entry.name, index) }}
                      />
                      <span className="text-sm font-semibold text-slate-800 whitespace-normal">
                        {entry.name}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-baseline gap-1.5">
                      <span className="text-sm font-bold tabular-nums text-slate-900">
                        {entry.value}
                      </span>
                      <span className="text-xs tabular-nums text-slate-400">
                        {pct}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

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
  roleSubtitle,
  institutionName,
  unreadCount
}: {
  title: string;
  description: string;
  userName: string;
  roleLabel: string;
  /** System role when roleLabel is a leadership designation (e.g. Teacher under Principal). */
  roleSubtitle?: string | null;
  institutionName?: string;
  unreadCount: number;
}) => (
  <section className="overflow-hidden rounded-2xl border border-brand-100 bg-[linear-gradient(135deg,_#eef3fb_0%,_#ffffff_45%,_#eff6ff_100%)] p-4 shadow-sm sm:rounded-3xl sm:p-6 md:p-8">
    {/*
      CSS grid keeps the action buttons pinned to the trailing edge.
      Flex + w-full previously allowed the button group to jump left after client navigation.
    */}
    <div className="grid min-h-0 gap-4 sm:gap-5 lg:min-h-[11.5rem] lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-8">
      <div className="min-w-0 space-y-2.5 sm:space-y-3">
        <div className="flex min-h-7 flex-wrap items-center gap-2">
          <Badge className="shrink-0 bg-brand-600 text-white">{roleLabel}</Badge>
          {roleSubtitle ? (
            <Badge className="shrink-0 bg-slate-100 text-slate-700">
              {roleSubtitle}
            </Badge>
          ) : null}
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
        <div className="space-y-1.5 sm:space-y-2">
          {/* Brand first on mobile; full legal name stays secondary */}
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-700 sm:text-xs">
            {appConfig.appName}
          </p>
          <p className="text-sm font-medium text-brand-800">{title}</p>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-3xl md:text-4xl">
            Welcome back, {userName}
          </h1>
          {institutionName ? (
            <p className="truncate text-xs font-medium text-slate-500 sm:text-sm sm:text-slate-600">
              {institutionName}
            </p>
          ) : null}
          <p className="max-w-2xl text-sm leading-6 text-slate-600 line-clamp-3 sm:line-clamp-none">
            {description}
          </p>
        </div>
      </div>
      <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:justify-end lg:w-auto lg:justify-self-end lg:pt-1">
        <Link
          to="/notifications"
          className={cn(
            "inline-flex h-10 min-w-0 flex-1 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50 sm:min-w-[9.75rem] sm:flex-none sm:px-4"
          )}
        >
          <Bell className="mr-2 h-4 w-4 shrink-0" />
          Notifications
        </Link>
        <Link
          to="/notices"
          className={cn(
            "inline-flex h-10 min-w-0 flex-1 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50 sm:min-w-[9.75rem] sm:flex-none sm:px-4"
          )}
        >
          <Megaphone className="mr-2 h-4 w-4 shrink-0" />
          Notice Board
        </Link>
      </div>
    </div>
  </section>
);

const DashboardHeroSkeleton = () => (
  <section className="overflow-hidden rounded-3xl border border-brand-100 bg-[linear-gradient(135deg,_#eef3fb_0%,_#ffffff_45%,_#eff6ff_100%)] p-6 shadow-sm md:p-8">
    <div className="grid min-h-0 gap-5 lg:min-h-[11.5rem] lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-8">
      <div className="min-w-0 space-y-3">
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
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 justify-self-end lg:pt-1">
        <div className="h-10 w-[9.75rem] animate-pulse rounded-xl bg-slate-100" />
        <div className="h-10 w-[9.75rem] animate-pulse rounded-xl bg-slate-100" />
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
          <p className="mt-1 text-sm text-slate-500">
            Alerts clear from your inbox after you open them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 ? <Badge className="bg-amber-100 text-amber-800">{unreadCount} unread</Badge> : null}
          {unreadCount > 0 ? (
            <Button size="sm" variant="secondary" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
              Clear all
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {unreadNotifications.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
            You&apos;re all caught up. No notifications.
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
      <Button key={`${action.href}-${action.label}`} asChild variant="outline" size="sm">
        <Link to={action.href}>{action.label}</Link>
      </Button>
    ))}
  </div>
);

const baseStaffActions: Array<{ label: string; href: string }> = [
  { label: "Notifications", href: "/notifications" },
  { label: "Academic Calendar", href: "/academic-calendar" },
  { label: "Complains", href: "/complains" }
];

const categoryQuickActions = (
  category?: CollegeStaffCategory | null
): Array<{ label: string; href: string }> => {
  switch (category) {
    case "TRANSPORT":
      return [{ label: "Transport / Routes", href: "/transport" }, ...baseStaffActions];
    case "RECEPTIONIST":
    case "OFFICE_ASSISTANT":
      return [
        { label: "Notices", href: "/notices" },
        { label: "Academic Calendar", href: "/academic-calendar" },
        ...baseStaffActions.filter((a) => a.href !== "/academic-calendar")
      ];
    case "SECURITY_GUARD":
    case "HOUSEKEEPING":
    case "IT_STAFF":
    case "OTHER":
    default:
      return [{ label: "Notices", href: "/notices" }, ...baseStaffActions];
  }
};

const StaffModuleDashboard = ({
  user,
  data,
  statsWithLiveUnread,
  roleLabel,
  roleSubtitle,
  institutionName,
  unreadCount
}: {
  user: UserProfile;
  data: DashboardResponse;
  statsWithLiveUnread: DashboardMetric[];
  roleLabel: string;
  roleSubtitle?: string | null;
  institutionName?: string;
  unreadCount: number;
}) => {
  const staffProfileQuery = useQuery({
    queryKey: ["college-staff-me", user._id],
    queryFn: () => unwrap<CollegeStaffRecord>(api.get("/college-staff/me")),
    enabled: user.role === "COLLEGE_STAFF",
    retry: false,
    staleTime: 60_000
  });

  const staffCategory = staffProfileQuery.data?.category;
  const staffQuickActions: Array<{ label: string; href: string }> =
    user.role === "ACCOUNTANT"
      ? [
          { label: "Fees & Accounts", href: "/accounting" },
          { label: "Notifications", href: "/notifications" },
          { label: "Complains", href: "/complains" }
        ]
      : user.role === "LIBRARY_STAFF"
        ? [
            { label: "Library Management", href: "/library" },
            { label: "Notifications", href: "/notifications" },
            { label: "Complains", href: "/complains" }
          ]
        : user.role === "LABORATORY_STAFF"
          ? [
              { label: "Laboratory Inventory", href: "/laboratory" },
              { label: "Stock Requests", href: "/laboratory" },
              { label: "Notifications", href: "/notifications" },
              { label: "Complains", href: "/complains" }
            ]
          : categoryQuickActions(staffCategory);

  const heroTitle =
    user.role === "ACCOUNTANT"
      ? "Finance Dashboard"
      : user.role === "LIBRARY_STAFF"
        ? "Library Dashboard"
        : user.role === "LABORATORY_STAFF"
          ? "Laboratory Dashboard"
          : staffCategory
            ? `${COLLEGE_STAFF_CATEGORY_LABELS[staffCategory] ?? "Staff"} Dashboard`
            : "Staff Dashboard";

  const heroDescription =
    user.role === "ACCOUNTANT"
      ? "Access fees, accounts, transactions, and financial reports for your institution."
      : user.role === "LIBRARY_STAFF"
        ? "Manage books, issue & return, and library inventory reports."
        : user.role === "LABORATORY_STAFF"
          ? "Manage assigned laboratory inventory, equipment, and stock requests."
          : staffProfileQuery.data
            ? `${staffProfileQuery.data.designation}${
                staffProfileQuery.data.department ? ` · ${staffProfileQuery.data.department}` : ""
              }. Open the modules linked to your staff role below.`
            : "Role-based operational dashboard for college staff. Teachers use a separate Teacher portal.";

  return (
    <PageContent className="space-y-6">
      <DashboardBannerPopup banners={data.banners} />
      <DashboardHero
        title={heroTitle}
        description={heroDescription}
        userName={user.fullName}
        roleLabel={roleLabel}
        roleSubtitle={roleSubtitle}
        institutionName={institutionName}
        unreadCount={unreadCount}
      />
      <StatGrid stats={statsWithLiveUnread} />
      <QuickActions actions={staffQuickActions} />
      <AcademicCalendarWidgets />
      <DashboardSchedulePanels />
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <NotificationsPanel notifications={data.notifications} unreadCount={unreadCount} />
        <NoticesPanel notices={data.notices} />
      </div>
    </PageContent>
  );
};

export const DashboardPage = () => {
  const { t } = useTranslation();
  const { user, activeSchoolId, availableSchools } = useAuth();
  const { unreadCount: liveUnreadCount } = useNotificationBadge();
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
  const roleLabel = getUserDisplayTitle(user);
  const roleSubtitle = getUserRoleSubtitle(user);
  const unreadCount = liveUnreadCount;
  const statsWithLiveUnread = data.stats.map((stat) =>
    stat.label === "Unread Alerts" ? { ...stat, value: liveUnreadCount } : stat
  );

  if (
    user.role === "COLLEGE_STAFF" ||
    user.role === "ACCOUNTANT" ||
    user.role === "LIBRARY_STAFF" ||
    user.role === "LABORATORY_STAFF"
  ) {
    return (
      <StaffModuleDashboard
        user={user}
        data={data}
        statsWithLiveUnread={statsWithLiveUnread}
        roleLabel={roleLabel}
        roleSubtitle={roleSubtitle}
        institutionName={institutionName}
        unreadCount={unreadCount}
      />
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
          roleSubtitle={roleSubtitle}
          institutionName={institutionName}
          unreadCount={unreadCount}
        />
        <StatGrid stats={statsWithLiveUnread} />
        <AcademicCalendarWidgets />
        <DashboardSchedulePanels />
        <HighlightsRow highlights={data.highlights} />
        <QuickActions
          actions={[
            { label: "My Subjects", href: "/my-subjects" },
            { label: "Assignments", href: "/homework-view" },
            { label: "My Fees", href: "/my-fees" },
            { label: "My Library", href: "/my-library" },
            { label: "Exams", href: "/exams" },
            { label: "Timetable", href: "/timetable" }
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
          roleSubtitle={roleSubtitle}
          institutionName={institutionName}
          unreadCount={unreadCount}
        />
        <StatGrid stats={statsWithLiveUnread} />
        <AcademicCalendarWidgets />
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

  // Filter out removed outstanding-fee admin widgets (balances live on student profile / fee records)
  const highlights = (data.highlights ?? []).filter(
    (h) =>
      h.action !== "fee-dues" &&
      !/outstanding student fees/i.test(h.label) &&
      !/students with fee dues/i.test(h.label),
  );

  return (
    <PageContent className="space-y-6">
      <DashboardBannerPopup banners={data.banners} />
      <DashboardHero
        title={`${t("dashboard")} · ${roleLabel}`}
        description={
          isCollegeAdmin
            ? "Institution-wide overview with student volume, attendance trends, notices, and the latest operational alerts."
            : isTeacher
              ? user.designation?.trim()
                ? `Signed in as ${user.designation.trim()}. Your teaching command center for classes, attendance, assignments, exams, and college communication.`
                : "Your teaching command center for classes, attendance, assignments, exams, and college communication."
              : "Role-based overview with attendance trends, notices, and the latest notifications."
        }
        userName={user.fullName}
        roleLabel={roleLabel}
        roleSubtitle={roleSubtitle}
        institutionName={institutionName}
        unreadCount={unreadCount}
      />

      <StatGrid stats={statsWithLiveUnread} />
      <AcademicCalendarWidgets />
      <DashboardSchedulePanels />
      <HighlightsRow highlights={highlights} />

      {isCollegeAdmin ? (
        <QuickActions
          actions={[
            { label: "Students", href: "/students" },
            { label: "Attendance", href: "/attendance-view" },
            { label: "Accounting", href: "/accounting" },
            { label: "Finance Management", href: "/finance" },
            { label: "Exams & Results", href: "/exams-view" },
            { label: "Timetable", href: "/timetable" },
            { label: "IEMIS Reports", href: "/reports" },
            { label: "Parent Links", href: "/parent-links" }
          ]}
        />
      ) : null}

      {isTeacher ? (
        <QuickActions
          actions={[
            { label: "My Students", href: "/students" },
            { label: "My Timetable", href: "/timetable" },
            { label: "My Assignments", href: "/homework" },
            { label: "My Attendance", href: "/attendance" },
            { label: "My Examinations", href: "/exams" },
            { label: "Academic Plans", href: "/academic-management" },
            { label: "My Library", href: "/my-library" }
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

            {isCollegeAdmin && (data.genderChart?.length ?? 0) > 0 ? (
              <BreakdownDonutCard
                title="Students by Gender"
                scope={data.genderChartScope}
                icon={<Users className="h-5 w-5 text-brand-700" />}
                data={data.genderChart ?? []}
                colorFor={(name) =>
                  GENDER_CHART_COLORS[name] ?? INSTITUTION_MIX_COLORS[0]!
                }
                emptyMessage="No active students with gender recorded yet."
              />
            ) : null}

            {isCollegeAdmin && (data.ethnicityChart?.length ?? 0) > 0 ? (
              <BreakdownDonutCard
                title="Students by Ethnicity"
                scope={data.ethnicityChartScope}
                icon={<Sparkles className="h-5 w-5 text-brand-700" />}
                data={data.ethnicityChart ?? []}
                colorFor={ethnicityColor}
                emptyMessage="No active students with ethnicity recorded yet."
              />
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