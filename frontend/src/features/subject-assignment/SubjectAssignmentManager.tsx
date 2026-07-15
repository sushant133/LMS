import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  SUBJECT_ASSIGNMENT_TYPES,
  type BatchRecord,
  type ClassRecord,
  type SectionRecord,
  type SubjectAssignmentRecord,
  type SubjectAssignmentType,
  type SubjectRecord,
  type TeacherRecord,
  type YearRecord,
} from "@phit-erp/shared";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { useIsCollege } from "hooks/useInstitutionType";
import { useIsTenantAdmin } from "hooks/useNormalizedRole";
import {
  filterSubjectsByClass,
  filterSubjectsByYear,
  filterYearsByBatch,
  getAcademicLabels,
} from "lib/academicStructureUtils";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";

interface TeacherRowDraft {
  key: string;
  teacherId: string;
  assignmentType: SubjectAssignmentType;
  unitFrom: number | "";
  unitTo: number | "";
  assignedPercentage: number | "";
  remarks: string;
}

interface MigrationTeacherRow {
  teacherId: string;
  teacherCode: string;
  fullName: string;
  email: string;
  assignmentMigrationStatus: string;
  activeAssignmentCount: number;
  subjects: string[];
  assignedClassIds: string[];
  assignedSectionIds: string[];
  assignedBatchIds: string[];
  assignedYearIds: string[];
}

interface WorkloadRow {
  teacherId: string;
  teacherName?: string;
  teacherCode?: string;
  subjectName?: string;
  assignmentType: string;
  assignedPercentage: number;
  unitFrom?: number | null;
  unitTo?: number | null;
}

const newTeacherRow = (): TeacherRowDraft => ({
  key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  teacherId: "",
  assignmentType: "FULL",
  unitFrom: "",
  unitTo: "",
  assignedPercentage: "",
  remarks: "",
});

const idOf = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "_id" in value) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
};

const labelOfTeacher = (value: SubjectAssignmentRecord["teacherId"]): string => {
  if (!value || typeof value === "string") return String(value ?? "—");
  const t = value as { teacherCode?: string; user?: { fullName?: string } | null };
  return t.user?.fullName
    ? `${t.user.fullName}${t.teacherCode ? ` (${t.teacherCode})` : ""}`
    : t.teacherCode ?? idOf(value);
};

const teacherOptionLabel = (t: {
  teacherCode?: string;
  user?: { fullName?: string } | null;
}): string => {
  const name = t.user?.fullName ?? "Teacher";
  return t.teacherCode ? `${name} (${t.teacherCode})` : name;
};

const labelOfSubject = (value: SubjectAssignmentRecord["subjectId"]): string => {
  if (!value || typeof value === "string") return String(value ?? "—");
  const s = value as { name?: string; code?: string };
  return s.name ? `${s.name}${s.code ? ` (${s.code})` : ""}` : idOf(value);
};

const labelById = (
  items: Array<{ _id: string; name?: string }>,
  id: unknown,
): string => {
  const key = idOf(id);
  if (!key) return "—";
  return items.find((item) => item._id === key)?.name ?? key;
};

export const SubjectAssignmentManager = () => {
  const canManage = useIsTenantAdmin();
  const isCollege = useIsCollege();
  const labels = getAcademicLabels(isCollege ? "COLLEGE" : "SCHOOL");
  const [searchParams] = useSearchParams();
  const teacherFilterFromUrl = searchParams.get("teacherId") ?? "";

  const [tab, setTab] = useState<"assignments" | "migration" | "workload">("assignments");
  const [academicYearBs, setAcademicYearBs] = useState("");
  const [filterSubjectId, setFilterSubjectId] = useState("");
  const [filterTeacherId, setFilterTeacherId] = useState(teacherFilterFromUrl);
  const [filterClassId, setFilterClassId] = useState("");
  const [filterSectionId, setFilterSectionId] = useState("");
  const [filterBatchId, setFilterBatchId] = useState("");
  const [filterYearId, setFilterYearId] = useState("");
  const [statusFilter, setStatusFilter] = useState("ACTIVE");

  // Create form shared context
  const [formAy, setFormAy] = useState("");
  const [formSubjectId, setFormSubjectId] = useState("");
  const [formClassId, setFormClassId] = useState("");
  const [formSectionId, setFormSectionId] = useState("");
  const [formBatchId, setFormBatchId] = useState("");
  const [formYearId, setFormYearId] = useState("");
  const [formEffectiveFrom, setFormEffectiveFrom] = useState("");
  const [teacherRows, setTeacherRows] = useState<TeacherRowDraft[]>([newTeacherRow()]);
  const [copyFromAy, setCopyFromAy] = useState("");
  const [copyToAy, setCopyToAy] = useState("");

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () =>
      unwrap<{ academicYearBs: string }>(api.get("/settings")),
  });

  const resolvedAy =
    academicYearBs || formAy || settingsQuery.data?.academicYearBs || "";

  const teachersQuery = useQuery({
    queryKey: ["teachers"],
    queryFn: () => unwrap<TeacherRecord[]>(api.get("/teachers")),
  });
  const subjectsQuery = useQuery({
    queryKey: ["subjects"],
    queryFn: () => unwrap<SubjectRecord[]>(api.get("/academics/subjects")),
  });
  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: () => unwrap<ClassRecord[]>(api.get("/academics/classes")),
    enabled: !isCollege,
  });
  const sectionsQuery = useQuery({
    queryKey: ["sections"],
    queryFn: () => unwrap<SectionRecord[]>(api.get("/academics/sections")),
    enabled: !isCollege,
  });
  const batchesQuery = useQuery({
    queryKey: ["batches"],
    queryFn: () => unwrap<BatchRecord[]>(api.get("/academics/batches")),
    enabled: isCollege,
  });
  const yearsQuery = useQuery({
    queryKey: ["years"],
    queryFn: () => unwrap<YearRecord[]>(api.get("/academics/years")),
    enabled: isCollege,
  });

  const listQueryKey = [
    "subject-assignments",
    resolvedAy,
    statusFilter,
    filterSubjectId,
    filterTeacherId,
    filterClassId,
    filterSectionId,
    filterBatchId,
    filterYearId,
  ];

  const assignmentsQuery = useQuery({
    queryKey: listQueryKey,
    queryFn: () => {
      const params = new URLSearchParams();
      if (resolvedAy) params.set("academicYearBs", resolvedAy);
      if (statusFilter) params.set("status", statusFilter);
      if (filterSubjectId) params.set("subjectId", filterSubjectId);
      if (filterTeacherId) params.set("teacherId", filterTeacherId);
      if (filterClassId) params.set("classId", filterClassId);
      if (filterSectionId) params.set("sectionId", filterSectionId);
      if (filterBatchId) params.set("batchId", filterBatchId);
      if (filterYearId) params.set("yearId", filterYearId);
      return unwrap<SubjectAssignmentRecord[]>(
        api.get(`/academics/subject-assignments?${params.toString()}`),
      );
    },
    enabled: tab === "assignments" && Boolean(settingsQuery.data || academicYearBs),
  });

  const migrationQuery = useQuery({
    queryKey: ["subject-assignments-migration"],
    queryFn: () =>
      unwrap<{ academicYearBs?: string; teachers: MigrationTeacherRow[] }>(
        api.get("/academics/subject-assignments/migration-review"),
      ),
    enabled: tab === "migration" && canManage,
  });

  const workloadQuery = useQuery({
    queryKey: ["subject-assignments-workload", resolvedAy],
    queryFn: () => {
      const params = new URLSearchParams();
      if (resolvedAy) params.set("academicYearBs", resolvedAy);
      return unwrap<{ academicYearBs: string; rows: WorkloadRow[] }>(
        api.get(`/academics/subject-assignments/reports/workload?${params.toString()}`),
      );
    },
    enabled: tab === "workload" && canManage,
  });

  // Seed form AY from settings
  useEffect(() => {
    if (settingsQuery.data?.academicYearBs) {
      setFormAy((current) => current || settingsQuery.data!.academicYearBs);
      setAcademicYearBs((current) => current || settingsQuery.data!.academicYearBs);
      setCopyToAy((current) => current || settingsQuery.data!.academicYearBs);
    }
  }, [settingsQuery.data?.academicYearBs]);

  /** Sections for the create form (scoped to selected class). */
  const formSections = useMemo(() => {
    const sections = sectionsQuery.data ?? [];
    if (!formClassId) return [];
    return sections.filter((s) => s.classId === formClassId);
  }, [sectionsQuery.data, formClassId]);

  /** Years for the create form (scoped to selected batch). */
  const formYears = useMemo(
    () => filterYearsByBatch(yearsQuery.data ?? [], formBatchId),
    [yearsQuery.data, formBatchId],
  );

  /** Subjects for create form — only those linked to the selected year (college) or class (school). */
  const formSubjects = useMemo(() => {
    const all = subjectsQuery.data ?? [];
    if (isCollege) {
      return filterSubjectsByYear(all, formYearId);
    }
    return filterSubjectsByClass(all, formClassId);
  }, [formClassId, formYearId, isCollege, subjectsQuery.data]);

  /** Filter panel: years for selected batch (or all when batch not chosen). */
  const filterYears = useMemo(() => {
    const years = yearsQuery.data ?? [];
    if (!filterBatchId) return years;
    return years.filter((y) => y.batchId === filterBatchId);
  }, [yearsQuery.data, filterBatchId]);

  // Drop subject selection when it no longer matches Batch/Year (or Class) scope
  useEffect(() => {
    if (!formSubjectId) return;
    if (!formSubjects.some((s) => s._id === formSubjectId)) {
      setFormSubjectId("");
    }
  }, [formSubjectId, formSubjects]);

  const canSubmitCreate = Boolean(
    (formAy || resolvedAy) &&
      formSubjectId &&
      formEffectiveFrom &&
      (isCollege
        ? formBatchId && formYearId
        : formClassId && formSectionId) &&
      teacherRows.some((r) => r.teacherId),
  );

  const bulkMutation = useMutation({
    mutationFn: async () => {
      if (!(formAy || resolvedAy)) {
        throw new Error("Academic Year (BS) is required");
      }
      if (isCollege) {
        if (!formBatchId) throw new Error(`Select a ${labels.primary.toLowerCase()}`);
        if (!formYearId) throw new Error(`Select a ${labels.secondary.toLowerCase()}`);
      } else {
        if (!formClassId) throw new Error("Select a class");
        if (!formSectionId) throw new Error("Select a section");
      }
      if (!formSubjectId) {
        throw new Error(
          isCollege
            ? `Select a subject for the chosen ${labels.secondary.toLowerCase()}`
            : "Select a subject for the chosen class",
        );
      }
      if (!formEffectiveFrom) {
        throw new Error("Effective From (BS) date is required");
      }

      const teachers = teacherRows
        .filter((r) => r.teacherId)
        .map((r) => ({
          teacherId: r.teacherId,
          assignmentType: r.assignmentType,
          unitFrom: r.assignmentType === "UNIT" && r.unitFrom !== "" ? Number(r.unitFrom) : null,
          unitTo: r.assignmentType === "UNIT" && r.unitTo !== "" ? Number(r.unitTo) : null,
          assignedPercentage:
            r.assignmentType === "PERCENTAGE" && r.assignedPercentage !== ""
              ? Number(r.assignedPercentage)
              : null,
          remarks: r.remarks || undefined,
        }));

      if (!teachers.length) {
        throw new Error("Add at least one teacher");
      }

      return unwrap<{ rows: SubjectAssignmentRecord[]; warnings: string[] }>(
        api.post("/academics/subject-assignments/bulk", {
          academicYearBs: formAy || resolvedAy,
          subjectId: formSubjectId,
          classId: isCollege ? undefined : formClassId || undefined,
          sectionId: isCollege ? undefined : formSectionId || undefined,
          batchId: isCollege ? formBatchId || undefined : undefined,
          yearId: isCollege ? formYearId || undefined : undefined,
          effectiveFromBs: formEffectiveFrom,
          teachers,
        }),
      );
    },
    onSuccess: async (data) => {
      toast.success(`Created ${data.rows.length} assignment(s)`);
      if (data.warnings?.length) {
        data.warnings.forEach((w) => toast.warning(w));
      }
      setTeacherRows([newTeacherRow()]);
      await queryClient.invalidateQueries({ queryKey: ["subject-assignments"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const endMutation = useMutation({
    mutationFn: async (id: string) => {
      const effectiveToBs =
        window.prompt("End date (BS YYYY-MM-DD)", formEffectiveFrom || "2083-04-01") ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveToBs)) {
        throw new Error("Invalid end date");
      }
      return unwrap(
        api.post(`/academics/subject-assignments/${id}/end`, {
          effectiveToBs,
          endReason: "Ended by admin",
        }),
      );
    },
    onSuccess: async () => {
      toast.success("Assignment ended");
      await queryClient.invalidateQueries({ queryKey: ["subject-assignments"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const copyMutation = useMutation({
    mutationFn: async () =>
      unwrap<{ copied: number; skipped: number; warnings: string[] }>(
        api.post("/academics/subject-assignments/copy-year", {
          fromAcademicYearBs: copyFromAy,
          toAcademicYearBs: copyToAy,
        }),
      ),
    onSuccess: async (data) => {
      toast.success(`Copied ${data.copied} assignment(s), skipped ${data.skipped}`);
      data.warnings?.slice(0, 5).forEach((w) => toast.warning(w));
      await queryClient.invalidateQueries({ queryKey: ["subject-assignments"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const acceptMutation = useMutation({
    mutationFn: async (teacherId: string) =>
      unwrap(
        api.post(`/academics/subject-assignments/migration-review/${teacherId}/accept`, {
          confirmEmpty: true,
        }),
      ),
    onSuccess: async () => {
      toast.success("Migration accepted");
      await queryClient.invalidateQueries({ queryKey: ["subject-assignments-migration"] });
      await queryClient.invalidateQueries({ queryKey: ["teachers"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const rejectMutation = useMutation({
    mutationFn: async (teacherId: string) =>
      unwrap(
        api.post(
          `/academics/subject-assignments/migration-review/${teacherId}/reject-to-legacy`,
        ),
      ),
    onSuccess: async () => {
      toast.success("Teacher kept on legacy scope");
      await queryClient.invalidateQueries({ queryKey: ["subject-assignments-migration"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  if (settingsQuery.isLoading || teachersQuery.isLoading || subjectsQuery.isLoading) {
    return <LoadingState />;
  }

  const teachers = teachersQuery.data ?? [];
  const subjects = subjectsQuery.data ?? [];
  const assignments = assignmentsQuery.data ?? [];
  const batches = batchesQuery.data ?? [];
  const years = yearsQuery.data ?? [];
  const classes = classesQuery.data ?? [];
  const sections = sectionsQuery.data ?? [];

  const groupLabel = (row: SubjectAssignmentRecord): string => {
    if (isCollege) {
      return `${labelById(batches, row.batchId)} / ${labelById(years, row.yearId)}`;
    }
    return `${labelById(classes, row.classId)} / ${labelById(sections, row.sectionId)}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subject Assignment"
        description="Assign teachers to subjects for class/section or batch/year with FULL, UNIT, or PERCENTAGE coverage. Teacher accounts remain HR-only."
      />

      <div className="flex flex-wrap gap-2">
        <Button
          variant={tab === "assignments" ? "default" : "outline"}
          onClick={() => setTab("assignments")}
        >
          Assignments
        </Button>
        {canManage ? (
          <>
            <Button
              variant={tab === "migration" ? "default" : "outline"}
              onClick={() => setTab("migration")}
            >
              Migration Review
            </Button>
            <Button
              variant={tab === "workload" ? "default" : "outline"}
              onClick={() => setTab("workload")}
            >
              Workload Report
            </Button>
          </>
        ) : null}
        <Link
          to="/academics"
          className="inline-flex items-center rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          ← Back to Academics
        </Link>
      </div>

      {tab === "assignments" ? (
        <>
          {canManage ? (
            <Card>
              <CardHeader>
                <CardTitle>Create Assignments</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <FormField label="Academic Year (BS)">
                    <Input
                      placeholder="2083/2084"
                      value={formAy}
                      onChange={(e) => setFormAy(e.target.value)}
                    />
                  </FormField>
                  {isCollege ? (
                    <>
                      <FormField label={labels.primary}>
                        <Select
                          value={formBatchId}
                          onChange={(e) => {
                            setFormBatchId(e.target.value);
                            setFormYearId("");
                            setFormSubjectId("");
                          }}
                        >
                          <option value="">Select {labels.primary.toLowerCase()}</option>
                          {(batchesQuery.data ?? []).map((b) => (
                            <option key={b._id} value={b._id}>
                              {b.name}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                      <FormField label={labels.secondary}>
                        <Select
                          value={formYearId}
                          disabled={!formBatchId}
                          onChange={(e) => {
                            setFormYearId(e.target.value);
                            setFormSubjectId("");
                          }}
                        >
                          <option value="">
                            {formBatchId
                              ? `Select ${labels.secondary.toLowerCase()}`
                              : `Select ${labels.primary.toLowerCase()} first`}
                          </option>
                          {formYears.map((y) => (
                            <option key={y._id} value={y._id}>
                              {y.name}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                      <FormField label="Subject">
                        <Select
                          value={formSubjectId}
                          disabled={!formYearId}
                          onChange={(e) => setFormSubjectId(e.target.value)}
                        >
                          <option value="">
                            {formYearId
                              ? formSubjects.length
                                ? "Select subject"
                                : "No subjects for this year"
                              : `Select ${labels.secondary.toLowerCase()} first`}
                          </option>
                          {formSubjects.map((s) => (
                            <option key={s._id} value={s._id}>
                              {s.name} ({s.code})
                            </option>
                          ))}
                        </Select>
                      </FormField>
                    </>
                  ) : (
                    <>
                      <FormField label="Class">
                        <Select
                          value={formClassId}
                          onChange={(e) => {
                            setFormClassId(e.target.value);
                            setFormSectionId("");
                            setFormSubjectId("");
                          }}
                        >
                          <option value="">Select class</option>
                          {(classesQuery.data ?? []).map((c) => (
                            <option key={c._id} value={c._id}>
                              {c.name}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                      <FormField label="Section">
                        <Select
                          value={formSectionId}
                          disabled={!formClassId}
                          onChange={(e) => setFormSectionId(e.target.value)}
                        >
                          <option value="">
                            {formClassId ? "Select section" : "Select class first"}
                          </option>
                          {formSections.map((s) => (
                            <option key={s._id} value={s._id}>
                              {s.name}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                      <FormField label="Subject">
                        <Select
                          value={formSubjectId}
                          disabled={!formClassId}
                          onChange={(e) => setFormSubjectId(e.target.value)}
                        >
                          <option value="">
                            {formClassId
                              ? formSubjects.length
                                ? "Select subject"
                                : "No subjects for this class"
                              : "Select class first"}
                          </option>
                          {formSubjects.map((s) => (
                            <option key={s._id} value={s._id}>
                              {s.name} ({s.code})
                            </option>
                          ))}
                        </Select>
                      </FormField>
                    </>
                  )}
                  <FormField label="Effective From (BS)">
                    <NepaliDateField
                      value={formEffectiveFrom}
                      onChange={setFormEffectiveFrom}
                    />
                  </FormField>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-800">Teachers</h3>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setTeacherRows((rows) => [...rows, newTeacherRow()])}
                    >
                      Add Another Teacher
                    </Button>
                  </div>

                  {teacherRows.map((row, index) => (
                    <div
                      key={row.key}
                      className="grid gap-3 rounded-lg border border-slate-200 p-3 md:grid-cols-6"
                    >
                      <FormField label={`Teacher ${index + 1}`}>
                        <Select
                          value={row.teacherId}
                          onChange={(e) =>
                            setTeacherRows((rows) =>
                              rows.map((r) =>
                                r.key === row.key ? { ...r, teacherId: e.target.value } : r,
                              ),
                            )
                          }
                        >
                          <option value="">Select teacher</option>
                          {teachers.map((t) => (
                            <option key={t._id} value={t._id}>
                              {teacherOptionLabel(t)}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                      <FormField label="Type">
                        <Select
                          value={row.assignmentType}
                          onChange={(e) =>
                            setTeacherRows((rows) =>
                              rows.map((r) =>
                                r.key === row.key
                                  ? {
                                      ...r,
                                      assignmentType: e.target.value as SubjectAssignmentType,
                                    }
                                  : r,
                              ),
                            )
                          }
                        >
                          {SUBJECT_ASSIGNMENT_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                      {row.assignmentType === "UNIT" ? (
                        <>
                          <FormField label="Unit From">
                            <NumberInput
                              value={row.unitFrom === "" ? undefined : row.unitFrom}
                              onChange={(e) =>
                                setTeacherRows((rows) =>
                                  rows.map((r) =>
                                    r.key === row.key
                                      ? {
                                          ...r,
                                          unitFrom: Number.isNaN(e.target.valueAsNumber)
                                            ? ""
                                            : e.target.valueAsNumber,
                                        }
                                      : r,
                                  ),
                                )
                              }
                            />
                          </FormField>
                          <FormField label="Unit To">
                            <NumberInput
                              value={row.unitTo === "" ? undefined : row.unitTo}
                              onChange={(e) =>
                                setTeacherRows((rows) =>
                                  rows.map((r) =>
                                    r.key === row.key
                                      ? {
                                          ...r,
                                          unitTo: Number.isNaN(e.target.valueAsNumber)
                                            ? ""
                                            : e.target.valueAsNumber,
                                        }
                                      : r,
                                  ),
                                )
                              }
                            />
                          </FormField>
                        </>
                      ) : null}
                      {row.assignmentType === "PERCENTAGE" ? (
                        <FormField label="% (1–99)">
                          <NumberInput
                            value={
                              row.assignedPercentage === ""
                                ? undefined
                                : row.assignedPercentage
                            }
                            onChange={(e) =>
                              setTeacherRows((rows) =>
                                rows.map((r) =>
                                  r.key === row.key
                                    ? {
                                        ...r,
                                        assignedPercentage: Number.isNaN(
                                          e.target.valueAsNumber,
                                        )
                                          ? ""
                                          : e.target.valueAsNumber,
                                      }
                                    : r,
                                ),
                              )
                            }
                          />
                        </FormField>
                      ) : null}
                      <FormField label="Remarks">
                        <Input
                          value={row.remarks}
                          onChange={(e) =>
                            setTeacherRows((rows) =>
                              rows.map((r) =>
                                r.key === row.key ? { ...r, remarks: e.target.value } : r,
                              ),
                            )
                          }
                        />
                      </FormField>
                      {teacherRows.length > 1 ? (
                        <div className="flex items-end">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setTeacherRows((rows) => rows.filter((r) => r.key !== row.key))
                            }
                          >
                            Remove
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>

                <div className="flex justify-end">
                  <Button
                    disabled={bulkMutation.isPending || !canSubmitCreate}
                    onClick={() => bulkMutation.mutate()}
                  >
                    {bulkMutation.isPending ? "Saving..." : "Create Assignments"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Filters & Copy Year</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                <FormField label="Academic Year">
                  <Input
                    value={academicYearBs}
                    onChange={(e) => setAcademicYearBs(e.target.value)}
                    placeholder="2083/2084"
                  />
                </FormField>
                <FormField label="Status">
                  <Select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="ENDED">ENDED</option>
                    <option value="SUPERSEDED">SUPERSEDED</option>
                    <option value="ACTIVE,ENDED,SUPERSEDED">All</option>
                  </Select>
                </FormField>
                <FormField label="Teacher">
                  <Select
                    value={filterTeacherId}
                    onChange={(e) => setFilterTeacherId(e.target.value)}
                  >
                    <option value="">All teachers</option>
                    {teachers.map((t) => (
                      <option key={t._id} value={t._id}>
                        {teacherOptionLabel(t)}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Subject">
                  <Select
                    value={filterSubjectId}
                    onChange={(e) => setFilterSubjectId(e.target.value)}
                  >
                    <option value="">All subjects</option>
                    {subjects.map((s) => (
                      <option key={s._id} value={s._id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                {isCollege ? (
                  <>
                    <FormField label={labels.primary}>
                      <Select
                        value={filterBatchId}
                        onChange={(e) => {
                          setFilterBatchId(e.target.value);
                          setFilterYearId("");
                        }}
                      >
                        <option value="">All</option>
                        {(batchesQuery.data ?? []).map((b) => (
                          <option key={b._id} value={b._id}>
                            {b.name}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                    <FormField label={labels.secondary}>
                      <Select
                        value={filterYearId}
                        onChange={(e) => setFilterYearId(e.target.value)}
                      >
                        <option value="">All</option>
                        {filterYears.map((y) => (
                          <option key={y._id} value={y._id}>
                            {y.name}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                  </>
                ) : (
                  <>
                    <FormField label="Class">
                      <Select
                        value={filterClassId}
                        onChange={(e) => setFilterClassId(e.target.value)}
                      >
                        <option value="">All</option>
                        {(classesQuery.data ?? []).map((c) => (
                          <option key={c._id} value={c._id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                    <FormField label="Section">
                      <Select
                        value={filterSectionId}
                        onChange={(e) => setFilterSectionId(e.target.value)}
                      >
                        <option value="">All</option>
                        {(sectionsQuery.data ?? []).map((s) => (
                          <option key={s._id} value={s._id}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                  </>
                )}
              </div>

              {canManage ? (
                <div className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-slate-300 p-3">
                  <FormField label="Copy from AY">
                    <Input
                      value={copyFromAy}
                      onChange={(e) => setCopyFromAy(e.target.value)}
                      placeholder="2082/2083"
                    />
                  </FormField>
                  <FormField label="Copy to AY">
                    <Input
                      value={copyToAy}
                      onChange={(e) => setCopyToAy(e.target.value)}
                      placeholder="2083/2084"
                    />
                  </FormField>
                  <Button
                    variant="outline"
                    disabled={copyMutation.isPending || !copyFromAy || !copyToAy}
                    onClick={() => copyMutation.mutate()}
                  >
                    Copy from previous academic year
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Assignment Matrix</CardTitle>
            </CardHeader>
            <CardContent>
              {assignmentsQuery.isLoading ? (
                <LoadingState />
              ) : assignments.length === 0 ? (
                <EmptyState
                  title="No assignments found"
                  description="Create subject assignments for the current academic year, or adjust filters."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHead>
                      <tr>
                        <Th>Teacher</Th>
                        <Th>Subject</Th>
                        <Th>Group</Th>
                        <Th>Type</Th>
                        <Th>Coverage</Th>
                        <Th>Status</Th>
                        <Th>From</Th>
                        <Th />
                      </tr>
                    </TableHead>
                    <TableBody>
                      {assignments.map((row) => (
                        <tr key={row._id}>
                          <Td>{labelOfTeacher(row.teacherId)}</Td>
                          <Td>{labelOfSubject(row.subjectId)}</Td>
                          <Td className="text-sm text-slate-700">{groupLabel(row)}</Td>
                          <Td>{row.assignmentType}</Td>
                          <Td>
                            {row.assignmentType === "FULL"
                              ? "100%"
                              : row.assignmentType === "PERCENTAGE"
                                ? `${row.assignedPercentage}%`
                                : `U${row.unitFrom}–${row.unitTo}`}
                          </Td>
                          <Td>{row.status}</Td>
                          <Td>{row.effectiveFromBs}</Td>
                          {canManage && row.status === "ACTIVE" ? (
                            <Td className="text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={endMutation.isPending}
                                onClick={() => endMutation.mutate(row._id)}
                              >
                                End
                              </Button>
                            </Td>
                          ) : (
                            <Td />
                          )}
                        </tr>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      {tab === "migration" && canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Migration Review Queue</CardTitle>
          </CardHeader>
          <CardContent>
            {migrationQuery.isLoading ? (
              <LoadingState />
            ) : !(migrationQuery.data?.teachers.length) ? (
              <EmptyState
                title="No teachers pending review"
                description="All teachers are ACCEPTED or NA. Run the migration script if legacy data still needs backfill."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <tr>
                      <Th>Teacher</Th>
                      <Th>Code</Th>
                      <Th>Status</Th>
                      <Th>Active rows</Th>
                      <Th>Legacy subjects</Th>
                      <Th />
                    </tr>
                  </TableHead>
                  <TableBody>
                    {migrationQuery.data!.teachers.map((t) => (
                      <tr key={t.teacherId}>
                        <Td>
                          <div className="font-medium">{t.fullName}</div>
                          <div className="text-xs text-slate-500">{t.email}</div>
                        </Td>
                        <Td>{t.teacherCode}</Td>
                        <Td>{t.assignmentMigrationStatus}</Td>
                        <Td>{t.activeAssignmentCount}</Td>
                        <Td className="text-xs">{t.subjects.length}</Td>
                        <Td className="space-x-2 text-right">
                          <Button
                            size="sm"
                            onClick={() => acceptMutation.mutate(t.teacherId)}
                            disabled={acceptMutation.isPending}
                          >
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => rejectMutation.mutate(t.teacherId)}
                            disabled={rejectMutation.isPending}
                          >
                            Keep legacy
                          </Button>
                          <Link
                            to={`/academics/subject-assignments?teacherId=${t.teacherId}`}
                            className="text-sm text-blue-700 underline"
                          >
                            Assign
                          </Link>
                        </Td>
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === "workload" && canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>
              Teacher Workload {workloadQuery.data?.academicYearBs
                ? `(${workloadQuery.data.academicYearBs})`
                : ""}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {workloadQuery.isLoading ? (
              <LoadingState />
            ) : !(workloadQuery.data?.rows.length) ? (
              <EmptyState
                title="No workload data"
                description="Create active subject assignments to see workload distribution."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <tr>
                      <Th>Teacher</Th>
                      <Th>Subject</Th>
                      <Th>Type</Th>
                      <Th>Load</Th>
                      <Th>Units</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {workloadQuery.data!.rows.map((row, idx) => (
                      <tr key={`${row.teacherId}-${row.subjectName}-${idx}`}>
                        <Td>
                          {row.teacherName ?? row.teacherCode ?? row.teacherId}
                        </Td>
                        <Td>{row.subjectName ?? "—"}</Td>
                        <Td>{row.assignmentType}</Td>
                        <Td>{row.assignedPercentage}%</Td>
                        <Td>
                          {row.unitFrom != null
                            ? `${row.unitFrom}–${row.unitTo}`
                            : "—"}
                        </Td>
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};
