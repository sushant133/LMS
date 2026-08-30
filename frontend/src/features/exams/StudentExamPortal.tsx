import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  ExamRecord,
  ExamRoutineRecord,
  MarksheetViewResponse,
  ResultRecord,
  SchoolSettingsRecord,
} from "@phit-erp/shared";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { PageContent } from "components/layout/PageContent";
import {
  ExamRoutineGrid,
  ExamRoutinePrintSheet,
  shortYearTitle,
  type RoutineColumn,
} from "features/exams/ExamRoutineGrid";
import { ResultMarksheetView } from "features/exams/ResultMarksheetView";
import { api, unwrap } from "lib/api";
import { printBulkResultsElement } from "lib/printUtils";
import { parseErrorMessage } from "lib/utils";

interface EnrichedRoutine extends ExamRoutineRecord {
  subjectName?: string;
  subjectCode?: string;
  yearName?: string;
  yearLevel?: number;
}

interface StudentExamPortalProps {
  exams: ExamRecord[];
  results: ResultRecord[];
  isLoading?: boolean;
}

const StudentResultMarksheet = ({
  examId,
  studentId,
}: {
  examId: string;
  studentId: string;
}) => {
  const marksheetQuery = useQuery({
    queryKey: ["marksheet", "portal", examId, studentId],
    queryFn: () =>
      unwrap<MarksheetViewResponse>(
        api.get(`/exams/results/${examId}/${studentId}/marksheet`),
      ),
  });

  if (marksheetQuery.isLoading) {
    return <LoadingState />;
  }

  if (!marksheetQuery.data) {
    return (
      <EmptyState
        title="Marksheet unavailable"
        description="Could not load your marksheet. Contact the college office if this persists."
      />
    );
  }

  return <ResultMarksheetView data={marksheetQuery.data} />;
};

export const StudentExamPortal = ({
  exams,
  results,
  isLoading,
}: StudentExamPortalProps) => {
  /**
   * Load published routines in one call (backend filters to published + student's year).
   * Do not depend on the exams list first — that previously returned empty when
   * exam batch/year matching was too strict, so routines never loaded.
   */
  const routinesQuery = useQuery({
    queryKey: ["exam-routines", "student"],
    queryFn: () => unwrap<EnrichedRoutine[]>(api.get("/exams/routines")),
  });

  /** College name for the printed routine header. */
  const settingsQuery = useQuery({
    queryKey: ["settings", "print-branding"],
    queryFn: () => unwrap<SchoolSettingsRecord>(api.get("/settings")),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const [isPrinting, setIsPrinting] = useState(false);

  const examById = useMemo(
    () => new Map(exams.map((exam) => [exam._id, exam])),
    [exams],
  );

  const publishedExams = useMemo(
    () => exams.filter((exam) => exam.routinePublished),
    [exams],
  );

  const upcomingRoutines = useMemo(() => {
    const routines = routinesQuery.data ?? [];
    return [...routines].sort((left, right) => {
      const byDate = left.examDateBs.localeCompare(right.examDateBs);
      if (byDate !== 0) return byDate;
      return (left.startTime ?? "").localeCompare(right.startTime ?? "");
    });
  }, [routinesQuery.data]);

  /**
   * The backend already restricts these rows to the student's own enrolled year, so the
   * grid below never has to filter — it just renders whichever year came back, one
   * section per exam.
   */
  const routineGroups = useMemo(() => {
    const byExam = new Map<
      string,
      {
        examId: string;
        examName: string;
        columns: RoutineColumn[];
        slots: EnrichedRoutine[];
      }
    >();

    for (const routine of upcomingRoutines) {
      const group = byExam.get(routine.examId) ?? {
        examId: routine.examId,
        examName: examById.get(routine.examId)?.name ?? "Exam",
        columns: [] as RoutineColumn[],
        slots: [] as EnrichedRoutine[],
      };
      const key = routine.yearId ?? "";
      if (!group.columns.some((column) => column.key === key)) {
        const title = routine.yearName || "My year";
        group.columns.push({
          key,
          title,
          shortTitle: routine.yearName
            ? shortYearTitle(title, routine.yearLevel)
            : title,
          level: routine.yearLevel,
        });
      }
      group.slots.push(routine);
      byExam.set(routine.examId, group);
    }

    return [...byExam.values()].map((group) => ({
      ...group,
      columns: group.columns.sort((a, b) => (a.level ?? 99) - (b.level ?? 99)),
    }));
  }, [examById, upcomingRoutines]);

  /** Year label shown next to the card title, e.g. "1st Year · Batch 2083". */
  const myYearName = useMemo(
    () => upcomingRoutines.find((routine) => routine.yearName)?.yearName ?? "",
    [upcomingRoutines],
  );

  const sortedResults = useMemo(
    () =>
      [...results].sort((left, right) => {
        const leftDate = examById.get(left.examId)?.startDateBs ?? "";
        const rightDate = examById.get(right.examId)?.startDateBs ?? "";
        return rightDate.localeCompare(leftDate);
      }),
    [results, examById],
  );

  const printSheetId = "student-exam-routine-print";
  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      await printBulkResultsElement(document.getElementById(printSheetId));
    } catch (error) {
      toast.error(parseErrorMessage(error));
    } finally {
      setIsPrinting(false);
    }
  };

  if (isLoading || routinesQuery.isLoading) {
    return <LoadingState />;
  }

  return (
    <PageContent className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex flex-wrap items-center gap-2">
                My exam routine
                {myYearName ? (
                  <Badge className="bg-brand-100 text-brand-700">
                    {myYearName}
                  </Badge>
                ) : null}
              </CardTitle>
              <p className="mt-1 text-sm text-slate-600">
                The college publishes one routine for all years; you only ever
                see the dates and subjects for your own enrolled year.
              </p>
            </div>
            {upcomingRoutines.length > 0 ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handlePrint()}
                disabled={isPrinting}
              >
                <Printer className="mr-1.5 h-4 w-4" />
                {isPrinting ? "Preparing…" : "Print my routine"}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {upcomingRoutines.length === 0 ? (
            <EmptyState
              title="No published routines"
              description="Your exam schedule will appear here once the college admin publishes the routine for your year."
            />
          ) : (
            routineGroups.map((group) => (
              <div key={group.examId} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {group.examName}
                  </h3>
                  <span className="text-xs text-slate-500">
                    {group.slots.length} subject
                    {group.slots.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ExamRoutineGrid
                  columns={group.columns}
                  slots={group.slots}
                  showDetails
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Hidden A4 landscape sheet cloned by "Print my routine" — the student's
          own year only, since that is all the API returns to them. */}
      <ExamRoutinePrintSheet
        id={printSheetId}
        collegeName={settingsQuery.data?.schoolName}
        heading="MY EXAMINATION ROUTINE"
        examName={routineGroups.map((group) => group.examName).join(", ")}
        academicYearBs={settingsQuery.data?.academicYearBs}
        columns={routineGroups[0]?.columns ?? []}
        slots={upcomingRoutines}
        note="Be seated in the examination hall 15 minutes before the scheduled start time and carry your college identity card."
        signatories={["Exam Coordinator"]}
      />

      {publishedExams.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Published Exam Sessions</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {publishedExams.map((exam) => (
              <div
                key={exam._id}
                className="rounded-2xl border border-brand-100 bg-brand-50/40 p-4"
              >
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
        <EmptyState
          title="No published results yet"
          description="Your exam results will appear here after the college admin publishes them."
        />
      ) : (
        sortedResults.map((result) => {
          const exam = examById.get(result.examId);
          return (
            <div key={result._id} className="space-y-2">
              <p className="text-sm font-medium text-slate-600">
                {exam?.name ?? "Exam"}
              </p>
              <StudentResultMarksheet
                examId={result.examId}
                studentId={result.studentId}
              />
            </div>
          );
        })
      )}
    </PageContent>
  );
};
