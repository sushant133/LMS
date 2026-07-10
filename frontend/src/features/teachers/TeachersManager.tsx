import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { TeacherInput, TeacherRecord } from "@phit-erp/shared";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Button } from "components/ui/button";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
import { PageHeader } from "components/shared/PageHeader";
import { api, unwrap } from "lib/api";
import {
  toastCredentialCreateResult,
  type CredentialsEmailResult,
} from "lib/credentialsEmail";
import { queryClient } from "lib/queryClient";
import { formatCurrencyNpr, parseErrorMessage } from "lib/utils";
import { useIsTenantAdmin } from "hooks/useNormalizedRole";
import { TeacherForm } from "./TeacherForm";

const mapTeacherToInput = (teacher: TeacherRecord): TeacherInput => ({
  fullName: teacher.user.fullName,
  email: teacher.user.email,
  phone: teacher.user.phone ?? "",
  teacherCode: teacher.teacherCode,
  qualification: teacher.qualification,
  joinedDateBs: teacher.joinedDateBs,
  address: teacher.address,
  subjects: [],
  assignedClassIds: [],
  assignedSectionIds: [],
  assignedBatchIds: [],
  assignedYearIds: [],
  basicSalaryNpr: teacher.basicSalaryNpr,
});

interface TeachersManagerProps {
  embedded?: boolean;
}

export const TeachersManager = ({ embedded = false }: TeachersManagerProps) => {
  const canManage = useIsTenantAdmin();
  const [editing, setEditing] = useState<TeacherRecord | null>(null);
  const teachersQuery = useQuery({
    queryKey: ["teachers"],
    queryFn: () => unwrap<TeacherRecord[]>(api.get("/teachers")),
  });

  const teacherMutation = useMutation({
    mutationFn: async (payload: TeacherInput) =>
      editing
        ? unwrap<TeacherRecord>(api.put(`/teachers/${editing._id}`, payload))
        : unwrap<{
            teacher: TeacherRecord;
            loginEmail: string;
            defaultPassword: string;
            credentialsEmail?: CredentialsEmailResult;
          }>(api.post("/teachers", payload)),
    onSuccess: async (data) => {
      if ("loginEmail" in data) {
        toastCredentialCreateResult(data, {
          successTitle: "Teacher created successfully",
        });
      } else {
        toast.success("Teacher updated");
      }
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ["teachers"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/teachers/${id}`);
    },
    onSuccess: async () => {
      toast.success("Teacher permanently deleted");
      await queryClient.invalidateQueries({ queryKey: ["teachers"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  if (teachersQuery.isLoading) {
    return <LoadingState />;
  }

  const teachers = teachersQuery.data ?? [];

  const content = (
    <>
      {!embedded ? (
        <PageHeader
          title="Teacher Management"
          description="Manage teacher accounts and HR fields. Teaching load is configured under Academics → Subject Assignment."
        />
      ) : null}

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>{editing ? "Edit Teacher" : "Create Teacher"}</CardTitle>
          </CardHeader>
          <CardContent>
            <TeacherForm
              key={editing?._id ?? "new-teacher"}
              isEditing={Boolean(editing)}
              teacherId={editing?._id}
              initialValue={editing ? mapTeacherToInput(editing) : undefined}
              submitting={teacherMutation.isPending}
              onCancel={editing ? () => setEditing(null) : undefined}
              onSubmit={async (value) => {
                await teacherMutation.mutateAsync(value);
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Teachers</CardTitle>
        </CardHeader>
        <CardContent>
          {teachers.length === 0 ? (
            <EmptyState
              title="No teachers yet"
              description="Create teacher profiles (HR only), then assign subjects under Academics → Subject Assignment."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Code</Th>
                    <Th>Qualification</Th>
                    <Th>Migration</Th>
                    <Th>Salary</Th>
                    <Th />
                  </tr>
                </TableHead>
                <TableBody>
                  {teachers.map((teacher) => (
                    <tr key={teacher._id}>
                      <Td>
                        <div>
                          <div className="font-medium text-slate-900">
                            {teacher.user.fullName}
                          </div>
                          <div className="text-xs text-slate-500">
                            {teacher.user.email}
                          </div>
                        </div>
                      </Td>
                      <Td>{teacher.teacherCode}</Td>
                      <Td>{teacher.qualification}</Td>
                      <Td className="text-xs">
                        {teacher.assignmentMigrationStatus ?? "PENDING"}
                      </Td>
                      <Td>{formatCurrencyNpr(teacher.basicSalaryNpr)}</Td>
                      {canManage ? (
                        <Td className="text-right">
                          <div className="flex justify-end gap-2">
                            <Link
                              to={`/academics/subject-assignments?teacherId=${teacher._id}`}
                              className="inline-flex h-8 items-center rounded-md border border-slate-200 px-2 text-xs text-slate-700 hover:bg-slate-50"
                            >
                              Assignments
                            </Link>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setEditing(teacher)}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => {
                                if (
                                  !window.confirm(
                                    `Permanently delete ${teacher.user.fullName}?\n\nThis removes the teacher record, login ID, email, phone, password, and related data from the database. This cannot be undone.`,
                                  )
                                ) {
                                  return;
                                }
                                void deleteMutation.mutateAsync(teacher._id);
                              }}
                            >
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
    </>
  );

  return <div className="space-y-6">{content}</div>;
};
