import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getTodayBs } from "@munatech/nepali-datepicker";
import type {
  LaboratoryRecord,
  TeacherLaboratoryAssignmentRecord,
  TeacherRecord,
} from "@phit-erp/shared";
import { FlaskConical, Plus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { Textarea } from "components/ui/textarea";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";

const todayBsString = (): string => {
  const d = getTodayBs();
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
};

const roleLabel: Record<string, string> = {
  IN_CHARGE: "In-charge",
  ASSISTANT: "Assistant",
  INSTRUCTOR: "Instructor / practical teacher",
};

/**
 * Admin-only laboratory allotment.
 * Independent of Module Access — uses institution admin teacher APIs.
 * Allotted teachers can open Laboratory Management for those labs only.
 */
export const LaboratoryAllotPanel = () => {
  const [teacherId, setTeacherId] = useState("");
  const [laboratoryId, setLaboratoryId] = useState("");
  const [role, setRole] = useState<"IN_CHARGE" | "ASSISTANT" | "INSTRUCTOR">(
    "INSTRUCTOR",
  );
  const [fromBs, setFromBs] = useState(todayBsString);
  const [remarks, setRemarks] = useState("");
  const [filterLabId, setFilterLabId] = useState("");
  const [search, setSearch] = useState("");

  const teachersQuery = useQuery({
    queryKey: ["teachers", "lab-allot"],
    queryFn: () => unwrap<TeacherRecord[]>(api.get("/teachers")),
  });

  const labsQuery = useQuery({
    queryKey: ["laboratory-labs"],
    queryFn: () => unwrap<LaboratoryRecord[]>(api.get("/laboratory/labs")),
  });

  const assignmentsQuery = useQuery({
    queryKey: ["teacher-lab-assignments", "all", filterLabId],
    queryFn: () =>
      unwrap<TeacherLaboratoryAssignmentRecord[]>(
        api.get("/teachers/lab-assignments", {
          params: {
            status: "ACTIVE",
            ...(filterLabId ? { laboratoryId: filterLabId } : {}),
          },
        }),
      ),
  });

  const teachers = useMemo(
    () =>
      (teachersQuery.data ?? []).filter(
        (t) => t.status === "ACTIVE" || !t.status,
      ),
    [teachersQuery.data],
  );

  const labs = useMemo(
    () => (labsQuery.data ?? []).filter((l) => l.isActive !== false),
    [labsQuery.data],
  );

  const assignments = useMemo(() => {
    const rows = assignmentsQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const hay = [
        row.teacherName,
        row.laboratoryName,
        row.laboratoryCode,
        row.role,
        row.remarks,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [assignmentsQuery.data, search]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["teacher-lab-assignments"] }),
      queryClient.invalidateQueries({ queryKey: ["laboratory-labs"] }),
      queryClient.invalidateQueries({ queryKey: ["teacher-lab-access"] }),
      queryClient.invalidateQueries({ queryKey: ["laboratory-dashboard"] }),
    ]);
  };

  const createAssignment = useMutation({
    mutationFn: () => {
      if (!teacherId) throw new Error("Select a teacher");
      if (!laboratoryId) throw new Error("Select a laboratory");
      return unwrap(
        api.post("/teachers/lab-assignments", {
          teacherId,
          laboratoryId,
          role,
          assignedFromBs: fromBs.trim() || todayBsString(),
          status: "ACTIVE",
          remarks: remarks.trim() || undefined,
        }),
      );
    },
    onSuccess: async () => {
      toast.success(
        "Laboratory allotted to teacher — they can open Laboratory Management for this lab",
      );
      setTeacherId("");
      setLaboratoryId("");
      setRole("INSTRUCTOR");
      setFromBs(todayBsString());
      setRemarks("");
      await invalidate();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const deactivateAssignment = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.delete(`/teachers/lab-assignments/${id}`)),
    onSuccess: async () => {
      toast.success("Laboratory allotment removed");
      await invalidate();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  if (teachersQuery.isLoading || labsQuery.isLoading) {
    return <LoadingState />;
  }

  return (
    <div className="space-y-6">
      <Card className="border-brand-100 bg-[linear-gradient(135deg,_#eef3fb_0%,_white_55%)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="h-5 w-5 text-brand-600" />
            Allot Laboratory to teachers
          </CardTitle>
          <p className="text-sm text-slate-600">
            Assign a laboratory (e.g. Physics Lab) to a practical / lab teacher.
            Allotment is independent of Module Access. After allotment, that
            teacher can open <strong>Laboratory Management</strong> to view that
            lab&apos;s inventory and submit <strong>Required items</strong>{" "}
            requests. Admin / Super Admin receive and approve those requests.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <FormField label="Teacher *">
            <Select
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
            >
              <option value="">Select teacher</option>
              {teachers.map((t) => (
                <option key={t._id} value={t._id}>
                  {t.user?.fullName ?? "Teacher"}
                  {t.department ? ` · ${t.department}` : ""}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Laboratory *">
            <Select
              value={laboratoryId}
              onChange={(e) => setLaboratoryId(e.target.value)}
            >
              <option value="">Select laboratory</option>
              {labs.map((lab) => (
                <option key={lab._id} value={lab._id}>
                  {lab.yearLevel ? `[${lab.yearLevel}] ` : ""}
                  {lab.name}
                  {lab.code ? ` (${lab.code})` : ""}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Role in lab">
            <Select
              value={role}
              onChange={(e) =>
                setRole(
                  e.target.value as "IN_CHARGE" | "ASSISTANT" | "INSTRUCTOR",
                )
              }
            >
              <option value="INSTRUCTOR">Instructor / practical teacher</option>
              <option value="IN_CHARGE">In-charge</option>
              <option value="ASSISTANT">Assistant</option>
            </Select>
          </FormField>
          <FormField label="Allot from (BS)">
            <NepaliDateField value={fromBs} onChange={setFromBs} />
          </FormField>
          <FormField label="Remarks (optional)">
            <Textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={2}
              placeholder="e.g. Physics practical HA 1st year"
            />
          </FormField>
          <div className="flex items-end">
            <Button
              className="w-full sm:w-auto"
              disabled={
                !teacherId || !laboratoryId || createAssignment.isPending
              }
              onClick={() => createAssignment.mutate()}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              {createAssignment.isPending ? "Allotting…" : "Allot laboratory"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <FlaskConical className="h-5 w-5 text-brand-600" />
              Active laboratory allotments
            </CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              {assignments.length} active assignment
              {assignments.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select
              className="w-auto min-w-[10rem]"
              value={filterLabId}
              onChange={(e) => setFilterLabId(e.target.value)}
            >
              <option value="">All laboratories</option>
              {labs.map((lab) => (
                <option key={lab._id} value={lab._id}>
                  {lab.name}
                </option>
              ))}
            </Select>
            <Input
              className="max-w-xs"
              placeholder="Search teacher or lab…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {assignmentsQuery.isLoading ? (
            <div className="px-6 py-10 text-center text-sm text-slate-500">
              Loading allotments…
            </div>
          ) : assignments.length === 0 ? (
            <div className="px-6 py-8">
              <EmptyState
                title="No laboratory allotments yet"
                description="Use the form above to allot a laboratory to a teacher. They will then see Laboratory Management for that lab only."
              />
            </div>
          ) : (
            <div className="max-w-full overflow-x-auto">
              <Table className="min-w-[900px]">
                <TableHead>
                  <tr>
                    <Th className="w-12 text-center">#</Th>
                    <Th>Teacher</Th>
                    <Th>Laboratory</Th>
                    <Th>Year</Th>
                    <Th>Role</Th>
                    <Th>From (BS)</Th>
                    <Th>Remarks</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {assignments.map((row, index) => (
                    <tr key={row._id}>
                      <Td className="text-center tabular-nums text-slate-500">
                        {index + 1}
                      </Td>
                      <Td className="font-medium">
                        {row.teacherName ?? row.teacherId}
                      </Td>
                      <Td>
                        <div className="font-medium">
                          {row.laboratoryName ?? "—"}
                        </div>
                        {row.laboratoryCode ? (
                          <div className="font-mono text-xs text-slate-500">
                            {row.laboratoryCode}
                          </div>
                        ) : null}
                      </Td>
                      <Td>
                        <Badge className="bg-indigo-100 text-indigo-800">
                          {row.laboratoryYearLevel ?? "All Years"}
                        </Badge>
                      </Td>
                      <Td>
                        <Badge className="bg-sky-100 text-sky-900">
                          {roleLabel[row.role] ?? row.role}
                        </Badge>
                      </Td>
                      <Td className="whitespace-nowrap text-sm">
                        {row.assignedFromBs}
                      </Td>
                      <Td className="max-w-[12rem] truncate text-sm text-slate-600">
                        {row.remarks?.trim() || "—"}
                      </Td>
                      <Td className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-rose-200 text-rose-700 hover:bg-rose-50"
                          disabled={deactivateAssignment.isPending}
                          onClick={() => {
                            if (
                              confirm(
                                `Remove allotment of “${row.laboratoryName ?? "lab"}” from ${row.teacherName ?? "teacher"}?`,
                              )
                            ) {
                              deactivateAssignment.mutate(row._id);
                            }
                          }}
                        >
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
