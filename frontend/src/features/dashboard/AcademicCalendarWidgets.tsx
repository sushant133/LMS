import { useQuery } from "@tanstack/react-query";
import type { AcademicCalendarDashboard } from "@phit-erp/shared";
import {
  CalendarDays,
  GraduationCap,
  PartyPopper,
  ScrollText,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
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
    <Card className="h-full border-slate-200/80 shadow-sm transition hover:border-brand-200 hover:shadow-md">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-5 w-5 text-brand-700" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-2xl font-semibold text-slate-900">{value}</p>
        <ul className="space-y-1 text-sm text-slate-600">
          {items.length === 0 ? (
            <li>Nothing upcoming</li>
          ) : (
            items.map((item) => (
              <li key={`${item.label}-${item.meta}`}>
                <span className="font-medium text-slate-800">{item.label}</span>
                <span className="text-slate-500"> · {item.meta}</span>
              </li>
            ))
          )}
        </ul>
      </CardContent>
    </Card>
  </Link>
);

export const AcademicCalendarWidgets = () => {
  const dashboardQuery = useQuery({
    queryKey: ["academic-calendar", "dashboard"],
    queryFn: () =>
      unwrap<AcademicCalendarDashboard>(
        api.get("/academic-calendar/dashboard"),
      ),
  });

  if (dashboardQuery.isPending) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
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

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <WidgetCard
        title="Today's BS Date"
        icon={CalendarDays}
        value={data.todayBs}
        items={[{ label: data.todayAd, meta: "AD equivalent" }]}
      />
      <WidgetCard
        title="Upcoming Holidays"
        icon={PartyPopper}
        value={`${data.upcomingHolidays.length}`}
        items={data.upcomingHolidays.map((event) => ({
          label: event.name,
          meta: event.dateBs,
        }))}
      />
      <WidgetCard
        title="Upcoming Academic Events"
        icon={GraduationCap}
        value={`${data.upcomingAcademicEvents.length}`}
        items={data.upcomingAcademicEvents.map((event) => ({
          label: event.name,
          meta: event.dateBs,
        }))}
      />
      <WidgetCard
        title="Upcoming Examinations"
        icon={ScrollText}
        value={`${data.upcomingExaminations.length}`}
        items={data.upcomingExaminations.map((event) => ({
          label: event.name,
          meta: `${event.dateBs} · ${getEventTypeLabel(event.eventType)}`,
        }))}
      />
    </div>
  );
};
