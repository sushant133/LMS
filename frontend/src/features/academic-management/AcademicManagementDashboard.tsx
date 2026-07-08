import type { AcademicManagementDashboard } from "@phit-erp/shared";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { LoadingState } from "components/shared/LoadingState";

interface AcademicManagementDashboardPanelProps {
  data?: AcademicManagementDashboard;
  loading: boolean;
}

const statCards = [
  { key: "totalSubjects", label: "Total Subjects" },
  { key: "totalSessionPlans", label: "Session Plans" },
  { key: "totalLessonPlans", label: "Lesson Plans" },
  { key: "todaysLogBooks", label: "Today's Log Books" },
  { key: "approvedPlans", label: "Approved Plans" },
  { key: "pendingApprovals", label: "Pending Approvals" },
  { key: "delayedLessonPlans", label: "Delayed Plans" },
  { key: "syllabusCompletionPercent", label: "Syllabus Completion %" },
  { key: "teachersPendingLogBook", label: "Teachers Pending Log Book" }
] as const;

export const AcademicManagementDashboardPanel = ({ data, loading }: AcademicManagementDashboardPanelProps) => {
  if (loading) return <LoadingState />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {statCards.map((card) => (
          <Card key={card.key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">{card.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold text-slate-900">
                {card.key === "syllabusCompletionPercent" ? `${data[card.key]}%` : data[card.key]}
              </p>
            </CardContent>
          </Card>
        ))}
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
            <CardTitle>Subject Progress</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.subjectProgress}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="subjectName" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Bar dataKey="completionPercent" fill="#2563eb" name="Completion %" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Teacher Performance</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.teacherPerformance}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="teacherName" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Bar dataKey="completionPercent" fill="#059669" name="Completion %" />
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
                <Bar dataKey="percent" fill="#7c3aed" name="Syllabus %" />
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
                <Bar dataKey="completionPercent" fill="#ea580c" name="Completion %" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};