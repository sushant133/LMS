import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ExamRecord, ResultInput, ResultMarkInput, ResultRecord, StudentRecord, SubjectRecord } from "@nepal-school-erp/shared";
import { EXAM_ATTENDANCE_STATUSES, computeSubjectMark, resultSchema } from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Textarea } from "components/ui/textarea";
import { defaultResultValue } from "features/exams/examDefaults";
import { getAcademicLabels } from "lib/academicStructureUtils";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { filterSectionsByClass, filterYearsByBatch, filterSubjectsByClass, filterSubjectsByYear, hasSingleOption } from "lib/teacherScopeUtils";
import { parseErrorMessage } from "lib/utils";

interface ExamMarksEntryProps {
  exams: ExamRecord[];
  subjects: SubjectRecord[];
  students: StudentRecord[];
  batches: Array<{ _id: string; name: string }>;
  years: Array<{ _id: string; name: string; batchId: string }>;
  classes: Array<{ _id: string; name: string }>;
  sections: Array<{ _id: string; name: string; classId: string }>;
  existingResults: ResultRecord[];
  isCollege: boolean;
  resultsLockedExamIds: Set<string>;
}

const buildDefaultMark = (subject?: SubjectRecord): ResultMarkInput => ({
  subjectId: subject?._id ?? "",
  fullMarks: subject?.fullMarks ?? 100,
  passMarks: subject?.passMarks ?? 35,
  theoryMarks: 0,
  practicalMarks: 0,
  internalMarks: 0,
  attendanceStatus: "PRESENT",
  teacherRemarks: ""
});

export const ExamMarksEntry = ({
  exams,
  subjects,
  students,
  batches,
  years,
  classes,
  sections,
  existingResults,
  isCollege,
  resultsLockedExamIds
}: ExamMarksEntryProps) => {
  const labels = getAcademicLabels(isCollege ? "COLLEGE" : "SCHOOL");
  const [resultForm, setResultForm] = useState<ResultInput>(defaultResultValue);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [markForm, setMarkForm] = useState<ResultMarkInput>(buildDefaultMark());

  const filteredYears = useMemo(() => filterYearsByBatch(years, resultForm.batchId ?? ""), [resultForm.batchId, years]);
  const filteredSections = useMemo(() => filterSectionsByClass(sections, resultForm.classId ?? ""), [resultForm.classId, sections]);
  const teacherFormSubjects = useMemo(
    () =>
      (isCollege
        ? filterSubjectsByYear(subjects, resultForm.yearId ?? "")
        : filterSubjectsByClass(subjects, resultForm.classId ?? "")) as SubjectRecord[],
    [isCollege, resultForm.classId, resultForm.yearId, subjects]
  );
  const filteredStudents = useMemo(
    () =>
      students.filter((student) =>
        isCollege
          ? student.batchId === resultForm.batchId && student.yearId === resultForm.yearId
          : student.classId === resultForm.classId && student.sectionId === resultForm.sectionId
      ),
    [isCollege, resultForm.batchId, resultForm.classId, resultForm.sectionId, resultForm.yearId, students]
  );

  const selectedSubject = useMemo(
    () => teacherFormSubjects.find((subject) => subject._id === selectedSubjectId) ?? subjects.find((subject) => subject._id === selectedSubjectId),
    [selectedSubjectId, subjects, teacherFormSubjects]
  );

  const selectedExam = useMemo(() => exams.find((exam) => exam._id === resultForm.examId), [exams, resultForm.examId]);
  const isLocked = selectedExam ? resultsLockedExamIds.has(selectedExam._id) || selectedExam.resultsLocked : false;

  useEffect(() => {
    if (hasSingleOption(isCollege ? batches : classes) && (isCollege ? resultForm.batchId : resultForm.classId) !== (isCollege ? batches : classes)[0]!._id) {
      setResultForm((current) =>
        isCollege
          ? { ...current, batchId: batches[0]!._id, yearId: "", studentId: "" }
          : { ...current, classId: classes[0]!._id, sectionId: "", studentId: "" }
      );
    }
  }, [batches, classes, isCollege, resultForm.batchId, resultForm.classId]);

  useEffect(() => {
    if (!isCollege && hasSingleOption(filteredSections) && resultForm.sectionId !== filteredSections[0]!._id) {
      setResultForm((current) => ({ ...current, sectionId: filteredSections[0]!._id, studentId: "" }));
    }
  }, [filteredSections, isCollege, resultForm.sectionId]);

  useEffect(() => {
    if (isCollege && hasSingleOption(filteredYears) && resultForm.yearId !== filteredYears[0]!._id) {
      setResultForm((current) => ({ ...current, yearId: filteredYears[0]!._id, studentId: "" }));
    }
  }, [filteredYears, isCollege, resultForm.yearId]);

  useEffect(() => {
    if (hasSingleOption(teacherFormSubjects) && selectedSubjectId !== teacherFormSubjects[0]!._id) {
      setSelectedSubjectId(teacherFormSubjects[0]!._id);
    }
  }, [selectedSubjectId, teacherFormSubjects]);

  useEffect(() => {
    if (!selectedSubjectId) {
      return;
    }
    const subject = teacherFormSubjects.find((item) => item._id === selectedSubjectId) ?? subjects.find((item) => item._id === selectedSubjectId);
    setMarkForm(buildDefaultMark(subject));
  }, [selectedSubjectId, subjects, teacherFormSubjects]);

  useEffect(() => {
    if (!resultForm.examId || !resultForm.studentId || !selectedSubjectId) {
      return;
    }

    const existing = existingResults.find((result) => result.examId === resultForm.examId && result.studentId === resultForm.studentId);
    const existingMark = existing?.marks.find((mark) => mark.subjectId === selectedSubjectId);
    const subject = selectedSubject;

    if (existingMark) {
      setMarkForm({
        subjectId: selectedSubjectId,
        fullMarks: existingMark.fullMarks ?? subject?.fullMarks ?? 100,
        passMarks: existingMark.passMarks ?? subject?.passMarks ?? 35,
        theoryMarks: existingMark.theoryMarks ?? 0,
        practicalMarks: existingMark.practicalMarks ?? 0,
        internalMarks: existingMark.internalMarks ?? 0,
        attendanceStatus: existingMark.attendanceStatus ?? "PRESENT",
        teacherRemarks: existingMark.teacherRemarks ?? ""
      });
    }
  }, [existingResults, resultForm.examId, resultForm.studentId, selectedSubject, selectedSubjectId]);

  const computedPreview = useMemo(() => computeSubjectMark({ ...markForm, obtainedMarks: 0 }), [markForm]);

  const resultMutation = useMutation({
    mutationFn: async (payload: ResultInput) => unwrap<ResultRecord>(api.post("/exams/results", payload)),
    onSuccess: async () => {
      toast.success("Marks saved");
      await queryClient.invalidateQueries({ queryKey: ["results"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const scopeReady = isCollege ? Boolean(resultForm.batchId && resultForm.yearId) : Boolean(resultForm.classId && resultForm.sectionId);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (isLocked) {
          toast.error("Results are locked by the college admin");
          return;
        }
        if (!selectedSubjectId) {
          toast.error("Select a subject");
          return;
        }
        const parsed = resultSchema.safeParse({
          ...resultForm,
          marks: [{ ...markForm, subjectId: selectedSubjectId }]
        });
        if (!parsed.success) {
          toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
          return;
        }
        void resultMutation.mutateAsync(parsed.data);
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Exam">
          <Select
            value={resultForm.examId}
            onChange={(event) => setResultForm((current) => ({ ...current, examId: event.target.value }))}
          >
            <option value="">Select exam</option>
            {exams.map((exam) => (
              <option key={exam._id} value={exam._id}>
                {exam.name}
                {exam.resultsLocked ? " (Locked)" : ""}
              </option>
            ))}
          </Select>
        </FormField>
        {hasSingleOption(isCollege ? batches : classes) ? (
          <FormField label={labels.primary}>
            <Input value={(isCollege ? batches : classes)[0]!.name} readOnly disabled />
          </FormField>
        ) : (
          <FormField label={labels.primary}>
            <Select
              value={isCollege ? resultForm.batchId : resultForm.classId}
              onChange={(event) => {
                setSelectedSubjectId("");
                setResultForm((current) =>
                  isCollege
                    ? { ...current, batchId: event.target.value, yearId: "", studentId: "" }
                    : { ...current, classId: event.target.value, sectionId: "", studentId: "" }
                );
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
        )}
        {hasSingleOption(isCollege ? filteredYears : filteredSections) ? (
          <FormField label={labels.secondary}>
            <Input value={(isCollege ? filteredYears : filteredSections)[0]!.name} readOnly disabled />
          </FormField>
        ) : (
          <FormField label={labels.secondary}>
            <Select
              value={isCollege ? resultForm.yearId : resultForm.sectionId}
              onChange={(event) =>
                setResultForm((current) =>
                  isCollege
                    ? { ...current, yearId: event.target.value, studentId: "" }
                    : { ...current, sectionId: event.target.value, studentId: "" }
                )
              }
              disabled={!scopeReady}
            >
              <option value="">Select {labels.secondary.toLowerCase()}</option>
              {(isCollege ? filteredYears : filteredSections).map((item) => (
                <option key={item._id} value={item._id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        <FormField label="Student">
          <Select
            value={resultForm.studentId}
            onChange={(event) => setResultForm((current) => ({ ...current, studentId: event.target.value }))}
            disabled={!scopeReady}
          >
            <option value="">Select student</option>
            {filteredStudents.map((student) => (
              <option key={student._id} value={student._id}>
                {student.user.fullName}
              </option>
            ))}
          </Select>
        </FormField>
        {hasSingleOption(teacherFormSubjects) ? (
          <FormField label="Subject">
            <Input value={teacherFormSubjects[0]!.name} readOnly disabled />
          </FormField>
        ) : (
          <FormField label="Subject">
            <Select value={selectedSubjectId} onChange={(event) => setSelectedSubjectId(event.target.value)} disabled={!scopeReady}>
              <option value="">Select subject</option>
              {teacherFormSubjects.map((subject) => (
                <option key={subject._id} value={subject._id}>
                  {subject.name}
                </option>
              ))}
            </Select>
          </FormField>
        )}
      </div>

      {isLocked ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Results for this exam are locked. Contact the college admin to unlock before editing marks.
        </p>
      ) : null}

      {selectedSubjectId && !isLocked ? (
        <div className="rounded-2xl border border-slate-200 p-4">
          <h4 className="font-medium text-slate-900">
            Marks — {selectedSubject?.name ?? "Subject"}
          </h4>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <FormField label="Full Marks">
              <Input
                type="number"
                min={1}
                value={markForm.fullMarks}
                onChange={(event) => setMarkForm((current) => ({ ...current, fullMarks: Number(event.target.value) }))}
              />
            </FormField>
            <FormField label="Pass Marks">
              <Input
                type="number"
                min={0}
                value={markForm.passMarks}
                onChange={(event) => setMarkForm((current) => ({ ...current, passMarks: Number(event.target.value) }))}
              />
            </FormField>
            <FormField label="Attendance">
              <Select
                value={markForm.attendanceStatus}
                onChange={(event) =>
                  setMarkForm((current) => ({ ...current, attendanceStatus: event.target.value as ResultMarkInput["attendanceStatus"] }))
                }
              >
                {EXAM_ATTENDANCE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Theory Marks">
              <Input
                type="number"
                min={0}
                value={markForm.theoryMarks ?? 0}
                onChange={(event) => setMarkForm((current) => ({ ...current, theoryMarks: Number(event.target.value) }))}
              />
            </FormField>
            <FormField label="Practical Marks">
              <Input
                type="number"
                min={0}
                value={markForm.practicalMarks ?? 0}
                onChange={(event) => setMarkForm((current) => ({ ...current, practicalMarks: Number(event.target.value) }))}
              />
            </FormField>
            <FormField label="Internal Marks">
              <Input
                type="number"
                min={0}
                value={markForm.internalMarks ?? 0}
                onChange={(event) => setMarkForm((current) => ({ ...current, internalMarks: Number(event.target.value) }))}
              />
            </FormField>
            <div className="md:col-span-2 xl:col-span-3">
              <FormField label="Teacher Remarks">
                <Textarea
                  value={markForm.teacherRemarks ?? ""}
                  onChange={(event) => setMarkForm((current) => ({ ...current, teacherRemarks: event.target.value }))}
                />
              </FormField>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-600">
            <span>
              Obtained: <strong>{computedPreview.obtainedMarks}</strong> / {computedPreview.fullMarks}
            </span>
            <span>
              Grade: <strong>{computedPreview.grade}</strong>
            </span>
            <span>
              Status: <strong>{computedPreview.passFail}</strong>
            </span>
          </div>
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={!selectedSubjectId || !resultForm.examId || !resultForm.studentId || isLocked || resultMutation.isPending}>
          Save Marks
        </Button>
      </div>
    </form>
  );
};