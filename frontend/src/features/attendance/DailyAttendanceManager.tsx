import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  type DailyAttendanceAssignment,
  type DailyAttendanceDashboard,
  type DailyAttendanceRecord,
  type DailyAttendanceReportType,
  type DailyAttendanceStatus,
  type DailyAttendanceStudentReportRow,
  type DailyAttendanceSubmitInput
} from "@phit-erp/shared";
import { getTodayBs } from "@munatech/nepali-datepicker";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { Textarea } from "components/ui/textarea";
import { useIsCollege } from "hooks/useInstitutionType";
import { getAcademicLabels } from "lib/academicStructureUtils";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";
import { useIsSystemAdministrator } from "hooks/useNormalizedRole";
import {
  buildAttendanceQueryParams,
  createDefaultAttendancePeriod,
  getAttendancePeriodLabel,
  type AttendancePeriodSelection
} from "lib/attendancePeriodUtils";
import {
  downloadClassSummaryExcel,
  downloadDailyAttendanceExcel,
  downloadOverallAttendanceWorkbook,
  downloadStudentAttendanceExcel
} from "./attendanceUtils";
import { AttendancePeriodFilter } from "./AttendancePeriodFilter";
import { DailyAttendanceHistoryPanel } from "./DailyAttendanceHistoryPanel";

const statuses: DailyAttendanceStatus[] = ["PRESENT", "ABSENT", "LATE", "LEAVE", "MEDICAL_LEAVE"];

const statusBadgeStyles: Record<DailyAttendanceStatus, string> = {
  PRESENT: "bg-brand-100 text-brand-800",
  ABSENT: "bg-rose-100 text-rose-800",
  LATE: "bg-amber-100 text-amber-800",
  LEAVE: "bg-sky-100 text-sky-800",
  MEDICAL_LEAVE: "bg-violet-100 text-violet-800"
};

interface DailyAttendanceManagerProps {
  hasInstitutionRead: boolean;
  canWriteAdmin: boolean;
  isTeacher: boolean;
}

interface ContextStudent {
  _id: string;
  rollNumber: number;
  admissionNumber: string;
  photoUrl?: string;
  fullName: string;
}

interface AttendanceContext {
  dateBs: string;
  dayName: string;
  academicYearBs: string;
  teacherName: string;
  startTime: string;
  endTime: string;
  students: ContextStudent[];
  existingRecord?: DailyAttendanceRecord;
  availability: { canMark: boolean; message?: string; isHoliday: boolean };
  holiday?: { title: string; dateBs: string };
}

const formatTodayBs = (): string => {
  const today = getTodayBs();
  return `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;
};

const assignmentKey = (assignment: DailyAttendanceAssignment): string =>
  assignment.timetableSlotId ||
  `${assignment.batchId ?? assignment.classId ?? ""}-${assignment.yearId ?? assignment.sectionId ?? ""}-manual`;

export const DailyAttendanceManager = ({ hasInstitutionRead, canWriteAdmin, isTeacher }: DailyAttendanceManagerProps) => {
  const isSuperAdmin = useIsSystemAdministrator();
  const isCollege = useIsCollege();
  const labels = getAcademicLabels(isCollege ? "COLLEGE" : "SCHOOL");
  const [view, setView] = useState<"mark" | "history" | "dashboard" | "reports">(isTeacher ? "mark" : "dashboard");
  const [dateBs, setDateBs] = useState(formatTodayBs);
  const [selectedAssignment, setSelectedAssignment] = useState<DailyAttendanceAssignment | null>(null);
  const [statusMap, setStatusMap] = useState<Record<string, DailyAttendanceStatus>>({});
  const [remarksMap, setRemarksMap] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [periodSelection, setPeriodSelection] = useState<AttendancePeriodSelection>(createDefaultAttendancePeriod);
  const [reportType, setReportType] = useState<DailyAttendanceReportType>("summary");
  const [isExporting, setIsExporting] = useState(false);
  const [assignedTeacherId, setAssignedTeacherId] = useState("");

  const adminParams = hasInstitutionRead ? { adminOverride: true } : {};

  const teachersQuery = useQuery({
    queryKey: ["teachers"],
    queryFn: () => unwrap<Array<{ _id: string; user: { fullName: string } }>>(api.get("/teachers")),
    enabled: canWriteAdmin
  });

  const assignmentsQuery = useQuery({
    queryKey: ["daily-attendance-assignments", dateBs, hasInstitutionRead],
    queryFn: () =>
      unwrap<DailyAttendanceAssignment[]>(
        api.get("/daily-attendance/assignments", {
          params: { ...(dateBs ? { dateBs } : {}), ...adminParams }
        })
      )
  });

  const contextQuery = useQuery({
    queryKey: [
      "daily-attendance-context",
      selectedAssignment?.timetableSlotId,
      selectedAssignment?.batchId,
      selectedAssignment?.yearId,
      selectedAssignment?.classId,
      selectedAssignment?.sectionId,
      dateBs,
      hasInstitutionRead
    ],
    queryFn: () =>
      unwrap<AttendanceContext & { isAdmin?: boolean; studentCount?: number; isManualAssignment?: boolean }>(
        api.get("/daily-attendance/context", {
          params: {
            ...(selectedAssignment?.timetableSlotId
              ? { timetableSlotId: selectedAssignment.timetableSlotId }
              : isCollege
                ? { batchId: selectedAssignment!.batchId, yearId: selectedAssignment!.yearId }
                : { classId: selectedAssignment!.classId, sectionId: selectedAssignment!.sectionId }),
            ...(dateBs ? { dateBs } : {}),
            ...adminParams
          }
        })
      ),
    enabled: Boolean(
      selectedAssignment &&
        (selectedAssignment.timetableSlotId ||
          (isCollege
            ? selectedAssignment.batchId && selectedAssignment.yearId
            : selectedAssignment.classId && selectedAssignment.sectionId))
    )
  });

  const attendancePeriodParams = useMemo(() => buildAttendanceQueryParams(periodSelection), [periodSelection]);

  const historyQuery = useQuery({
    queryKey: ["daily-attendance-history", attendancePeriodParams],
    queryFn: () =>
      unwrap<DailyAttendanceRecord[]>(api.get("/daily-attendance", { params: attendancePeriodParams })),
    enabled: view === "history" || view === "reports"
  });

  const dashboardQuery = useQuery({
    queryKey: ["daily-attendance-dashboard"],
    queryFn: () => unwrap<DailyAttendanceDashboard>(api.get("/daily-attendance/dashboard")),
    enabled: view === "dashboard" && hasInstitutionRead
  });

  const reportsQuery = useQuery({
    queryKey: ["daily-attendance-reports", reportType, attendancePeriodParams],
    queryFn: () =>
      unwrap<{ type: string; rows?: DailyAttendanceStudentReportRow[] | Array<{ label: string; present: number; absent: number; percentage: number }> }>(
        api.get("/daily-attendance/reports", {
          params: {
            type: reportType,
            ...attendancePeriodParams
          }
        })
      ),
    enabled: view === "reports" && hasInstitutionRead
  });

  const exportAttendanceWorkbook = async () => {
    setIsExporting(true);
    try {
      const periodLabel = getAttendancePeriodLabel(periodSelection);
      const [records, report] = await Promise.all([
        unwrap<DailyAttendanceRecord[]>(api.get("/daily-attendance", { params: attendancePeriodParams })),
        unwrap<{ rows?: DailyAttendanceStudentReportRow[] }>(
          api.get("/daily-attendance/reports", {
            params: { type: "student", ...attendancePeriodParams }
          })
        )
      ]);

      if (!records.length) {
        toast.error("No attendance records in the selected period.");
        return;
      }

      downloadOverallAttendanceWorkbook(
        records,
        report.rows ?? [],
        `overall-attendance_${periodLabel}.xlsx`
      );
      toast.success("Overall attendance Excel downloaded");
    } catch (error) {
      toast.error(parseErrorMessage(error));
    } finally {
      setIsExporting(false);
    }
  };

  const submitMutation = useMutation({
    mutationFn: (payload: DailyAttendanceSubmitInput) =>
      unwrap<DailyAttendanceRecord>(api.post("/daily-attendance", payload)),
    onSuccess: async () => {
      toast.success("Daily attendance submitted and synchronized with first-period subject attendance");
      setSelectedAssignment(null);
      setStatusMap({});
      setRemarksMap({});
      setNotes("");
      setSelectedIds(new Set());
      await queryClient.invalidateQueries({ queryKey: ["daily-attendance"] });
      await queryClient.invalidateQueries({ queryKey: ["daily-attendance-assignments"] });
      await queryClient.invalidateQueries({ queryKey: ["daily-attendance-context"] });
      await queryClient.invalidateQueries({ queryKey: ["daily-attendance-dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  // Changing the date invalidates the selected slot for that day.
  useEffect(() => {
    setSelectedAssignment(null);
    setStatusMap({});
    setRemarksMap({});
    setNotes("");
    setSelectedIds(new Set());
    setSearch("");
  }, [dateBs]);

  useEffect(() => {
    const existing = contextQuery.data?.existingRecord;
    if (!existing) {
      setStatusMap({});
      setRemarksMap({});
      setNotes("");
      return;
    }

    setStatusMap(
      existing.entries.reduce<Record<string, DailyAttendanceStatus>>((acc, entry) => {
        acc[String(entry.studentId)] = entry.status;
        return acc;
      }, {})
    );
    setRemarksMap(
      existing.entries.reduce<Record<string, string>>((acc, entry) => {
        if (entry.remarks) acc[String(entry.studentId)] = entry.remarks;
        return acc;
      }, {})
    );
    setNotes(existing.notes ?? "");
  }, [contextQuery.data?.existingRecord]);

  const filteredStudents = useMemo(() => {
    const students = contextQuery.data?.students ?? [];
    const query = search.trim().toLowerCase();
    if (!query) return students;
    return students.filter(
      (student) =>
        student.fullName.toLowerCase().includes(query) ||
        String(student.rollNumber).includes(query) ||
        student.admissionNumber.toLowerCase().includes(query)
    );
  }, [contextQuery.data?.students, search]);

  const summary = useMemo(() => {
    const students = contextQuery.data?.students ?? [];
    const counts = { present: 0, absent: 0, late: 0, leave: 0, medical: 0, notMarked: 0 };
    students.forEach((student) => {
      const status = statusMap[student._id];
      if (!status) {
        counts.notMarked += 1;
        return;
      }
      if (status === "PRESENT") counts.present += 1;
      if (status === "ABSENT") counts.absent += 1;
      if (status === "LATE") counts.late += 1;
      if (status === "LEAVE") counts.leave += 1;
      if (status === "MEDICAL_LEAVE") counts.medical += 1;
    });
    return counts;
  }, [contextQuery.data?.students, statusMap]);

  const studentCount =
    contextQuery.data?.students?.length ?? selectedAssignment?.studentCount ?? 0;
  const isLocked = Boolean(
    selectedAssignment?.isLocked || contextQuery.data?.existingRecord?.status === "LOCKED"
  );
  const canMark =
    studentCount > 0 &&
    (canWriteAdmin
      ? !isLocked
      : isTeacher && !isLocked && (contextQuery.data?.availability.canMark ?? false));

  useEffect(() => {
    if (!selectedAssignment) return;
    setAssignedTeacherId(selectedAssignment.teacherId || "");
  }, [selectedAssignment]);

  const applyStatus = (studentIds: string[], status: DailyAttendanceStatus) => {
    setStatusMap((current) => {
      const next = { ...current };
      studentIds.forEach((id) => {
        next[id] = status;
      });
      return next;
    });
  };

  const toggleSelected = (studentId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!selectedAssignment) return;
    const students = contextQuery.data?.students ?? [];
    if (students.length === 0) {
      toast.error("No students are enrolled in this academic group.");
      return;
    }
    const missing = students.find((student) => !statusMap[student._id]);
    if (missing) {
      toast.error("Every student must have an attendance status before submission.");
      return;
    }
    if (canWriteAdmin && !assignedTeacherId && !selectedAssignment.teacherId) {
      toast.error("Please assign a teacher before submitting attendance.");
      return;
    }

    await submitMutation.mutateAsync({
      ...(isCollege
        ? { batchId: selectedAssignment.batchId, yearId: selectedAssignment.yearId }
        : { classId: selectedAssignment.classId, sectionId: selectedAssignment.sectionId }),
      dateBs: contextQuery.data?.dateBs ?? selectedAssignment.dateBs ?? dateBs,
      ...(selectedAssignment.timetableSlotId
        ? { timetableSlotId: selectedAssignment.timetableSlotId }
        : {}),
      ...(selectedAssignment.subjectId ? { subjectId: selectedAssignment.subjectId } : {}),
      notes,
      ...(canWriteAdmin
        ? {
            adminOverride: true,
            assignedTeacherId: assignedTeacherId || selectedAssignment.teacherId || undefined
          }
        : {}),
      entries: students.map((student) => ({
        studentId: student._id,
        status: statusMap[student._id]!,
        remarks: remarksMap[student._id]
      }))
    } as DailyAttendanceSubmitInput);
  };

  if (assignmentsQuery.isLoading && view === "mark") {
    return <LoadingState />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {(isTeacher ? ["mark", "history"] : ["dashboard", "mark", "history", "reports"]).map((tab) => (
          <Button key={tab} variant={view === tab ? "default" : "outline"} onClick={() => setView(tab as typeof view)}>
            {tab === "mark" ? "Mark Attendance" : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </Button>
        ))}
      </div>

      {view === "dashboard" && hasInstitutionRead ? (
        dashboardQuery.isLoading ? (
          <LoadingState />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
              {[
                { label: "Total Students", value: dashboardQuery.data?.totalStudents ?? 0 },
                { label: "Present Today", value: dashboardQuery.data?.presentToday ?? 0 },
                { label: "Absent Today", value: dashboardQuery.data?.absentToday ?? 0 },
                { label: "Late", value: dashboardQuery.data?.lateToday ?? 0 },
                { label: "Leave", value: dashboardQuery.data?.leaveToday ?? 0 },
                {
                  label: "Attendance %",
                  value: `${dashboardQuery.data?.attendancePercentage ?? 0}%`
                }
              ].map((stat) => (
                <Card key={stat.label} className="bg-[linear-gradient(135deg,_white_0%,_#eef3fb_100%)]">
                  <CardContent className="py-5">
                    <p className="text-sm text-slate-500">{stat.label}</p>
                    <p className="mt-1 text-3xl font-semibold text-brand-700">{stat.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Daily Trend</CardTitle>
                </CardHeader>
                <CardContent className="h-72">
                  {(dashboardQuery.data?.dailyTrend.length ?? 0) === 0 ? (
                    <EmptyState title="No trend data yet" description="Submit daily attendance to populate charts." />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dashboardQuery.data?.dailyTrend ?? []}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="dateBs" />
                        <YAxis allowDecimals={false} />
                        <Tooltip />
                        <Bar dataKey="present" fill="#0c2d6b" />
                        <Bar dataKey="absent" fill="#fb7185" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Monthly Trend</CardTitle>
                </CardHeader>
                <CardContent className="h-72">
                  {(dashboardQuery.data?.monthlyTrend.length ?? 0) === 0 ? (
                    <EmptyState title="No monthly data yet" description="Monthly trends appear after attendance is recorded." />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dashboardQuery.data?.monthlyTrend ?? []}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="month" />
                        <YAxis allowDecimals={false} />
                        <Tooltip />
                        <Bar dataKey="present" fill="#0ea5e9" />
                        <Bar dataKey="absent" fill="#fb7185" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Class-wise Comparison</CardTitle>
                </CardHeader>
                <CardContent className="h-72">
                  {(dashboardQuery.data?.classWise.length ?? 0) === 0 ? (
                    <EmptyState title="No class data yet" description="Class comparisons appear after attendance is recorded." />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dashboardQuery.data?.classWise ?? []}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" />
                        <YAxis allowDecimals={false} />
                        <Tooltip />
                        <Bar dataKey="percentage" fill="#0c2d6b" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Teacher-wise Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  {(dashboardQuery.data?.teacherWise.length ?? 0) === 0 ? (
                    <EmptyState title="No teacher data yet" description="Teacher summaries appear after attendance is recorded." />
                  ) : (
                    <div className="space-y-3">
                      {(dashboardQuery.data?.teacherWise ?? []).map((item) => (
                        <div key={item.teacherName} className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
                          <div>
                            <p className="font-medium text-slate-900">{item.teacherName}</p>
                            <p className="text-sm text-slate-500">{item.classesMarked} classes marked</p>
                          </div>
                          <p className="text-lg font-semibold text-brand-700">{item.percentage}%</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )
      ) : null}

      {view === "mark" ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{hasInstitutionRead ? "All Class Assignments" : "Today's Assignments"}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Date (BS)</label>
                <NepaliDateField value={dateBs} onChange={setDateBs} />
              </div>
            </CardContent>
            <CardContent>
              {assignmentsQuery.isError ? (
                <EmptyState
                  title="Unable to load assignments"
                  description={parseErrorMessage(assignmentsQuery.error)}
                />
              ) : (assignmentsQuery.data ?? []).length === 0 ? (
                <EmptyState
                  title="No daily attendance assignments"
                  description={
                    isTeacher
                      ? "No first-period (or substitute) classes are assigned to you for this day. Ask admin to set the timetable."
                      : "No enrolled classes found for this day. Add students and timetable first-period slots, or pick another date."
                  }
                />
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {(assignmentsQuery.data ?? []).map((assignment) => {
                    const key = assignmentKey(assignment);
                    const selected = selectedAssignment ? assignmentKey(selectedAssignment) === key : false;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSelectedAssignment(assignment)}
                        className={`rounded-xl border p-4 text-left transition hover:border-brand-300 ${
                          selected ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-slate-900">
                              {isCollege
                                ? `${assignment.batchName ?? "Batch"} · ${assignment.yearName ?? "Year"}`
                                : `${assignment.className ?? "Class"} · ${assignment.sectionName ?? "Section"}`}
                            </p>
                            <p className="mt-1 text-sm text-slate-600">
                              {assignment.subjectName || "Daily register"} · {assignment.startTime}–{assignment.endTime}
                            </p>
                            <p className="mt-1 text-sm text-slate-500">
                              {assignment.isSubstituteSlot ? "Substitute: " : ""}
                              {assignment.teacherName || "Assign teacher"}
                              {assignment.isSubstituteSlot && assignment.firstPeriodTeacherName
                                ? ` (1st period: ${assignment.firstPeriodTeacherName})`
                                : ""}
                            </p>
                            <p className="mt-1 text-xs font-medium text-slate-500">
                              {assignment.studentCount ?? "—"} students
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {assignment.isSubstituteSlot ? (
                                <Badge className="bg-violet-100 text-violet-800">Substitute Slot</Badge>
                              ) : null}
                              {assignment.isManualAssignment ? (
                                <Badge className="bg-sky-100 text-sky-800">Manual / No period slot</Badge>
                              ) : null}
                            </div>
                          </div>
                          {assignment.isLocked ? (
                            <Badge className="bg-slate-100 text-slate-700">Locked</Badge>
                          ) : assignment.isHoliday ? (
                            <Badge className="bg-amber-100 text-amber-800">Holiday</Badge>
                          ) : (assignment.studentCount ?? 0) === 0 ? (
                            <Badge className="bg-slate-100 text-slate-600">Empty</Badge>
                          ) : assignment.canMark ? (
                            <Badge className="bg-emerald-100 text-emerald-800">Open</Badge>
                          ) : (
                            <Badge className="bg-rose-100 text-rose-800">Closed</Badge>
                          )}
                        </div>
                        {assignment.availabilityMessage ? (
                          <p className="mt-3 text-xs text-slate-500">{assignment.availabilityMessage}</p>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {selectedAssignment ? (
            <Card>
              <CardHeader>
                <CardTitle>Daily Attendance Register</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm md:grid-cols-3">
                  <p>
                    <span className="font-medium text-slate-700">Date:</span> {contextQuery.data?.dateBs}
                  </p>
                  <p>
                    <span className="font-medium text-slate-700">Day:</span> {contextQuery.data?.dayName}
                  </p>
                  <p>
                    <span className="font-medium text-slate-700">Academic Year:</span>{" "}
                    {selectedAssignment.academicYearBs}
                  </p>
                  <p>
                    <span className="font-medium text-slate-700">{labels.primary}:</span>{" "}
                    {isCollege ? selectedAssignment.batchName : selectedAssignment.className}
                  </p>
                  <p>
                    <span className="font-medium text-slate-700">{labels.secondary}:</span>{" "}
                    {isCollege ? selectedAssignment.yearName : selectedAssignment.sectionName}
                  </p>
                  <p>
                    <span className="font-medium text-slate-700">Teacher:</span> {selectedAssignment.teacherName}
                  </p>
                  {canWriteAdmin ? (
                    <div className="md:col-span-3">
                      <label className="mb-2 block text-sm font-medium text-slate-700">Assign Teacher</label>
                      <Select value={assignedTeacherId} onChange={(event) => setAssignedTeacherId(event.target.value)}>
                        <option value="">Select teacher</option>
                        {(teachersQuery.data ?? []).map((teacher) => (
                          <option key={teacher._id} value={teacher._id}>
                            {teacher.user.fullName}
                          </option>
                        ))}
                      </Select>
                      <p className="mt-1 text-xs text-slate-500">
                        Admins can assign any teacher if the first-period teacher missed attendance.
                      </p>
                    </div>
                  ) : null}
                  <p>
                    <span className="font-medium text-slate-700">First Subject:</span> {selectedAssignment.subjectName}
                  </p>
                  <p>
                    <span className="font-medium text-slate-700">First Period:</span> {selectedAssignment.startTime}–
                    {selectedAssignment.endTime}
                  </p>
                </div>

                {contextQuery.data?.holiday ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    Holiday: {contextQuery.data.holiday.title}
                  </div>
                ) : null}

                {contextQuery.data?.availability.message && !canMark ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
                    {contextQuery.data.availability.message}
                  </div>
                ) : null}

                {canWriteAdmin && selectedAssignment?.isManualAssignment && !isLocked ? (
                  <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
                    No first-period timetable for this day. Assign a teacher and mark the daily register manually.
                  </div>
                ) : null}

                {canWriteAdmin && isLocked ? (
                  <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
                    This record is locked. Edit it anytime from the <strong>History</strong> tab — unlock is not required for admins.
                  </div>
                ) : null}

                {contextQuery.isLoading ? (
                  <LoadingState />
                ) : contextQuery.isError ? (
                  <EmptyState
                    title="Unable to load attendance register"
                    description={parseErrorMessage(contextQuery.error)}
                  />
                ) : (contextQuery.data?.students?.length ?? 0) === 0 ? (
                  <EmptyState
                    title="No students in this group"
                    description="Enroll students in this batch/year (or class/section) before marking daily attendance."
                  />
                ) : (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
                      {[
                        { label: "Present", value: summary.present },
                        { label: "Absent", value: summary.absent },
                        { label: "Late", value: summary.late },
                        { label: "Leave", value: summary.leave },
                        { label: "Medical", value: summary.medical },
                        { label: "Not marked", value: summary.notMarked }
                      ].map((stat) => (
                        <div key={stat.label} className="rounded-xl border border-slate-200 bg-white p-4">
                          <p className="text-sm text-slate-500">{stat.label}</p>
                          <p className="mt-1 text-2xl font-semibold text-brand-700">{stat.value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search by name, roll, or registration number"
                        className="max-w-sm"
                      />
                      {canMark ? (
                        <>
                          <Button variant="outline" onClick={() => applyStatus(filteredStudents.map((s) => s._id), "PRESENT")}>
                            Mark All Present
                          </Button>
                          <Button variant="outline" onClick={() => applyStatus(filteredStudents.map((s) => s._id), "ABSENT")}>
                            Mark All Absent
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => applyStatus([...selectedIds], "PRESENT")}
                            disabled={selectedIds.size === 0}
                          >
                            Mark Selected Present
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => applyStatus([...selectedIds], "ABSENT")}
                            disabled={selectedIds.size === 0}
                          >
                            Mark Selected Absent
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setStatusMap({});
                              setRemarksMap({});
                              setSelectedIds(new Set());
                            }}
                          >
                            Reset Attendance
                          </Button>
                        </>
                      ) : null}
                    </div>

                    <div className="overflow-x-auto">
                      <Table>
                        <TableHead>
                          <tr>
                            {canMark ? <Th>Select</Th> : null}
                            <Th>Photo</Th>
                            <Th>Student</Th>
                            <Th>Roll</Th>
                            <Th>Registration</Th>
                            <Th>Status</Th>
                            <Th>Remarks</Th>
                          </tr>
                        </TableHead>
                        <TableBody>
                          {filteredStudents.map((student) => {
                            const status = statusMap[student._id];
                            return (
                              <tr key={student._id}>
                                {canMark ? (
                                  <Td>
                                    <input
                                      type="checkbox"
                                      checked={selectedIds.has(student._id)}
                                      onChange={() => toggleSelected(student._id)}
                                    />
                                  </Td>
                                ) : null}
                                <Td>
                                  {student.photoUrl ? (
                                    <img
                                      src={student.photoUrl}
                                      alt={student.fullName}
                                      className="h-10 w-10 rounded-full object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-500">
                                      N/A
                                    </div>
                                  )}
                                </Td>
                                <Td>{student.fullName}</Td>
                                <Td>{student.rollNumber}</Td>
                                <Td>{student.admissionNumber}</Td>
                                <Td>
                                  {canMark ? (
                                    <Select
                                      value={status ?? ""}
                                      onChange={(event) =>
                                        setStatusMap((current) => ({
                                          ...current,
                                          [student._id]: event.target.value as DailyAttendanceStatus
                                        }))
                                      }
                                    >
                                      <option value="">Select status</option>
                                      {statuses.map((item) => (
                                        <option key={item} value={item}>
                                          {item.replace("_", " ")}
                                        </option>
                                      ))}
                                    </Select>
                                  ) : status ? (
                                    <Badge className={statusBadgeStyles[status]}>{status.replace("_", " ")}</Badge>
                                  ) : (
                                    <Badge className="bg-slate-100 text-slate-600">Not marked</Badge>
                                  )}
                                </Td>
                                <Td>
                                  {canMark ? (
                                    <Input
                                      value={remarksMap[student._id] ?? ""}
                                      onChange={(event) =>
                                        setRemarksMap((current) => ({
                                          ...current,
                                          [student._id]: event.target.value
                                        }))
                                      }
                                      placeholder="Remarks"
                                    />
                                  ) : (
                                    remarksMap[student._id] ?? "—"
                                  )}
                                </Td>
                              </tr>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">Class Notes</label>
                      <Textarea
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        placeholder="Optional notes for this attendance session"
                        disabled={!canMark}
                      />
                    </div>

                    {canMark ? (
                      <div className="flex justify-end">
                        <Button disabled={submitMutation.isPending} onClick={() => void handleSubmit()}>
                          Submit Attendance
                        </Button>
                      </div>
                    ) : isLocked ? (
                      <p className="text-sm text-slate-500">
                        This attendance record is locked. Administrators can unlock it from the history view.
                      </p>
                    ) : null}
                  </>
                )}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}

      {view === "history" ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Filter & Export</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <AttendancePeriodFilter value={periodSelection} onChange={setPeriodSelection} />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={isExporting}
                  onClick={() => {
                    const records = historyQuery.data ?? [];
                    if (!records.length) {
                      toast.error("No attendance records in the selected period.");
                      return;
                    }
                    downloadDailyAttendanceExcel(records, `daily-attendance_${getAttendancePeriodLabel(periodSelection)}.xlsx`);
                    toast.success("Daily attendance Excel downloaded");
                  }}
                >
                  Export Daily Summary Excel
                </Button>
                {hasInstitutionRead ? (
                  <Button variant="outline" disabled={isExporting} onClick={() => void exportAttendanceWorkbook()}>
                    {isExporting ? "Exporting..." : "Export Overall Attendance Excel"}
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
          <DailyAttendanceHistoryPanel
            records={historyQuery.data ?? []}
            hasInstitutionRead={hasInstitutionRead}
            canWriteAdmin={canWriteAdmin}
            isSuperAdmin={isSuperAdmin}
            isLoading={historyQuery.isLoading}
          />
        </div>
      ) : null}

      {view === "reports" && hasInstitutionRead ? (
        <Card>
          <CardHeader>
            <CardTitle>Reports & Export</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Report Type</label>
                <Select value={reportType} onChange={(event) => setReportType(event.target.value as DailyAttendanceReportType)}>
                  <option value="summary">Summary Report</option>
                  <option value="class">Class-wise Report</option>
                  <option value="student">Student-wise Report</option>
                  <option value="defaulter">Low Attendance Defaulters</option>
                  <option value="leave">Leave Report</option>
                  <option value="late">Late Arrival Report</option>
                </Select>
              </div>
            </div>

            <AttendancePeriodFilter value={periodSelection} onChange={setPeriodSelection} />

            {reportsQuery.isLoading ? (
              <LoadingState />
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (!historyQuery.data?.length) {
                        toast.error("No records available to export.");
                        return;
                      }
                      downloadDailyAttendanceExcel(
                        historyQuery.data,
                        `daily-attendance_${getAttendancePeriodLabel(periodSelection)}.xlsx`
                      );
                      toast.success("Daily attendance Excel downloaded");
                    }}
                  >
                    Export Daily Summary Excel
                  </Button>
                  <Button variant="outline" disabled={isExporting} onClick={() => void exportAttendanceWorkbook()}>
                    {isExporting ? "Exporting..." : "Export Overall Attendance Excel"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const rows = reportsQuery.data?.rows;
                      if (!rows?.length) {
                        toast.error("No report rows available to export.");
                        return;
                      }
                      const periodLabel = getAttendancePeriodLabel(periodSelection);
                      if (reportType === "class") {
                        downloadClassSummaryExcel(
                          rows as Array<{ label: string; present: number; absent: number; percentage: number }>,
                          `class-attendance_${periodLabel}.xlsx`
                        );
                      } else if (reportType === "student" || reportType === "defaulter") {
                        downloadStudentAttendanceExcel(
                          rows as DailyAttendanceStudentReportRow[],
                          `student-attendance_${periodLabel}.xlsx`
                        );
                      } else {
                        toast.error("Use overall attendance export for this report type.");
                        return;
                      }
                      toast.success("Report Excel downloaded");
                    }}
                  >
                    Export Report Excel
                  </Button>
                  <Button variant="outline" onClick={() => window.print()}>
                    Print
                  </Button>
                </div>

                {reportsQuery.data?.rows && reportsQuery.data.rows.length > 0 ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHead>
                        <tr>
                          {reportType === "class" ? (
                            <>
                              <Th>Class</Th>
                              <Th>Present</Th>
                              <Th>Absent</Th>
                              <Th>Percentage</Th>
                            </>
                          ) : reportType === "student" || reportType === "defaulter" ? (
                            <>
                              <Th>Student</Th>
                              <Th>Roll</Th>
                              <Th>Present</Th>
                              <Th>Absent</Th>
                              <Th>Percentage</Th>
                            </>
                          ) : (
                            <>
                              <Th>Date</Th>
                              <Th>Student ID</Th>
                              <Th>Status</Th>
                            </>
                          )}
                        </tr>
                      </TableHead>
                      <TableBody>
                        {reportType === "class"
                          ? (reportsQuery.data.rows as Array<{ label: string; present: number; absent: number; percentage: number }>).map(
                              (row) => (
                                <tr key={row.label}>
                                  <Td>{row.label}</Td>
                                  <Td>{row.present}</Td>
                                  <Td>{row.absent}</Td>
                                  <Td>{row.percentage}%</Td>
                                </tr>
                              )
                            )
                          : reportType === "student" || reportType === "defaulter"
                            ? (reportsQuery.data.rows as DailyAttendanceStudentReportRow[]).map((row) => (
                                <tr key={row.studentId}>
                                  <Td>{row.fullName}</Td>
                                  <Td>{row.rollNumber}</Td>
                                  <Td>{row.present}</Td>
                                  <Td>{row.absent}</Td>
                                  <Td>{row.percentage}%</Td>
                                </tr>
                              ))
                            : (reportsQuery.data.rows as unknown as Array<{ dateBs: string; studentId: string; status: string }>).map(
                                (row) => (
                                  <tr key={`${row.dateBs}-${row.studentId}`}>
                                    <Td>{row.dateBs}</Td>
                                    <Td>{row.studentId}</Td>
                                    <Td>{row.status}</Td>
                                  </tr>
                                )
                              )}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <EmptyState title="No report data" description="Adjust filters or record attendance to generate reports." />
                )}
              </>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};