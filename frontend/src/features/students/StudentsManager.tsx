import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { BatchRecord, ClassRecord, SectionRecord, StudentInput, StudentRecord, YearRecord } from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Button } from "components/ui/button";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { PageHeader } from "components/shared/PageHeader";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { useIsCollege } from "hooks/useInstitutionType";
import { useIsTenantAdmin, useNormalizedRole } from "hooks/useNormalizedRole";
import { useTeacherScope } from "hooks/useTeacherScope";
import { filterSectionsByClass, filterYearsByBatch, getAcademicLabels } from "lib/academicStructureUtils";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { formatCurrencyNpr, parseErrorMessage } from "lib/utils";
import { StudentForm } from "./StudentForm";

const mapStudentToInput = (student: StudentRecord): StudentInput => ({
  fullName: student.user.fullName,
  email: student.user.email,
  phone: student.user.phone ?? "",
  admissionNumber: student.admissionNumber,
  rollNumber: student.rollNumber,
  classId: student.classId,
  sectionId: student.sectionId,
  batchId: student.batchId,
  yearId: student.yearId,
  admissionDateBs: student.admissionDateBs,
  dateOfBirthBs: student.dateOfBirthBs,
  gender: student.gender,
  bloodGroup: student.bloodGroup,
  address: student.address,
  fatherName: student.fatherName,
  fatherPhone: student.fatherPhone ?? "",
  motherName: student.motherName,
  motherPhone: student.motherPhone ?? "",
  guardianName: student.guardianName,
  guardianPhone: student.guardianPhone,
  feesDueNpr: student.feesDueNpr,
  remarks: student.remarks ?? ""
});

export const StudentsManager = () => {
  const role = useNormalizedRole();
  const isCollege = useIsCollege();
  const labels = getAcademicLabels(isCollege ? "COLLEGE" : "SCHOOL");
  const isAdmin = useIsTenantAdmin();
  const isTeacher = role === "TEACHER";
  const canManage = isAdmin;
  const teacherScopeQuery = useTeacherScope(isTeacher);

  const [editing, setEditing] = useState<StudentRecord | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [batchFilter, setBatchFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [sectionFilter, setSectionFilter] = useState("");
  const studentsQuery = useQuery({
    queryKey: ["students"],
    queryFn: () => unwrap<StudentRecord[]>(api.get("/students")),
    enabled: isAdmin
  });
  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: () => unwrap<ClassRecord[]>(api.get("/academics/classes")),
    enabled: isAdmin && !isCollege
  });
  const sectionsQuery = useQuery({
    queryKey: ["sections"],
    queryFn: () => unwrap<SectionRecord[]>(api.get("/academics/sections")),
    enabled: isAdmin && !isCollege
  });
  const batchesQuery = useQuery({
    queryKey: ["batches"],
    queryFn: () => unwrap<BatchRecord[]>(api.get("/academics/batches")),
    enabled: isAdmin && isCollege
  });
  const yearsQuery = useQuery({
    queryKey: ["years"],
    queryFn: () => unwrap<YearRecord[]>(api.get("/academics/years")),
    enabled: isAdmin && isCollege
  });

  const studentMutation = useMutation({
    mutationFn: async (payload: StudentInput) =>
      editing
        ? unwrap<StudentRecord>(api.put(`/students/${editing._id}`, payload))
        : unwrap<{ student: StudentRecord; loginEmail: string; defaultPassword: string }>(api.post("/students", payload)),
    onSuccess: async (data) => {
      if ("loginEmail" in data) {
        toast.success("Student created with portal login", {
          description: `Login ID: ${data.loginEmail} · Password: ${data.defaultPassword}`
        });
      } else {
        toast.success("Student updated");
      }
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ["students"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/students/${id}`);
    },
    onSuccess: async () => {
      toast.success("Student deleted");
      await queryClient.invalidateQueries({ queryKey: ["students"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const classes = isTeacher ? (teacherScopeQuery.data?.classes ?? []) : (classesQuery.data ?? []);
  const sections = isTeacher ? (teacherScopeQuery.data?.sections ?? []) : (sectionsQuery.data ?? []);
  const batches = isTeacher ? (teacherScopeQuery.data?.batches ?? []) : (batchesQuery.data ?? []);
  const years = isTeacher ? (teacherScopeQuery.data?.years ?? []) : (yearsQuery.data ?? []);
  const students = isTeacher ? (teacherScopeQuery.data?.students ?? []) : (studentsQuery.data ?? []);

  const primaryMap = useMemo(
    () =>
      new Map(
        (isCollege ? batches : classes).map((item) => [item._id, item.name])
      ),
    [batches, classes, isCollege]
  );
  const secondaryMap = useMemo(
    () =>
      new Map(
        (isCollege ? years : sections).map((item) => [item._id, item.name])
      ),
    [isCollege, sections, years]
  );

  const filteredYearOptions = useMemo(() => filterYearsByBatch(years, batchFilter), [batchFilter, years]);
  const filteredSectionOptions = useMemo(() => filterSectionsByClass(sections, classFilter), [classFilter, sections]);

  const hasActiveFilters = Boolean(searchQuery.trim() || batchFilter || yearFilter || classFilter || sectionFilter);

  const filteredStudents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return students.filter((student) => {
      if (isCollege) {
        if (batchFilter && student.batchId !== batchFilter) {
          return false;
        }
        if (yearFilter && student.yearId !== yearFilter) {
          return false;
        }
      } else {
        if (classFilter && student.classId !== classFilter) {
          return false;
        }
        if (sectionFilter && student.sectionId !== sectionFilter) {
          return false;
        }
      }

      if (!query) {
        return true;
      }

      const name = student.user.fullName.toLowerCase();
      const email = student.user.email.toLowerCase();
      const phone = (student.user.phone ?? "").toLowerCase();
      const guardianPhone = student.guardianPhone.toLowerCase();
      const fatherPhone = (student.fatherPhone ?? "").toLowerCase();
      const motherPhone = (student.motherPhone ?? "").toLowerCase();

      return (
        name.includes(query) ||
        email.includes(query) ||
        phone.includes(query) ||
        guardianPhone.includes(query) ||
        fatherPhone.includes(query) ||
        motherPhone.includes(query)
      );
    });
  }, [batchFilter, classFilter, isCollege, searchQuery, sectionFilter, students, yearFilter]);

  const clearFilters = () => {
    setSearchQuery("");
    setBatchFilter("");
    setYearFilter("");
    setClassFilter("");
    setSectionFilter("");
  };

  const isLoading = isTeacher
    ? teacherScopeQuery.isLoading
    : studentsQuery.isLoading ||
      (isCollege ? batchesQuery.isLoading || yearsQuery.isLoading : classesQuery.isLoading || sectionsQuery.isLoading);

  if (isLoading) {
    return <LoadingState />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={canManage ? "Student Management" : "My Students"}
        description={
          canManage
            ? "Admissions, BS dates, Nepal address data, guardian details, and fee due tracking."
            : `Students in your assigned ${labels.primaryPlural.toLowerCase()} and ${labels.secondaryPlural.toLowerCase()}. Contact the college admin to register new students.`
        }
      />

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>{editing ? "Edit Student" : "Create Student"}</CardTitle>
          </CardHeader>
          <CardContent>
            <StudentForm
              key={editing?._id ?? "new-student"}
              isEditing={Boolean(editing)}
              initialValue={editing ? mapStudentToInput(editing) : undefined}
              classes={classesQuery.data ?? []}
              sections={sectionsQuery.data ?? []}
              batches={batchesQuery.data ?? []}
              years={yearsQuery.data ?? []}
              submitting={studentMutation.isPending}
              onCancel={editing ? () => setEditing(null) : undefined}
              onSubmit={async (value) => {
                await studentMutation.mutateAsync(value);
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>{canManage ? "Students" : "Assigned Students"}</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              Showing {filteredStudents.length} of {students.length} student{students.length === 1 ? "" : "s"}
            </p>
          </div>
          {hasActiveFilters ? (
            <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 md:grid-cols-2 xl:grid-cols-4">
            <FormField label="Search">
              <Input
                placeholder="Name, mobile number, or login ID"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </FormField>

            {isCollege ? (
              <>
                <FormField label={labels.primary}>
                  <Select
                    value={batchFilter}
                    onChange={(event) => {
                      setBatchFilter(event.target.value);
                      setYearFilter("");
                    }}
                  >
                    <option value="">All {labels.primaryPlural.toLowerCase()}</option>
                    {batches.map((item) => (
                      <option key={item._id} value={item._id}>
                        {item.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label={labels.secondary}>
                  <Select value={yearFilter} onChange={(event) => setYearFilter(event.target.value)}>
                    <option value="">All {labels.secondaryPlural.toLowerCase()}</option>
                    {filteredYearOptions.map((item) => (
                      <option key={item._id} value={item._id}>
                        {item.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </>
            ) : (
              <>
                <FormField label={labels.primary}>
                  <Select
                    value={classFilter}
                    onChange={(event) => {
                      setClassFilter(event.target.value);
                      setSectionFilter("");
                    }}
                  >
                    <option value="">All {labels.primaryPlural.toLowerCase()}</option>
                    {classes.map((item) => (
                      <option key={item._id} value={item._id}>
                        {item.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label={labels.secondary}>
                  <Select value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)}>
                    <option value="">All {labels.secondaryPlural.toLowerCase()}</option>
                    {filteredSectionOptions.map((item) => (
                      <option key={item._id} value={item._id}>
                        {item.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </>
            )}
          </div>

          {students.length === 0 ? (
            <EmptyState
              title="No students found"
              description={
                canManage
                  ? "Start by registering a student profile with BS admission and DOB information."
                  : `No students are assigned to your ${labels.primaryPlural.toLowerCase()} and ${labels.secondaryPlural.toLowerCase()} yet.`
              }
            />
          ) : filteredStudents.length === 0 ? (
            <EmptyState
              title="No matching students"
              description="Try a different name, mobile number, login ID, or filter selection."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Mobile</Th>
                    <Th>Roll No.</Th>
                    <Th>Admission No.</Th>
                    <Th>{labels.primary}</Th>
                    <Th>{labels.secondary}</Th>
                    <Th>Guardian</Th>
                    {canManage ? <Th>Fees Due</Th> : null}
                    {canManage ? <Th /> : null}
                  </tr>
                </TableHead>
                <TableBody>
                  {filteredStudents.map((student) => (
                    <tr key={student._id}>
                      <Td>
                        <div>
                          <div className="font-medium text-slate-900">{student.user.fullName}</div>
                          <div className="text-xs text-slate-500">{student.user.email}</div>
                        </div>
                      </Td>
                      <Td>{student.user.phone || "—"}</Td>
                      <Td>{student.rollNumber}</Td>
                      <Td>{student.admissionNumber}</Td>
                      <Td>{primaryMap.get((isCollege ? student.batchId : student.classId) ?? "") ?? "—"}</Td>
                      <Td>{secondaryMap.get((isCollege ? student.yearId : student.sectionId) ?? "") ?? "—"}</Td>
                      <Td>{student.guardianName}</Td>
                      {canManage ? <Td>{formatCurrencyNpr(student.feesDueNpr)}</Td> : null}
                      {canManage ? (
                        <Td className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => setEditing(student)}>
                              Edit
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => void deleteMutation.mutateAsync(student._id)}>
                              Delete
                            </Button>
                          </div>
                        </Td>
                      ) : null}
                    </tr>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};