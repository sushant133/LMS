import { useQuery } from "@tanstack/react-query";
import type { AcademicCalendarDashboard } from "@phit-erp/shared";
import {
  CalendarDays,
  GraduationCap,
  PartyPopper,
  ScrollText,
  Sun,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { useCanAccessModule } from "hooks/useModuleAccess";
import { api, unwrap } from "lib/api";
import { getEventTypeLabel } from "features/academic-calendar/academicCalendarUtils";

const WidgetCard = ({
  title,
  icon: Icon,
  value,
  items,
}: {
  title: string;
  icon: typeof CalendarDays;
  value: string;
  items: Array<{ label: string; meta: string }>;
}) => (
  <Link to="/academic-calendar" className="block">
    <Card className="h-full border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_28px_-12px_rgba(15,23,42,0.12)] transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_8px_30px_-12px_rgba(15,23,42,0.16)]">
      <CardHeader className="border-slate-100/80 pb-2">
        <CardTitle className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-slate-800 sm:text-base">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-100 bg-slate-50">
            <Icon className="h-4 w-4 text-slate-600" strokeWidth={1.75} />
          </span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
          {value}
        </p>
        <ul className="space-y-1.5 text-sm text-slate-600">
          {items.length === 0 ? (
            <li className="text-slate-400">Nothing upcoming</li>
          ) : (
            items.map((item) => (
              <li key={`${item.label}-${item.meta}`} className="leading-snug">
                <span className="font-medium text-slate-800">{item.label}</span>
                <span className="text-slate-400"> · {item.meta}</span>
              </li>
            ))
          )}
        </ul>
      </CardContent>
    </Card>
  </Link>
);

const formatRangeMeta = (start: string, end: string): string =>
  start === end ? start : `${start} → ${end}`;

export const AcademicCalendarWidgets = () => {
  const canAccessCalendar = useCanAccessModule("academic-calendar");

  const dashboardQuery = useQuery({
    queryKey: ["academic-calendar", "dashboard"],
    queryFn: () =>
      unwrap<AcademicCalendarDashboard>(
        api.get("/academic-calendar/dashboard"),
      ),
    enabled: canAccessCalendar,
  });

  // Staff without Academic Calendar module (e.g. accountant with only Accounts)
  // must not hit the API — avoids noisy 403s on the dashboard.
  if (!canAccessCalendar) return null;

  if (dashboardQuery.isPending) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="h-36 animate-pulse rounded-2xl border border-slate-200 bg-white"
          />
        ))}
      </div>
    );
  }

  const data = dashboardQuery.data;
  if (!data) return null;

  const todayItems = (data.todayEvents ?? []).map((event) => ({
    label: event.name,
    meta: getEventTypeLabel(event.eventType),
  }));

  const activeMultiDay = (data.activeMultiDayEvents ?? []).map((event) => ({
    label: event.name,
    meta: formatRangeMeta(
      event.startDateBs || event.dateBs,
      event.endDateBs || event.dateBs,
    ),
  }));

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      <WidgetCard
        title="Today"
        icon={CalendarDays}
        value={data.todayBs}
        items={
          todayItems.length > 0
            ? todayItems
            : [{ label: data.todayAd, meta: "AD equivalent" }]
        }
      />
      <WidgetCard
        title="Active Events"
        icon={Sun}
        value={`${(data.activeMultiDayEvents ?? []).length || (data.todayEvents ?? []).filter((e) => e.totalDays > 1).length}`}
        items={
          activeMultiDay.length > 0
            ? activeMultiDay
            : (data.todayEvents ?? [])
                .filter((event) => !event.isSystemGenerated)
                .slice(0, 3)
                .map((event) => ({
                  label: event.name,
                  meta: getEventTypeLabel(event.eventType),
                }))
        }
      />
      <WidgetCard
        title="Upcoming Holidays"
        icon={PartyPopper}
        value={`${(data.upcomingHolidays ?? []).filter((e) => !e.isSystemGenerated).length}`}
        items={(data.upcomingHolidays ?? [])
          .filter((event) => !event.isSystemGenerated)
          .map((event) => ({
            label: event.name,
            meta: formatRangeMeta(
              event.startDateBs || event.dateBs,
              event.endDateBs || event.dateBs,
            ),
          }))}
      />
      <WidgetCard
        title="Upcoming Academic Events"
        icon={GraduationCap}
        value={`${data.upcomingAcademicEvents.length}`}
        items={data.upcomingAcademicEvents.map((event) => ({
          label: event.name,
          meta: formatRangeMeta(
            event.startDateBs || event.dateBs,
            event.endDateBs || event.dateBs,
          ),
        }))}
      />
      <WidgetCard
        title="Upcoming Examinations"
        icon={ScrollText}
        value={`${data.upcomingExaminations.length}`}
        items={data.upcomingExaminations.map((event) => ({
          label: event.name,
          meta: `${formatRangeMeta(
            event.startDateBs || event.dateBs,
            event.endDateBs || event.dateBs,
          )} · ${getEventTypeLabel(event.eventType)}`,
        }))}
      />
    </div>
  );
};
