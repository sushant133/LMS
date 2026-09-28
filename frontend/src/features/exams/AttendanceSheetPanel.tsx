import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  ExamRecord,
  ExamRoutineRecord,
  ExamSymbolNumberRecord,
  SchoolSettingsRecord,
  StudentRecord,
  SubjectRecord,
} from "@phit-erp/shared";
import { ClipboardCheck, Download, Printer } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, TableHead, Td, Th } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { getPrintInstitutionBranding } from "lib/printBranding";
import { parseErrorMessage } from "lib/utils";
import {
  buildAttendanceSheetPdf,
  openPrintWindow,
  printPdf,
} from "./attendanceSheetPdf";

interface ScopeOption {
  _id: string;
  name: string;
  batchId?: string;
}

interface AttendanceSheetPanelProps {
  isCollege: boolean;
  exams: ExamRecord[];
  batches: ScopeOption[];
  years: ScopeOption[];
  classes: Array<{ _id: string; name: string }>;
  subjects: SubjectRecord[];
  students: StudentRecord[];
}

/** One printable subject sheet; dates/times come from the routine and stay editable. */
interface SubjectRow {
  key: string;
  name: string;
  code: string;
  dateBs: string;
  time: string;
  hall: string;
}

interface SubjectEdit {
  selected: boolean;
  dateBs: string;
  time: string;
}

const compareSymbol = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/**
 * Examination Attendance Sheet — candidates sign against their symbol number,
 * one sheet per subject. Every sheet carries the same candidate list; only the
 * subject, date and time differ. Registration numbers are intentionally left off.
 */
export const AttendanceSheetPanel = ({
  isCollege,
  exams,
  batches,
  years,
  classes,
  subjects,
  students,
}: AttendanceSheetPanelProps) => {
  const [examId, setExamId] = useState("");
  const [cohortId, setCohortId] = useState("");
  const [edits, setEdits] = useState<Record<string, SubjectEdit>>({});
  const [busy, setBusy] = useState<"" | "download" | "print">("");

  const selectedExam = useMemo(
    () => exams.find((exam) => exam._id === examId) ?? null,
    [exams, examId],
  );

  /** Default to the most recent exam so the panel is useful on open. */
  useEffect(() => {
    if (examId || exams.length === 0) return;
    const sorted = [...exams].sort((a, b) =>
      (b.startDateBs || "").localeCompare(a.startDateBs || ""),
    );
    setExamId(sorted[0]?._id ?? "");
  }, [exams, examId]);

  const batchById = useMemo(() => new Map(batches.map((b) => [b._id, b.name])), [batches]);

  /** Years (college) or classes (school) the exam is assigned to. */
  const cohortOptions = useMemo(() => {
    if (!selectedExam) return [];
    if (isCollege) {
      const ids = new Set((selectedExam.yearIds ?? []).map(String));
      return years
        .filter((year) => ids.size === 0 || ids.has(year._id))
        .map((year) => {
          const batch = year.batchId ? batchById.get(year.batchId) : undefined;
          return { _id: year._id, name: batch ? `${year.name} — ${batch}` : year.name };
        });
    }
    const ids = new Set((selectedExam.classIds ?? []).map(String));
    return classes.filter((row) => ids.size === 0 || ids.has(row._id));
  }, [selectedExam, isCollege, years, classes, batchById]);

  // Keep the cohort valid for the chosen exam; pick the only one automatically.
  useEffect(() => {
    if (cohortOptions.some((option) => option._id === cohortId)) return;
    setCohortId(cohortOptions.length === 1 ? (cohortOptions[0]?._id ?? "") : "");
  }, [cohortOptions, cohortId]);

  useEffect(() => {
    setEdits({});
  }, [examId, cohortId]);

  const routinesQuery = useQuery({
    queryKey: ["exam-routines", examId],
    queryFn: () =>
      unwrap<ExamRoutineRecord[]>(api.get("/exams/routines", { params: { examId } })),
    enabled: Boolean(examId),
  });

  const symbolQuery = useQuery({
    queryKey: ["exam-symbol-numbers", examId],
    queryFn: () =>
      unwrap<ExamSymbolNumberRecord[]>(api.get(`/exams/${examId}/symbol-numbers`)),
    enabled: Boolean(examId),
  });

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => unwrap<SchoolSettingsRecord>(api.get("/settings")),
  });

  /** Routine rows for this cohort; the year's subjects when no routine exists yet. */
  const subjectRows = useMemo<SubjectRow[]>(() => {
    if (!cohortId) return [];
    const routine = (routinesQuery.data ?? []).filter((row) =>
      isCollege ? String(row.yearId ?? "") === cohortId : true,
    );
    if (routine.length > 0) {
      return [...routine]
        .sort(
          (a, b) =>
            (a.examDateBs ?? "").localeCompare(b.examDateBs ?? "") ||
            (a.startTime ?? "").localeCompare(b.startTime ?? ""),
        )
        .map((row) => ({
          key: String(row._id),
          name: row.subjectName?.trim() || "Subject",
          code: row.subjectCode?.trim() ?? "",
          dateBs: row.examDateBs ?? "",
          time:
            row.startTime && row.endTime
              ? `${row.startTime} – ${row.endTime}`
              : row.startTime || row.endTime || "",
          hall: row.examHall?.trim() ?? "",
        }));
    }
    return subjects
      .filter((subject) => subject.isActive !== false)
      .filter((subject) =>
        (isCollege ? subject.yearIds : subject.classIds)?.map(String).includes(cohortId),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((subject) => ({
        key: subject._id,
        name: subject.name,
        code: subject.code ?? "",
        dateBs: "",
        time: "",
        hall: "",
      }));
  }, [cohortId, routinesQuery.data, subjects, isCollege]);

  const fromRoutine = useMemo(
    () =>
      (routinesQuery.data ?? []).some((row) =>
        isCollege ? String(row.yearId ?? "") === cohortId : true,
      ),
    [routinesQuery.data, cohortId, isCollege],
  );

  const editFor = (row: SubjectRow): SubjectEdit =>
    edits[row.key] ?? { selected: true, dateBs: row.dateBs, time: row.time };

  const updateEdit = (row: SubjectRow, patch: Partial<SubjectEdit>) =>
    setEdits((current) => ({ ...current, [row.key]: { ...editFor(row), ...patch } }));

  const savedSymbols = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of symbolQuery.data ?? []) {
      map.set(String(row.studentId), String(row.symbolNumber ?? "").trim());
    }
    return map;
  }, [symbolQuery.data]);

  /** Students sitting this exam in the chosen cohort, in symbol-number order. */
  const candidates = useMemo(() => {
    if (!cohortId) return [];
    return students
      .filter((student) => {
        const status = student.academicStatus ?? "ACTIVE";
        if (status !== "ACTIVE" && status !== "PENDING_NOT_PASSED") return false;
        const cohort = isCollege ? student.yearId : student.classId;
        return String(cohort ?? "") === cohortId;
      })
      .map((student) => ({
        id: student._id,
        symbolNo: savedSymbols.get(student._id) ?? "",
        name: student.user?.fullName?.trim() || "—",
      }))
      .sort((a, b) => {
        if (a.symbolNo && b.symbolNo) return compareSymbol(a.symbolNo, b.symbolNo);
        if (a.symbolNo !== b.symbolNo) return a.symbolNo ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [students, cohortId, isCollege, savedSymbols]);

  const missingSymbols = candidates.filter((candidate) => !candidate.symbolNo).length;
  const chosenSubjects = subjectRows.filter((row) => editFor(row).selected);
  const allSelected = subjectRows.length > 0 && chosenSubjects.length === subjectRows.length;
  const cohortLabel = cohortOptions.find((option) => option._id === cohortId)?.name ?? "";

  const buildPdf = async () => {
    if (!selectedExam) throw new Error("Select an exam");
    if (chosenSubjects.length === 0) throw new Error("Select at least one subject");
    if (candidates.length === 0) throw new Error("No candidates found for this selection");
    const branding = getPrintInstitutionBranding();
    const settings = settingsQuery.data;
    return buildAttendanceSheetPdf({
      college: {
        name: settings?.schoolName?.trim() || branding.name,
        address: branding.address,
      },
      examName: selectedExam.name,
      program: settings?.programName?.trim(),
      yearLabel: cohortLabel,
      subjects: chosenSubjects.map((row) => {
        const edit = editFor(row);
        return {
          name: row.name,
          code: row.code,
          dateBs: edit.dateBs.trim(),
          time: edit.time.trim(),
          hall: row.hall,
        };
      }),
      candidates: candidates.map(({ symbolNo, name }) => ({ symbolNo, name })),
    });
  };

  const run = async (mode: "download" | "print") => {
    // Opened before any await so the browser treats it as part of the click.
    const printWindow = mode === "print" ? openPrintWindow() : null;
    setBusy(mode);
    try {
      const doc = await buildPdf();
      const safe = (value: string) => value.replace(/[^\w-]+/g, "-").replace(/-+/g, "-");
      const filename = `Attendance-Sheet-${safe(selectedExam?.name ?? "Exam")}-${safe(cohortLabel)}.pdf`;
      if (mode === "print") {
        printPdf(doc, printWindow, filename);
      } else {
        doc.save(filename);
      }
    } catch (error) {
      printWindow?.close();
      toast.error(parseErrorMessage(error));
    } finally {
      setBusy("");
    }
  };

  if (exams.length === 0) {
    return (
      <EmptyState
        title="No exams yet"
        description="Create an exam first, then print its attendance sheets here."
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-brand-700" />
          Examination Attendance Sheet
        </CardTitle>
        <p className="text-sm text-slate-600">
          One sheet per subject with every candidate&apos;s symbol number, name, signature
          and remarks. The student list is the same on every sheet — only the subject,
          date and time change.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Exam">
            <Select value={examId} onChange={(event) => setExamId(event.target.value)}>
              {[...exams]
                .sort((a, b) => (b.startDateBs || "").localeCompare(a.startDateBs || ""))
                .map((exam) => (
                  <option key={exam._id} value={exam._id}>
                    {exam.name} ({exam.academicYearBs})
                  </option>
                ))}
            </Select>
          </FormField>
          <FormField label={isCollege ? "Year / Part" : "Class"}>
            <Select value={cohortId} onChange={(event) => setCohortId(event.target.value)}>
              <option value="">Select {isCollege ? "year" : "class"}</option>
              {cohortOptions.map((option) => (
                <option key={option._id} value={option._id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        {!cohortId ? (
          <EmptyState
            title={`Select a ${isCollege ? "year" : "class"}`}
            description="Choose who is sitting the exam to list the subjects and candidates."
          />
        ) : routinesQuery.isLoading || symbolQuery.isLoading ? (
          <LoadingState />
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-800">
                  Subjects ({chosenSubjects.length} of {subjectRows.length} selected)
                </h3>
                {subjectRows.length > 0 ? (
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(event) =>
                        setEdits((current) => {
                          const next = { ...current };
                          for (const row of subjectRows) {
                            next[row.key] = { ...editFor(row), selected: event.target.checked };
                          }
                          return next;
                        })
                      }
                    />
                    Select all subjects
                  </label>
                ) : null}
              </div>
              {!fromRoutine && subjectRows.length > 0 ? (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  No exam routine for this {isCollege ? "year" : "class"} yet — subjects are
                  listed from the academic structure. Enter the exam dates below, or publish
                  the routine to fill them automatically.
                </p>
              ) : null}
              {subjectRows.length === 0 ? (
                <EmptyState
                  title="No subjects found"
                  description="Add subjects to this year or create the exam routine first."
                />
              ) : (
                <Table>
                  <TableHead>
                    <tr>
                      <Th className="w-10"> </Th>
                      <Th>Subject</Th>
                      <Th>Exam Date (BS)</Th>
                      <Th>Time</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {subjectRows.map((row) => {
                      const edit = editFor(row);
                      return (
                        <tr key={row.key}>
                          <Td>
                            <input
                              type="checkbox"
                              checked={edit.selected}
                              onChange={(event) =>
                                updateEdit(row, { selected: event.target.checked })
                              }
                            />
                          </Td>
                          <Td>
                            <div className="font-medium text-slate-900">{row.name}</div>
                            {row.code ? (
                              <div className="text-xs text-slate-500">{row.code}</div>
                            ) : null}
                          </Td>
                          <Td>
                            <Input
                              value={edit.dateBs}
                              placeholder="YYYY-MM-DD"
                              onChange={(event) =>
                                updateEdit(row, { dateBs: event.target.value })
                              }
                            />
                          </Td>
                          <Td>
                            <Input
                              value={edit.time}
                              placeholder="e.g. 07:00 – 10:00"
                              onChange={(event) => updateEdit(row, { time: event.target.value })}
                            />
                          </Td>
                        </tr>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-800">
                Candidates ({candidates.length})
              </h3>
              {missingSymbols > 0 ? (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {missingSymbols} candidate{missingSymbols === 1 ? " has" : "s have"} no
                  symbol number for this exam and will print with a blank Symbol No. Issue
                  symbol numbers from the Admit Card tab first.
                </p>
              ) : null}
              {candidates.length === 0 ? (
                <EmptyState
                  title="No candidates"
                  description="No active or back students found for this selection."
                />
              ) : (
                <div className="max-h-96 overflow-y-auto rounded-xl border border-slate-200">
                  <Table>
                    <TableHead>
                      <tr>
                        <Th className="w-14">SN</Th>
                        <Th>Symbol No.</Th>
                        <Th>Name of Student</Th>
                      </tr>
                    </TableHead>
                    <TableBody>
                      {candidates.map((candidate, index) => (
                        <tr key={candidate.id}>
                          <Td>{index + 1}</Td>
                          <Td>{candidate.symbolNo || "—"}</Td>
                          <Td className="uppercase">{candidate.name}</Td>
                        </tr>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(busy) || chosenSubjects.length === 0 || candidates.length === 0}
                onClick={() => void run("print")}
              >
                <Printer className="mr-2 h-4 w-4" />
                {busy === "print" ? "Preparing..." : "Print"}
              </Button>
              <Button
                type="button"
                disabled={Boolean(busy) || chosenSubjects.length === 0 || candidates.length === 0}
                onClick={() => void run("download")}
              >
                <Download className="mr-2 h-4 w-4" />
                {busy === "download"
                  ? "Preparing..."
                  : `Download PDF (${chosenSubjects.length} subject${chosenSubjects.length === 1 ? "" : "s"})`}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
