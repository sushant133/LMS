import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getTodayBs } from "@munatech/nepali-datepicker";
import {
  type BatchRecord,
  type LaboratoryRecord,
  type SubjectAssignmentRecord,
  type SubjectRecord,
  type TeacherLaboratoryAssignmentRecord,
  type TeacherRecord,
  type YearRecord,
} from "@phit-erp/shared";
import { BookOpen, FlaskConical, History, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { useIsCollege } from "hooks/useInstitutionType";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";

const todayBsString = (): string => {
  const t = getTodayBs();
  return `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
};

const idOf = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "_id" in value) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
};

const subjectLabel = (value: SubjectAssignmentRecord["subjectId"]): string => {
  if (!value || typeof value === "string") return String(value ?? "—");
  const s = value as { name?: string; code?: string };
  return s.name ? `${s.name}${s.code ? ` (${s.code})` : ""}` : idOf(value);
};

const nameById = (
  items: Array<{ _id: string; name?: string; code?: string; yearLevel?: string }>,
  id: string,
): string => {
  const found = items.find((item) => item._id === id);
  if (!found) return id;
  if (found.name) {
    return found.code ? `${found.name} (${found.code})` : found.name;
  }
  return found.yearLevel ?? id;
};

type Props = {
  teacherId: string;
  teacherName: string;
  /** Full teacher row — used to show legacy load for already-created teachers */
  teacher?: TeacherRecord | null;
};

/**
 * Shows all teaching + laboratory responsibilities for one teacher account.
 * Subject rows come from SubjectAssignment (multi-subject SoT).
 * Lab rows come from TeacherLaboratoryAssignment (multi-lab SoT).
 * For PENDING/NEEDS_REVIEW teachers, also surfaces legacy Teacher arrays.
 */
export const TeacherAssignmentsPanel = ({
  teacherId,
  teacherName,
  teacher,
}: Props) => {
  const isCollege = useIsCollege();
  const [labId, setLabId] = useState("");
  const [role, setRole] = useState<"IN_CHARGE" | "ASSISTANT" | "INSTRUCTOR">(
    "IN_CHARGE",
  );
  // Default today so Assign is clickable without hunting for the date picker
  const [fromBs, setFromBs] = useState(todayBsString);

  const migrationStatus = teacher?.assignmentMigrationStatus ?? "PENDING";
  const legacySubjectIds = (teacher?.subjects ?? []).map(String).filter(Boolean);
  const legacyYearIds = (teacher?.assignedYearIds ?? []).map(String).filter(Boolean);
  const legacyBatchIds = (teacher?.assignedBatchIds ?? []).map(String).filter(Boolean);
  const legacyClassIds = (teacher?.assignedClassIds ?? []).map(String).filter(Boolean);
  const legacySectionIds = (teacher?.assignedSectionIds ?? [])
    .map(String)
    .filter(Boolean);
  const hasLegacyLoad =
    legacySubjectIds.length > 0 ||
    legacyYearIds.length > 0 ||
    legacyBatchIds.length > 0 ||
    legacyClassIds.length > 0 ||
    legacySectionIds.length > 0;
  const showLegacyCard =
    hasLegacyLoad &&
    (migrationStatus === "PENDING" || migrationStatus === "NEEDS_REVIEW");

  const subjectAssignmentsQuery = useQuery({
    queryKey: ["subject-assignments", "teacher", teacherId],
    queryFn: () =>
      unwrap<SubjectAssignmentRecord[]>(
        api.get("/academics/subject-assignments", {
          params: { teacherId, status: "ACTIVE" },
        }),
      ),
    enabled: Boolean(teacherId),
  });

  const labAssignmentsQuery = useQuery({
    queryKey: ["teacher-lab-assignments", teacherId],
    queryFn: () =>
      unwrap<TeacherLaboratoryAssignmentRecord[]>(
        api.get("/teachers/lab-assignments", {
          params: { teacherId, status: "ACTIVE" },
        }),
      ),
    enabled: Boolean(teacherId),
  });

  const labsQuery = useQuery({
    queryKey: ["laboratory-labs"],
    queryFn: () => unwrap<LaboratoryRecord[]>(api.get("/laboratory/labs")),
  });

  const subjectsQuery = useQuery({
    queryKey: ["subjects"],
    queryFn: () => unwrap<SubjectRecord[]>(api.get("/academics/subjects")),
    enabled: showLegacyCard,
  });
  const batchesQuery = useQuery({
    queryKey: ["batches"],
    queryFn: () => unwrap<BatchRecord[]>(api.get("/academics/batches")),
    enabled: showLegacyCard && isCollege,
  });
  const yearsQuery = useQuery({
    queryKey: ["years"],
    queryFn: () => unwrap<YearRecord[]>(api.get("/academics/years")),
    enabled: showLegacyCard && isCollege,
  });

  const assignedLabIds = useMemo(
    () =>
      new Set(
        (labAssignmentsQuery.data ?? []).map((r) => String(r.laboratoryId)),
      ),
    [labAssignmentsQuery.data],
  );

  const availableLabs = useMemo(
    () =>
      (labsQuery.data ?? []).filter(
        (lab) =>
          lab.isActive !== false && !assignedLabIds.has(String(lab._id)),
      ),
    [labsQuery.data, assignedLabIds],
  );

  const createLabAssignment = useMutation({
    mutationFn: () => {
      if (!labId) {
        throw new Error("Select a laboratory first");
      }
      if (!teacherId) {
        throw new Error("Teacher is missing — close and open Assignments again");
      }
      return unwrap(
        api.post("/teachers/lab-assignments", {
          teacherId,
          laboratoryId: labId,
          role,
          assignedFromBs: fromBs.trim() || todayBsString(),
          status: "ACTIVE",
        }),
      );
    },
    onSuccess: async () => {
      toast.success("Laboratory assigned to this teacher login");
      setLabId("");
      setFromBs(todayBsString());
      await queryClient.invalidateQueries({
        queryKey: ["teacher-lab-assignments", teacherId],
      });
      await queryClient.invalidateQueries({ queryKey: ["laboratory-labs"] });
      // Teacher sidebar "Laboratory" menu uses this key after re-login / focus
      await queryClient.invalidateQueries({ queryKey: ["teacher-lab-access"] });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const deactivateLabAssignment = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/teachers/lab-assignments/${id}`)),
    onSuccess: async () => {
      toast.success("Laboratory assignment removed");
      await queryClient.invalidateQueries({
        queryKey: ["teacher-lab-assignments", teacherId],
      });
      await queryClient.invalidateQueries({ queryKey: ["laboratory-labs"] });
      await queryClient.invalidateQueries({ queryKey: ["teacher-lab-access"] });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const deactivateSubjectAssignment = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.post(`/academics/subject-assignments/${id}/end`, {
          effectiveToBs: todayBsString(),
          endReason: "Deactivated from teacher assignments",
        }),
      ),
    onSuccess: async () => {
      toast.success("Subject assignment deactivated");
      await queryClient.invalidateQueries({
        queryKey: ["subject-assignments", "teacher", teacherId],
      });
      await queryClient.invalidateQueries({ queryKey: ["subject-assignments"] });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const deleteSubjectAssignment = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.delete(`/academics/subject-assignments/${id}`)),
    onSuccess: async () => {
      toast.success("Subject assignment deleted");
      await queryClient.invalidateQueries({
        queryKey: ["subject-assignments", "teacher", teacherId],
      });
      await queryClient.invalidateQueries({ queryKey: ["subject-assignments"] });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const subjects = subjectAssignmentsQuery.data ?? [];
  const labs = labAssignmentsQuery.data ?? [];
  const allSubjects = subjectsQuery.data ?? [];
  const allBatches = batchesQuery.data ?? [];
  const allYears = yearsQuery.data ?? [];

  return (
    <div className="space-y-4">
      {showLegacyCard ? (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardHeader className="border-b border-amber-100 pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-amber-950">
              <History className="h-5 w-5 text-amber-700" />
              Current teaching load (already on this teacher)
            </CardTitle>
            <p className="mt-1 text-xs text-amber-900/90">
              This teacher was created with the older multi-select fields. That load is
              still active for their portal (migration:{" "}
              <strong>{migrationStatus}</strong>). It does not appear as matrix rows
              until you add them under <strong>Add subject assignment</strong>. You do{" "}
              <strong>not</strong> need a second login.
            </p>
          </CardHeader>
          <CardContent className="grid gap-3 pt-4 text-sm text-slate-800 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                Subjects ({legacySubjectIds.length})
              </p>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {legacySubjectIds.length === 0 ? (
                  <li className="list-none text-slate-500">None stored</li>
                ) : (
                  legacySubjectIds.map((id) => (
                    <li key={id}>{nameById(allSubjects, id)}</li>
                  ))
                )}
              </ul>
            </div>
            {isCollege ? (
              <>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                    Batches ({legacyBatchIds.length})
                  </p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5">
                    {legacyBatchIds.length === 0 ? (
                      <li className="list-none text-slate-500">None stored</li>
                    ) : (
                      legacyBatchIds.map((id) => (
                        <li key={id}>{nameById(allBatches, id)}</li>
                      ))
                    )}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                    Years ({legacyYearIds.length})
                  </p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5">
                    {legacyYearIds.length === 0 ? (
                      <li className="list-none text-slate-500">None stored</li>
                    ) : (
                      legacyYearIds.map((id) => (
                        <li key={id}>{nameById(allYears, id)}</li>
                      ))
                    )}
                  </ul>
                </div>
              </>
            ) : (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                  Classes / sections
                </p>
                <p className="mt-1 text-slate-600">
                  {legacyClassIds.length} class(es), {legacySectionIds.length}{" "}
                  section(s) on record
                </p>
              </div>
            )}
            <div className="md:col-span-2">
              <Button asChild size="sm" variant="outline">
                <Link to={`/academics/subject-assignments?teacherId=${teacherId}`}>
                  Convert / add matrix rows for multi-subject load
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-5 w-5 text-brand-600" />
              Teaching assignments (matrix) — {teacherName}
            </CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              One login can teach unlimited subjects, years, and batches. New multi-subject
              rows are created here (or under Academics → Subject Assignment). Existing
              teachers keep the legacy load above until matrix rows are added.
            </p>
          </div>
          <Button asChild size="sm">
            <Link to={`/academics/subject-assignments?teacherId=${teacherId}`}>
              <Plus className="mr-1 h-4 w-4" />
              Add subject assignment
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {subjectAssignmentsQuery.isLoading ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              Loading teaching load…
            </p>
          ) : subjects.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              {showLegacyCard ? (
                <>
                  No matrix rows yet — that is normal for already-created teachers. Their
                  portal still uses the <strong>legacy load</strong> shown above. Click{" "}
                  <strong>Add subject assignment</strong> only when you want multi-row
                  matrix control (extra subjects / unit splits).
                </>
              ) : (
                <>
                  No active subject assignments. Click{" "}
                  <strong>Add subject assignment</strong> to attach batches, years, and
                  subjects to this single account.
                </>
              )}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <tr className="bg-slate-50/80">
                    <Th>Subject</Th>
                    <Th>Academic year</Th>
                    <Th>Type</Th>
                    <Th>Units / %</Th>
                    <Th>From</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {subjects.map((row) => (
                    <tr key={row._id}>
                      <Td className="font-medium">{subjectLabel(row.subjectId)}</Td>
                      <Td className="text-sm">{row.academicYearBs}</Td>
                      <Td>
                        <Badge className="bg-sky-100 text-sky-800">
                          {row.assignmentType}
                        </Badge>
                      </Td>
                      <Td className="text-sm text-slate-600">
                        {row.assignmentType === "UNIT"
                          ? `U${row.unitFrom ?? "?"}–${row.unitTo ?? "?"}`
                          : row.assignmentType === "PERCENTAGE"
                            ? `${row.assignedPercentage ?? "—"}%`
                            : "Full"}
                      </Td>
                      <Td className="text-sm">{row.effectiveFromBs}</Td>
                      <Td>
                        <Badge className="bg-brand-100 text-brand-800">
                          {row.status}
                        </Badge>
                      </Td>
                      <Td className="text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <Button asChild size="sm" variant="outline">
                            <Link
                              to={`/academics/subject-assignments?teacherId=${teacherId}`}
                              title="Edit in Subject Assignment matrix"
                            >
                              <Pencil className="mr-1 h-3.5 w-3.5" />
                              Edit
                            </Link>
                          </Button>
                          {row.status === "ACTIVE" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-amber-200 text-amber-800"
                              disabled={deactivateSubjectAssignment.isPending}
                              onClick={() => {
                                if (
                                  confirm(
                                    `Deactivate subject assignment for ${subjectLabel(row.subjectId)}? Teaching access ends today; history is kept.`,
                                  )
                                ) {
                                  deactivateSubjectAssignment.mutate(row._id);
                                }
                              }}
                            >
                              <Power className="mr-1 h-3.5 w-3.5" />
                              Deactivate
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-rose-200 text-rose-700"
                            disabled={deleteSubjectAssignment.isPending}
                            onClick={() => {
                              if (
                                confirm(
                                  `Permanently delete assignment for ${subjectLabel(row.subjectId)}? This cannot be undone.`,
                                )
                              ) {
                                deleteSubjectAssignment.mutate(row._id);
                              }
                            }}
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" />
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

      <Card>
        <CardHeader className="border-b border-slate-100 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-5 w-5 text-brand-600" />
            Laboratory assignments
          </CardTitle>
          <p className="mt-1 text-xs text-slate-500">
            Assign 2–3 (or more) labs to <strong>{teacherName}</strong> with this
            same login. Path: Teachers → Assignments (not Edit). Pick lab → role →
            Assign. Repeat for each lab.
          </p>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          {labsQuery.isError ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              Could not load laboratories: {parseErrorMessage(labsQuery.error)}.
              Log in as College Admin and ensure Laboratory module is available.
            </p>
          ) : null}
          {labsQuery.isSuccess && (labsQuery.data?.length ?? 0) === 0 ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              No laboratories exist yet. Create them first under{" "}
              <Link to="/laboratory" className="font-medium underline">
                Laboratory
              </Link>
              , then return here to assign them to this teacher.
            </p>
          ) : null}
          {labsQuery.isSuccess &&
          (labsQuery.data?.length ?? 0) > 0 &&
          availableLabs.length === 0 &&
          labs.length > 0 ? (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              All active laboratories are already assigned to this teacher. Remove
              one below if you need to reassign, or create another lab.
            </p>
          ) : null}

          <div className="grid gap-3 md:grid-cols-4">
            <FormField label="Laboratory *">
              <Select
                value={labId}
                onChange={(e) => setLabId(e.target.value)}
                disabled={labsQuery.isLoading || availableLabs.length === 0}
              >
                <option value="">
                  {labsQuery.isLoading
                    ? "Loading labs…"
                    : availableLabs.length === 0
                      ? "No labs available to assign"
                      : "Select laboratory"}
                </option>
                {availableLabs.map((lab) => (
                  <option key={lab._id} value={lab._id}>
                    {lab.yearLevel ? `[${lab.yearLevel}] ` : ""}
                    {lab.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Role">
              <Select
                value={role}
                onChange={(e) =>
                  setRole(e.target.value as "IN_CHARGE" | "ASSISTANT" | "INSTRUCTOR")
                }
              >
                <option value="IN_CHARGE">In-charge</option>
                <option value="ASSISTANT">Assistant</option>
                <option value="INSTRUCTOR">Instructor</option>
              </Select>
            </FormField>
            <FormField label="From date (BS)">
              <NepaliDateField value={fromBs} onChange={setFromBs} />
            </FormField>
            <div className="flex flex-col justify-end gap-1">
              <Button
                className="w-full"
                disabled={!labId || createLabAssignment.isPending}
                onClick={() => createLabAssignment.mutate()}
              >
                <Plus className="mr-1 h-4 w-4" />
                {createLabAssignment.isPending ? "Assigning…" : "Assign laboratory"}
              </Button>
              {!labId ? (
                <p className="text-center text-[11px] text-slate-500">
                  Select a laboratory above, then click Assign
                </p>
              ) : null}
            </div>
          </div>

          {labAssignmentsQuery.isError ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              Could not load lab assignments:{" "}
              {parseErrorMessage(labAssignmentsQuery.error)}
            </p>
          ) : null}

          {labAssignmentsQuery.isLoading ? (
            <p className="py-6 text-center text-sm text-slate-500">
              Loading laboratory assignments…
            </p>
          ) : labs.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              No laboratories assigned yet. Choose a lab from the list, leave the
              date as today (or pick one), then click{" "}
              <strong>Assign laboratory</strong>. Repeat for each lab — one login
              covers all.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <Table>
                <TableHead>
                  <tr className="bg-slate-50/80">
                    <Th>Laboratory</Th>
                    <Th>Role</Th>
                    <Th>From</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {labs.map((row) => (
                    <tr key={row._id}>
                      <Td className="font-medium">
                        {row.laboratoryName ?? row.laboratoryId}
                      </Td>
                      <Td>
                        <Badge className="bg-indigo-100 text-indigo-800">
                          {row.role.replace("_", " ")}
                        </Badge>
                      </Td>
                      <Td className="text-sm">{row.assignedFromBs}</Td>
                      <Td>
                        <Badge className="bg-brand-100 text-brand-800">
                          {row.status}
                        </Badge>
                      </Td>
                      <Td className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-rose-200 text-rose-700"
                          disabled={deactivateLabAssignment.isPending}
                          onClick={() => {
                            if (
                              confirm(
                                `Remove laboratory assignment for ${row.laboratoryName ?? "this lab"}?`,
                              )
                            ) {
                              deactivateLabAssignment.mutate(row._id);
                            }
                          }}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          Remove
                        </Button>
                      </Td>
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
