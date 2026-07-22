import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  DEFAULT_TEACHER_DESIGNATION,
  type HrDocument,
  type TeacherInput,
  type TeacherRecord,
} from "@phit-erp/shared";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Button } from "components/ui/button";
import { Badge } from "components/ui/badge";
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
import { useIsCollege } from "hooks/useInstitutionType";
import { useIsTenantAdmin } from "hooks/useNormalizedRole";
import { ModuleAccessControlPanel } from "features/users/ModuleAccessControlPanel";
import { TeacherAssignmentsPanel } from "./TeacherAssignmentsPanel";
import { TeacherForm } from "./TeacherForm";

const migrationBadgeClass = (status: string): string => {
  switch (status) {
    case "ACCEPTED":
    case "NA":
      return "bg-emerald-100 text-emerald-800";
    case "NEEDS_REVIEW":
      return "bg-orange-100 text-orange-900";
    default:
      return "bg-amber-100 text-amber-900";
  }
};

/** Compact summary of what an already-created teacher already has on file */
const legacyLoadSummary = (
  teacher: TeacherRecord,
  isCollege: boolean,
): string => {
  const subjects = teacher.subjects?.length ?? 0;
  if (isCollege) {
    const years = teacher.assignedYearIds?.length ?? 0;
    const batches = teacher.assignedBatchIds?.length ?? 0;
    if (subjects === 0 && years === 0 && batches === 0) {
      return "No load on record";
    }
    return `${subjects} subject(s) · ${batches} batch(es) · ${years} year(s)`;
  }
  const classes = teacher.assignedClassIds?.length ?? 0;
  const sections = teacher.assignedSectionIds?.length ?? 0;
  if (subjects === 0 && classes === 0 && sections === 0) {
    return "No load on record";
  }
  return `${subjects} subject(s) · ${classes} class(es) · ${sections} section(s)`;
};

const mapTeacherToInput = (teacher: TeacherRecord): TeacherInput => ({
  fullName: teacher.user.fullName,
  email: teacher.user.email,
  phone: teacher.user.phone ?? "",
  teacherCode: teacher.teacherCode,
  qualification: teacher.qualification,
  designation:
    teacher.user?.designation?.trim() || DEFAULT_TEACHER_DESIGNATION,
  joinedDateBs: teacher.joinedDateBs,
  address: teacher.address,
  subjects: [],
  assignedClassIds: [],
  assignedSectionIds: [],
  assignedBatchIds: [],
  assignedYearIds: [],
  basicSalaryNpr: teacher.basicSalaryNpr,
  photoUrl: teacher.photoUrl ?? "",
});

interface TeachersManagerProps {
  embedded?: boolean;
}

export const TeachersManager = ({ embedded = false }: TeachersManagerProps) => {
  const canManage = useIsTenantAdmin();
  const isCollege = useIsCollege();
  const [editing, setEditing] = useState<TeacherRecord | null>(null);
  const [editDocuments, setEditDocuments] = useState<HrDocument[]>([]);
  const [accessTeacher, setAccessTeacher] = useState<TeacherRecord | null>(null);
  const [assignmentsTeacher, setAssignmentsTeacher] =
    useState<TeacherRecord | null>(null);
  const teachersQuery = useQuery({
    // includeInactive so admins can see deactivated teachers and re-activate them
    queryKey: ["teachers", "manage"],
    queryFn: () =>
      unwrap<TeacherRecord[]>(
        api.get("/teachers", { params: { includeInactive: true } }),
      ),
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
      setEditDocuments([]);
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

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "INACTIVE" }) =>
      unwrap<TeacherRecord>(api.put(`/teachers/${id}/status`, { status })),
    onSuccess: async (_, vars) => {
      toast.success(
        vars.status === "ACTIVE"
          ? "Teacher activated — they can log in again"
          : "Teacher deactivated — login is disabled",
      );
      await queryClient.invalidateQueries({ queryKey: ["teachers"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  if (teachersQuery.isLoading) {
    return <LoadingState />;
  }

  const teachers = (teachersQuery.data ?? []).filter(
    (teacher) => Boolean(teacher.user),
  );

  const content = (
    <>
      {!embedded ? (
        <PageHeader
          title="Teacher Management"
          description="One login per teacher. Use Assignments on each row to attach subjects and laboratories to that same account."
        />
      ) : null}

      {assignmentsTeacher ? (
        <div className="mb-6 space-y-3 rounded-xl border border-brand-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">
              Assignments — {assignmentsTeacher.user.fullName}
            </h2>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAssignmentsTeacher(null)}
            >
              Close
            </Button>
          </div>
          <TeacherAssignmentsPanel
            teacherId={assignmentsTeacher._id}
            teacherName={assignmentsTeacher.user.fullName}
            teacher={assignmentsTeacher}
          />
        </div>
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
              documents={editDocuments}
              canManageDocuments={canManage}
              onDocumentsChange={setEditDocuments}
              submitting={teacherMutation.isPending}
              onCancel={
                editing
                  ? () => {
                      setEditing(null);
                      setEditDocuments([]);
                    }
                  : undefined
              }
              onSubmit={async (value) => {
                await teacherMutation.mutateAsync(value);
              }}
            />
            {editing?.user?._id ? (
              <div className="mt-6 border-t border-slate-100 pt-6">
                <ModuleAccessControlPanel
                  userId={editing.user._id}
                  userName={editing.user.fullName}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {canManage && accessTeacher?.user?._id && !editing ? (
        <div className="space-y-2">
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAccessTeacher(null)}
            >
              Close module access
            </Button>
          </div>
          <ModuleAccessControlPanel
            userId={accessTeacher.user._id}
            userName={accessTeacher.user.fullName}
          />
        </div>
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
                    <Th>Designation</Th>
                    <Th>Code</Th>
                    <Th>Status</Th>
                    <Th>Teaching load</Th>
                    <Th>Migration</Th>
                    <Th>Salary</Th>
                    <Th />
                  </tr>
                </TableHead>
                <TableBody>
                  {teachers.map((teacher) => {
                    const migrationStatus =
                      teacher.assignmentMigrationStatus ?? "PENDING";
                    const designation =
                      teacher.user?.designation?.trim() ||
                      DEFAULT_TEACHER_DESIGNATION;
                    const isActive =
                      teacher.status !== "INACTIVE" &&
                      teacher.user?.isActive !== false;
                    return (
                    <tr key={teacher._id}>
                      <Td>
                        <div>
                          <Link
                            to={`/teachers/${teacher._id}/profile`}
                            className="font-medium text-brand-700 hover:underline"
                          >
                            {teacher.user.fullName}
                          </Link>
                          <div className="text-xs text-slate-500">
                            {teacher.user.email}
                          </div>
                        </div>
                      </Td>
                      <Td>
                        <Badge className="bg-brand-100 text-brand-900">
                          {designation}
                        </Badge>
                      </Td>
                      <Td>{teacher.teacherCode}</Td>
                      <Td>
                        <Badge
                          className={
                            isActive
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-200 text-slate-700"
                          }
                        >
                          {isActive ? "Active" : "Inactive"}
                        </Badge>
                      </Td>
                      <Td className="max-w-[14rem] text-xs text-slate-600">
                        {legacyLoadSummary(teacher, isCollege)}
                      </Td>
                      <Td>
                        <Badge className={migrationBadgeClass(migrationStatus)}>
                          {migrationStatus}
                        </Badge>
                      </Td>
                      <Td>{formatCurrencyNpr(teacher.basicSalaryNpr)}</Td>
                      {canManage ? (
                        <Td className="text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button size="sm" variant="outline" asChild>
                              <Link to={`/teachers/${teacher._id}/profile`}>
                                Profile
                              </Link>
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => {
                                setEditing(null);
                                setAccessTeacher(null);
                                setAssignmentsTeacher(teacher);
                                window.scrollTo({ top: 0, behavior: "smooth" });
                              }}
                            >
                              Assignments
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setAccessTeacher(null);
                                setAssignmentsTeacher(null);
                                setEditing(teacher);
                                setEditDocuments(teacher.documents ?? []);
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!teacher.user?._id}
                              onClick={() => {
                                setEditing(null);
                                setAccessTeacher(teacher);
                                window.scrollTo({ top: 0, behavior: "smooth" });
                              }}
                            >
                              Module Access
                            </Button>
                            {isActive ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={statusMutation.isPending}
                                onClick={() => {
                                  if (
                                    !window.confirm(
                                      `Deactivate ${teacher.user.fullName}?\n\nThey will not be able to log in until you activate them again.`,
                                    )
                                  ) {
                                    return;
                                  }
                                  statusMutation.mutate({
                                    id: teacher._id,
                                    status: "INACTIVE",
                                  });
                                }}
                              >
                                Deactivate
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={statusMutation.isPending}
                                onClick={() =>
                                  statusMutation.mutate({
                                    id: teacher._id,
                                    status: "ACTIVE",
                                  })
                                }
                              >
                                Activate
                              </Button>
                            )}
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
                    );
                  })}
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
