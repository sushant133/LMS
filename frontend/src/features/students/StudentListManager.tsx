import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import { StickyTableScroll } from "components/ui/StickyTableScroll";
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
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const role = useNormalizedRole();
  const isCollege = useIsCollege();
  const labels = getAcademicLabels(isCollege ? "COLLEGE" : "SCHOOL");
  const isAdmin = useIsTenantAdmin();
  const hasInstitutionRead = useHasInstitutionAccess();
  const isTeacher = userIsTeacher(user) || role === "TEACHER";
  const canManage = isAdmin;
  const teacherScopeQuery = useTeacherScope(isTeacher);

  const [searchQuery, setSearchQuery] = useState("");
  const [batchFilter, setBatchFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [sectionFilter, setSectionFilter] = useState("");
  /** "" | "Male" | "Female" | "Other" */
  const [genderFilter, setGenderFilter] = useState("");
  /** Dashboard deep-link: year display name (e.g. 1st Year) */
  const [yearNameFilter, setYearNameFilter] = useState("");
  /** Dashboard deep-link: ACTIVE | PASSED_OUT | ALUMNI | … */
  const [statusFilter, setStatusFilter] = useState("");

  // Apply filters from main dashboard stat cards (?status= / ?yearName= / ?gender=)
  useEffect(() => {
    const status = searchParams.get("status")?.trim() ?? "";
    const yearName = searchParams.get("yearName")?.trim() ?? "";
    const gender = searchParams.get("gender")?.trim() ?? "";
    const q = searchParams.get("q")?.trim() ?? "";
    // Reset then apply so re-clicking another year on dashboard updates correctly
    setStatusFilter(status);
    setYearNameFilter(yearName);
    if (gender) setGenderFilter(gender);
    else if (searchParams.has("gender")) setGenderFilter("");
    if (q) setSearchQuery(q);
  }, [searchParams]);

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

  /**
   * When dashboard opens with yearName (e.g. "1st Year"), resolve matching year
   * record IDs so filters stay consistent across batches.
   */
  const yearIdsMatchingName = useMemo(() => {
    const wanted = yearNameFilter.trim().toLowerCase();
    if (!wanted || !isCollege) return [] as string[];
    // Exact name match first (dashboard counts by Year.name)
    const exact = years.filter(
      (y) => (y.name ?? "").trim().toLowerCase() === wanted,
    );
    if (exact.length > 0) return exact.map((y) => y._id);
    // Soft match: year name contains filter or vice versa (e.g. "1st Year" vs "HA 1st Year")
    return years
      .filter((y) => {
        const n = (y.name ?? "").trim().toLowerCase();
        return n.includes(wanted) || wanted.includes(n);
      })
      .map((y) => y._id);
  }, [isCollege, yearNameFilter, years]);

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
      sectionFilter ||
      genderFilter ||
      yearNameFilter ||
      statusFilter,
  );

  const filteredStudents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const genderWanted = genderFilter.trim().toLowerCase();
    const yearNameWanted = yearNameFilter.trim().toLowerCase();
    const statusWanted = statusFilter.trim().toUpperCase();

    return students.filter((student) => {
      // Skip orphaned student records (user account missing)
      if (!student.user) return false;

      if (isCollege) {
        if (batchFilter && student.batchId !== batchFilter) return false;
        // Prefer explicit year dropdown; else match all year IDs with dashboard yearName
        if (yearFilter && student.yearId !== yearFilter) return false;
        else if (!yearFilter && yearIdsMatchingName.length > 0) {
          if (
            !student.yearId ||
            !yearIdsMatchingName.includes(student.yearId)
          ) {
            return false;
          }
        } else if (!yearFilter && yearNameWanted) {
          // Fallback: name match if year list not loaded yet / no exact ID match
          const fromMap = student.yearId
            ? (secondaryMap.get(student.yearId) ?? "").toLowerCase()
            : "";
          const fromField = (
            (student as { yearName?: string }).yearName ?? ""
          ).toLowerCase();
          if (fromMap !== yearNameWanted && fromField !== yearNameWanted) {
            return false;
          }
        }
      } else {
        if (classFilter && student.classId !== classFilter) return false;
        if (sectionFilter && student.sectionId !== sectionFilter) return false;
      }

      if (statusWanted) {
        const status = (student.academicStatus ?? "ACTIVE").toUpperCase();
        if (status !== statusWanted) return false;
      }

      if (genderWanted) {
        const studentGender = (student.gender ?? "").trim().toLowerCase();
        if (genderWanted === "other") {
          if (studentGender === "male" || studentGender === "female") {
            return false;
          }
        } else if (studentGender !== genderWanted) {
          return false;
        }
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
    genderFilter,
    isCollege,
    searchQuery,
    secondaryMap,
    sectionFilter,
    statusFilter,
    students,
    yearFilter,
    yearIdsMatchingName,
    yearNameFilter,
  ]);

  const clearFilters = () => {
    setSearchQuery("");
    setBatchFilter("");
    setYearFilter("");
    setClassFilter("");
    setSectionFilter("");
    setGenderFilter("");
    setYearNameFilter("");
    setStatusFilter("");
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

  /**
   * StickyTableScroll uses separate header/body tables with table-fixed.
   * Matching colgroups are required so columns align and cells don't overflow
   * into each other.
   */
  const tableMinWidthClass = canManage
    ? isCollege
      ? "min-w-[1680px]"
      : "min-w-[1540px]"
    : isCollege
      ? "min-w-[1320px]"
      : "min-w-[1200px]";

  const tableClassName = cn("w-full table-fixed", tableMinWidthClass);

  const colGroup = (
    <colgroup>
      {canManage && isCollege ? (
        <>
          <col className="w-[4%]" />
          <col className="w-[13%]" />
          <col className="w-[8%]" />
          <col className="w-[6%]" />
          <col className="w-[8%]" />
          <col className="w-[8%]" />
          <col className="w-[7%]" />
          <col className="w-[8%]" />
          <col className="w-[8%]" />
          <col className="w-[8%]" />
          <col className="w-[22%]" />
        </>
      ) : canManage ? (
        <>
          <col className="w-[4%]" />
          <col className="w-[14%]" />
          <col className="w-[9%]" />
          <col className="w-[6%]" />
          <col className="w-[9%]" />
          <col className="w-[9%]" />
          <col className="w-[8%]" />
          <col className="w-[9%]" />
          <col className="w-[9%]" />
          <col className="w-[23%]" />
        </>
      ) : isCollege ? (
        <>
          <col className="w-[5%]" />
          <col className="w-[16%]" />
          <col className="w-[9%]" />
          <col className="w-[7%]" />
          <col className="w-[9%]" />
          <col className="w-[9%]" />
          <col className="w-[8%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[17%]" />
        </>
      ) : (
        <>
          <col className="w-[5%]" />
          <col className="w-[18%]" />
          <col className="w-[10%]" />
          <col className="w-[8%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[11%]" />
          <col className="w-[18%]" />
        </>
      )}
    </colgroup>
  );

  const thClass = "bg-slate-50 whitespace-nowrap";
  const cellTruncateClass = "min-w-0 max-w-full truncate";

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <CardTitle>
            {canManage ? "All Students" : "My Students"}
          </CardTitle>
          <p className="mt-1 text-sm text-slate-500">
            {isTeacher && !canManage
              ? "Students in your assigned subject batch/year (or class/section). "
              : null}
            Showing {filteredStudents.length} of {students.length} student
            {students.length === 1 ? "" : "s"}
            {isTeacher &&
            !canManage &&
            students.length === 0 &&
            !teacherScopeQuery.isLoading
              ? " — ask admin to assign you a subject with batch and year under Subject Assignment."
              : null}
          </p>
        </div>
        <Button
          variant="outline"
          className="w-full shrink-0 sm:w-auto"
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
      <CardContent className="min-w-0 space-y-4">
        {statusFilter || yearNameFilter ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-200 bg-brand-50/80 px-4 py-2 text-sm text-brand-900">
            <p>
              Filtered from dashboard
              {statusFilter
                ? ` · status: ${statusFilter.replace(/_/g, " ")}`
                : ""}
              {yearNameFilter ? ` · year: ${yearNameFilter}` : ""}
            </p>
            <Button size="sm" variant="outline" onClick={clearFilters}>
              Clear
            </Button>
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          <FormField label="Search">
            <Input
              placeholder="Name, mobile number, or login ID"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </FormField>

          <FormField label="Gender">
            <Select
              value={genderFilter}
              onChange={(event) => setGenderFilter(event.target.value)}
            >
              <option value="">All genders</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </Select>
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
          <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200">
            <StickyTableScroll
              header={
                <Table className={tableClassName}>
                  {colGroup}
                  <TableHead>
                    <tr>
                      <Th className={cn(thClass, "text-center")}>S.N.</Th>
                      <Th className={thClass}>Name</Th>
                      <Th className={thClass}>Mobile</Th>
                      <Th className={thClass}>Roll No.</Th>
                      <Th className={thClass}>Admission No.</Th>
                      <Th className={thClass}>{labels.primary}</Th>
                      <Th className={thClass}>{labels.secondary}</Th>
                      {isCollege ? <Th className={thClass}>Status</Th> : null}
                      <Th className={thClass}>Guardian</Th>
                      {canManage ? (
                        <Th className={cn(thClass, "text-right")}>Total Fee</Th>
                      ) : null}
                      <Th className={cn(thClass, "text-right")}>Actions</Th>
                    </tr>
                  </TableHead>
                </Table>
              }
              body={
                <Table className={tableClassName}>
                  {colGroup}
                  <TableBody>
                    {filteredStudents.map((student, index) => {
                      const pendingDocs = countPendingRequiredDocuments(
                        student.documents ?? [],
                      );
                      const displayName =
                        student.user?.fullName ?? "Unknown student";
                      const displayEmail = student.user?.email ?? "—";
                      const displayPhone = student.user?.phone || "—";
                      const primaryLabel =
                        primaryMap.get(
                          (isCollege ? student.batchId : student.classId) ?? "",
                        ) ?? "—";
                      const secondaryLabel =
                        secondaryMap.get(
                          (isCollege ? student.yearId : student.sectionId) ??
                            "",
                        ) ?? "—";
                      const academicStatus =
                        student.academicStatus ?? "ACTIVE";
                      const statusLabel =
                        STUDENT_ACADEMIC_STATUS_LABELS[
                          academicStatus as keyof typeof STUDENT_ACADEMIC_STATUS_LABELS
                        ] ?? academicStatus.replace(/_/g, " ");
                      const statusClass =
                        academicStatus === "ACTIVE"
                          ? "bg-emerald-100 text-emerald-800"
                          : academicStatus === "PENDING_NOT_PASSED"
                            ? "bg-orange-100 text-orange-900"
                            : academicStatus === "PASSED_OUT" ||
                                academicStatus === "ALUMNI"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-700";

                      return (
                        <tr key={student._id} className="align-top">
                          <Td className="text-center tabular-nums text-slate-500">
                            {index + 1}
                          </Td>
                          <Td className="min-w-0">
                            <div className="min-w-0 space-y-1">
                              <StudentNameLink
                                studentId={student._id}
                                name={displayName}
                                subtitle={displayEmail}
                              />
                              {pendingDocs > 0 ? (
                                <Badge className="max-w-full truncate bg-amber-100 text-amber-900">
                                  {pendingDocs} doc
                                  {pendingDocs === 1 ? "" : "s"} pending
                                </Badge>
                              ) : null}
                            </div>
                          </Td>
                          <Td
                            className={cellTruncateClass}
                            title={displayPhone}
                          >
                            {displayPhone}
                          </Td>
                          <Td
                            className={cellTruncateClass}
                            title={student.rollNumber || undefined}
                          >
                            {student.rollNumber || "—"}
                          </Td>
                          <Td className="min-w-0">
                            <div className="min-w-0 space-y-0.5">
                              <p
                                className="truncate"
                                title={student.admissionNumber || undefined}
                              >
                                {student.admissionNumber || "—"}
                              </p>
                              {student.registrationNumber ? (
                                <p
                                  className="truncate text-xs text-slate-500"
                                  title={`Reg: ${student.registrationNumber}`}
                                >
                                  Reg: {student.registrationNumber}
                                </p>
                              ) : null}
                            </div>
                          </Td>
                          <Td
                            className={cellTruncateClass}
                            title={primaryLabel}
                          >
                            {primaryLabel}
                          </Td>
                          <Td
                            className={cellTruncateClass}
                            title={secondaryLabel}
                          >
                            {secondaryLabel}
                          </Td>
                          {isCollege ? (
                            <Td className="min-w-0">
                              <span
                                className={cn(
                                  "inline-flex max-w-full truncate rounded-full px-2 py-0.5 text-xs font-semibold",
                                  statusClass,
                                )}
                                title={statusLabel}
                              >
                                {statusLabel}
                              </span>
                            </Td>
                          ) : null}
                          <Td
                            className={cellTruncateClass}
                            title={student.guardianName || undefined}
                          >
                            {student.guardianName || "—"}
                          </Td>
                          {canManage ? (
                            <Td className="min-w-0 text-right">
                              {student.hasScholarship ? (
                                <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                                  Scholarship
                                </span>
                              ) : (
                                <span className="tabular-nums">
                                  {formatCurrencyNpr(student.feesDueNpr)}
                                </span>
                              )}
                            </Td>
                          ) : null}
                          <Td className="min-w-0 text-right">
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              <Button
                                variant="outline"
                                size="sm"
                                className="shrink-0 whitespace-nowrap"
                                onClick={() =>
                                  navigate(`/students/${student._id}/profile`)
                                }
                              >
                                Profile
                              </Button>
                              {canManage ? (
                                <>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="shrink-0 whitespace-nowrap"
                                    onClick={() => handleEdit(student)}
                                  >
                                    Edit
                                  </Button>
                                  {student.user?._id ? (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="shrink-0 whitespace-nowrap"
                                      disabled={
                                        resendCredentialsMutation.isPending
                                      }
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
                                      Resend
                                    </Button>
                                  ) : null}
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    className="shrink-0 whitespace-nowrap"
                                    onClick={() => {
                                      if (
                                        !window.confirm(
                                          `Permanently delete ${displayName} (${student.admissionNumber})?\n\nThis removes the student record, login ID, email, phone, password, and related data from the database. This cannot be undone.`,
                                        )
                                      ) {
                                        return;
                                      }
                                      void deleteMutation.mutateAsync(
                                        student._id,
                                      );
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
              }
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
};
