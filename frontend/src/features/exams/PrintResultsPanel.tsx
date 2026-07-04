import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  ClassRecord,
  ExamRecord,
  MarksheetViewResponse,
  PrintResultsGridResponse,
  SectionRecord,
  StudentRecord
} from "@nepal-school-erp/shared";
import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { ResultMarksheetView } from "features/exams/ResultMarksheetView";
import { api, unwrap } from "lib/api";
import { printWithMode } from "lib/printUtils";
import { filterYearsByBatch } from "lib/teacherScopeUtils";
import { parseErrorMessage } from "lib/utils";

interface PrintResultsPanelProps {
  isCollege: boolean;
  labels: { primary: string; secondary: string; primaryPlural: string; secondaryPlural: string };
  batches: Array<{ _id: string; name: string }>;
  years: Array<{ _id: string; name: string; batchId: string }>;
  classes: ClassRecord[];
  sections: SectionRecord[];
  students: StudentRecord[];
  fallbackPublishedExams?: ExamRecord[];
}

export const PrintResultsPanel = ({
  isCollege,
  labels,
  batches,
  years,
  classes,
  sections,
  students,
  fallbackPublishedExams = []
}: PrintResultsPanelProps) => {
  const [academicYearBs, setAcademicYearBs] = useState("");
  const [batchId, setBatchId] = useState("");
  const [yearId, setYearId] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [examId, setExamId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [exporting, setExporting] = useState(false);

  const publishedExamsQuery = useQuery({
    queryKey: ["print-results", "exams", academicYearBs],
    queryFn: () =>
      unwrap<ExamRecord[]>(
        api.get("/exams/results/published/exams", {
          params: academicYearBs ? { academicYearBs } : undefined
        })
      ),
    retry: 1
  });

  const publishedExams = useMemo(() => {
    if (publishedExamsQuery.data && publishedExamsQuery.data.length > 0) {
      return publishedExamsQuery.data;
    }
    return fallbackPublishedExams.filter((exam) => exam.resultsPublished);
  }, [fallbackPublishedExams, publishedExamsQuery.data]);

  const academicSessions = useMemo(() => {
    const sessions = new Set(publishedExams.map((exam) => exam.academicYearBs).filter(Boolean));
    return [...sessions].sort((left, right) => right.localeCompare(left));
  }, [publishedExams]);

  const filteredExams = useMemo(() => {
    if (!academicYearBs) return publishedExams;
    return publishedExams.filter((exam) => exam.academicYearBs === academicYearBs);
  }, [academicYearBs, publishedExams]);

  const filteredYears = useMemo(() => filterYearsByBatch(years, batchId), [batchId, years]);
  const filteredSections = useMemo(
    () => sections.filter((section) => section.classId === classId),
    [classId, sections]
  );

  const scopeStudents = useMemo(
    () =>
      students.filter((student) =>
        isCollege
          ? student.batchId === batchId && student.yearId === yearId
          : student.classId === classId && student.sectionId === sectionId
      ),
    [batchId, classId, isCollege, sectionId, students, yearId]
  );

  const filtersComplete = isCollege
    ? Boolean(examId && batchId && yearId)
    : Boolean(examId && classId && sectionId);

  const gridQuery = useQuery({
    queryKey: ["print-results", "grid", examId, batchId, yearId, classId, sectionId, studentId],
    queryFn: () =>
      unwrap<PrintResultsGridResponse>(
        api.get("/exams/results/published/grid", {
          params: isCollege
            ? {
                examId,
                batchId,
                yearId,
                studentId: studentId || undefined
              }
            : {
                examId,
                classId,
                sectionId,
                studentId: studentId || undefined
              }
        })
      ),
    enabled: filtersComplete
  });

  const marksheetQuery = useQuery({
    queryKey: ["print-results", "marksheet", examId, studentId],
    queryFn: () =>
      unwrap<MarksheetViewResponse>(api.get(`/exams/results/${examId}/${studentId}/marksheet`)),
    enabled: Boolean(examId && studentId)
  });

  const selectedExam = filteredExams.find((exam) => exam._id === examId);
  const grid = gridQuery.data;

  const scopeLabel = isCollege
    ? [grid?.batchName, grid?.yearName].filter(Boolean).join(" · ")
    : [grid?.className, grid?.sectionName].filter(Boolean).join(" · ");

  const exportParams = isCollege
    ? { examId, batchId, yearId, studentId: studentId || undefined }
    : { examId, classId, sectionId, studentId: studentId || undefined };

  const downloadExport = async () => {
    if (!filtersComplete) return;
    setExporting(true);
    try {
      const response = await api.get("/exams/results/published/export", {
        params: exportParams,
        responseType: "blob"
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      const disposition = response.headers["content-disposition"];
      let filename = `print-results-${selectedExam?.name?.replace(/\s+/g, "-") ?? "exam"}.csv`;
      if (disposition) {
        const match = disposition.match(/filename="(.+)"/);
        if (match) filename = match[1];
      }
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Results exported to Excel (CSV)");
    } catch (error) {
      toast.error(parseErrorMessage(error));
    } finally {
      setExporting(false);
    }
  };

  const printBulk = () => printWithMode("printing-bulk-results");

  if (publishedExamsQuery.isLoading && publishedExams.length === 0) {
    return <LoadingState />;
  }

  return (
    <div className="space-y-6">
      {publishedExamsQuery.isError ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Could not refresh the published-exams list from the server. Showing exams marked as published from your session.
          {publishedExams.length === 0 ? " Restart the backend server if filters stay empty." : ""}
        </div>
      ) : null}

      {publishedExams.length === 0 ? (
        <EmptyState
          title="No published exams yet"
          description="Publish results from Exam Sessions first. After publishing, exams will appear here for printing."
        />
      ) : (
      <Card>
        <CardHeader>
          <CardTitle>Print Results</CardTitle>
          <p className="text-sm text-slate-600">
            View and print published exam results only. Results appear here after admin review and publishing.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <FormField label="Academic Session">
            <Select
              value={academicYearBs}
              onChange={(event) => {
                setAcademicYearBs(event.target.value);
                setExamId("");
                setStudentId("");
              }}
            >
              <option value="">All sessions</option>
              {academicSessions.map((session) => (
                <option key={session} value={session}>
                  {session}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Exam">
            <Select
              value={examId}
              onChange={(event) => {
                setExamId(event.target.value);
                setStudentId("");
              }}
            >
              <option value="">Select published exam</option>
              {filteredExams.map((exam) => (
                <option key={exam._id} value={exam._id}>
                  {exam.name} ({exam.academicYearBs})
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={labels.primary}>
            <Select
              value={isCollege ? batchId : classId}
              onChange={(event) => {
                if (isCollege) {
                  setBatchId(event.target.value);
                  setYearId("");
                } else {
                  setClassId(event.target.value);
                  setSectionId("");
                }
                setStudentId("");
              }}
            >
              <option value="">Select {labels.primary.toLowerCase()}</option>
              {(isCollege ? batches : classes).map((item) => (
                <option key={item._id} value={item._id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={labels.secondary}>
            <Select
              value={isCollege ? yearId : sectionId}
              onChange={(event) => {
                if (isCollege) {
                  setYearId(event.target.value);
                } else {
                  setSectionId(event.target.value);
                }
                setStudentId("");
              }}
              disabled={isCollege ? !batchId : !classId}
            >
              <option value="">Select {labels.secondary.toLowerCase()}</option>
              {(isCollege ? filteredYears : filteredSections).map((item) => (
                <option key={item._id} value={item._id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Student (optional)">
            <Select
              value={studentId}
              onChange={(event) => setStudentId(event.target.value)}
              disabled={!filtersComplete}
            >
              <option value="">All students in scope</option>
              {scopeStudents.map((student) => (
                <option key={student._id} value={student._id}>
                  {student.user.fullName} (Roll {student.rollNumber})
                </option>
              ))}
            </Select>
          </FormField>
        </CardContent>
      </Card>
      )}

      {publishedExams.length > 0 && !filtersComplete ? (
        <EmptyState
          title="Select filters to load published results"
          description={`Choose a published exam, ${labels.primary.toLowerCase()}, and ${labels.secondary.toLowerCase()} to view the results grid.`}
        />
      ) : publishedExams.length > 0 && gridQuery.isError ? (
        <EmptyState
          title="Could not load results"
          description={parseErrorMessage(gridQuery.error)}
        />
      ) : publishedExams.length > 0 && gridQuery.isLoading ? (
        <LoadingState />
      ) : publishedExams.length > 0 && (!grid || grid.rows.length === 0) ? (
        <EmptyState
          title="No published results found"
          description="No published results match these filters. Ensure results were published for the selected batch/year and marks were entered for students."
        />
      ) : publishedExams.length > 0 && grid && grid.rows.length > 0 ? (
        <>
          <Card className="print:hidden">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>{selectedExam?.name ?? "Results"}</CardTitle>
                  <p className="mt-1 text-sm text-slate-600">
                    {scopeLabel}
                    {grid.academicYearBs ? ` · Session ${grid.academicYearBs}` : ""}
                    {" · "}
                    {grid.rows.length} student{grid.rows.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={printBulk}>
                    <Printer className="mr-2 h-4 w-4" />
                    Print Bulk
                  </Button>
                  <Button size="sm" variant="outline" disabled={exporting} onClick={() => void downloadExport()}>
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    {exporting ? "Exporting..." : "Export Excel"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <Table>
                  <TableHead>
                    <tr>
                      <Th>S.N.</Th>
                      <Th>Student</Th>
                      <Th>Roll</Th>
                      <Th>Reg. No.</Th>
                      {grid.subjects.map((subject) => (
                        <Th key={subject.subjectId}>{subject.subjectName}</Th>
                      ))}
                      <Th>Total</Th>
                      <Th>%</Th>
                      <Th>Grade</Th>
                      <Th>GPA</Th>
                      <Th>Status</Th>
                      <Th />
                    </tr>
                  </TableHead>
                  <TableBody>
                    {grid.rows.map((row) => (
                      <tr key={row.resultId}>
                        <Td>{row.sn}</Td>
                        <Td>{row.studentName}</Td>
                        <Td>{row.rollNumber}</Td>
                        <Td>{row.registrationNumber}</Td>
                        {grid.subjects.map((subject) => (
                          <Td key={subject.subjectId}>{row.subjectMarks[subject.subjectId] ?? "—"}</Td>
                        ))}
                        <Td>
                          {row.totalMarks}/{row.totalFullMarks}
                        </Td>
                        <Td>{row.percentage}%</Td>
                        <Td>
                          <Badge>{row.grade}</Badge>
                        </Td>
                        <Td>{row.gpa.toFixed(2)}</Td>
                        <Td>
                          <Badge className={row.passFailStatus === "PASS" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}>
                            {row.passFailStatus}
                          </Badge>
                        </Td>
                        <Td>
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setStudentId(row.studentId)}
                            >
                              Marksheet
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Open marksheet to download PDF"
                              onClick={() => setStudentId(row.studentId)}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="print-results-bulk-table">
            <div className="mb-4 text-center">
              <h1 className="text-lg font-bold">{grid.collegeName ?? "College"}</h1>
              {grid.collegeNameNp ? <p className="text-sm text-slate-700">{grid.collegeNameNp}</p> : null}
              <h2 className="mt-2 text-base font-semibold">{selectedExam?.name}</h2>
              <p className="text-sm text-slate-600">
                {scopeLabel}
                {grid.academicYearBs ? ` · Academic Session: ${grid.academicYearBs}` : ""}
              </p>
              <p className="text-xs text-slate-500">Published Results · {grid.rows.length} students</p>
            </div>
            <table className="w-full border-collapse border border-slate-300 text-[10px]">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-300 px-1.5 py-1 text-left">S.N.</th>
                  <th className="border border-slate-300 px-1.5 py-1 text-left">Student</th>
                  <th className="border border-slate-300 px-1.5 py-1 text-left">Roll</th>
                  <th className="border border-slate-300 px-1.5 py-1 text-left">Reg. No.</th>
                  {grid.subjects.map((subject) => (
                    <th key={subject.subjectId} className="border border-slate-300 px-1.5 py-1 text-left">
                      {subject.subjectName}
                    </th>
                  ))}
                  <th className="border border-slate-300 px-1.5 py-1 text-left">Total</th>
                  <th className="border border-slate-300 px-1.5 py-1 text-left">%</th>
                  <th className="border border-slate-300 px-1.5 py-1 text-left">Grade</th>
                  <th className="border border-slate-300 px-1.5 py-1 text-left">GPA</th>
                  <th className="border border-slate-300 px-1.5 py-1 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((row) => (
                  <tr key={row.resultId}>
                    <td className="border border-slate-300 px-1.5 py-1">{row.sn}</td>
                    <td className="border border-slate-300 px-1.5 py-1">{row.studentName}</td>
                    <td className="border border-slate-300 px-1.5 py-1">{row.rollNumber}</td>
                    <td className="border border-slate-300 px-1.5 py-1">{row.registrationNumber}</td>
                    {grid.subjects.map((subject) => (
                      <td key={subject.subjectId} className="border border-slate-300 px-1.5 py-1">
                        {row.subjectMarks[subject.subjectId] ?? "—"}
                      </td>
                    ))}
                    <td className="border border-slate-300 px-1.5 py-1">
                      {row.totalMarks}/{row.totalFullMarks}
                    </td>
                    <td className="border border-slate-300 px-1.5 py-1">{row.percentage}%</td>
                    <td className="border border-slate-300 px-1.5 py-1">{row.grade}</td>
                    <td className="border border-slate-300 px-1.5 py-1">{row.gpa.toFixed(2)}</td>
                    <td className="border border-slate-300 px-1.5 py-1">{row.passFailStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {studentId ? (
            <div className="print:hidden space-y-3">
              <div className="flex justify-end">
                <Button size="sm" variant="outline" onClick={() => setStudentId("")}>
                  Back to bulk view
                </Button>
              </div>
              {marksheetQuery.isLoading ? (
                <LoadingState />
              ) : marksheetQuery.data ? (
                <ResultMarksheetView data={marksheetQuery.data} />
              ) : (
                <EmptyState title="Marksheet unavailable" description="Could not load the marksheet for this student." />
              )}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
};