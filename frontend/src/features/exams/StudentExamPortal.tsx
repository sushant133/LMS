import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ExamRecord, ExamRoutineRecord, ResultRecord, SubjectRecord } from "@nepal-school-erp/shared";
import { computeSubjectMark } from "@nepal-school-erp/shared";
import { Download, Printer } from "lucide-react";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { PageContent } from "components/layout/PageContent";
import { api, resolveApiUrl, unwrap } from "lib/api";

interface EnrichedRoutine extends ExamRoutineRecord {
  subjectName?: string;
  subjectCode?: string;
}

interface StudentExamPortalProps {
  exams: ExamRecord[];
  results: ResultRecord[];
  isLoading?: boolean;
}

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
              <div key={exam._id} className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4">
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
            <Card key={result._id} className="overflow-hidden border-emerald-100">
              <CardHeader className="border-b border-emerald-50 bg-emerald-50/40">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>{exam?.name ?? "Exam"}</CardTitle>
                    <p className="mt-1 text-sm text-slate-600">
                      {exam ? `${exam.startDateBs} to ${exam.endDateBs}` : "Exam session"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{result.grade}</Badge>
                    <Badge className={result.passFailStatus === "PASS" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}>
                      {result.passFailStatus}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(resolveApiUrl(`/exams/results/${result.examId}/${result.studentId}/marksheet/pdf`), "_blank")}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      PDF
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(resolveApiUrl(`/exams/results/${result.examId}/${result.studentId}/marksheet/pdf`), "_blank", "noopener")}
                    >
                      <Printer className="mr-2 h-4 w-4" />
                      Print
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Percentage</p>
                    <p className="mt-1 text-2xl font-semibold">{result.percentage}%</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">GPA</p>
                    <p className="mt-1 text-2xl font-semibold">{result.gpa.toFixed(2)}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Grade</p>
                    <p className="mt-1 text-2xl font-semibold">{result.grade}</p>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-slate-200">
                  <Table>
                    <TableHead>
                      <tr>
                        <Th>Subject</Th>
                        <Th>Theory</Th>
                        <Th>Practical</Th>
                        <Th>Internal</Th>
                        <Th>Total</Th>
                        <Th>Grade</Th>
                        <Th>Status</Th>
                        <Th>Remarks</Th>
                      </tr>
                    </TableHead>
                    <TableBody>
                      {result.marks.map((mark) => {
                        const subject = subjectMap.get(mark.subjectId);
                        const computed = computeSubjectMark({
                          ...mark,
                          fullMarks: mark.fullMarks ?? subject?.fullMarks ?? 100,
                          passMarks: mark.passMarks ?? subject?.passMarks ?? 35,
                          obtainedMarks: 0
                        });
                        return (
                          <tr key={mark.subjectId}>
                            <Td>{subject?.name ?? "Subject"}</Td>
                            <Td>{mark.theoryMarks ?? 0}</Td>
                            <Td>{mark.practicalMarks ?? 0}</Td>
                            <Td>{mark.internalMarks ?? 0}</Td>
                            <Td>
                              {computed.obtainedMarks} / {computed.fullMarks}
                            </Td>
                            <Td>
                              <Badge>{computed.grade}</Badge>
                            </Td>
                            <Td>
                              <Badge className={computed.passFail === "PASS" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}>
                                {computed.passFail}
                              </Badge>
                            </Td>
                            <Td>{mark.teacherRemarks || "—"}</Td>
                          </tr>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </PageContent>
  );
};