import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ExamRecord, ExamRoutineRecord, MarksheetViewResponse, ResultRecord, SubjectRecord } from "@phit-erp/shared";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { PageContent } from "components/layout/PageContent";
import { ResultMarksheetView } from "features/exams/ResultMarksheetView";
import { api, unwrap } from "lib/api";

interface EnrichedRoutine extends ExamRoutineRecord {
  subjectName?: string;
  subjectCode?: string;
}

interface StudentExamPortalProps {
  exams: ExamRecord[];
  results: ResultRecord[];
  isLoading?: boolean;
}

const StudentResultMarksheet = ({ examId, studentId }: { examId: string; studentId: string }) => {
  const marksheetQuery = useQuery({
    queryKey: ["marksheet", "portal", examId, studentId],
    queryFn: () => unwrap<MarksheetViewResponse>(api.get(`/exams/results/${examId}/${studentId}/marksheet`))
  });

  if (marksheetQuery.isLoading) {
    return <LoadingState />;
  }

  if (!marksheetQuery.data) {
    return <EmptyState title="Marksheet unavailable" description="Could not load your marksheet. Contact the college office if this persists." />;
  }

  return <ResultMarksheetView data={marksheetQuery.data} />;
};

export const StudentExamPortal = ({ exams, results, isLoading }: StudentExamPortalProps) => {
  const routinesQuery = useQuery({
    queryKey: ["exam-routines", "student"],
    queryFn: async () => {
      const all = await Promise.all(
        exams.map((exam) =>
          unwrap<EnrichedRoutine[]>(api.get("/exams/routines", { params: { examId: exam._id } })).catch(() => [])
        )
      );
      return all.flat();
    },
    enabled: exams.length > 0
  });

  const subjectsQuery = useQuery({
    queryKey: ["student-subjects"],
    queryFn: () => unwrap<SubjectRecord[]>(api.get("/student/subjects")),
    staleTime: 60_000
  });

  const subjectMap = useMemo(
    () => new Map((subjectsQuery.data ?? []).map((subject) => [subject._id, subject])),
    [subjectsQuery.data]
  );

  const examById = useMemo(() => new Map(exams.map((exam) => [exam._id, exam])), [exams]);

  const publishedExams = useMemo(() => exams.filter((exam) => exam.routinePublished), [exams]);

  const upcomingRoutines = useMemo(() => {
    const routines = routinesQuery.data ?? [];
    return [...routines].sort((left, right) => left.examDateBs.localeCompare(right.examDateBs));
  }, [routinesQuery.data]);

  const sortedResults = useMemo(
    () =>
      [...results].sort((left, right) => {
        const leftDate = examById.get(left.examId)?.startDateBs ?? "";
        const rightDate = examById.get(right.examId)?.startDateBs ?? "";
        return rightDate.localeCompare(leftDate);
      }),
    [results, examById]
  );

  if (isLoading || routinesQuery.isLoading) {
    return <LoadingState />;
  }

  return (
    <PageContent className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Upcoming Exam Routines</CardTitle>
        </CardHeader>
        <CardContent>
          {upcomingRoutines.length === 0 ? (
            <EmptyState title="No published routines" description="Your exam schedule will appear here once the college admin publishes the routine." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Exam</Th>
                    <Th>Subject</Th>
                    <Th>Date</Th>
                    <Th>Day</Th>
                    <Th>Time</Th>
                    <Th>Duration</Th>
                    <Th>Hall</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {upcomingRoutines.map((routine) => {
                    const exam = examById.get(routine.examId);
                    return (
                      <tr key={routine._id}>
                        <Td>{exam?.name ?? "Exam"}</Td>
                        <Td>{routine.subjectName ?? subjectMap.get(routine.subjectId)?.name ?? "Subject"}</Td>
                        <Td>{routine.examDateBs}</Td>
                        <Td>{routine.day}</Td>
                        <Td>
                          {routine.startTime} - {routine.endTime}
                        </Td>
                        <Td>{routine.durationMinutes} min</Td>
                        <Td>{routine.examHall || "—"}</Td>
                      </tr>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {publishedExams.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Published Exam Sessions</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {publishedExams.map((exam) => (
              <div key={exam._id} className="rounded-2xl border border-brand-100 bg-brand-50/40 p-4">
                <p className="font-semibold text-slate-900">{exam.name}</p>
                <p className="mt-1 text-sm text-slate-600">
                  {exam.startDateBs} to {exam.endDateBs} · {exam.academicYearBs}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {sortedResults.length === 0 ? (
        <EmptyState title="No published results yet" description="Your exam results will appear here after the college admin publishes them." />
      ) : (
        sortedResults.map((result) => {
          const exam = examById.get(result.examId);
          return (
            <div key={result._id} className="space-y-2">
              <p className="text-sm font-medium text-slate-600">{exam?.name ?? "Exam"}</p>
              <StudentResultMarksheet examId={result.examId} studentId={result.studentId} />
            </div>
          );
        })
      )}
    </PageContent>
  );
};