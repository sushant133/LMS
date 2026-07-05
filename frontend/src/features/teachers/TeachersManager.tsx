import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { BatchRecord, ClassRecord, SectionRecord, SubjectRecord, TeacherInput, TeacherRecord, YearRecord } from "@phit-erp/shared";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Button } from "components/ui/button";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
import { PageHeader } from "components/shared/PageHeader";
import { useIsCollege } from "hooks/useInstitutionType";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { formatCurrencyNpr, parseErrorMessage } from "lib/utils";
import { TeacherForm } from "./TeacherForm";

const mapTeacherToInput = (teacher: TeacherRecord): TeacherInput => ({
  fullName: teacher.user.fullName,
  email: teacher.user.email,
  phone: teacher.user.phone ?? "",
  teacherCode: teacher.teacherCode,
  qualification: teacher.qualification,
  joinedDateBs: teacher.joinedDateBs,
  address: teacher.address,
  subjects: teacher.subjects,
  assignedClassIds: teacher.assignedClassIds,
  assignedSectionIds: teacher.assignedSectionIds,
  assignedBatchIds: teacher.assignedBatchIds ?? [],
  assignedYearIds: teacher.assignedYearIds ?? [],
  basicSalaryNpr: teacher.basicSalaryNpr
});

interface TeachersManagerProps {
  embedded?: boolean;
}

export const TeachersManager = ({ embedded = false }: TeachersManagerProps) => {
  const isCollege = useIsCollege();
  const [editing, setEditing] = useState<TeacherRecord | null>(null);
  const teachersQuery = useQuery({
    queryKey: ["teachers"],
    queryFn: () => unwrap<TeacherRecord[]>(api.get("/teachers"))
  });
  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: () => unwrap<ClassRecord[]>(api.get("/academics/classes")),
    enabled: !isCollege
  });
  const sectionsQuery = useQuery({
    queryKey: ["sections"],
    queryFn: () => unwrap<SectionRecord[]>(api.get("/academics/sections")),
    enabled: !isCollege
  });
  const batchesQuery = useQuery({
    queryKey: ["batches"],
    queryFn: () => unwrap<BatchRecord[]>(api.get("/academics/batches")),
    enabled: isCollege
  });
  const yearsQuery = useQuery({
    queryKey: ["years"],
    queryFn: () => unwrap<YearRecord[]>(api.get("/academics/years")),
    enabled: isCollege
  });
  const subjectsQuery = useQuery({
    queryKey: ["subjects"],
    queryFn: () => unwrap<SubjectRecord[]>(api.get("/academics/subjects"))
  });

  const teacherMutation = useMutation({
    mutationFn: async (payload: TeacherInput) =>
      editing
        ? unwrap<TeacherRecord>(api.put(`/teachers/${editing._id}`, payload))
        : unwrap<{ teacher: TeacherRecord; loginEmail: string; defaultPassword: string }>(api.post("/teachers", payload)),
    onSuccess: async (data) => {
      if ("loginEmail" in data) {
        toast.success("Teacher created with portal login", {
          description: `Login ID: ${data.loginEmail} · Password: ${data.defaultPassword}`
        });
      } else {
        toast.success("Teacher updated");
      }
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ["teachers"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/teachers/${id}`);
    },
    onSuccess: async () => {
      toast.success("Teacher deleted");
      await queryClient.invalidateQueries({ queryKey: ["teachers"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const classMap = useMemo(() => new Map((classesQuery.data ?? []).map((item) => [item._id, item.name])), [classesQuery.data]);
  const subjectMap = useMemo(() => new Map((subjectsQuery.data ?? []).map((item) => [item._id, item.name])), [subjectsQuery.data]);

  if (
    teachersQuery.isLoading ||
    subjectsQuery.isLoading ||
    (isCollege ? batchesQuery.isLoading || yearsQuery.isLoading : classesQuery.isLoading || sectionsQuery.isLoading)
  ) {
    return <LoadingState />;
  }

  const teachers = teachersQuery.data ?? [];

  const content = (
    <>
      {!embedded ? (
        <PageHeader title="Teacher Management" description="Manage teacher accounts, qualifications, BS joining dates, classes, and subject assignments." />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{editing ? "Edit Teacher" : "Create Teacher"}</CardTitle>
        </CardHeader>
        <CardContent>
          <TeacherForm
            key={editing?._id ?? "new-teacher"}
            isEditing={Boolean(editing)}
            initialValue={editing ? mapTeacherToInput(editing) : undefined}
            classes={classesQuery.data ?? []}
            sections={sectionsQuery.data ?? []}
            batches={batchesQuery.data ?? []}
            years={yearsQuery.data ?? []}
            subjects={subjectsQuery.data ?? []}
            submitting={teacherMutation.isPending}
            onCancel={editing ? () => setEditing(null) : undefined}
            onSubmit={async (value) => {
              await teacherMutation.mutateAsync(value);
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Teachers</CardTitle>
        </CardHeader>
        <CardContent>
          {teachers.length === 0 ? (
            <EmptyState title="No teachers yet" description="Create teacher profiles and link them with subjects and class responsibilities." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Code</Th>
                    <Th>Qualification</Th>
                    <Th>Classes</Th>
                    <Th>Subjects</Th>
                    <Th>Salary</Th>
                    <Th />
                  </tr>
                </TableHead>
                <TableBody>
                  {teachers.map((teacher) => (
                    <tr key={teacher._id}>
                      <Td>
                        <div>
                          <div className="font-medium text-slate-900">{teacher.user.fullName}</div>
                          <div className="text-xs text-slate-500">{teacher.user.email}</div>
                        </div>
                      </Td>
                      <Td>{teacher.teacherCode}</Td>
                      <Td>{teacher.qualification}</Td>
                      <Td>{teacher.assignedClassIds.map((id) => classMap.get(id) ?? id).join(", ")}</Td>
                      <Td>{teacher.subjects.map((id) => subjectMap.get(id) ?? id).join(", ")}</Td>
                      <Td>{formatCurrencyNpr(teacher.basicSalaryNpr)}</Td>
                      <Td className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => setEditing(teacher)}>
                            Edit
                          </Button>
                          <Button variant="destructive" size="sm" onClick={() => void deleteMutation.mutateAsync(teacher._id)}>
                            Delete
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );

  return <div className="space-y-6">{content}</div>;
};
