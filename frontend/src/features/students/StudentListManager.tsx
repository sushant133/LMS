import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  STUDENT_ACADEMIC_STATUS_LABELS,
  type BatchRecord,
  type ClassRecord,
  type SectionRecord,
  type StudentRecord,
  type YearRecord,
} from "@phit-erp/shared";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Button } from "components/ui/button";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { StudentNameLink } from "components/shared/StudentNameLink";
import { Input } from "components/ui/input";
import { Label } from "components/ui/label";
import { Select } from "components/ui/select";
import { cn } from "lib/utils";
import { useIsCollege } from "hooks/useInstitutionType";
import {
  useHasInstitutionAccess,
  useIsTenantAdmin,
  useNormalizedRole,
} from "hooks/useNormalizedRole";
import { useTeacherScope } from "hooks/useTeacherScope";
import { useAuth } from "features/auth/AuthProvider";
import { userIsTeacher } from "lib/teacherRole";
import {
  filterSectionsByClass,
  filterYearsByBatch,
  getAcademicLabels,
} from "lib/academicStructureUtils";
import { api, unwrap } from "lib/api";
import { toastResendCredentials } from "lib/credentialsEmail";
import { queryClient } from "lib/queryClient";
import { formatCurrencyNpr, parseErrorMessage } from "lib/utils";
import { Badge } from "components/ui/badge";
import { downloadStudentsExcel } from "./studentExportUtils";
import { countPendingRequiredDocuments } from "./studentDocumentUtils";

export const StudentListManager = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = useNormalizedRole();
  const isCollege = useIsCollege();
  const labels = getAcademicLabels(isCollege ? "COLLEGE" : "SCHOOL");
  const isAdmin = useIsTenantAdmin();
  const hasInstitutionRead = useHasInstitutionAccess();
  const isTeacher = userIsTeacher(user) || role === "TEACHER";
  const canManage = isAdmin;
  const canReadList = hasInstitutionRead || isTeacher;
  const teacherScopeQuery = useTeacherScope(isTeacher);

  const [searchQuery, setSearchQuery] = useState("");
  const [batchFilter, setBatchFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [sectionFilter, setSectionFilter] = useState("");

  const studentsQuery = useQuery({
    queryKey: ["students"],
    queryFn: () => unwrap<StudentRecord[]>(api.get("/students")),
    enabled: hasInstitutionRead,
  });
  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: () => unwrap<ClassRecord[]>(api.get("/academics/classes")),
    enabled: hasInstitutionRead && !isCollege,
  });
  const sectionsQuery = useQuery({
    queryKey: ["sections"],
    queryFn: () => unwrap<SectionRecord[]>(api.get("/academics/sections")),
    enabled: hasInstitutionRead && !isCollege,
  });
  const batchesQuery = useQuery({
    queryKey: ["batches"],
    queryFn: () => unwrap<BatchRecord[]>(api.get("/academics/batches")),
    enabled: hasInstitutionRead && isCollege,
  });
  const yearsQuery = useQuery({
    queryKey: ["years"],
    queryFn: () => unwrap<YearRecord[]>(api.get("/academics/years")),
    enabled: hasInstitutionRead && isCollege,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/students/${id}`);
    },
    onSuccess: async () => {
      toast.success("Student permanently deleted");
      await queryClient.invalidateQueries({ queryKey: ["students"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const resendCredentialsMutation = useMutation({
    mutationFn: async (userId: string) => toastResendCredentials(userId),
  });

  const classes = isTeacher
    ? (teacherScopeQuery.data?.classes ?? [])
    : (classesQuery.data ?? []);
  const sections = isTeacher
    ? (teacherScopeQuery.data?.sections ?? [])
    : (sectionsQuery.data ?? []);
  const batches = isTeacher
    ? (teacherScopeQuery.data?.batches ?? [])
    : (batchesQuery.data ?? []);
  const years = isTeacher
    ? (teacherScopeQuery.data?.years ?? [])
    : (yearsQuery.data ?? []);
  const students = isTeacher
    ? (teacherScopeQuery.data?.students ?? [])
    : (studentsQuery.data ?? []);

  const primaryMap = useMemo(
    () =>
      new Map(
        (isCollege ? batches : classes).map((item) => [item._id, item.name]),
      ),
    [batches, classes, isCollege],
  );
  const secondaryMap = useMemo(
    () =>
      new Map(
        (isCollege ? years : sections).map((item) => [item._id, item.name]),
      ),
    [isCollege, sections, years],
  );

  const filteredYearOptions = useMemo(
    () => filterYearsByBatch(years, batchFilter),
    [batchFilter, years],
  );
  const filteredSectionOptions = useMemo(
    () => filterSectionsByClass(sections, classFilter),
    [classFilter, sections],
  );

  const hasActiveFilters = Boolean(
    searchQuery.trim() ||
    batchFilter ||
    yearFilter ||
    classFilter ||
    sectionFilter,
  );

  const filteredStudents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return students.filter((student) => {
      // Skip orphaned student records (user account missing)
      if (!student.user) return false;

      if (isCollege) {
        if (batchFilter && student.batchId !== batchFilter) return false;
        if (yearFilter && student.yearId !== yearFilter) return false;
      } else {
        if (classFilter && student.classId !== classFilter) return false;
        if (sectionFilter && student.sectionId !== sectionFilter) return false;
      }

      if (!query) return true;

      const name = (student.user.fullName ?? "").toLowerCase();
      const email = (student.user.email ?? "").toLowerCase();
      const phone = (student.user.phone ?? "").toLowerCase();
      const guardianPhone = (student.guardianPhone ?? "").toLowerCase();
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
  }, [
    batchFilter,
    classFilter,
    isCollege,
    searchQuery,
    sectionFilter,
    students,
    yearFilter,
  ]);

  const clearFilters = () => {
    setSearchQuery("");
    setBatchFilter("");
    setYearFilter("");
    setClassFilter("");
    setSectionFilter("");
  };

  const clearFiltersButton = (alignLabel: string) => (
    <div className="space-y-2">
      <Label className="invisible select-none" aria-hidden="true">
        {alignLabel}
      </Label>
      <Button
        type="button"
        variant="outline"
        className={cn(
          "h-10 w-full border-slate-300 bg-white transition-colors",
          "hover:border-brand-300 hover:bg-brand-100 hover:text-brand-800",
          "disabled:hover:border-slate-300 disabled:hover:bg-white disabled:hover:text-slate-900",
        )}
        disabled={!hasActiveFilters}
        onClick={clearFilters}
      >
        Clear filters
      </Button>
    </div>
  );

  const handleEdit = (student: StudentRecord) => {
    navigate("/students/create", { state: { student } });
  };

  const isLoading = isTeacher
    ? teacherScopeQuery.isLoading
    : studentsQuery.isLoading ||
      (isCollege
        ? batchesQuery.isLoading || yearsQuery.isLoading
        : classesQuery.isLoading || sectionsQuery.isLoading);

  if (isLoading) {
    return <LoadingState />;
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>
            {canManage ? "All Students" : "My Students"}
          </CardTitle>
          <p className="mt-1 text-sm text-slate-500">
            {isTeacher && !canManage
              ? "Students in your assigned subject batch/year (or class/section)."
              : null}{" "}
            Showing {filteredStudents.length} of {students.length} student
            {students.length === 1 ? "" : "s"}
            {isTeacher &&
            !canManage &&
            students.length === 0 &&
            !teacherScopeQuery.isLoading
              ? " — ask admin to assign you a subject with batch and year under Subject Assignment."
              : ""}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={filteredStudents.length === 0}
          onClick={() => {
            downloadStudentsExcel(filteredStudents, {
              isCollege,
              primaryLabel: labels.primary,
              secondaryLabel: labels.secondary,
              primaryMap,
              secondaryMap,
              includeFees: canManage,
            });
            toast.success("Student data exported to Excel");
          }}
        >
          Export Excel
        </Button>
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
                  <option value="">
                    All {labels.primaryPlural.toLowerCase()}
                  </option>
                  {batches.map((item) => (
                    <option key={item._id} value={item._id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={labels.secondary}>
                <Select
                  value={yearFilter}
                  onChange={(event) => setYearFilter(event.target.value)}
                >
                  <option value="">
                    All {labels.secondaryPlural.toLowerCase()}
                  </option>
                  {filteredYearOptions.map((item) => (
                    <option key={item._id} value={item._id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              {clearFiltersButton(labels.secondary)}
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
                  <option value="">
                    All {labels.primaryPlural.toLowerCase()}
                  </option>
                  {classes.map((item) => (
                    <option key={item._id} value={item._id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={labels.secondary}>
                <Select
                  value={sectionFilter}
                  onChange={(event) => setSectionFilter(event.target.value)}
                >
                  <option value="">
                    All {labels.secondaryPlural.toLowerCase()}
                  </option>
                  {filteredSectionOptions.map((item) => (
                    <option key={item._id} value={item._id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              {clearFiltersButton(labels.secondary)}
            </>
          )}
        </div>

        {students.length === 0 ? (
          <EmptyState
            title="No students found"
            description={
              canManage
                ? "Start by registering a student from the Create Student section."
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
                  {isCollege ? <Th>Status</Th> : null}
                  <Th>Guardian</Th>
                  {canManage ? <Th>Total Fee</Th> : null}
                  <Th />
                </tr>
              </TableHead>
              <TableBody>
                {filteredStudents.map((student) => {
                  const pendingDocs = countPendingRequiredDocuments(
                    student.documents ?? [],
                  );
                  const displayName =
                    student.user?.fullName ?? "Unknown student";
                  const displayEmail = student.user?.email ?? "—";
                  const displayPhone = student.user?.phone || "—";
                  return (
                  <tr key={student._id}>
                    <Td>
                      <div className="space-y-1">
                        <StudentNameLink
                          studentId={student._id}
                          name={displayName}
                          subtitle={displayEmail}
                        />
                        {pendingDocs > 0 ? (
                          <Badge className="bg-amber-100 text-amber-900">
                            {pendingDocs} doc{pendingDocs === 1 ? "" : "s"}{" "}
                            pending
                          </Badge>
                        ) : null}
                      </div>
                    </Td>
                    <Td>{displayPhone}</Td>
                    <Td>{student.rollNumber}</Td>
                    <Td>
                      <div className="space-y-0.5">
                        <p>{student.admissionNumber}</p>
                        {student.registrationNumber ? (
                          <p className="text-xs text-slate-500">
                            Reg: {student.registrationNumber}
                          </p>
                        ) : null}
                      </div>
                    </Td>
                    <Td>
                      {primaryMap.get(
                        (isCollege ? student.batchId : student.classId) ?? "",
                      ) ?? "—"}
                    </Td>
                    <Td>
                      {secondaryMap.get(
                        (isCollege ? student.yearId : student.sectionId) ?? "",
                      ) ?? "—"}
                    </Td>
                    {isCollege ? (
                      <Td>
                        <span
                          className={
                            (student.academicStatus ?? "ACTIVE") === "ACTIVE"
                              ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800"
                              : (student.academicStatus ?? "") ===
                                    "PENDING_NOT_PASSED"
                                ? "rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-900"
                                : (student.academicStatus ?? "") ===
                                      "PASSED_OUT" ||
                                    (student.academicStatus ?? "") === "ALUMNI"
                                  ? "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
                                  : "rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700"
                          }
                        >
                          {STUDENT_ACADEMIC_STATUS_LABELS[
                            (student.academicStatus ??
                              "ACTIVE") as keyof typeof STUDENT_ACADEMIC_STATUS_LABELS
                          ] ??
                            (student.academicStatus ?? "ACTIVE").replace(
                              /_/g,
                              " ",
                            )}
                        </span>
                      </Td>
                    ) : null}
                    <Td>{student.guardianName}</Td>
                    {canManage ? (
                      <Td>
                        {student.hasScholarship ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                            Scholarship
                          </span>
                        ) : (
                          formatCurrencyNpr(student.feesDueNpr)
                        )}
                      </Td>
                    ) : null}
                    <Td className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            navigate(`/students/${student._id}/profile`)
                          }
                        >
                          View Profile
                        </Button>
                        {canManage ? (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleEdit(student)}
                            >
                              Edit
                            </Button>
                            {student.user?._id ? (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={resendCredentialsMutation.isPending}
                                onClick={() => {
                                  if (
                                    !window.confirm(
                                      `Resend login credentials to ${displayName} (${student.user.email})?\n\nA new password will be generated and emailed to the student.`,
                                    )
                                  ) {
                                    return;
                                  }
                                  void resendCredentialsMutation.mutateAsync(
                                    student.user._id,
                                  );
                                }}
                              >
                                Resend credentials
                              </Button>
                            ) : null}
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => {
                                if (
                                  !window.confirm(
                                    `Permanently delete ${displayName} (${student.admissionNumber})?\n\nThis removes the student record, login ID, email, phone, password, and related data from the database. This cannot be undone.`,
                                  )
                                ) {
                                  return;
                                }
                                void deleteMutation.mutateAsync(student._id);
                              }}
                            >
                              Delete
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </Td>
                  </tr>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
