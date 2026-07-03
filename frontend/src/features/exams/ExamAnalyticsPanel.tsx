import { useQuery } from "@tanstack/react-query";
import type { ExamAnalyticsSummary } from "@nepal-school-erp/shared";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
import { Badge } from "components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";

interface ExamAnalyticsPanelProps {
  examId: string;
}

export const ExamAnalyticsPanel = ({ examId }: ExamAnalyticsPanelProps) => {
  const analyticsQuery = useQuery({
    queryKey: ["exam-analytics", examId],
    queryFn: () => unwrap<ExamAnalyticsSummary>(api.get(`/exams/${examId}/analytics`)),
    enabled: Boolean(examId)
  });

  if (analyticsQuery.isLoading) {
    return <LoadingState />;
  }

  const analytics = analyticsQuery.data;
  if (!analytics) {
    return <EmptyState title="No analytics" description="Analytics will appear once results are entered." />;
  }

  const passRate = analytics.resultsEntered > 0 ? Math.round((analytics.passCount / analytics.resultsEntered) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">Students</p>
            <p className="mt-1 text-2xl font-semibold">{analytics.totalStudents}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">Results Entered</p>
            <p className="mt-1 text-2xl font-semibold">{analytics.resultsEntered}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">Average %</p>
            <p className="mt-1 text-2xl font-semibold">{analytics.averagePercentage}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">Pass Rate</p>
            <p className="mt-1 text-2xl font-semibold">{passRate}%</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Pass / Fail Summary</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Badge className="bg-emerald-100 px-4 py-2 text-base text-emerald-700">{analytics.passCount} Passed</Badge>
            <Badge className="bg-red-100 px-4 py-2 text-base text-red-700">{analytics.failCount} Failed</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Performers</CardTitle>
          </CardHeader>
          <CardContent>
            {analytics.topPerformers.length === 0 ? (
              <p className="text-sm text-slate-500">No results yet.</p>
            ) : (
              <div className="space-y-2">
                {analytics.topPerformers.map((performer, index) => (
                  <div key={performer.studentId} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2 text-sm">
                    <span>
                      {index + 1}. {performer.studentName}
                    </span>
                    <span className="font-medium">
                      {performer.percentage}% · {performer.grade}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Subject-wise Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHead>
                <tr>
                  <Th>Subject</Th>
                  <Th>Avg %</Th>
                  <Th>Pass</Th>
                  <Th>Fail</Th>
                </tr>
              </TableHead>
              <TableBody>
                {analytics.subjectPerformance.map((subject) => (
                  <tr key={subject.subjectId}>
                    <Td>{subject.subjectName}</Td>
                    <Td>{subject.averagePercentage}%</Td>
                    <Td>{subject.passCount}</Td>
                    <Td>{subject.failCount}</Td>
                  </tr>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {analytics.lowestPerformers.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Needs Attention</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {analytics.lowestPerformers.map((performer) => (
              <div key={performer.studentId} className="flex items-center justify-between rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2 text-sm">
                <span>{performer.studentName}</span>
                <span className="font-medium text-amber-800">
                  {performer.percentage}% · {performer.grade}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};