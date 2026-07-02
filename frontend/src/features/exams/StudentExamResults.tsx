import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ExamRecord, ResultRecord, SubjectRecord } from "@nepal-school-erp/shared";
import { getNepalGrade } from "@nepal-school-erp/shared";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
import { Badge } from "components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { PageContent } from "components/layout/PageContent";
import { useAuth } from "features/auth/AuthProvider";
import { api, unwrap } from "lib/api";

interface StudentExamResultsProps {
  exams: ExamRecord[];
  results: ResultRecord[];
  isLoading?: boolean;
}

const getOverallStatus = (grade: string, percentage: number): { label: string; className: string } => {
  if (grade === "E" || percentage < 35) {
    return { label: "Fail", className: "bg-red-100 text-red-700" };
  }
  return { label: "Pass", className: "bg-emerald-100 text-emerald-700" };
};

export const StudentExamResults = ({ exams, results, isLoading }: StudentExamResultsProps) => {
  const { user } = useAuth();

  const subjectsQuery = useQuery({
    queryKey: ["student-subjects"],
    queryFn: () => unwrap<Array<Pick<SubjectRecord, "_id" | "name" | "code" | "fullMarks" | "passMarks">>>(api.get("/student/subjects")),
    enabled: user?.role === "STUDENT",
    staleTime: 60_000
  });

  const subjectMap = useMemo(
    () => new Map((subjectsQuery.data ?? []).map((subject) => [subject._id, subject])),
    [subjectsQuery.data]
  );

  const examById = useMemo(() => new Map(exams.map((exam) => [exam._id, exam])), [exams]);

  const sortedResults = useMemo(
    () =>
      [...results].sort((left, right) => {
        const leftDate = examById.get(left.examId)?.startDateBs ?? "";
        const rightDate = examById.get(right.examId)?.startDateBs ?? "";
        return rightDate.localeCompare(leftDate);
      }),
    [results, examById]
  );

  if (isLoading) {
    return <LoadingState />;
  }

  if (sortedResults.length === 0) {
    return (
      <EmptyState
        title="No published results yet"
        description="Your exam results will appear here after teachers enter and publish marks."
      />
    );
  }

  return (
    <PageContent className="space-y-6">
      {sortedResults.map((result) => {
        const exam = examById.get(result.examId);
        const overallStatus = getOverallStatus(result.grade, result.percentage);

        return (
          <Card key={result._id} className="overflow-hidden border-emerald-100">
            <CardHeader className="border-b border-emerald-50 bg-emerald-50/40">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>{exam?.name ?? "Exam"}</CardTitle>
                  <p className="mt-1 text-sm text-slate-600">
                    {exam ? `${exam.startDateBs} to ${exam.endDateBs}` : "Exam session"}
                    {result.publishedAtBs ? ` · Published ${result.publishedAtBs}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{result.grade}</Badge>
                  <Badge className={overallStatus.className}>{overallStatus.label}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Overall Grade</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{result.grade}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">GPA</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{result.gpa.toFixed(2)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Percentage</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{result.percentage}%</p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <Table>
                  <TableHead>
                    <tr>
                      <Th>Subject</Th>
                      <Th>Marks</Th>
                      <Th>Grade</Th>
                      <Th>Status</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {result.marks.map((mark) => {
                      const subject = subjectMap.get(mark.subjectId);
                      const fullMarks = subject?.fullMarks ?? 100;
                      const passMarks = subject?.passMarks ?? 35;
                      const percentage = fullMarks > 0 ? (mark.obtainedMarks / fullMarks) * 100 : 0;
                      const subjectGrade = getNepalGrade(percentage).grade;
                      const passed = mark.obtainedMarks >= passMarks;

                      return (
                        <tr key={mark.subjectId}>
                          <Td>
                            <div className="font-medium text-slate-900">{subject?.name ?? "Subject"}</div>
                            {subject?.code ? <div className="text-xs text-slate-500">{subject.code}</div> : null}
                          </Td>
                          <Td>
                            {mark.obtainedMarks} / {fullMarks}
                          </Td>
                          <Td>
                            <Badge>{subjectGrade}</Badge>
                          </Td>
                          <Td>
                            <Badge className={passed ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}>
                              {passed ? "Pass" : "Fail"}
                            </Badge>
                          </Td>
                        </tr>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </PageContent>
  );
};