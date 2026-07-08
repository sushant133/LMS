import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { hasInstitutionAccess, type AttendanceInput, type AttendanceRecord, type AttendanceStatus, type StudentRecord } from "@phit-erp/shared";
import { toast } from "sonner";
import { useAuth } from "features/auth/AuthProvider";
import { EmptyState } from "components/shared/EmptyState";
import { StudentNameLink } from "components/shared/StudentNameLink";
import { LoadingState } from "components/shared/LoadingState";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { useIsCollege } from "hooks/useInstitutionType";
import { useTeacherScope } from "hooks/useTeacherScope";
import { getAcademicLabels } from "lib/academicStructureUtils";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import {
  filterSectionsByClass,
  filterSubjectsByClass,
  filterSubjectsByYear,
  filterYearsByBatch,
  hasSingleOption
} from "lib/teacherScopeUtils";
import { parseErrorMessage } from "lib/utils";

const statuses: AttendanceStatus[] = ["PRESENT", "ABSENT", "LEAVE", "LATE", "MEDICAL_LEAVE"];

const statusBadgeStyles: Record<AttendanceStatus, string> = {
  PRESENT: "bg-brand-100 text-brand-800",
  ABSENT: "bg-rose-100 text-rose-800",
  LATE: "bg-amber-100 text-amber-800",
  LEAVE: "bg-sky-100 text-sky-800",
  MEDICAL_LEAVE: "bg-violet-100 text-violet-800"
};

const StatusBadge = ({ status }: { status: AttendanceStatus | "NOT_MARKED" }) => {
  if (status === "NOT_MARKED") {
    return <Badge className="bg-slate-100 text-slate-600">Not marked</Badge>;
  }
  return <Badge className={statusBadgeStyles[status]}>{status}</Badge>;
};

interface AttendanceManagerProps {
  embedded?: boolean;
}

export const AttendanceManager = ({ embedded = false }: AttendanceManagerProps) => {
  const { user } = useAuth();
  const isTeacher = user?.role === "TEACHER";
  const isAdminViewer = hasInstitutionAccess(user?.role ?? "");
  const canMark = isTeacher;
  const isCollege = useIsCollege();
  const labels = getAcademicLabels(isCollege ? "COLLEGE" : "SCHOOL");
  const teacherScopeQuery = useTeacherScope(isTeacher);

  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [yearId, setYearId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [dateBs, setDateBs] = useState("");
  const [statusMap, setStatusMap] = useState<Record<string, AttendanceStatus>>({});

  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: () => unwrap<Array<{ _id: string; name: string }>>(api.get("/academics/classes")),
    enabled: isAdminViewer && !isCollege
  });
  const sectionsQuery = useQuery({
    queryKey: ["sections"],
    queryFn: () => unwrap<Array<{ _id: string; name: string; classId: string }>>(api.get("/academics/sections")),
    enabled: isAdminViewer && !isCollege
  });
  const batchesQuery = useQuery({
    queryKey: ["batches"],
    queryFn: () => unwrap<Array<{ _id: string; name: string }>>(api.get("/academics/batches")),
    enabled: isAdminViewer && isCollege
  });
  const yearsQuery = useQuery({
    queryKey: ["years"],
    queryFn: () => unwrap<Array<{ _id: string; name: string; batchId: string }>>(api.get("/academics/years")),
    enabled: isAdminViewer && isCollege
  });
  const subjectsQuery = useQuery({
    queryKey: ["subjects"],
    queryFn: () =>
      unwrap<Array<{ _id: string; name: string; code: string; classIds?: string[]; yearIds?: string[] }>>(
        api.get("/academics/subjects")
      ),
    enabled: isAdminViewer
  });
  const studentsQuery = useQuery({
    queryKey: ["students"],
    queryFn: () => unwrap<StudentRecord[]>(api.get("/students")),
    enabled: isAdminViewer
  });

  const classes = isTeacher ? (teacherScopeQuery.data?.classes ?? []) : (classesQuery.data ?? []);
  const sections = isTeacher ? (teacherScopeQuery.data?.sections ?? []) : (sectionsQuery.data ?? []);
  const batches = isTeacher ? (teacherScopeQuery.data?.batches ?? []) : (batchesQuery.data ?? []);
  const years = isTeacher ? (teacherScopeQuery.data?.years ?? []) : (yearsQuery.data ?? []);
  const subjects = isTeacher ? (teacherScopeQuery.data?.subjects ?? []) : (subjectsQuery.data ?? []);
  const students = isTeacher ? (teacherScopeQuery.data?.students ?? []) : (studentsQuery.data ?? []);

  const primaryId = isCollege ? batchId : classId;
  const secondaryId = isCollege ? yearId : sectionId;
  const filtersComplete = Boolean(primaryId && secondaryId && subjectId && dateBs);

  const attendanceQuery = useQuery({
    queryKey: ["attendance", classId, sectionId, batchId, yearId, subjectId, dateBs],
    queryFn: () =>
      unwrap<AttendanceRecord[]>(
        api.get("/attendance", {
          params: isCollege ? { batchId, yearId, subjectId, dateBs } : { classId, sectionId, subjectId, dateBs }
        })
      ),
    enabled: filtersComplete
  });

  const saveAttendance = useMutation({
    mutationFn: async (payload: AttendanceInput) => unwrap<AttendanceRecord>(api.post("/attendance", payload)),
    onSuccess: async () => {
      toast.success("Attendance saved");
      await queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const filteredSections = useMemo(() => filterSectionsByClass(sections, classId), [classId, sections]);
  const filteredYears = useMemo(() => filterYearsByBatch(years, batchId), [batchId, years]);
  const filteredSubjects = useMemo(
    () => (isCollege ? filterSubjectsByYear(subjects, yearId) : filterSubjectsByClass(subjects, classId)),
    [classId, isCollege, subjects, yearId]
  );

  useEffect(() => {
    if (!isTeacher) {
      return;
    }

    if (isCollege) {
      if (hasSingleOption(batches) && batchId !== batches[0]!._id) {
        setBatchId(batches[0]!._id);
        setYearId("");
        setSubjectId("");
      }
      return;
    }

    if (hasSingleOption(classes) && classId !== classes[0]!._id) {
      setClassId(classes[0]!._id);
      setSectionId("");
      setSubjectId("");
    }
  }, [batchId, batches, classId, classes, isCollege, isTeacher]);

  useEffect(() => {
    if (!isTeacher) {
      return;
    }

    if (isCollege) {
      if (!batchId) return;
      if (hasSingleOption(filteredYears) && yearId !== filteredYears[0]!._id) {
        setYearId(filteredYears[0]!._id);
        setSubjectId("");
      }
      return;
    }

    if (!classId) return;
    if (hasSingleOption(filteredSections) && sectionId !== filteredSections[0]!._id) {
      setSectionId(filteredSections[0]!._id);
      setSubjectId("");
    }
  }, [batchId, classId, filteredSections, filteredYears, isCollege, isTeacher, sectionId, yearId]);

  useEffect(() => {
    if (!isTeacher) return;
    const scopeReady = isCollege ? Boolean(batchId && yearId) : Boolean(classId);
    if (!scopeReady) return;

    if (hasSingleOption(filteredSubjects) && subjectId !== filteredSubjects[0]!._id) {
      setSubjectId(filteredSubjects[0]!._id);
    }
  }, [batchId, classId, filteredSubjects, isCollege, isTeacher, subjectId, yearId]);

  const filteredStudents = useMemo(
    () =>
      students.filter((student) =>
        isCollege
          ? student.batchId === batchId && student.yearId === yearId
          : student.classId === classId && student.sectionId === sectionId
      ),
    [batchId, classId, isCollege, sectionId, students, yearId]
  );

  useEffect(() => {
    const existing = attendanceQuery.data?.[0];
    if (!existing) {
      setStatusMap({});
      return;
    }

    const nextStatusMap = existing.entries.reduce<Record<string, AttendanceStatus>>((acc, item) => {
      acc[item.studentId] = item.status;
      return acc;
    }, {});
    setStatusMap(nextStatusMap);
  }, [attendanceQuery.data]);

  const summary = useMemo(() => {
    const counts = { present: 0, absent: 0, late: 0, leave: 0, notMarked: 0 };
    filteredStudents.forEach((student) => {
      const status = statusMap[student._id];
      if (!status) {
        counts.notMarked += 1;
        return;
      }
      if (status === "PRESENT") counts.present += 1;
      if (status === "ABSENT") counts.absent += 1;
      if (status === "LATE") counts.late += 1;
      if (status === "LEAVE") counts.leave += 1;
    });
    return counts;
  }, [filteredStudents, statusMap]);

  const isLoading = isTeacher
    ? teacherScopeQuery.isLoading
    : studentsQuery.isLoading ||
      subjectsQuery.isLoading ||
      (isCollege ? batchesQuery.isLoading || yearsQuery.isLoading : classesQuery.isLoading || sectionsQuery.isLoading);

  if (isLoading) {
    return <LoadingState />;
  }

  const existingRecord = attendanceQuery.data?.[0];
  const isSyncedFromDaily = Boolean(existingRecord?.autoGeneratedFromDaily);

  const handleSave = async () => {
    if (isSyncedFromDaily) {
      const confirmed = window.confirm(
        "This subject attendance is synchronized with Daily Attendance. Editing it may break synchronization. Continue?"
      );
      if (!confirmed) return;
    }

    await saveAttendance.mutateAsync({
      ...(isCollege ? { batchId, yearId } : { classId, sectionId }),
      subjectId,
      dateBs,
      confirmSyncOverride: isSyncedFromDaily,
      entries: filteredStudents.map((student) => ({
        studentId: student._id,
        status: statusMap[student._id] ?? "PRESENT"
      }))
    });
  };

  return (
    <div className="space-y-6">
      {!embedded ? (
        <PageHeader
          title="Subject-wise Attendance"
          description={
            canMark
              ? "Mark subject-wise attendance for your assigned classes. Each record is stored per subject and teacher."
              : `View attendance results by ${labels.primary.toLowerCase()}, ${labels.secondary.toLowerCase()}, subject, and date.`
          }
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{canMark ? "Attendance Sheet" : "Attendance Lookup"}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">{labels.primary}</label>
            {isTeacher && hasSingleOption(isCollege ? batches : classes) ? (
              <Input value={(isCollege ? batches : classes)[0]!.name} readOnly disabled />
            ) : (
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
                  setSubjectId("");
                }}
              >
                <option value="">Select {labels.primary.toLowerCase()}</option>
                {(isCollege ? batches : classes).map((item) => (
                  <option key={item._id} value={item._id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">{labels.secondary}</label>
            {isTeacher && hasSingleOption(isCollege ? filteredYears : filteredSections) ? (
              <Input value={(isCollege ? filteredYears : filteredSections)[0]!.name} readOnly disabled />
            ) : (
              <Select
                value={isCollege ? yearId : sectionId}
                onChange={(event) => {
                  if (isCollege) {
                    setYearId(event.target.value);
                  } else {
                    setSectionId(event.target.value);
                  }
                  setSubjectId("");
                }}
                disabled={!primaryId}
              >
                <option value="">Select {labels.secondary.toLowerCase()}</option>
                {(isCollege ? filteredYears : filteredSections).map((item) => (
                  <option key={item._id} value={item._id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Subject</label>
            {isTeacher && hasSingleOption(filteredSubjects) ? (
              <Input
                value={
                  filteredSubjects[0]!.code
                    ? `${filteredSubjects[0]!.name} (${filteredSubjects[0]!.code})`
                    : filteredSubjects[0]!.name
                }
                readOnly
                disabled
              />
            ) : (
              <Select value={subjectId} onChange={(event) => setSubjectId(event.target.value)} disabled={!primaryId}>
                <option value="">Select subject</option>
                {filteredSubjects.map((item) => (
                  <option key={item._id} value={item._id}>
                    {item.name} ({item.code})
                  </option>
                ))}
              </Select>
            )}
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Date (BS)</label>
            <NepaliDateField value={dateBs} onChange={setDateBs} />
          </div>
        </CardContent>
      </Card>

      {filtersComplete ? (
        <>
          {isAdminViewer ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              {[
                { label: "Present", value: summary.present, className: "text-brand-700" },
                { label: "Absent", value: summary.absent, className: "text-rose-600" },
                { label: "Late", value: summary.late, className: "text-amber-600" },
                { label: "Leave", value: summary.leave, className: "text-sky-700" },
                { label: "Not marked", value: summary.notMarked, className: "text-slate-600" }
              ].map((stat) => (
                <Card key={stat.label} className="bg-[linear-gradient(135deg,_white_0%,_#eef3fb_100%)]">
                  <CardContent className="py-5">
                    <p className="text-sm text-slate-500">{stat.label}</p>
                    <p className={`mt-1 text-3xl font-semibold ${stat.className}`}>{stat.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : null}

          {isSyncedFromDaily ? (
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              <Badge className="mr-2 bg-sky-100 text-sky-800">Auto Generated from Daily Attendance</Badge>
              First-period subject attendance was synchronized automatically from the daily register.
            </div>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>{canMark ? "Subject Attendance Register" : "Attendance Results"}</CardTitle>
            </CardHeader>
            <CardContent>
              {attendanceQuery.isLoading ? (
                <LoadingState />
              ) : filteredStudents.length === 0 ? (
                <EmptyState
                  title="No students found"
                  description={`Assign students to the selected ${labels.primary.toLowerCase()} and ${labels.secondary.toLowerCase()} first.`}
                />
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHead>
                        <tr>
                          <Th>Student</Th>
                          <Th>Roll</Th>
                          <Th>Status</Th>
                        </tr>
                      </TableHead>
                      <TableBody>
                        {filteredStudents.map((student) => {
                          const status = statusMap[student._id];
                          return (
                            <tr key={student._id}>
                              <Td>
                                <StudentNameLink studentId={student._id} name={student.user.fullName} />
                              </Td>
                              <Td>{student.rollNumber}</Td>
                              <Td>
                                {canMark ? (
                                  <Select
                                    value={status ?? "PRESENT"}
                                    onChange={(event) =>
                                      setStatusMap((current) => ({
                                        ...current,
                                        [student._id]: event.target.value as AttendanceStatus
                                      }))
                                    }
                                  >
                                    {statuses.map((item) => (
                                      <option key={item} value={item}>
                                        {item}
                                      </option>
                                    ))}
                                  </Select>
                                ) : (
                                  <StatusBadge status={status ?? "NOT_MARKED"} />
                                )}
                              </Td>
                            </tr>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  {canMark ? (
                    <div className="mt-4 flex justify-end">
                      <Button disabled={saveAttendance.isPending} onClick={() => void handleSave()}>
                        Save Attendance
                      </Button>
                    </div>
                  ) : attendanceQuery.data?.length === 0 ? (
                    <p className="mt-4 text-sm text-slate-500">
                      {`No attendance has been recorded for this ${labels.primary.toLowerCase()}, ${labels.secondary.toLowerCase()}, subject, and date yet.`}
                    </p>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
};