import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ClassRecord, SectionRecord, StudentInput, StudentRecord } from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { useAuth } from "features/auth/AuthProvider";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Button } from "components/ui/button";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
import { PageHeader } from "components/shared/PageHeader";
import { useTeacherScope } from "hooks/useTeacherScope";
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
  admissionDateBs: student.admissionDateBs,
  dateOfBirthBs: student.dateOfBirthBs,
  gender: student.gender,
  bloodGroup: student.bloodGroup,
  address: student.address,
  fatherName: student.fatherName,
  motherName: student.motherName,
  guardianName: student.guardianName,
  guardianPhone: student.guardianPhone,
  feesDueNpr: student.feesDueNpr,
  remarks: student.remarks ?? ""
});

export const StudentsManager = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === "SCHOOL_ADMIN" || user?.role === "SUPER_ADMIN";
  const isTeacher = user?.role === "TEACHER";
  const canManage = isAdmin;
  const teacherScopeQuery = useTeacherScope(isTeacher);

  const [editing, setEditing] = useState<StudentRecord | null>(null);
  const studentsQuery = useQuery({
    queryKey: ["students"],
    queryFn: () => unwrap<StudentRecord[]>(api.get("/students")),
    enabled: isAdmin
  });
  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: () => unwrap<ClassRecord[]>(api.get("/academics/classes")),
    enabled: isAdmin
  });
  const sectionsQuery = useQuery({
    queryKey: ["sections"],
    queryFn: () => unwrap<SectionRecord[]>(api.get("/academics/sections")),
    enabled: isAdmin
  });

  const studentMutation = useMutation({
    mutationFn: async (payload: StudentInput) =>
      editing ? unwrap<StudentRecord>(api.put(`/students/${editing._id}`, payload)) : unwrap<StudentRecord>(api.post("/students", payload)),
    onSuccess: async () => {
      toast.success(editing ? "Student updated" : "Student created");
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
  const students = isTeacher ? (teacherScopeQuery.data?.students ?? []) : (studentsQuery.data ?? []);

  const classMap = useMemo(() => new Map(classes.map((item) => [item._id, item.name])), [classes]);
  const sectionMap = useMemo(() => new Map(sections.map((item) => [item._id, item.name])), [sections]);

  const isLoading = isTeacher
    ? teacherScopeQuery.isLoading
    : studentsQuery.isLoading || classesQuery.isLoading || sectionsQuery.isLoading;

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
            : "Students in your assigned classes and sections. Contact the school admin to register new students."
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
              initialValue={editing ? mapStudentToInput(editing) : undefined}
              classes={classesQuery.data ?? []}
              sections={sectionsQuery.data ?? []}
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
        <CardHeader>
          <CardTitle>{canManage ? "Students" : "Assigned Students"}</CardTitle>
        </CardHeader>
        <CardContent>
          {students.length === 0 ? (
            <EmptyState
              title="No students found"
              description={
                canManage
                  ? "Start by registering a student profile with BS admission and DOB information."
                  : "No students are assigned to your classes and sections yet."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Roll No.</Th>
                    <Th>Admission No.</Th>
                    <Th>Class</Th>
                    <Th>Section</Th>
                    <Th>Guardian</Th>
                    {canManage ? <Th>Fees Due</Th> : null}
                    {canManage ? <Th /> : null}
                  </tr>
                </TableHead>
                <TableBody>
                  {students.map((student) => (
                    <tr key={student._id}>
                      <Td>
                        <div>
                          <div className="font-medium text-slate-900">{student.user.fullName}</div>
                          <div className="text-xs text-slate-500">{student.user.email}</div>
                        </div>
                      </Td>
                      <Td>{student.rollNumber}</Td>
                      <Td>{student.admissionNumber}</Td>
                      <Td>{classMap.get(student.classId) ?? student.classId}</Td>
                      <Td>{sectionMap.get(student.sectionId) ?? student.sectionId}</Td>
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

