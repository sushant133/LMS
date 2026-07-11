import type {
  AcademicManagementDashboard,
  AcademicTeacherAlert,
} from "@phit-erp/shared";
import { AlertTriangle, BookOpen, Clock, ClipboardList } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { LoadingState } from "components/shared/LoadingState";
import { AcademicProgressBar } from "./AcademicProgressBar";

interface AcademicManagementDashboardPanelProps {
  data?: AcademicManagementDashboard;
  loading: boolean;
}

const statCards = [
  { key: "totalSubjects", label: "Curriculum Subjects" },
  { key: "totalSessionPlans", label: "Session Plans" },
  { key: "totalLessonPlans", label: "Lesson Plans" },
  { key: "todaysLogBooks", label: "Today's Log Books" },
  { key: "approvedPlans", label: "Approved Plans" },
  { key: "pendingApprovals", label: "Pending Approvals" },
  { key: "delayedLessonPlans", label: "Delayed Plans" },
  { key: "syllabusCompletionPercent", label: "Syllabus Completion %" },
  { key: "syllabusRemainingPercent", label: "Syllabus Remaining %" },
  { key: "teachersPendingLogBook", label: "Teachers Pending Log Book" },
] as const;

const alertStyle = (type: AcademicTeacherAlert["type"]) => {
  switch (type) {
    case "LESSON_PLAN_OVERDUE":
      return "border-rose-200 bg-rose-50";
    case "LESSON_PLAN_APPROACHING":
      return "border-amber-200 bg-amber-50";
    case "LOG_BOOK_MISSING":
      return "border-orange-200 bg-orange-50";
    default:
      return "border-slate-200 bg-slate-50";
  }
};

const alertIcon = (type: AcademicTeacherAlert["type"]) => {
  switch (type) {
    case "LESSON_PLAN_OVERDUE":
      return <AlertTriangle className="h-4 w-4 text-rose-600" />;
    case "LESSON_PLAN_APPROACHING":
      return <Clock className="h-4 w-4 text-amber-600" />;
    case "LOG_BOOK_MISSING":
      return <ClipboardList className="h-4 w-4 text-orange-600" />;
    default:
      return <BookOpen className="h-4 w-4 text-slate-600" />;
  }
};

const alertLabel = (type: AcademicTeacherAlert["type"]) => {
  switch (type) {
    case "LESSON_PLAN_OVERDUE":
      return "Overdue / delayed";
    case "LESSON_PLAN_APPROACHING":
      return "Deadline near";
    case "LOG_BOOK_MISSING":
      return "Log book missing";
    default:
      return type;
  }
};

export const AcademicManagementDashboardPanel = ({
  data,
  loading,
}: AcademicManagementDashboardPanelProps) => {
  if (loading) return <LoadingState />;
  if (!data) return null;

  const alerts = data.teacherAlerts ?? [];

  return (
    <div className="space-y-6">
      {alerts.length > 0 ? (
        <Card className="border-amber-200">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Teacher action required
            </CardTitle>
            <p className="text-sm text-slate-600">
              Missing log books and lesson plans that are near deadline or not
              on time. Remaining work is shown as a percentage.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {alerts.map((alert, index) => (
              <div
                key={`${alert.type}-${alert.teacherId}-${alert.lessonPlanItemId ?? alert.topic}-${index}`}
                className={`rounded-xl border p-3 ${alertStyle(alert.type)}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    {alertIcon(alert.type)}
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="bg-white/80 text-slate-800">
                          {alertLabel(alert.type)}
                        </Badge>
                        {alert.subjectName ? (
                          <span className="text-sm font-medium text-slate-900">
                            {alert.subjectName}
                            {alert.month ? ` · ${alert.month}` : ""}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-slate-700">
                        {alert.message}
                      </p>
                      {alert.deadline ? (
                        <p className="mt-0.5 text-xs text-slate-500">
                          Deadline: {alert.deadline}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  {alert.type !== "LOG_BOOK_MISSING" ? (
                    <div className="min-w-[140px] text-right">
                      <p className="text-lg font-semibold text-amber-800">
                        {alert.remainingPercent}% remaining
                      </p>
                      <p className="text-xs text-slate-500">
                        {alert.completedClasses}/{alert.estimatedClasses}{" "}
                        classes
                      </p>
                      <AcademicProgressBar
                        className="mt-1"
                        completedPercent={alert.completedPercent}
                        remainingPercent={alert.remainingPercent}
                        compact
                      />
                    </div>
                  ) : (
                    <p className="text-sm font-semibold text-orange-800">
                      Not submitted
                    </p>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {statCards.map((card) => {
          const value = data[card.key as keyof AcademicManagementDashboard];
          const isPercent =
            card.key === "syllabusCompletionPercent" ||
            card.key === "syllabusRemainingPercent";
          return (
            <Card key={card.key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">
                  {card.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p
                  className={`text-3xl font-semibold ${
                    card.key === "syllabusRemainingPercent" ||
                    card.key === "delayedLessonPlans" ||
                    card.key === "teachersPendingLogBook"
                      ? "text-amber-800"
                      : "text-slate-900"
                  }`}
                >
                  {isPercent ? `${value as number}%` : (value as number)}
                </p>
                {card.key === "syllabusCompletionPercent" ? (
                  <AcademicProgressBar
                    className="mt-2"
                    completedPercent={data.syllabusCompletionPercent}
                    remainingPercent={data.syllabusRemainingPercent}
                  />
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Monthly Progress</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.monthlyProgress}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="planned" fill="#94a3b8" name="Planned" />
                <Bar dataKey="completed" fill="#0c2d6b" name="Completed" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Subject Progress (remaining %)</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.subjectProgress}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="subjectName" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Bar
                  dataKey="completionPercent"
                  fill="#2563eb"
                  name="Completed %"
                />
                <Bar
                  dataKey="remainingPercent"
                  fill="#f59e0b"
                  name="Remaining %"
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Teacher Performance (remaining %)</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.teacherPerformance}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="teacherName" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Bar
                  dataKey="completionPercent"
                  fill="#059669"
                  name="Completed %"
                />
                <Bar
                  dataKey="remainingPercent"
                  fill="#f59e0b"
                  name="Remaining %"
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Syllabus Completion</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.syllabusCompletion}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="subjectName" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Bar dataKey="percent" fill="#7c3aed" name="Completed %" />
                <Bar
                  dataKey="remainingPercent"
                  fill="#f59e0b"
                  name="Remaining %"
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Faculty Progress</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.facultyProgress}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="faculty" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Bar
                  dataKey="completionPercent"
                  fill="#ea580c"
                  name="Completed %"
                />
                <Bar
                  dataKey="remainingPercent"
                  fill="#f59e0b"
                  name="Remaining %"
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
