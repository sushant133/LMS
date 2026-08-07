import { useMemo, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  STUDENT_ACADEMIC_STATUS_LABELS,
  type StudentRecord,
} from "@phit-erp/shared";
import { Check, Pencil, Printer, Search, X } from "lucide-react";
import { toast } from "sonner";
import { CollegeLogo } from "components/shared/CollegeLogo";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
import { StudentNameLink } from "components/shared/StudentNameLink";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { Table, TableBody, TableHead, Td, Th } from "components/ui/table";
import { useAuth } from "features/auth/AuthProvider";
import { filterYearsByBatch } from "lib/teacherScopeUtils";
import { api, unwrap } from "lib/api";
import { getCollegeDisplayName } from "lib/auth";
import {
  formatPrintAddress,
  getPrintInstitutionBranding,
} from "lib/printBranding";
import { printElementById } from "lib/printUtils";
import { parseErrorMessage } from "lib/utils";

interface BackStudentsPanelProps {
  batches?: Array<{ _id: string; name: string }>;
  years?: Array<{ _id: string; name: string; batchId?: string }>;
}

const PRINT_AREA_ID = "back-students-print-area";

const printTh: CSSProperties = {
  border: "1px solid #94a3b8",
  background: "#f1f5f9",
  padding: "5px 4px",
  fontSize: 10,
  fontWeight: 700,
  textAlign: "left",
  color: "#0f172a",
};

const printTd: CSSProperties = {
  border: "1px solid #cbd5e1",
  padding: "4px 4px",
  fontSize: 10,
  color: "#0f172a",
  verticalAlign: "top",
};

const asText = (value: unknown): string => {
  if (value == null) return "";
  return String(value).trim();
};

const resolveStudentUser = (student: StudentRecord) => {
  const user = student.user as StudentRecord["user"] | string | null | undefined;
  if (user && typeof user === "object") return user;
  return null;
};

const resolveBackCount = (student: StudentRecord): number => {
  const n = Number(student.backCount);
  if (Number.isFinite(n) && n >= 1) return Math.min(50, Math.floor(n));
  return 1;
};

/**
 * College Examination Management → Back Students.
 * Lists students with academic status Back (PENDING_NOT_PASSED).
 * Number of backs is set on student create/edit and can be updated here.
 */
export const BackStudentsPanel = ({
  batches = [],
  years = [],
}: BackStudentsPanelProps) => {
  const queryClient = useQueryClient();
  const { user, availableSchools } = useAuth();
  const [batchFilter, setBatchFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [search, setSearch] = useState("");
  const [printing, setPrinting] = useState(false);
  /** studentId currently being edited for back count */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState(1);

  const printBranding = useMemo(() => getPrintInstitutionBranding(), []);
  const institutionName = getCollegeDisplayName(availableSchools, user);
  const institutionAddress =
    printBranding.address?.trim() ||
    formatPrintAddress(
      availableSchools[0]?.address ?? user?.school?.address,
    );

  const studentsQuery = useQuery({
    queryKey: ["students", "back-students"],
    queryFn: () => unwrap<StudentRecord[]>(api.get("/students")),
  });

  const updateBackCount = useMutation({
    mutationFn: ({ id, backCount }: { id: string; backCount: number }) =>
      unwrap(api.patch(`/students/${id}/back-count`, { backCount })),
    onSuccess: async () => {
      toast.success("Number of backs updated");
      setEditingId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["students"] }),
      ]);
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const batchNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const batch of batches) {
      const id = asText(batch?._id);
      if (id) map.set(id, asText(batch?.name) || id);
    }
    return map;
  }, [batches]);

  const yearNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const year of years) {
      const id = asText(year?._id);
      if (id) map.set(id, asText(year?.name) || id);
    }
    return map;
  }, [years]);

  /**
   * Years are stored per batch (each batch has its own "1st Year", …).
   * - With a batch: list that batch’s year ids.
   * - Without a batch: unique year *names* only (avoids duplicate labels).
   */
  const yearOptions = useMemo(() => {
    if (batchFilter) {
      return filterYearsByBatch(years, batchFilter).map((year) => ({
        value: asText(year._id),
        label: asText(year.name) || asText(year._id),
      }));
    }

    const byName = new Map<string, string>();
    for (const year of years) {
      const label = asText(year?.name);
      const key = label.toLowerCase();
      if (!key || key === "ended") continue;
      if (!byName.has(key)) byName.set(key, label);
    }

    return Array.from(byName.values())
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((label) => ({ value: label, label }));
  }, [years, batchFilter]);

  const resolveYearName = (student: StudentRecord): string => {
    const fromField = asText((student as { yearName?: string }).yearName);
    if (fromField) return fromField;
    const yearId = asText(student.yearId);
    if (yearId) return yearNameById.get(yearId) ?? "";
    return "";
  };

  const resolveBatchName = (student: StudentRecord): string => {
    const fromField = asText((student as { batchName?: string }).batchName);
    if (fromField) return fromField;
    const batchId = asText(student.batchId);
    if (batchId) return batchNameById.get(batchId) ?? "";
    return "";
  };

  const backStudents = useMemo(() => {
    const rows = (studentsQuery.data ?? []).filter(
      (student) => (student.academicStatus ?? "ACTIVE") === "PENDING_NOT_PASSED",
    );
    const needle = search.trim().toLowerCase();
    const yearNeedle = yearFilter.trim().toLowerCase();

    return rows
      .filter((student) => {
        const studentBatchId = asText(student.batchId);
        const studentYearId = asText(student.yearId);

        if (batchFilter && studentBatchId !== batchFilter) return false;

        if (yearFilter) {
          if (batchFilter) {
            if (studentYearId !== yearFilter) return false;
          } else {
            if (resolveYearName(student).toLowerCase() !== yearNeedle) {
              return false;
            }
          }
        }

        if (!needle) return true;

        const userRow = resolveStudentUser(student);
        const name = asText(userRow?.fullName).toLowerCase();
        const email = asText(userRow?.email).toLowerCase();
        const phone = asText(userRow?.phone).toLowerCase();
        const admission = asText(student.admissionNumber).toLowerCase();
        const registration = asText(student.registrationNumber).toLowerCase();
        const roll = asText(student.rollNumber);

        return (
          name.includes(needle) ||
          email.includes(needle) ||
          phone.includes(needle) ||
          admission.includes(needle) ||
          registration.includes(needle) ||
          roll.includes(needle)
        );
      })
      .sort((a, b) => {
        const nameA = asText(resolveStudentUser(a)?.fullName).toLowerCase();
        const nameB = asText(resolveStudentUser(b)?.fullName).toLowerCase();
        if (nameA !== nameB) return nameA.localeCompare(nameB);
        return (Number(a.rollNumber) || 0) - (Number(b.rollNumber) || 0);
      });
  }, [studentsQuery.data, batchFilter, yearFilter, search, yearNameById]);

  const printScopeLines = useMemo(() => {
    const lines: string[] = [];
    if (batchFilter) {
      lines.push(`Batch: ${batchNameById.get(batchFilter) || batchFilter}`);
    }
    if (yearFilter) {
      if (batchFilter) {
        lines.push(`Year: ${yearNameById.get(yearFilter) || yearFilter}`);
      } else {
        lines.push(`Year: ${yearFilter}`);
      }
    }
    if (search.trim()) {
      lines.push(`Search: ${search.trim()}`);
    }
    return lines;
  }, [batchFilter, yearFilter, search, batchNameById, yearNameById]);

  const startEditBacks = (student: StudentRecord) => {
    setEditingId(asText(student._id));
    setEditValue(resolveBackCount(student));
  };

  const cancelEditBacks = () => {
    setEditingId(null);
  };

  const saveEditBacks = (studentId: string) => {
    const n = Math.floor(Number(editValue));
    if (!Number.isFinite(n) || n < 1 || n > 50) {
      toast.error("Number of backs must be between 1 and 50");
      return;
    }
    updateBackCount.mutate({ id: studentId, backCount: n });
  };

  const handlePrintList = async () => {
    if (backStudents.length === 0) {
      toast.error("No back students to print");
      return;
    }
    setPrinting(true);
    try {
      const el = document.getElementById(PRINT_AREA_ID);
      if (!el?.textContent?.trim()) {
        throw new Error("Print content is empty — try again");
      }
      await printElementById(PRINT_AREA_ID, "back-students-print");
      toast.success(
        `Print dialog opened — ${backStudents.length} student${
          backStudents.length === 1 ? "" : "s"
        }`,
      );
    } catch (error) {
      toast.error(parseErrorMessage(error));
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <CardTitle>Back Students</CardTitle>
          <p className="mt-1 text-sm text-slate-500">
            Students marked with academic status Back. Set number of backs when
            creating/editing a student, or update it here when they clear papers
            (e.g. 2 → 1).
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full shrink-0 sm:w-auto"
          disabled={
            backStudents.length === 0 || printing || studentsQuery.isLoading
          }
          onClick={() => void handlePrintList()}
        >
          <Printer className="mr-2 h-4 w-4" />
          {printing ? "Preparing…" : "Print list"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select
            value={batchFilter}
            onChange={(event) => {
              setBatchFilter(event.target.value);
              setYearFilter("");
            }}
          >
            <option value="">All batches</option>
            {batches.map((batch) => (
              <option key={asText(batch._id)} value={asText(batch._id)}>
                {asText(batch.name) || asText(batch._id)}
              </option>
            ))}
          </Select>
          <Select
            value={yearFilter}
            onChange={(event) => setYearFilter(event.target.value)}
          >
            <option value="">All years</option>
            {yearOptions.map((year) => (
              <option key={year.value} value={year.value}>
                {year.label}
              </option>
            ))}
          </Select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, number, email…"
              className="pl-9"
            />
          </div>
        </div>

        {studentsQuery.isLoading ? (
          <LoadingState />
        ) : studentsQuery.isError ? (
          <EmptyState
            title="Could not load students"
            description={parseErrorMessage(studentsQuery.error)}
          />
        ) : backStudents.length === 0 ? (
          <EmptyState
            title="No back students"
            description="Students with academic status Back will appear here. Set status to Back and enter number of backs when creating or editing a student."
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <Table>
              <TableHead>
                <tr>
                  <Th>Student Name</Th>
                  <Th>Academic Status</Th>
                  <Th className="whitespace-nowrap">No. of backs</Th>
                  <Th>Number</Th>
                  <Th>Email</Th>
                  <Th>Batch / Year</Th>
                </tr>
              </TableHead>
              <TableBody>
                {backStudents.map((student, index) => {
                  const status = student.academicStatus ?? "PENDING_NOT_PASSED";
                  const statusLabel =
                    STUDENT_ACADEMIC_STATUS_LABELS[
                      status as keyof typeof STUDENT_ACADEMIC_STATUS_LABELS
                    ] ?? "Back";
                  const userRow = resolveStudentUser(student);
                  const phone =
                    asText(userRow?.phone) ||
                    asText(student.guardianPhone) ||
                    "";
                  const email = asText(userRow?.email);
                  const batchLabel = resolveBatchName(student) || "—";
                  const yearLabel = resolveYearName(student) || "—";
                  const studentId = asText(student._id);
                  const backs = resolveBackCount(student);
                  const isEditing = editingId === studentId;

                  return (
                    <tr key={studentId || `back-student-${index}`}>
                      <Td className="font-medium text-slate-900">
                        {studentId ? (
                          <StudentNameLink
                            studentId={studentId}
                            name={asText(userRow?.fullName) || "—"}
                            subtitle={
                              [
                                asText(student.registrationNumber),
                                asText(student.admissionNumber),
                                student.rollNumber != null
                                  ? `Roll ${student.rollNumber}`
                                  : "",
                              ]
                                .filter(Boolean)
                                .join(" · ") || undefined
                            }
                          />
                        ) : (
                          asText(userRow?.fullName) || "—"
                        )}
                      </Td>
                      <Td>
                        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-900">
                          {statusLabel}
                        </span>
                      </Td>
                      <Td>
                        {isEditing ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <NumberInput
                              min={1}
                              max={50}
                              step={1}
                              className="h-9 w-20"
                              value={editValue}
                              onValueChange={(value) =>
                                setEditValue(
                                  Math.max(
                                    1,
                                    Math.min(50, Math.floor(value ?? 1)),
                                  ),
                                )
                              }
                              disabled={updateBackCount.isPending}
                              aria-label="Number of backs"
                            />
                            <Button
                              type="button"
                              size="sm"
                              className="h-9 px-2"
                              disabled={
                                updateBackCount.isPending || !studentId
                              }
                              title="Save"
                              onClick={() => saveEditBacks(studentId)}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-9 px-2"
                              disabled={updateBackCount.isPending}
                              title="Cancel"
                              onClick={cancelEditBacks}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="inline-flex min-w-[1.75rem] items-center justify-center rounded-lg bg-amber-50 px-2 py-1 text-sm font-bold tabular-nums text-amber-950 ring-1 ring-amber-200">
                              {backs}
                            </span>
                            {studentId ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 px-2"
                                title="Edit number of backs"
                                onClick={() => startEditBacks(student)}
                              >
                                <Pencil className="mr-1 h-3.5 w-3.5" />
                                Edit
                              </Button>
                            ) : null}
                          </div>
                        )}
                      </Td>
                      <Td className="tabular-nums text-slate-700">
                        {phone || "—"}
                      </Td>
                      <Td className="text-slate-700">{email || "—"}</Td>
                      <Td className="text-slate-600">
                        {batchLabel}
                        <span className="text-slate-400"> / </span>
                        {yearLabel}
                      </Td>
                    </tr>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {!studentsQuery.isLoading &&
        !studentsQuery.isError &&
        backStudents.length > 0 ? (
          <p className="text-sm text-slate-500">
            Showing {backStudents.length} back student
            {backStudents.length === 1 ? "" : "s"}
          </p>
        ) : null}
      </CardContent>

      {/* Hidden print layout */}
      <div
        id={PRINT_AREA_ID}
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
                {institutionName || "Institution"}
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
                Back Students list
              </p>
              {printScopeLines.length > 0 ? (
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: 11,
                    color: "#334155",
                    fontWeight: 600,
                  }}
                >
                  {printScopeLines.join("  ·  ")}
                </p>
              ) : null}
              <p
                style={{
                  margin: "2px 0 0",
                  fontSize: 10,
                  color: "#64748b",
                }}
              >
                {backStudents.length} student
                {backStudents.length === 1 ? "" : "s"}
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
              <th style={printTh}>No. of backs</th>
              <th style={printTh}>Admission / Reg.</th>
              <th style={printTh}>Phone</th>
              <th style={printTh}>Batch</th>
              <th style={printTh}>Year</th>
            </tr>
          </thead>
          <tbody>
            {backStudents.map((student, index) => {
              const userRow = resolveStudentUser(student);
              return (
                <tr
                  key={asText(student._id) || index}
                  style={{
                    background: index % 2 === 1 ? "#f8fafc" : "#ffffff",
                  }}
                >
                  <td style={{ ...printTd, textAlign: "center" }}>
                    {index + 1}
                  </td>
                  <td style={printTd}>
                    <div style={{ fontWeight: 600 }}>
                      {asText(userRow?.fullName) || "—"}
                    </div>
                    {userRow?.email ? (
                      <div style={{ fontSize: 9, color: "#64748b" }}>
                        {userRow.email}
                      </div>
                    ) : null}
                  </td>
                  <td
                    style={{
                      ...printTd,
                      textAlign: "center",
                      fontWeight: 700,
                    }}
                  >
                    {resolveBackCount(student)}
                  </td>
                  <td style={printTd}>
                    {asText(student.admissionNumber) || "—"}
                    {student.registrationNumber ? (
                      <div style={{ fontSize: 9, color: "#64748b" }}>
                        Reg: {asText(student.registrationNumber)}
                      </div>
                    ) : null}
                  </td>
                  <td style={printTd}>
                    {asText(userRow?.phone) ||
                      asText(student.guardianPhone) ||
                      "—"}
                  </td>
                  <td style={printTd}>{resolveBatchName(student) || "—"}</td>
                  <td style={printTd}>{resolveYearName(student) || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
};
