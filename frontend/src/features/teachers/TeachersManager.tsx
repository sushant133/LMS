import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  DEFAULT_TEACHER_DESIGNATION,
  type HrDocument,
  type TeacherInput,
  type TeacherRecord,
} from "@phit-erp/shared";
import { Printer } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Button } from "components/ui/button";
import { Badge } from "components/ui/badge";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { CollegeLogo } from "components/shared/CollegeLogo";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
import { PageHeader } from "components/shared/PageHeader";
import { PhoneLink } from "components/shared/PhoneLink";
import { useAuth } from "features/auth/AuthProvider";
import { api, unwrap } from "lib/api";
import { getCollegeDisplayName } from "lib/auth";
import {
  toastCredentialCreateResult,
  type CredentialsEmailResult,
} from "lib/credentialsEmail";
import {
  formatPrintAddress,
  getPrintInstitutionBranding,
} from "lib/printBranding";
import { printElementById } from "lib/printUtils";
import { queryClient } from "lib/queryClient";
import { formatCurrencyNpr, parseErrorMessage } from "lib/utils";
import { useIsCollege } from "hooks/useInstitutionType";
import { useIsTenantAdmin } from "hooks/useNormalizedRole";
import { ModuleAccessControlPanel } from "features/users/ModuleAccessControlPanel";
import { TeacherAssignmentsPanel } from "./TeacherAssignmentsPanel";
import { TeacherForm } from "./TeacherForm";

const TEACHERS_PRINT_AREA_ID = "teachers-list-print-area";

const printTh: CSSProperties = {
  border: "1px solid #94a3b8",
  background: "#f1f5f9",
  padding: "5px 4px",
  fontSize: 10,
  fontWeight: 700,
  textAlign: "left",
  color: "#0f172a",
  whiteSpace: "nowrap",
};

const printTd: CSSProperties = {
  border: "1px solid #cbd5e1",
  padding: "4px 4px",
  fontSize: 10,
  color: "#0f172a",
  verticalAlign: "top",
};

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
  const { user, availableSchools } = useAuth();
  const institutionName = getCollegeDisplayName(availableSchools, user);
  const printBranding = getPrintInstitutionBranding();
  const institutionAddress =
    printBranding.address?.trim() ||
    formatPrintAddress(
      availableSchools[0]?.address ?? user?.school?.address,
    );
  const [printing, setPrinting] = useState(false);
  const [editing, setEditing] = useState<TeacherRecord | null>(null);
  const [editDocuments, setEditDocuments] = useState<HrDocument[]>([]);
  const [accessTeacher, setAccessTeacher] = useState<TeacherRecord | null>(null);
  const moduleAccessRef = useRef<HTMLDivElement | null>(null);

  /**
   * Bring the panel itself into view once it has rendered.
   *
   * The button used to jump to the top of the page instead, which landed above
   * the panel — with the add-teacher card in between it read as "the page just
   * scrolled up" rather than as the module access opening. The panel does not
   * exist until this state is set, so the scroll has to happen in an effect.
   */
  useEffect(() => {
    if (!accessTeacher?.user?._id) return;
    moduleAccessRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [accessTeacher]);
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
  const isTeacherActive = (teacher: (typeof teachers)[number]) =>
    teacher.status !== "INACTIVE" && teacher.user?.isActive !== false;
  const printableTeachers = teachers.filter(isTeacherActive);

  const handlePrintList = async () => {
    if (printableTeachers.length === 0) {
      toast.error("No activated teachers to print");
      return;
    }
    setPrinting(true);
    try {
      const el = document.getElementById(TEACHERS_PRINT_AREA_ID);
      if (!el?.textContent?.trim()) {
        throw new Error("Print content is empty — try again");
      }
      await printElementById(TEACHERS_PRINT_AREA_ID, "teachers-list-print");
      toast.success(
        `Print dialog opened — ${printableTeachers.length} teacher${
          printableTeachers.length === 1 ? "" : "s"
        }`,
      );
    } catch (e) {
      toast.error(parseErrorMessage(e));
    } finally {
      setPrinting(false);
    }
  };

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
        <div ref={moduleAccessRef} className="scroll-mt-4 space-y-2">
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
        <CardHeader className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <CardTitle>Teachers</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              Showing {teachers.length} teacher{teachers.length === 1 ? "" : "s"}
            </p>
          </div>
          <Button
            variant="outline"
            className="w-full shrink-0 sm:w-auto"
            disabled={printableTeachers.length === 0 || printing}
            onClick={() => void handlePrintList()}
          >
            <Printer className="mr-2 h-4 w-4" />
            {printing ? "Preparing…" : "Print list"}
          </Button>
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
                    <Th className="w-14 text-center">S.N.</Th>
                    <Th>Name</Th>
                    <Th>Phone</Th>
                    <Th>Designation</Th>
                    <Th>Qualification</Th>
                    <Th>Code</Th>
                    <Th>Status</Th>
                    <Th>Teaching load</Th>
                    <Th>Migration</Th>
                    <Th>Salary</Th>
                    <Th />
                  </tr>
                </TableHead>
                <TableBody>
                  {teachers.map((teacher, index) => {
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
                      <Td className="text-center tabular-nums text-slate-500">
                        {index + 1}
                      </Td>
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
                      <Td className="text-sm">
                        <PhoneLink phone={teacher.user?.phone} />
                      </Td>
                      <Td>
                        <Badge className="bg-brand-100 text-brand-900">
                          {designation}
                        </Badge>
                      </Td>
                      <Td className="text-sm text-slate-700">
                        {teacher.qualification?.trim() || "—"}
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

        {/* Hidden print layout — college header + teachers table */}
        <div
          id={TEACHERS_PRINT_AREA_ID}
          className="hidden print:block"
          aria-hidden="true"
          style={{
            background: "#ffffff",
            color: "#0f172a",
            padding: 16,
            fontFamily:
              '"IBM Plex Sans", "Noto Sans Devanagari", "Nirmala UI", sans-serif',
          }}
        >
          <header
            style={{
              marginBottom: 12,
              paddingBottom: 10,
              borderBottom: "1px solid #94a3b8",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <CollegeLogo className="h-12 w-12 shrink-0" />
              <div style={{ minWidth: 0 }}>
                <p
                  style={{
                    margin: 0,
                    fontSize: 16,
                    fontWeight: 700,
                    color: "#0f172a",
                  }}
                >
                  {institutionName || printBranding.name || "Institution"}
                </p>
                {institutionAddress ? (
                  <p
                    style={{
                      margin: "2px 0 0",
                      fontSize: 11,
                      color: "#475569",
                      lineHeight: 1.35,
                    }}
                  >
                    {institutionAddress}
                  </p>
                ) : null}
                <p
                  style={{
                    margin: "2px 0 0",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#1e293b",
                  }}
                >
                  Teachers list
                </p>
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: 11,
                    color: "#334155",
                    fontWeight: 600,
                  }}
                >
                  Active only
                </p>
                <p
                  style={{
                    margin: "2px 0 0",
                    fontSize: 10,
                    color: "#64748b",
                  }}
                >
                  {printableTeachers.length} active teacher
                  {printableTeachers.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>
          </header>

          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              tableLayout: "auto",
            }}
          >
            <thead>
              <tr>
                <th style={{ ...printTh, textAlign: "center", width: 36 }}>
                  S.N.
                </th>
                <th style={printTh}>Name</th>
                <th style={printTh}>Phone</th>
                <th style={printTh}>Designation</th>
                <th style={printTh}>Qualification</th>
                <th style={printTh}>Code</th>
                <th style={printTh}>Status</th>
                <th style={printTh}>Teaching load</th>
                {canManage ? (
                  <th style={{ ...printTh, textAlign: "right" }}>Salary</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {printableTeachers.map((teacher, index) => {
                const designation =
                  teacher.user?.designation?.trim() ||
                  DEFAULT_TEACHER_DESIGNATION;
                const isActive =
                  teacher.status !== "INACTIVE" &&
                  teacher.user?.isActive !== false;
                return (
                  <tr
                    key={teacher._id}
                    style={{
                      background: index % 2 === 1 ? "#f8fafc" : "#ffffff",
                    }}
                  >
                    <td style={{ ...printTd, textAlign: "center" }}>
                      {index + 1}
                    </td>
                    <td style={printTd}>
                      <div style={{ fontWeight: 600 }}>
                        {teacher.user?.fullName ?? "—"}
                      </div>
                      {teacher.user?.email ? (
                        <div style={{ fontSize: 9, color: "#64748b" }}>
                          {teacher.user.email}
                        </div>
                      ) : null}
                    </td>
                    <td style={printTd}>{teacher.user?.phone?.trim() || "—"}</td>
                    <td style={printTd}>{designation}</td>
                    <td style={printTd}>
                      {teacher.qualification?.trim() || "—"}
                    </td>
                    <td style={printTd}>{teacher.teacherCode || "—"}</td>
                    <td style={printTd}>{isActive ? "Active" : "Inactive"}</td>
                    <td style={printTd}>
                      {legacyLoadSummary(teacher, isCollege)}
                    </td>
                    {canManage ? (
                      <td style={{ ...printTd, textAlign: "right" }}>
                        {formatCurrencyNpr(teacher.basicSalaryNpr)}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>

          <footer
            style={{
              marginTop: 12,
              paddingTop: 8,
              borderTop: "1px solid #cbd5e1",
              fontSize: 9,
              color: "#64748b",
            }}
          >
            <p style={{ margin: 0 }}>
              Teachers list · Confidential institutional record
            </p>
          </footer>
        </div>
      </Card>
    </>
  );

  return <div className="space-y-6">{content}</div>;
};
