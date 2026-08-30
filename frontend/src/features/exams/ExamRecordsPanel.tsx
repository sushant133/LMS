import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  ExamRecordSheet,
  ExamRecordSummary,
  StudentExamHistory,
  StudentRecord,
} from "@phit-erp/shared";
import {
  ArrowLeft,
  Download,
  History,
  Printer,
  Search,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { printBulkResultsElement } from "lib/printUtils";
import { parseErrorMessage } from "lib/utils";

interface ExamRecordsPanelProps {
  batches: Array<{ _id: string; name: string }>;
  years: Array<{ _id: string; name: string; batchId?: string }>;
  classes: Array<{ _id: string; name: string }>;
  sections: Array<{ _id: string; name: string; classId?: string }>;
  students: StudentRecord[];
  isCollege?: boolean;
}

const idStr = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "_id" in value) {
    return String((value as { _id: unknown })._id ?? "");
  }
  return String(value);
};

/**
 * Exam Records — where the administration reads back students' previous exams.
 *
 * Pick a batch and year (or class and section) and every completed exam for that cohort
 * is listed: First Term, Second Term, and so on. Opening one shows that exam's full marks
 * sheet on its own, so the First Term result stays available while the Third Term is
 * still being scheduled. The "By student" tab follows a single student across every term
 * they have sat.
 *
 * This screen is read-only — corrections still go through Enter Marks and the result
 * approval workflow.
 */
export const ExamRecordsPanel = ({
  batches,
  years,
  classes,
  sections,
  students,
  isCollege = false,
}: ExamRecordsPanelProps) => {
  const [mode, setMode] = useState<"cohort" | "student">("cohort");

  const [batchId, setBatchId] = useState("");
  const [yearId, setYearId] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [openExamId, setOpenExamId] = useState("");

  const [studentSearch, setStudentSearch] = useState("");
  const [studentId, setStudentId] = useState("");

  const [isPrinting, setIsPrinting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const yearsForBatch = useMemo(
    () =>
      batchId
        ? years.filter((year) => idStr(year.batchId) === batchId)
        : years,
    [batchId, years],
  );

  const sectionsForClass = useMemo(
    () =>
      classId
        ? sections.filter((section) => idStr(section.classId) === classId)
        : sections,
    [classId, sections],
  );

  const cohortComplete = isCollege
    ? Boolean(batchId && yearId)
    : Boolean(classId && sectionId);

  const cohortParams = useMemo(
    () =>
      isCollege
        ? { batchId: batchId || undefined, yearId: yearId || undefined }
        : { classId: classId || undefined, sectionId: sectionId || undefined },
    [batchId, classId, isCollege, sectionId, yearId],
  );

  /** Every exam this cohort has marks for — First Term, Second Term, … */
  const examsQuery = useQuery({
    queryKey: ["exam-records", "exams", cohortParams],
    queryFn: () =>
      unwrap<ExamRecordSummary[]>(
        api.get("/exams/records/exams", { params: cohortParams }),
      ),
    enabled: cohortComplete,
  });

  /** The one exam the user opened. */
  const sheetQuery = useQuery({
    queryKey: ["exam-records", "sheet", openExamId, cohortParams],
    queryFn: () =>
      unwrap<ExamRecordSheet>(
        api.get("/exams/records/sheet", {
          params: { ...cohortParams, examId: openExamId },
        }),
      ),
    enabled: Boolean(openExamId) && cohortComplete,
  });

  const historyQuery = useQuery({
    queryKey: ["exam-records", "student", studentId],
    queryFn: () =>
      unwrap<StudentExamHistory>(
        api.get("/exams/records/student", { params: { studentId } }),
      ),
    enabled: mode === "student" && Boolean(studentId),
  });

  // Changing the cohort invalidates whichever exam was open.
  useEffect(() => {
    setOpenExamId("");
  }, [batchId, yearId, classId, sectionId]);

  const filteredStudents = useMemo(() => {
    const term = studentSearch.trim().toLowerCase();
    const scoped = students.filter((student) => {
      if (isCollege) {
        if (batchId && idStr(student.batchId) !== batchId) return false;
        if (yearId && idStr(student.yearId) !== yearId) return false;
      } else {
        if (classId && idStr(student.classId) !== classId) return false;
        if (sectionId && idStr(student.sectionId) !== sectionId) return false;
      }
      return true;
    });
    if (!term) return scoped.slice(0, 200);
    return scoped
      .filter((student) => {
        const name = (
          (student.user as { fullName?: string } | undefined)?.fullName ?? ""
        ).toLowerCase();
        const roll = String(student.rollNumber ?? "");
        const reg = String(student.registrationNumber ?? "");
        return (
          name.includes(term) || roll.includes(term) || reg.includes(term)
        );
      })
      .slice(0, 200);
  }, [batchId, classId, isCollege, sectionId, studentSearch, students, yearId]);

  const cohortLabel = useMemo(() => {
    if (isCollege) {
      const year = years.find((row) => idStr(row._id) === yearId)?.name;
      const batch = batches.find((row) => idStr(row._id) === batchId)?.name;
      return [year, batch].filter(Boolean).join(" · ");
    }
    const cls = classes.find((row) => idStr(row._id) === classId)?.name;
    const sec = sections.find((row) => idStr(row._id) === sectionId)?.name;
    return [cls, sec].filter(Boolean).join(" · ");
  }, [batchId, batches, classId, classes, isCollege, sectionId, sections, yearId, years]);

  const sheetPrintId = "exam-record-print-sheet";
  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      await printBulkResultsElement(document.getElementById(sheetPrintId));
    } catch (error) {
      toast.error(parseErrorMessage(error));
    } finally {
      setIsPrinting(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await api.get("/exams/records/sheet/export", {
        params: { ...cohortParams, examId: openExamId },
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      const disposition = response.headers["content-disposition"];
      let filename = "exam-record.csv";
      if (disposition) {
        const match = disposition.match(/filename="(.+)"/);
        if (match) filename = match[1];
      }
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Exam record exported (CSV)");
    } catch (error) {
      toast.error(parseErrorMessage(error));
    } finally {
      setIsExporting(false);
    }
  };

  const sheet = sheetQuery.data;

  /* ── Cohort filter bar ─────────────────────────────────────────────────── */
  const filterBar = (
    <div className="grid gap-3 md:grid-cols-3">
      {isCollege ? (
        <>
          <FormField label="Batch">
            <Select
              value={batchId}
              onChange={(event) => {
                setBatchId(event.target.value);
                setYearId("");
              }}
            >
              <option value="">Select batch</option>
              {batches.map((batch) => (
                <option key={batch._id} value={batch._id}>
                  {batch.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Year">
            <Select
              value={yearId}
              onChange={(event) => setYearId(event.target.value)}
              disabled={!batchId}
            >
              <option value="">Select year</option>
              {yearsForBatch.map((year) => (
                <option key={year._id} value={year._id}>
                  {year.name}
                </option>
              ))}
            </Select>
          </FormField>
        </>
      ) : (
        <>
          <FormField label="Class">
            <Select
              value={classId}
              onChange={(event) => {
                setClassId(event.target.value);
                setSectionId("");
              }}
            >
              <option value="">Select class</option>
              {classes.map((row) => (
                <option key={row._id} value={row._id}>
                  {row.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Section">
            <Select
              value={sectionId}
              onChange={(event) => setSectionId(event.target.value)}
              disabled={!classId}
            >
              <option value="">Select section</option>
              {sectionsForClass.map((row) => (
                <option key={row._id} value={row._id}>
                  {row.name}
                </option>
              ))}
            </Select>
          </FormField>
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <History className="h-5 w-5 text-brand-600" />
                Exam Records — previous exams &amp; results
              </CardTitle>
              <p className="mt-1 max-w-3xl text-sm text-slate-600">
                Look up any completed exam for any batch and year. Once First
                Term is done you can open its marks and results on their own,
                even while Second or Third Term is still being prepared. Switch
                to <span className="font-medium">By student</span> to see one
                student&apos;s marks across every term.
              </p>
            </div>
            <div className="flex overflow-hidden rounded-lg border border-slate-300 bg-white">
              <button
                type="button"
                onClick={() => setMode("cohort")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors ${
                  mode === "cohort"
                    ? "bg-brand-600 text-white"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                By exam
              </button>
              <button
                type="button"
                onClick={() => setMode("student")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors ${
                  mode === "student"
                    ? "bg-brand-600 text-white"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <Search className="h-3.5 w-3.5" />
                By student
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {filterBar}
          {mode === "student" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <FormField label="Find student (name, roll or registration no.)">
                <Input
                  value={studentSearch}
                  placeholder="e.g. Sita, 12, 2081-045"
                  onChange={(event) => setStudentSearch(event.target.value)}
                />
              </FormField>
              <FormField label="Student">
                <Select
                  value={studentId}
                  onChange={(event) => setStudentId(event.target.value)}
                >
                  <option value="">Select student</option>
                  {filteredStudents.map((student) => {
                    const name =
                      (student.user as { fullName?: string } | undefined)
                        ?.fullName ?? "Student";
                    return (
                      <option key={student._id} value={student._id}>
                        {name}
                        {student.rollNumber
                          ? ` · Roll ${student.rollNumber}`
                          : ""}
                      </option>
                    );
                  })}
                </Select>
              </FormField>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ── By student: every term, newest first ───────────────────────────── */}
      {mode === "student" ? (
        !studentId ? (
          <EmptyState
            title="Select a student"
            description="Pick a batch and year to narrow the list, then choose a student to see every exam they have sat."
          />
        ) : historyQuery.isLoading ? (
          <LoadingState />
        ) : !historyQuery.data || historyQuery.data.exams.length === 0 ? (
          <EmptyState
            title="No exam records for this student"
            description="This student has no marks entered against any exam yet."
          />
        ) : (
          <div className="space-y-4">
            <Card>
              <CardHeader className="border-b border-slate-100 bg-slate-50/80 pb-3">
                <CardTitle className="text-base">
                  {historyQuery.data.student.studentName}
                </CardTitle>
                <p className="text-sm text-slate-500">
                  {[
                    historyQuery.data.student.yearName,
                    historyQuery.data.student.batchName,
                    historyQuery.data.student.className,
                    historyQuery.data.student.sectionName,
                    historyQuery.data.student.rollNumber
                      ? `Roll ${historyQuery.data.student.rollNumber}`
                      : "",
                    historyQuery.data.student.registrationNumber
                      ? `Reg. ${historyQuery.data.student.registrationNumber}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <Table>
                    <TableHead>
                      <tr>
                        <Th>Exam</Th>
                        <Th>Academic Year</Th>
                        <Th className="text-center">Total</Th>
                        <Th className="text-center">%</Th>
                        <Th className="text-center">GPA</Th>
                        <Th className="text-center">Grade</Th>
                        <Th className="text-center">Result</Th>
                        <Th className="text-center">Released</Th>
                      </tr>
                    </TableHead>
                    <TableBody>
                      {historyQuery.data.exams.map((entry) => (
                        <tr key={entry.examId}>
                          <Td>
                            <div className="font-medium text-slate-900">
                              {entry.examName}
                            </div>
                            <div className="text-xs text-slate-500">
                              {entry.startDateBs}
                            </div>
                          </Td>
                          <Td>{entry.academicYearBs}</Td>
                          <Td className="text-center tabular-nums">
                            {entry.totalObtained}/{entry.totalFull}
                          </Td>
                          <Td className="text-center tabular-nums">
                            {entry.percentage}
                          </Td>
                          <Td className="text-center tabular-nums">
                            {entry.gpa}
                          </Td>
                          <Td className="text-center">{entry.grade ?? "—"}</Td>
                          <Td className="text-center">
                            <Badge
                              className={
                                entry.passFailStatus === "PASS"
                                  ? "bg-brand-100 text-brand-700"
                                  : "bg-red-100 text-red-700"
                              }
                            >
                              {entry.passFailStatus ?? "—"}
                            </Badge>
                          </Td>
                          <Td className="text-center text-xs text-slate-500">
                            {entry.released
                              ? (entry.publishedAtBs ?? "Yes")
                              : "Not released"}
                          </Td>
                        </tr>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Per-term subject breakdown */}
            {historyQuery.data.exams.map((entry) => (
              <Card key={`${entry.examId}-detail`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    {entry.examName} — subject marks
                  </CardTitle>
                  <p className="text-sm text-slate-500">
                    {entry.academicYearBs} · {entry.marks.length} subject
                    {entry.marks.length === 1 ? "" : "s"}
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <Table>
                      <TableHead>
                        <tr>
                          <Th>Subject</Th>
                          <Th className="text-center">Full</Th>
                          <Th className="text-center">Pass</Th>
                          <Th className="text-center">Obtained</Th>
                          <Th className="text-center">Grade</Th>
                          <Th className="text-center">Result</Th>
                        </tr>
                      </TableHead>
                      <TableBody>
                        {entry.marks.map((mark) => (
                          <tr key={mark.subjectId}>
                            <Td className="font-medium text-slate-900">
                              {mark.subjectName}
                              {mark.subjectCode ? (
                                <span className="ml-1.5 text-xs font-normal text-slate-400">
                                  {mark.subjectCode}
                                </span>
                              ) : null}
                            </Td>
                            <Td className="text-center tabular-nums">
                              {mark.fullMarks}
                            </Td>
                            <Td className="text-center tabular-nums">
                              {mark.passMarks}
                            </Td>
                            <Td
                              className={`text-center tabular-nums ${
                                mark.passFail === "FAIL"
                                  ? "font-semibold text-red-600"
                                  : ""
                              }`}
                            >
                              {mark.obtainedMarks}
                            </Td>
                            <Td className="text-center">{mark.grade ?? "—"}</Td>
                            <Td className="text-center">
                              {mark.passFail ?? "—"}
                            </Td>
                          </tr>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : /* ── By exam: cohort's exam list, then one exam's sheet ───────────── */
      !cohortComplete ? (
        <EmptyState
          title={isCollege ? "Select a batch and year" : "Select a class and section"}
          description="Choose a cohort above and every exam it has completed will be listed here."
        />
      ) : openExamId ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOpenExamId("")}
            >
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              All exams
            </Button>
            {sheet ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handlePrint()}
                  disabled={isPrinting}
                >
                  <Printer className="mr-1.5 h-4 w-4" />
                  {isPrinting ? "Preparing…" : "Print"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleExport()}
                  disabled={isExporting}
                >
                  <Download className="mr-1.5 h-4 w-4" />
                  {isExporting ? "Exporting…" : "Export CSV"}
                </Button>
              </>
            ) : null}
          </div>

          {sheetQuery.isLoading ? (
            <LoadingState />
          ) : !sheet || sheet.rows.length === 0 ? (
            <EmptyState
              title="No marks for this exam"
              description="No student in this batch/year has marks entered against this exam."
            />
          ) : (
            <>
              <Card>
                <CardHeader className="border-b border-slate-100 bg-slate-50/80">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg">
                        {sheet.exam.name} — {cohortLabel}
                      </CardTitle>
                      <p className="mt-1 text-sm text-slate-500">
                        Academic year {sheet.exam.academicYearBs} ·{" "}
                        {sheet.exam.startDateBs} to {sheet.exam.endDateBs}
                        {sheet.exam.resultPublishDateBs
                          ? ` · Results published ${sheet.exam.resultPublishDateBs}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge
                        className={
                          sheet.exam.resultsPublished
                            ? "bg-brand-100 text-brand-700"
                            : "bg-amber-100 text-amber-800"
                        }
                      >
                        {sheet.exam.resultsPublished
                          ? "Results published"
                          : "Not published"}
                      </Badge>
                      {sheet.exam.resultsLocked ? (
                        <Badge className="bg-slate-200 text-slate-700">
                          Locked
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-4">
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <Table>
                      <TableHead>
                        <tr>
                          <Th className="w-12">S.N.</Th>
                          <Th>Student</Th>
                          <Th>Roll</Th>
                          <Th>Reg. No.</Th>
                          {sheet.subjects.map((subject) => (
                            <Th key={subject.subjectId} className="text-center">
                              <div>{subject.subjectName}</div>
                              <div className="text-xs font-normal text-slate-400">
                                FM {subject.fullMarks} / PM {subject.passMarks}
                              </div>
                              {!subject.published ? (
                                <div className="text-[10px] font-normal uppercase tracking-wide text-amber-600">
                                  unpublished
                                </div>
                              ) : null}
                            </Th>
                          ))}
                          <Th className="text-center">Total</Th>
                          <Th className="text-center">%</Th>
                          <Th className="text-center">GPA</Th>
                          <Th className="text-center">Grade</Th>
                          <Th className="text-center">Result</Th>
                        </tr>
                      </TableHead>
                      <TableBody>
                        {sheet.rows.map((row, index) => (
                          <tr key={row.resultId}>
                            <Td>{index + 1}</Td>
                            <Td className="font-medium text-slate-900">
                              {row.studentName}
                              {!row.released ? (
                                <span className="ml-1.5 text-[10px] uppercase tracking-wide text-amber-600">
                                  not released
                                </span>
                              ) : null}
                            </Td>
                            <Td>{row.rollNumber ?? "—"}</Td>
                            <Td className="font-mono text-xs">
                              {row.registrationNumber || "—"}
                            </Td>
                            {sheet.subjects.map((subject) => {
                              const mark = row.marks[subject.subjectId];
                              return (
                                <Td
                                  key={subject.subjectId}
                                  className={`text-center tabular-nums ${
                                    mark?.passFail === "FAIL"
                                      ? "font-semibold text-red-600"
                                      : ""
                                  }`}
                                >
                                  {mark ? mark.obtainedMarks : "—"}
                                </Td>
                              );
                            })}
                            <Td className="text-center tabular-nums">
                              {row.totalObtained}/{row.totalFull}
                            </Td>
                            <Td className="text-center tabular-nums">
                              {row.percentage}
                            </Td>
                            <Td className="text-center tabular-nums">
                              {row.gpa}
                            </Td>
                            <Td className="text-center">{row.grade ?? "—"}</Td>
                            <Td className="text-center">
                              <Badge
                                className={
                                  row.passFailStatus === "PASS"
                                    ? "bg-brand-100 text-brand-700"
                                    : "bg-red-100 text-red-700"
                                }
                              >
                                {row.passFailStatus ?? "—"}
                              </Badge>
                            </Td>
                          </tr>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              {/* Hidden A4 landscape sheet cloned by the Print button */}
              <div
                id={sheetPrintId}
                className="print-results-bulk-table iar-report"
              >
                <div className="iar-title">EXAMINATION RECORD</div>
                <div className="iar-sheet-title">
                  {sheet.exam.name}
                  {cohortLabel ? ` — ${cohortLabel}` : ""}
                </div>
                <table className="iar-meta" cellSpacing={0} cellPadding={0}>
                  <tbody>
                    <tr>
                      <td>
                        <span className="iar-meta-k">Academic Year:</span>{" "}
                        {sheet.exam.academicYearBs}
                      </td>
                      <td>
                        <span className="iar-meta-k">Exam Dates:</span>{" "}
                        {sheet.exam.startDateBs} to {sheet.exam.endDateBs}
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <span className="iar-meta-k">Result Published:</span>{" "}
                        {sheet.exam.resultPublishDateBs || "Not published"}
                      </td>
                      <td>
                        <span className="iar-meta-k">Students:</span>{" "}
                        {sheet.rows.length}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <table className="iar-marks" cellSpacing={0} cellPadding={0}>
                  <thead>
                    <tr>
                      <th>S.N.</th>
                      <th>Reg. No.</th>
                      <th>Roll</th>
                      <th>Student Name</th>
                      {sheet.subjects.map((subject) => (
                        <th key={subject.subjectId}>
                          {subject.subjectName}
                          <br />({subject.fullMarks})
                        </th>
                      ))}
                      <th>Total</th>
                      <th>%</th>
                      <th>Grade</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.rows.map((row, index) => (
                      <tr key={row.resultId}>
                        <td className="iar-sn">{index + 1}</td>
                        <td className="iar-regd">{row.registrationNumber}</td>
                        <td className="iar-symbol">{row.rollNumber ?? ""}</td>
                        <td className="iar-name">{row.studentName}</td>
                        {sheet.subjects.map((subject) => (
                          <td
                            key={subject.subjectId}
                            style={{ textAlign: "center" }}
                          >
                            {row.marks[subject.subjectId]?.obtainedMarks ?? ""}
                          </td>
                        ))}
                        <td style={{ textAlign: "center" }}>
                          {row.totalObtained}/{row.totalFull}
                        </td>
                        <td style={{ textAlign: "center" }}>{row.percentage}</td>
                        <td style={{ textAlign: "center" }}>
                          {row.grade ?? ""}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {row.passFailStatus ?? ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      ) : examsQuery.isLoading ? (
        <LoadingState />
      ) : (examsQuery.data ?? []).length === 0 ? (
        <EmptyState
          title="No exam records for this cohort"
          description="No marks have been entered for this batch/year yet. Once a term's marks are entered, that exam appears here."
        />
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Completed exams — {cohortLabel}
            </CardTitle>
            <p className="text-sm text-slate-500">
              Newest term first. Open any exam to read its full marks sheet on
              its own.
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Exam</Th>
                    <Th>Academic Year</Th>
                    <Th>Exam Dates</Th>
                    <Th className="text-center">Students</Th>
                    <Th className="text-center">Subjects</Th>
                    <Th className="text-center">Pass / Fail</Th>
                    <Th className="text-center">Avg %</Th>
                    <Th className="text-center">Status</Th>
                    <Th />
                  </tr>
                </TableHead>
                <TableBody>
                  {(examsQuery.data ?? []).map((row) => (
                    <tr key={row.examId}>
                      <Td className="font-medium text-slate-900">
                        {row.examName}
                      </Td>
                      <Td>{row.academicYearBs}</Td>
                      <Td className="text-xs text-slate-600">
                        {row.startDateBs} — {row.endDateBs}
                      </Td>
                      <Td className="text-center tabular-nums">
                        {row.studentCount}
                      </Td>
                      <Td className="text-center tabular-nums">
                        {row.subjectCount}
                        {row.publishedSubjectCount < row.subjectCount ? (
                          <span className="ml-1 text-xs text-amber-600">
                            ({row.publishedSubjectCount} published)
                          </span>
                        ) : null}
                      </Td>
                      <Td className="text-center tabular-nums">
                        <span className="text-brand-700">{row.passCount}</span>
                        {" / "}
                        <span className="text-red-600">{row.failCount}</span>
                      </Td>
                      <Td className="text-center tabular-nums">
                        {row.averagePercentage}%
                      </Td>
                      <Td className="text-center">
                        <Badge
                          className={
                            row.resultsPublished
                              ? "bg-brand-100 text-brand-700"
                              : "bg-amber-100 text-amber-800"
                          }
                        >
                          {row.resultsPublished ? "Published" : "In progress"}
                        </Badge>
                      </Td>
                      <Td>
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setOpenExamId(row.examId)}
                          >
                            View marks &amp; results
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
      )}
    </div>
  );
};
