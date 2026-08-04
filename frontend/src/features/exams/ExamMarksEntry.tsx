import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  ExamRecord,
  ResultInput,
  ResultMarkInput,
  ResultRecord,
  ResultSubmissionRecord,
  StudentRecord,
  SubjectRecord,
  TeacherAssignmentPair,
} from "@phit-erp/shared";
import {
  EXAM_ATTENDANCE_STATUSES,
  computeSubjectMark,
  resultSchema,
} from "@phit-erp/shared";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { Textarea } from "components/ui/textarea";
import {
  RESULT_SUBMISSION_STATUS_COLORS,
  RESULT_SUBMISSION_STATUS_LABELS,
  defaultResultValue,
} from "features/exams/examDefaults";
import { getAcademicLabels } from "lib/academicStructureUtils";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import {
  filterSectionsByClass,
  filterSubjectsForTeacherCohort,
  filterYearsForTeacherBatch,
  hasSingleOption,
} from "lib/teacherScopeUtils";
import { parseErrorMessage } from "lib/utils";

interface SubmissionScopeData {
  _id?: string;
  status: string;
  studentsTotal: number;
  marksEntered: number;
  missingStudents: Array<{ studentId: string; studentName: string }>;
  reviewComments?: string;
  /** Teacher-set once for this exam + subject + cohort */
  fullMarks?: number;
  passMarks?: number;
  marksSchemeConfigured?: boolean;
  marksSchemeSetAt?: string;
}

interface ExamMarksEntryProps {
  exams: ExamRecord[];
  subjects: SubjectRecord[];
  students: StudentRecord[];
  batches: Array<{ _id: string; name: string }>;
  years: Array<{ _id: string; name: string; batchId: string }>;
  classes: Array<{ _id: string; name: string }>;
  sections: Array<{ _id: string; name: string; classId: string }>;
  isCollege: boolean;
  resultsLockedExamIds: Set<string>;
  /**
   * Teacher assignment pairs from /teacher/scope — used to show only subjects
   * the teacher may grade for the selected batch/year (avoids 403 on save).
   */
  assignments?: TeacherAssignmentPair[];
  /** Flat subject ids from teacher scope (legacy fallback when no pairs). */
  assignedSubjectIds?: string[];
}

/** Subject has a practical component when practical full marks are configured (> 0). */
const subjectHasPractical = (subject?: SubjectRecord | null): boolean =>
  Number(subject?.practicalMarks ?? 0) > 0;

const buildDefaultMark = (
  subject?: SubjectRecord | null,
  scheme?: { fullMarks: number; passMarks: number } | null,
): ResultMarkInput => ({
  subjectId: subject?._id ?? "",
  fullMarks: scheme?.fullMarks ?? subject?.fullMarks ?? 100,
  passMarks: scheme?.passMarks ?? subject?.passMarks ?? 35,
  theoryMarks: 0,
  practicalMarks: 0,
  internalMarks: 0,
  attendanceStatus: "PRESENT",
  teacherRemarks: "",
});

export const ExamMarksEntry = ({
  exams,
  subjects,
  students,
  batches,
  years,
  classes,
  sections,
  isCollege,
  resultsLockedExamIds,
  assignments = [],
  assignedSubjectIds = [],
}: ExamMarksEntryProps) => {
  const labels = getAcademicLabels(isCollege ? "COLLEGE" : "SCHOOL");
  const [resultForm, setResultForm] = useState<ResultInput>(defaultResultValue);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [markForm, setMarkForm] = useState<ResultMarkInput>(buildDefaultMark());
  /** Draft values for exam-subject full/pass scheme (saved once before student entry). */
  const [schemeForm, setSchemeForm] = useState({ fullMarks: 100, passMarks: 35 });

  /**
   * Prefer cohorts that actually have roster students (teacher scope expands
   * same-level years across batches for Academic Management — mark entry should
   * only offer batch/year pairs the teacher can grade).
   */
  const markEntryBatches = useMemo(() => {
    const withStudents = new Set(
      students.map((s) => String(s.batchId ?? "")).filter(Boolean),
    );
    // Also keep batches that appear on assignment pairs (even before students load)
    for (const a of assignments) {
      if (a.batchId) withStudents.add(String(a.batchId));
    }
    if (withStudents.size === 0) return batches;
    const filtered = batches.filter((b) => withStudents.has(String(b._id)));
    return filtered.length > 0 ? filtered : batches;
  }, [assignments, batches, students]);

  const markEntryClasses = useMemo(() => {
    const withStudents = new Set(
      students.map((s) => String(s.classId ?? "")).filter(Boolean),
    );
    for (const a of assignments) {
      if (a.classId) withStudents.add(String(a.classId));
    }
    if (withStudents.size === 0) return classes;
    const filtered = classes.filter((c) => withStudents.has(String(c._id)));
    return filtered.length > 0 ? filtered : classes;
  }, [assignments, classes, students]);

  const filteredYears = useMemo(() => {
    const studentYearIds = students
      .filter((s) => String(s.batchId) === String(resultForm.batchId ?? ""))
      .map((s) => String(s.yearId ?? ""))
      .filter(Boolean);
    return filterYearsForTeacherBatch(years, resultForm.batchId ?? "", {
      assignments,
      studentYearIds,
    });
  }, [assignments, resultForm.batchId, students, years]);

  const filteredSections = useMemo(() => {
    const byClass = filterSectionsByClass(sections, resultForm.classId ?? "");
    if (!resultForm.classId) return byClass;
    const sectionIdsWithStudents = new Set(
      students
        .filter((s) => String(s.classId) === String(resultForm.classId))
        .map((s) => String(s.sectionId ?? ""))
        .filter(Boolean),
    );
    for (const a of assignments) {
      if (
        String(a.classId ?? "") === String(resultForm.classId ?? "") &&
        a.sectionId
      ) {
        sectionIdsWithStudents.add(String(a.sectionId));
      }
    }
    if (sectionIdsWithStudents.size === 0) return byClass;
    const withStudents = byClass.filter((s) =>
      sectionIdsWithStudents.has(String(s._id)),
    );
    return withStudents.length > 0 ? withStudents : byClass;
  }, [assignments, resultForm.classId, sections, students]);

  /** Subjects teacher may grade for selected cohort (assignment-pair aware). */
  const teacherFormSubjects = useMemo(
    () =>
      filterSubjectsForTeacherCohort(subjects, {
        isCollege,
        batchId: resultForm.batchId,
        yearId: resultForm.yearId,
        classId: resultForm.classId,
        sectionId: resultForm.sectionId,
        assignments,
        assignedSubjectIds,
      }) as SubjectRecord[],
    [
      assignedSubjectIds,
      assignments,
      isCollege,
      resultForm.batchId,
      resultForm.classId,
      resultForm.sectionId,
      resultForm.yearId,
      subjects,
    ],
  );

  const filteredStudents = useMemo(
    () =>
      students.filter((student) =>
        isCollege
          ? String(student.batchId ?? "") === String(resultForm.batchId ?? "") &&
            String(student.yearId ?? "") === String(resultForm.yearId ?? "")
          : String(student.classId ?? "") === String(resultForm.classId ?? "") &&
            String(student.sectionId ?? "") ===
              String(resultForm.sectionId ?? ""),
      ),
    [
      isCollege,
      resultForm.batchId,
      resultForm.classId,
      resultForm.sectionId,
      resultForm.yearId,
      students,
    ],
  );

  const selectedSubject = useMemo(
    () =>
      teacherFormSubjects.find(
        (subject) => subject._id === selectedSubjectId,
      ) ?? subjects.find((subject) => subject._id === selectedSubjectId),
    [selectedSubjectId, subjects, teacherFormSubjects],
  );

  const hasPractical = subjectHasPractical(selectedSubject);

  const selectedExam = useMemo(
    () => exams.find((exam) => exam._id === resultForm.examId),
    [exams, resultForm.examId],
  );
  const isLocked = selectedExam
    ? resultsLockedExamIds.has(selectedExam._id) || selectedExam.resultsLocked
    : false;
  /** Full batch+year (or class+section) chosen — enables student/subject pickers */
  const scopeReady = isCollege
    ? Boolean(resultForm.batchId && resultForm.yearId)
    : Boolean(resultForm.classId && resultForm.sectionId);
  /**
   * Year/section dropdown only needs the primary (batch/class) selected.
   * Do NOT gate on scopeReady — that required yearId before year could be chosen
   * (chicken-and-egg: Year stayed disabled forever when multiple years exist).
   */
  const secondarySelectReady = isCollege
    ? Boolean(resultForm.batchId)
    : Boolean(resultForm.classId);

  const marksEntryResultsQuery = useQuery({
    queryKey: [
      "results",
      "marks-entry",
      resultForm.examId,
      resultForm.batchId,
      resultForm.yearId,
      resultForm.classId,
      resultForm.sectionId,
    ],
    queryFn: () =>
      unwrap<ResultRecord[]>(
        api.get("/exams/results/all", {
          params: isCollege
            ? {
                examId: resultForm.examId,
                batchId: resultForm.batchId,
                yearId: resultForm.yearId,
              }
            : {
                examId: resultForm.examId,
                classId: resultForm.classId,
                sectionId: resultForm.sectionId,
              },
        }),
      ),
    enabled: Boolean(resultForm.examId && scopeReady),
  });

  const existingResults = marksEntryResultsQuery.data ?? [];

  const localCoverage = useMemo(() => {
    if (!resultForm.examId || !selectedSubjectId || !scopeReady) {
      return {
        studentsTotal: 0,
        marksEntered: 0,
        missingStudents: [] as Array<{
          studentId: string;
          studentName: string;
        }>,
      };
    }

    const missingStudents = filteredStudents
      .filter((student) => {
        const result = existingResults.find(
          (item) => String(item.studentId) === String(student._id),
        );
        return !result?.marks.some(
          (mark) => String(mark.subjectId) === selectedSubjectId,
        );
      })
      .map((student) => ({
        studentId: student._id,
        studentName: student.user.fullName,
      }));

    return {
      studentsTotal: filteredStudents.length,
      marksEntered: filteredStudents.length - missingStudents.length,
      missingStudents,
    };
  }, [
    existingResults,
    filteredStudents,
    resultForm.examId,
    scopeReady,
    selectedSubjectId,
  ]);

  const submissionQuery = useQuery({
    queryKey: [
      "result-submission-scope",
      resultForm.examId,
      selectedSubjectId,
      resultForm.batchId,
      resultForm.yearId,
      resultForm.classId,
      resultForm.sectionId,
    ],
    queryFn: () =>
      unwrap<SubmissionScopeData & Partial<ResultSubmissionRecord>>(
        api.get("/exams/result-submissions/scope", {
          params: isCollege
            ? {
                examId: resultForm.examId,
                subjectId: selectedSubjectId,
                batchId: resultForm.batchId,
                yearId: resultForm.yearId,
              }
            : {
                examId: resultForm.examId,
                subjectId: selectedSubjectId,
                classId: resultForm.classId,
                sectionId: resultForm.sectionId,
              },
        }),
      ),
    enabled: Boolean(resultForm.examId && selectedSubjectId && scopeReady),
  });

  const submission = submissionQuery.data;
  const submissionStatus = submission?.status ?? "DRAFT";
  const marksSchemeConfigured = Boolean(
    submission?.marksSchemeConfigured ||
      (typeof submission?.fullMarks === "number" &&
        submission.fullMarks > 0 &&
        typeof submission?.passMarks === "number"),
  );
  const schemeFullMarks = marksSchemeConfigured
    ? Number(submission?.fullMarks) || 0
    : schemeForm.fullMarks || 0;
  const schemePassMarks = marksSchemeConfigured
    ? Number(submission?.passMarks) || 0
    : schemeForm.passMarks || 0;
  const coverage = {
    studentsTotal: submission?.studentsTotal ?? localCoverage.studentsTotal,
    marksEntered: Math.max(
      submission?.marksEntered ?? 0,
      localCoverage.marksEntered,
    ),
    missingStudents:
      localCoverage.missingStudents.length > 0
        ? localCoverage.missingStudents
        : (submission?.missingStudents ?? []),
  };
  const canEditMarks =
    !isLocked &&
    (submissionStatus === "DRAFT" ||
      submissionStatus === "RETURNED_FOR_CORRECTION");
  const isPendingReview =
    submissionStatus === "PENDING_ADMIN_REVIEW" ||
    submissionStatus === "SUBMITTED_FOR_REVIEW";
  const canSubmitForReview =
    canEditMarks &&
    marksSchemeConfigured &&
    coverage.studentsTotal > 0 &&
    coverage.marksEntered >= coverage.studentsTotal &&
    coverage.missingStudents.length === 0;
  const submitBlockReason = !scopeReady
    ? `Select exam, ${labels.primary.toLowerCase()}, and ${labels.secondary.toLowerCase()} first`
    : !selectedSubjectId
      ? "Select a subject first"
      : !marksSchemeConfigured
        ? "Set Full Marks and Pass Marks for this subject first"
        : coverage.studentsTotal === 0
          ? "No students found in this scope"
          : coverage.missingStudents.length > 0
            ? `Enter marks for ${coverage.missingStudents.length} remaining student(s)`
            : isPendingReview
              ? "Already submitted — waiting for admin review"
              : submissionStatus === "APPROVED"
                ? "Results approved by admin"
                : submissionStatus === "PUBLISHED"
                  ? "Results already published"
                  : !canEditMarks
                    ? "Marks are locked for editing"
                    : "";

  useEffect(() => {
    const primaryList = isCollege ? markEntryBatches : markEntryClasses;
    if (
      hasSingleOption(primaryList) &&
      (isCollege ? resultForm.batchId : resultForm.classId) !== primaryList[0]!._id
    ) {
      setResultForm((current) =>
        isCollege
          ? {
              ...current,
              batchId: primaryList[0]!._id,
              yearId: "",
              studentId: "",
            }
          : {
              ...current,
              classId: primaryList[0]!._id,
              sectionId: "",
              studentId: "",
            },
      );
    }
  }, [
    isCollege,
    markEntryBatches,
    markEntryClasses,
    resultForm.batchId,
    resultForm.classId,
  ]);

  useEffect(() => {
    if (
      !isCollege &&
      hasSingleOption(filteredSections) &&
      resultForm.sectionId !== filteredSections[0]!._id
    ) {
      setResultForm((current) => ({
        ...current,
        sectionId: filteredSections[0]!._id,
        studentId: "",
      }));
    }
  }, [filteredSections, isCollege, resultForm.sectionId]);

  useEffect(() => {
    if (
      isCollege &&
      hasSingleOption(filteredYears) &&
      resultForm.yearId !== filteredYears[0]!._id
    ) {
      setResultForm((current) => ({
        ...current,
        yearId: filteredYears[0]!._id,
        studentId: "",
      }));
    }
  }, [filteredYears, isCollege, resultForm.yearId]);

  useEffect(() => {
    if (
      hasSingleOption(teacherFormSubjects) &&
      selectedSubjectId !== teacherFormSubjects[0]!._id
    ) {
      setSelectedSubjectId(teacherFormSubjects[0]!._id);
    }
  }, [selectedSubjectId, teacherFormSubjects]);

  // Prefill scheme form from saved submission or subject defaults (suggestion only)
  useEffect(() => {
    if (!selectedSubjectId) return;
    if (submissionQuery.isFetching) return;

    if (
      typeof submission?.fullMarks === "number" &&
      submission.fullMarks > 0 &&
      typeof submission?.passMarks === "number"
    ) {
      setSchemeForm({
        fullMarks: submission.fullMarks,
        passMarks: submission.passMarks,
      });
      return;
    }

    setSchemeForm({
      fullMarks: selectedSubject?.fullMarks ?? 100,
      passMarks: selectedSubject?.passMarks ?? 35,
    });
  }, [
    selectedSubject,
    selectedSubjectId,
    submission?.fullMarks,
    submission?.passMarks,
    submissionQuery.isFetching,
  ]);

  useEffect(() => {
    if (!selectedSubjectId) {
      return;
    }
    const scheme =
      marksSchemeConfigured &&
      typeof submission?.fullMarks === "number" &&
      typeof submission?.passMarks === "number"
        ? {
            fullMarks: submission.fullMarks,
            passMarks: submission.passMarks,
          }
        : null;
    setMarkForm(buildDefaultMark(selectedSubject, scheme));
  }, [
    marksSchemeConfigured,
    selectedSubject,
    selectedSubjectId,
    submission?.fullMarks,
    submission?.passMarks,
  ]);

  useEffect(() => {
    if (!resultForm.examId || !resultForm.studentId || !selectedSubjectId) {
      return;
    }

    const existing = existingResults.find(
      (result) =>
        result.examId === resultForm.examId &&
        result.studentId === resultForm.studentId,
    );
    const existingMark = existing?.marks.find(
      (mark) => String(mark.subjectId) === selectedSubjectId,
    );
    const subject = selectedSubject;
    const scheme =
      marksSchemeConfigured &&
      typeof submission?.fullMarks === "number" &&
      typeof submission?.passMarks === "number"
        ? {
            fullMarks: submission.fullMarks,
            passMarks: submission.passMarks,
          }
        : null;

    if (existingMark) {
      setMarkForm({
        subjectId: selectedSubjectId,
        fullMarks: scheme?.fullMarks ?? existingMark.fullMarks ?? 100,
        passMarks: scheme?.passMarks ?? existingMark.passMarks ?? 35,
        theoryMarks: existingMark.theoryMarks ?? 0,
        practicalMarks: subjectHasPractical(subject)
          ? (existingMark.practicalMarks ?? 0)
          : 0,
        internalMarks: 0,
        attendanceStatus: existingMark.attendanceStatus ?? "PRESENT",
        teacherRemarks: existingMark.teacherRemarks ?? "",
      });
    } else {
      setMarkForm(buildDefaultMark(subject, scheme));
    }
  }, [
    existingResults,
    marksSchemeConfigured,
    resultForm.examId,
    resultForm.studentId,
    selectedSubject,
    selectedSubjectId,
    submission?.fullMarks,
    submission?.passMarks,
  ]);

  const computedPreview = useMemo(
    () =>
      computeSubjectMark({
        ...markForm,
        fullMarks: schemeFullMarks || 0,
        passMarks: schemePassMarks || 0,
        theoryMarks: Number(markForm.theoryMarks) || 0,
        practicalMarks: hasPractical
          ? Number(markForm.practicalMarks) || 0
          : 0,
        internalMarks: Number(markForm.internalMarks) || 0,
        obtainedMarks: 0,
      }),
    [hasPractical, markForm, schemeFullMarks, schemePassMarks],
  );

  /** Roster of students with current subject marks for review / edit. */
  const studentMarksRows = useMemo(() => {
    if (!selectedSubjectId || !scopeReady) return [];

    return filteredStudents
      .map((student) => {
        const result = existingResults.find(
          (item) => String(item.studentId) === String(student._id),
        );
        const mark = result?.marks.find(
          (item) => String(item.subjectId) === selectedSubjectId,
        );
        return {
          studentId: student._id,
          studentName: student.user?.fullName ?? "Student",
          rollNumber: student.rollNumber,
          hasMarks: Boolean(mark),
          theoryMarks: mark?.theoryMarks ?? null,
          practicalMarks: mark?.practicalMarks ?? null,
          obtainedMarks: mark?.obtainedMarks ?? null,
          grade: mark?.grade ?? null,
          passFail: mark?.passFail ?? null,
          attendanceStatus: mark?.attendanceStatus ?? null,
          teacherRemarks: mark?.teacherRemarks ?? null,
        };
      })
      .sort((a, b) => {
        // Missing marks first, then by roll / name
        if (a.hasMarks !== b.hasMarks) return a.hasMarks ? 1 : -1;
        const rollA = a.rollNumber ?? Number.MAX_SAFE_INTEGER;
        const rollB = b.rollNumber ?? Number.MAX_SAFE_INTEGER;
        if (rollA !== rollB) return Number(rollA) - Number(rollB);
        return a.studentName.localeCompare(b.studentName);
      });
  }, [existingResults, filteredStudents, scopeReady, selectedSubjectId]);

  const selectedStudentHasMarks = useMemo(
    () =>
      studentMarksRows.some(
        (row) =>
          row.studentId === resultForm.studentId && row.hasMarks,
      ),
    [resultForm.studentId, studentMarksRows],
  );

  const selectStudentForEdit = (studentId: string) => {
    setResultForm((current) => ({
      ...current,
      studentId,
    }));
    // Scroll form into view so teacher can edit immediately
    window.requestAnimationFrame(() => {
      document
        .getElementById("exam-marks-entry-form")
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };

  const marksSchemeMutation = useMutation({
    mutationFn: async (payload: {
      fullMarks: number;
      passMarks: number;
    }) =>
      unwrap(
        api.post("/exams/result-submissions/marks-scheme", {
          examId: resultForm.examId,
          subjectId: selectedSubjectId,
          fullMarks: payload.fullMarks,
          passMarks: payload.passMarks,
          ...(isCollege
            ? {
                batchId: resultForm.batchId,
                yearId: resultForm.yearId,
              }
            : {
                classId: resultForm.classId,
                sectionId: resultForm.sectionId,
              }),
        }),
      ),
    onSuccess: async () => {
      toast.success(
        "Full Marks and Pass Marks saved for this exam subject. You can now enter student marks.",
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["result-submission-scope"],
        }),
        queryClient.invalidateQueries({ queryKey: ["result-submissions"] }),
        queryClient.invalidateQueries({ queryKey: ["results"] }),
      ]);
      await submissionQuery.refetch();
      await marksEntryResultsQuery.refetch();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const resultMutation = useMutation({
    mutationFn: async (payload: ResultInput) =>
      unwrap<ResultRecord>(api.post("/exams/results", payload)),
    onSuccess: async () => {
      toast.success("Student marks saved");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["results"] }),
        queryClient.invalidateQueries({
          queryKey: ["result-submission-scope"],
        }),
        queryClient.invalidateQueries({ queryKey: ["result-submissions"] }),
      ]);
      await marksEntryResultsQuery.refetch();
      await submissionQuery.refetch();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const submitForReviewMutation = useMutation({
    mutationFn: async () =>
      unwrap(
        api.post(
          "/exams/result-submissions/submit",
          isCollege
            ? {
                examId: resultForm.examId,
                subjectId: selectedSubjectId,
                batchId: resultForm.batchId,
                yearId: resultForm.yearId,
              }
            : {
                examId: resultForm.examId,
                subjectId: selectedSubjectId,
                classId: resultForm.classId,
                sectionId: resultForm.sectionId,
              },
        ),
      ),
    onSuccess: async () => {
      toast.success("Results submitted for admin review");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["result-submission-scope"],
        }),
        queryClient.invalidateQueries({ queryKey: ["result-submissions"] }),
      ]);
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const saveMarksScheme = () => {
    if (!resultForm.examId || !selectedSubjectId || !scopeReady) {
      toast.error(
        `Select exam, ${labels.primary.toLowerCase()}, ${labels.secondary.toLowerCase()}, and subject first`,
      );
      return;
    }
    const fullMarks = Number(schemeForm.fullMarks);
    const passMarks = Number(schemeForm.passMarks);
    if (!Number.isFinite(fullMarks) || fullMarks < 1) {
      toast.error("Full Marks must be at least 1");
      return;
    }
    if (!Number.isFinite(passMarks) || passMarks < 0) {
      toast.error("Pass Marks cannot be negative");
      return;
    }
    if (passMarks > fullMarks) {
      toast.error("Pass Marks cannot exceed Full Marks");
      return;
    }
    if (
      marksSchemeConfigured &&
      coverage.marksEntered > 0 &&
      !window.confirm(
        "Updating Full/Pass Marks will recalculate grades for students already entered for this subject. Continue?",
      )
    ) {
      return;
    }
    void marksSchemeMutation.mutateAsync({ fullMarks, passMarks });
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (isLocked) {
          toast.error("Results are locked by the college admin");
          return;
        }
        if (!canEditMarks) {
          toast.error(
            "Marks cannot be edited while pending admin review or approved",
          );
          return;
        }
        if (!selectedSubjectId) {
          toast.error("Select a subject");
          return;
        }
        if (!marksSchemeConfigured) {
          toast.error(
            "Set Full Marks and Pass Marks for this subject first, then enter student marks",
          );
          return;
        }
        const theory = Number(markForm.theoryMarks) || 0;
        const practical = hasPractical
          ? Number(markForm.practicalMarks) || 0
          : 0;
        if (theory + practical > schemeFullMarks) {
          toast.error(
            `Total obtained marks (${theory + practical}) cannot exceed Full Marks (${schemeFullMarks})`,
          );
          return;
        }

        const parsed = resultSchema.safeParse({
          ...resultForm,
          // Teachers enter obtained theory (+ practical when configured) only
          marks: [
            {
              ...markForm,
              subjectId: selectedSubjectId,
              fullMarks: schemeFullMarks,
              passMarks: schemePassMarks,
              theoryMarks: theory,
              practicalMarks: practical,
              internalMarks: 0,
            },
          ],
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
            onChange={(event) =>
              setResultForm((current) => ({
                ...current,
                examId: event.target.value,
              }))
            }
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
        {hasSingleOption(isCollege ? markEntryBatches : markEntryClasses) ? (
          <FormField label={labels.primary}>
            <Input
              value={(isCollege ? markEntryBatches : markEntryClasses)[0]!.name}
              readOnly
              disabled
            />
          </FormField>
        ) : (
          <FormField label={labels.primary}>
            <Select
              value={
                isCollege
                  ? (resultForm.batchId ?? "")
                  : (resultForm.classId ?? "")
              }
              onChange={(event) => {
                setSelectedSubjectId("");
                setResultForm((current) =>
                  isCollege
                    ? {
                        ...current,
                        batchId: event.target.value,
                        yearId: "",
                        studentId: "",
                      }
                    : {
                        ...current,
                        classId: event.target.value,
                        sectionId: "",
                        studentId: "",
                      },
                );
              }}
            >
              <option value="">Select {labels.primary.toLowerCase()}</option>
              {(isCollege ? markEntryBatches : markEntryClasses).map((item) => (
                <option key={item._id} value={item._id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        {hasSingleOption(isCollege ? filteredYears : filteredSections) ? (
          <FormField label={labels.secondary}>
            <Input
              value={(isCollege ? filteredYears : filteredSections)[0]!.name}
              readOnly
              disabled
            />
          </FormField>
        ) : (
          <FormField label={labels.secondary}>
            <Select
              value={isCollege ? (resultForm.yearId ?? "") : (resultForm.sectionId ?? "")}
              onChange={(event) => {
                setSelectedSubjectId("");
                setResultForm((current) =>
                  isCollege
                    ? { ...current, yearId: event.target.value, studentId: "" }
                    : {
                        ...current,
                        sectionId: event.target.value,
                        studentId: "",
                      },
                );
              }}
              disabled={!secondarySelectReady}
            >
              <option value="">
                {!secondarySelectReady
                  ? `Select ${labels.primary.toLowerCase()} first`
                  : `Select ${labels.secondary.toLowerCase()}`}
              </option>
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
            onChange={(event) =>
              setResultForm((current) => ({
                ...current,
                studentId: event.target.value,
              }))
            }
            disabled={!scopeReady}
          >
            <option value="">
              {!scopeReady
                ? `Select ${labels.secondary.toLowerCase()} first`
                : filteredStudents.length === 0
                  ? "No students in this scope"
                  : "Select student to enter or edit marks"}
            </option>
            {filteredStudents.map((student) => {
              const entered = selectedSubjectId
                ? studentMarksRows.find(
                    (row) => row.studentId === student._id,
                  )?.hasMarks
                : false;
              return (
                <option key={student._id} value={student._id}>
                  {student.user?.fullName ?? "Student"}
                  {student.rollNumber != null
                    ? ` (Roll ${student.rollNumber})`
                    : ""}
                  {selectedSubjectId
                    ? entered
                      ? " — entered (edit)"
                      : " — missing"
                    : ""}
                </option>
              );
            })}
          </Select>
        </FormField>
        {hasSingleOption(teacherFormSubjects) ? (
          <FormField label="Subject">
            <Input value={teacherFormSubjects[0]!.name} readOnly disabled />
          </FormField>
        ) : (
          <FormField label="Subject">
            <Select
              value={selectedSubjectId}
              onChange={(event) => setSelectedSubjectId(event.target.value)}
              disabled={!scopeReady}
            >
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

      {selectedSubjectId && scopeReady ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-900">
                Result Workflow Status
              </p>
              <p className="text-xs text-slate-500">
                {coverage.studentsTotal > 0
                  ? `${coverage.marksEntered} / ${coverage.studentsTotal} students have marks for ${selectedSubject?.name ?? "this subject"}`
                  : "No students in this batch/year"}
              </p>
            </div>
            <Badge
              className={
                RESULT_SUBMISSION_STATUS_COLORS[submissionStatus] ??
                "bg-slate-100 text-slate-700"
              }
            >
              {RESULT_SUBMISSION_STATUS_LABELS[submissionStatus] ??
                submissionStatus}
            </Badge>
          </div>

          {submission?.reviewComments ? (
            <p className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-800">
              Admin feedback: {submission.reviewComments}
            </p>
          ) : null}

          {isPendingReview ? (
            <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
              Results submitted. The college admin will review and approve or
              return them for correction.
            </p>
          ) : null}

          {coverage.missingStudents.length > 0 ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p className="font-medium">Still need marks for:</p>
              <ul className="mt-1 list-inside list-disc text-xs">
                {coverage.missingStudents.map((item) => (
                  <li key={item.studentId}>{item.studentName}</li>
                ))}
              </ul>
            </div>
          ) : coverage.studentsTotal > 0 && canEditMarks ? (
            <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
              All students have marks. You can submit for admin review.
            </p>
          ) : null}

          {submissionQuery.isError ? (
            <p className="mt-2 text-sm text-red-700">
              Could not sync server status. Local progress is shown — save marks
              and try submit.
            </p>
          ) : null}
        </div>
      ) : null}

      {isLocked ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Results for this exam are locked. Contact the college admin to unlock
          before editing marks.
        </p>
      ) : null}

      {!canEditMarks && !isLocked && selectedSubjectId ? (
        <p className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          Marks are locked for editing while pending admin review. You will be
          notified when the admin approves or returns them.
        </p>
      ) : null}

      {selectedSubjectId && scopeReady ? (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="font-semibold text-slate-900">
                {marksSchemeConfigured
                  ? "Full Marks & Pass Marks (editable)"
                  : "Step 1 — Set Full Marks & Pass Marks"}
              </h4>
              <p className="mt-1 text-sm text-slate-600">
                {marksSchemeConfigured
                  ? "You can edit Full Marks and Pass Marks anytime while marks are unlocked. Changes apply to every student for this subject in this exam."
                  : "Set these once for this subject in this exam. They apply to every student. Subject defaults are suggested but you can change them."}
              </p>
            </div>
            {marksSchemeConfigured ? (
              <Badge className="bg-brand-100 text-brand-800">
                Current — Full {schemeFullMarks} / Pass {schemePassMarks}
              </Badge>
            ) : (
              <Badge className="bg-amber-100 text-amber-900">
                Required before student entry
              </Badge>
            )}
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <FormField label="Full Marks">
              <NumberInput
                min={1}
                value={schemeForm.fullMarks}
                disabled={!canEditMarks}
                onChange={(event) =>
                  setSchemeForm((current) => ({
                    ...current,
                    fullMarks: event.target.valueAsNumber,
                  }))
                }
              />
            </FormField>
            <FormField label="Pass Marks">
              <NumberInput
                min={0}
                value={schemeForm.passMarks}
                disabled={!canEditMarks}
                onChange={(event) =>
                  setSchemeForm((current) => ({
                    ...current,
                    passMarks: event.target.valueAsNumber,
                  }))
                }
              />
            </FormField>
            <div className="flex items-end">
              <Button
                type="button"
                disabled={!canEditMarks || marksSchemeMutation.isPending}
                onClick={saveMarksScheme}
                className="w-full"
              >
                {marksSchemeMutation.isPending
                  ? "Saving..."
                  : marksSchemeConfigured
                    ? "Save changes to Full & Pass Marks"
                    : "Save Full & Pass Marks"}
              </Button>
            </div>
          </div>
          {selectedSubject &&
          (selectedSubject.fullMarks != null ||
            selectedSubject.passMarks != null) ? (
            <p className="mt-3 text-xs text-slate-500">
              Subject master defaults: Full {selectedSubject.fullMarks ?? "—"}{" "}
              / Pass {selectedSubject.passMarks ?? "—"}
              {hasPractical
                ? ` · Has practical (theory + practical entry)`
                : ` · Theory only`}
              {marksSchemeConfigured && canEditMarks
                ? " · Change values above and click save to update"
                : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {selectedSubjectId && canEditMarks && !marksSchemeConfigured ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Save Full Marks and Pass Marks above before entering student obtained
          marks.
        </p>
      ) : null}

      {/* Entered marks roster — review & edit any student */}
      {selectedSubjectId && scopeReady && marksSchemeConfigured ? (
        <div className="rounded-2xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="font-semibold text-slate-900">
                Entered marks — {selectedSubject?.name ?? "Subject"}
              </h4>
              <p className="mt-1 text-sm text-slate-600">
                Review all students. Use{" "}
                <strong>{canEditMarks ? "Edit" : "View"}</strong> to load a
                student&apos;s marks
                {canEditMarks
                  ? " and update them below."
                  : " (read-only while pending review)."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
                Entered: {coverage.marksEntered} / {coverage.studentsTotal}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
                Full {schemeFullMarks} / Pass {schemePassMarks}
              </span>
            </div>
          </div>

          {studentMarksRows.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">
              No students in this scope.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Roll</Th>
                    <Th>Student</Th>
                    <Th>Status</Th>
                    {hasPractical ? <Th>Theory</Th> : null}
                    {hasPractical ? <Th>Practical</Th> : null}
                    <Th>Obtained</Th>
                    <Th>Grade</Th>
                    <Th>P/F</Th>
                    <Th className="text-right">Action</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {studentMarksRows.map((row) => {
                    const isSelected =
                      String(resultForm.studentId) === String(row.studentId);
                    return (
                      <tr
                        key={row.studentId}
                        className={
                          isSelected ? "bg-brand-50/80" : undefined
                        }
                      >
                        <Td className="whitespace-nowrap text-slate-600">
                          {row.rollNumber != null ? row.rollNumber : "—"}
                        </Td>
                        <Td className="font-medium text-slate-900">
                          {row.studentName}
                        </Td>
                        <Td>
                          {row.hasMarks ? (
                            <Badge className="bg-brand-100 text-brand-800">
                              Entered
                            </Badge>
                          ) : (
                            <Badge className="bg-amber-100 text-amber-900">
                              Missing
                            </Badge>
                          )}
                        </Td>
                        {hasPractical ? (
                          <Td>
                            {row.hasMarks ? (row.theoryMarks ?? 0) : "—"}
                          </Td>
                        ) : null}
                        {hasPractical ? (
                          <Td>
                            {row.hasMarks ? (row.practicalMarks ?? 0) : "—"}
                          </Td>
                        ) : null}
                        <Td>
                          {row.hasMarks
                            ? `${row.obtainedMarks ?? 0} / ${schemeFullMarks}`
                            : "—"}
                        </Td>
                        <Td>{row.hasMarks ? (row.grade ?? "—") : "—"}</Td>
                        <Td>
                          {row.hasMarks ? (
                            <span
                              className={
                                row.passFail === "PASS"
                                  ? "font-medium text-brand-700"
                                  : "font-medium text-red-700"
                              }
                            >
                              {row.passFail ?? "—"}
                            </span>
                          ) : (
                            "—"
                          )}
                        </Td>
                        <Td className="text-right">
                          <Button
                            type="button"
                            variant="outline"
                            className="h-8 px-3 text-xs"
                            onClick={() =>
                              selectStudentForEdit(row.studentId)
                            }
                          >
                            {canEditMarks
                              ? row.hasMarks
                                ? "Edit"
                                : "Enter"
                              : "View"}
                          </Button>
                        </Td>
                      </tr>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      ) : null}

      {selectedSubjectId && canEditMarks && marksSchemeConfigured ? (
        <div
          id="exam-marks-entry-form"
          className="rounded-2xl border border-slate-200 p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="font-medium text-slate-900">
                {selectedStudentHasMarks
                  ? "Edit student marks"
                  : "Enter student marks"}{" "}
                — {selectedSubject?.name ?? "Subject"}
              </h4>
              <p className="mt-1 text-xs text-slate-500">
                {resultForm.studentId
                  ? selectedStudentHasMarks
                    ? "Update obtained marks for the selected student, then save."
                    : "Enter obtained marks for the selected student, then save."
                  : "Select a student from the list above or the Student dropdown."}{" "}
                Full Marks {schemeFullMarks} · Pass Marks {schemePassMarks}
                {hasPractical ? " · Theory + Practical" : " · Theory only"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
                Full Marks: {schemeFullMarks}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
                Pass Marks: {schemePassMarks}
              </span>
              {selectedStudentHasMarks ? (
                <Badge className="bg-blue-100 text-blue-800">
                  Editing existing
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <FormField label="Student">
              <Select
                value={resultForm.studentId}
                onChange={(event) =>
                  setResultForm((current) => ({
                    ...current,
                    studentId: event.target.value,
                  }))
                }
              >
                <option value="">Select student</option>
                {filteredStudents.map((student) => {
                  const entered = studentMarksRows.find(
                    (row) => row.studentId === student._id,
                  )?.hasMarks;
                  return (
                    <option key={student._id} value={student._id}>
                      {student.user?.fullName ?? "Student"}
                      {student.rollNumber != null
                        ? ` (Roll ${student.rollNumber})`
                        : ""}
                      {entered ? " — entered" : " — missing"}
                    </option>
                  );
                })}
              </Select>
            </FormField>
            <FormField label="Attendance">
              <Select
                value={markForm.attendanceStatus}
                onChange={(event) =>
                  setMarkForm((current) => ({
                    ...current,
                    attendanceStatus: event.target
                      .value as ResultMarkInput["attendanceStatus"],
                  }))
                }
              >
                {EXAM_ATTENDANCE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField
              label={
                hasPractical
                  ? "Theory Marks (obtained)"
                  : `Obtained Marks (out of ${schemeFullMarks})`
              }
            >
              <NumberInput
                min={0}
                max={schemeFullMarks}
                value={markForm.theoryMarks}
                onChange={(event) =>
                  setMarkForm((current) => ({
                    ...current,
                    theoryMarks: event.target.valueAsNumber,
                    fullMarks: schemeFullMarks,
                    passMarks: schemePassMarks,
                  }))
                }
              />
            </FormField>
            {hasPractical ? (
              <FormField label="Practical Marks (obtained)">
                <NumberInput
                  min={0}
                  max={schemeFullMarks}
                  value={markForm.practicalMarks}
                  onChange={(event) =>
                    setMarkForm((current) => ({
                      ...current,
                      practicalMarks: event.target.valueAsNumber,
                      fullMarks: schemeFullMarks,
                      passMarks: schemePassMarks,
                    }))
                  }
                />
              </FormField>
            ) : null}
            <div className="md:col-span-2 xl:col-span-3">
              <FormField label="Teacher Remarks">
                <Textarea
                  value={markForm.teacherRemarks ?? ""}
                  onChange={(event) =>
                    setMarkForm((current) => ({
                      ...current,
                      teacherRemarks: event.target.value,
                    }))
                  }
                />
              </FormField>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-3 text-sm text-slate-600">
              <span>
                Obtained: <strong>{computedPreview.obtainedMarks}</strong> /{" "}
                {schemeFullMarks}
              </span>
              <span>
                Grade: <strong>{computedPreview.grade}</strong>
              </span>
              <span>
                Status: <strong>{computedPreview.passFail}</strong>
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {resultForm.studentId ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setResultForm((current) => ({
                      ...current,
                      studentId: "",
                    }))
                  }
                >
                  Clear selection
                </Button>
              ) : null}
              <Button
                type="submit"
                disabled={
                  !resultForm.studentId ||
                  !canEditMarks ||
                  !marksSchemeConfigured ||
                  resultMutation.isPending
                }
              >
                {resultMutation.isPending
                  ? "Saving..."
                  : selectedStudentHasMarks
                    ? "Update student marks"
                    : "Save student marks"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-brand-200 bg-brand-50/40 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="font-semibold text-slate-900">Submit for Review</h4>
            <p className="mt-1 text-sm text-slate-600">
              Save marks for every student, then submit to the college admin.
              You can edit Full/Pass and student marks anytime while status is
              Draft or Returned for correction.
            </p>
            {submitBlockReason && !canSubmitForReview ? (
              <p className="mt-2 text-sm font-medium text-amber-800">
                {submitBlockReason}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={
                !canSubmitForReview || submitForReviewMutation.isPending
              }
              onClick={() => {
                if (
                  !window.confirm(
                    `Submit marks for ${selectedSubject?.name ?? "this subject"} (${coverage.studentsTotal} students) to the college admin for review?`,
                  )
                ) {
                  return;
                }
                void submitForReviewMutation.mutateAsync();
              }}
            >
              {submitForReviewMutation.isPending
                ? "Submitting..."
                : "Submit for Review"}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
};
