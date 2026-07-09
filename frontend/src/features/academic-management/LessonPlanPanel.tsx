import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type AcademicLessonPlanInput,
  type AcademicLessonPlanRecord,
  type AcademicSessionPlanUnitRecord,
  canManageInstitution,
} from "@phit-erp/shared";
import { Plus, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { Table, TableBody, TableHead, Td, Th } from "components/ui/table";
import { Textarea } from "components/ui/textarea";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { useAuth } from "features/auth/AuthProvider";
import { api, unwrap } from "lib/api";
import { parseErrorMessage } from "lib/utils";
import {
  filtersToParams,
  NEPALI_MONTHS,
  statusBadgeClass,
} from "./academicManagementUtils";
import type {
  AcademicManagementFilters,
  AcademicSessionPlanRecord,
} from "@phit-erp/shared";
import { AcademicCommentsPanel } from "./AcademicCommentsPanel";
import { AcademicProgressBar } from "./AcademicProgressBar";

interface LessonPlanPanelProps {
  filters: AcademicManagementFilters;
  subjects: Array<{ _id: string; name: string }>;
  teacherId?: string;
  teachers?: Array<{ _id: string; user: { fullName: string } }>;
}

const emptyItem = (serialNo: number) => ({
  serialNo,
  subjectLabel: "",
  plannedTopic: "",
  description: "",
  learningObjectives: "",
  teachingMethod: "",
  teachingAids: "",
  assessmentMethod: "",
  deadline: "",
  estimatedClasses: 1,
  remarks: "",
});

export const LessonPlanPanel = ({
  filters,
  subjects,
  teacherId,
  teachers = [],
}: LessonPlanPanelProps) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = canManageInstitution(user?.role ?? "");
  const [showForm, setShowForm] = useState(false);
  const [sessionPlanId, setSessionPlanId] = useState(
    filters.subjectId ? "" : "",
  );
  const [form, setForm] = useState<AcademicLessonPlanInput>({
    academicYearBs: filters.academicYearBs || "2082/083",
    session: filters.session || filters.academicYearBs || "2082/083",
    faculty: filters.faculty || "",
    semesterBs: filters.semesterBs || "",
    classId: filters.classId,
    sectionId: filters.sectionId,
    batchId: filters.batchId,
    yearId: filters.yearId,
    subjectId: filters.subjectId || "",
    teacherId: teacherId || filters.teacherId || "",
    month: filters.month || NEPALI_MONTHS[0] || "Baisakh",
    items: [emptyItem(1)],
  });

  const sessionPlansQuery = useQuery({
    queryKey: [
      "academic-management",
      "session-plans",
      filters.subjectId,
      teacherId,
    ],
    queryFn: () =>
      unwrap<AcademicSessionPlanRecord[]>(
        api.get("/academic-management/session-plans", {
          params: {
            ...filtersToParams(filters),
            subjectId: form.subjectId || filters.subjectId,
            teacherId: teacherId || filters.teacherId,
          },
        }),
      ),
    enabled: showForm,
  });

  const plansQuery = useQuery({
    queryKey: ["academic-management", "lesson-plans", filters],
    queryFn: () =>
      unwrap<AcademicLessonPlanRecord[]>(
        api.get("/academic-management/lesson-plans", {
          params: filtersToParams(filters),
        }),
      ),
  });

  const unitsQuery = useQuery({
    queryKey: ["academic-management", "session-plan-units", sessionPlanId],
    queryFn: () =>
      unwrap<AcademicSessionPlanUnitRecord[]>(
        api.get("/academic-management/session-plan-units", {
          params: { sessionPlanId },
        }),
      ),
    enabled: Boolean(sessionPlanId),
  });

  const createMutation = useMutation({
    mutationFn: (payload: AcademicLessonPlanInput) =>
      unwrap(api.post("/academic-management/lesson-plans", payload)),
    onSuccess: () => {
      toast.success("Lesson plan created");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
      setShowForm(false);
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const submitMutation = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.post(`/academic-management/lesson-plans/${id}/submit`)),
    onSuccess: () => {
      toast.success("Lesson plan submitted");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.post(`/academic-management/lesson-plans/${id}/approve`, {})),
    onSuccess: () => {
      toast.success("Lesson plan approved");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const unlockMutation = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.post(`/academic-management/lesson-plans/${id}/unlock`)),
    onSuccess: () => {
      toast.success("Lesson plan unlocked");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, remarks }: { id: string; remarks: string }) =>
      unwrap(
        api.post(`/academic-management/lesson-plans/${id}/reject`, { remarks }),
      ),
    onSuccess: () => {
      toast.success("Lesson plan rejected");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const filteredPlans = useMemo(() => {
    const keyword = filters.keyword?.toLowerCase().trim();
    if (!keyword) return plansQuery.data ?? [];
    return (plansQuery.data ?? []).filter(
      (plan) =>
        plan.items.some((item) =>
          item.plannedTopic.toLowerCase().includes(keyword),
        ) ||
        [plan.subject?.name, plan.teacher?.user?.fullName]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(keyword)),
    );
  }, [filters.keyword, plansQuery.data]);

  if (plansQuery.isLoading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Lesson Plan</h2>
          <p className="text-sm text-slate-600">
            Monthly teaching plans linked to session plan units with automatic
            progress tracking.
          </p>
        </div>
        <Button onClick={() => setShowForm((current) => !current)}>
          <Plus className="mr-2 h-4 w-4" />
          New Lesson Plan
        </Button>
      </div>

      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle>Create Lesson Plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <Select
                value={form.subjectId}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    subjectId: event.target.value,
                  }))
                }
              >
                <option value="">Subject</option>
                {subjects.map((subject) => (
                  <option key={subject._id} value={subject._id}>
                    {subject.name}
                  </option>
                ))}
              </Select>
              {isAdmin && teachers.length > 0 ? (
                <Select
                  value={form.teacherId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      teacherId: event.target.value,
                    }))
                  }
                >
                  <option value="">Teacher</option>
                  {teachers.map((teacher) => (
                    <option key={teacher._id} value={teacher._id}>
                      {teacher.user.fullName}
                    </option>
                  ))}
                </Select>
              ) : null}
              <Select
                value={form.month}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    month: event.target.value,
                  }))
                }
              >
                {NEPALI_MONTHS.map((month) => (
                  <option key={month} value={month}>
                    {month}
                  </option>
                ))}
              </Select>
              <Select
                value={sessionPlanId}
                onChange={(event) => {
                  setSessionPlanId(event.target.value);
                  setForm((current) => ({
                    ...current,
                    sessionPlanId: event.target.value,
                  }));
                }}
              >
                <option value="">Link session plan (optional)</option>
                {(sessionPlansQuery.data ?? []).map((plan) => (
                  <option key={plan._id} value={plan._id}>
                    {plan.subject?.name} · {plan.academicYearBs} ({plan.status})
                  </option>
                ))}
              </Select>
              <Input
                value={form.academicYearBs}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    academicYearBs: event.target.value,
                  }))
                }
              />
            </div>
            {form.items.map((item, index) => (
              <div
                key={index}
                className="grid gap-3 rounded-2xl border border-slate-200 p-4 md:grid-cols-2"
              >
                <FormField label="Session plan unit">
                  <Select
                    value={item.sessionPlanUnitId ?? ""}
                    onChange={(event) => {
                      const unit = unitsQuery.data?.find(
                        (row) => row._id === event.target.value,
                      );
                      setForm((current) => ({
                        ...current,
                        items: current.items.map((row, rowIndex) =>
                          rowIndex === index
                            ? {
                                ...row,
                                sessionPlanUnitId: event.target.value,
                                plannedTopic:
                                  unit?.chapterName ?? row.plannedTopic,
                                subjectLabel: unit
                                  ? `Unit ${unit.unitNo}`
                                  : row.subjectLabel,
                              }
                            : row,
                        ),
                      }));
                    }}
                  >
                    <option value="">Select session plan unit</option>
                    {(unitsQuery.data ?? []).map((unit) => (
                      <option key={unit._id} value={unit._id}>
                        Unit {unit.unitNo}: {unit.chapterName}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Planned topic">
                  <Input
                    value={item.plannedTopic}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        items: current.items.map((row, rowIndex) =>
                          rowIndex === index
                            ? { ...row, plannedTopic: event.target.value }
                            : row,
                        ),
                      }))
                    }
                    placeholder="Topic to teach"
                  />
                </FormField>
                <FormField label="Estimated classes">
                  <NumberInput
                    min={1}
                    value={item.estimatedClasses}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        items: current.items.map((row, rowIndex) =>
                          rowIndex === index
                            ? {
                                ...row,
                                estimatedClasses: event.target.valueAsNumber,
                              }
                            : row,
                        ),
                      }))
                    }
                    placeholder="e.g. 3"
                  />
                </FormField>
                <FormField label="Deadline (BS)">
                  <NepaliDateField
                    value={item.deadline}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        items: current.items.map((row, rowIndex) =>
                          rowIndex === index
                            ? { ...row, deadline: value }
                            : row,
                        ),
                      }))
                    }
                    placeholder="Select deadline"
                  />
                </FormField>
                <div className="md:col-span-2">
                  <FormField label="Learning objectives">
                    <Textarea
                      value={item.learningObjectives}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          items: current.items.map((row, rowIndex) =>
                            rowIndex === index
                              ? {
                                  ...row,
                                  learningObjectives: event.target.value,
                                }
                              : row,
                          ),
                        }))
                      }
                      placeholder="What students should learn"
                    />
                  </FormField>
                </div>
              </div>
            ))}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    items: [
                      ...current.items,
                      emptyItem(current.items.length + 1),
                    ],
                  }))
                }
              >
                Add Row
              </Button>
              <Button
                onClick={() =>
                  createMutation.mutate({
                    ...form,
                    sessionPlanId: sessionPlanId || undefined,
                    teacherId: teacherId || form.teacherId,
                  })
                }
              >
                Save Draft
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {filteredPlans.length === 0 ? (
        <EmptyState
          title="No lesson plans found"
          description="Create a monthly lesson plan linked to your session plan units."
        />
      ) : (
        filteredPlans.map((plan) => (
          <Card key={plan._id}>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>
                  {plan.subject?.name} · {plan.month} · {plan.academicYearBs}
                </CardTitle>
                <p className="text-sm text-slate-600">
                  {plan.teacher?.user?.fullName} · {plan.completedPercent}%
                  complete ·{" "}
                  <span className="font-medium text-amber-700">
                    {plan.remainingPercent}% remaining
                  </span>
                  {" · "}Pending: {plan.pendingUnits} · Delayed:{" "}
                  {plan.delayedUnits}
                </p>
                <AcademicProgressBar
                  className="mt-2 max-w-md"
                  completedPercent={plan.completedPercent}
                  remainingPercent={plan.remainingPercent}
                />
              </div>
              <Badge className={statusBadgeClass(plan.status)}>
                {plan.status}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <tr>
                      <Th>SN</Th>
                      <Th>Topic</Th>
                      <Th>Objectives</Th>
                      <Th>Method</Th>
                      <Th>Classes</Th>
                      <Th>Progress</Th>
                      <Th>Remaining</Th>
                      <Th>Deadline</Th>
                      <Th>Status</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {plan.items.map((item) => {
                      const remaining =
                        item.remainingPercent ??
                        Math.max(0, 100 - item.completedPercent);
                      return (
                        <tr key={item._id}>
                          <Td>{item.serialNo}</Td>
                          <Td>{item.plannedTopic}</Td>
                          <Td className="max-w-xs truncate">
                            {item.learningObjectives}
                          </Td>
                          <Td>{item.teachingMethod}</Td>
                          <Td>
                            {item.completedClasses}/{item.estimatedClasses}
                          </Td>
                          <Td className="min-w-[120px]">
                            <AcademicProgressBar
                              completedPercent={item.completedPercent}
                              remainingPercent={remaining}
                              compact
                            />
                            <span className="text-xs text-slate-600">
                              {item.completedPercent}%
                            </span>
                          </Td>
                          <Td>
                            <span
                              className={
                                remaining > 0
                                  ? "font-semibold text-amber-700"
                                  : "text-emerald-700"
                              }
                            >
                              {remaining}%
                            </span>
                          </Td>
                          <Td className="whitespace-nowrap text-xs">
                            {item.deadline || "—"}
                          </Td>
                          <Td>
                            <Badge
                              className={statusBadgeClass(
                                item.completionStatus,
                              )}
                            >
                              {item.completionStatus}
                            </Badge>
                          </Td>
                        </tr>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="grid gap-2 rounded-2xl border border-slate-200 p-4 text-sm text-slate-700 md:grid-cols-2">
                <p>
                  Prepared By: {plan.preparedBy || plan.teacher?.user?.fullName}
                </p>
                <p>Checked By: {plan.checkedBy || "—"}</p>
                <p>Approved By: {plan.approvedByName || "—"}</p>
                <p>Approval Date: {plan.approvalDate || "—"}</p>
                <p className="md:col-span-2">
                  Admin Remarks: {plan.adminRemarks || "—"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {plan.status === "DRAFT" || plan.status === "REJECTED" ? (
                  <Button
                    size="sm"
                    onClick={() => submitMutation.mutate(plan._id)}
                  >
                    <Send className="mr-2 h-4 w-4" />
                    Submit
                  </Button>
                ) : null}
                {isAdmin && plan.status === "PENDING_APPROVAL" ? (
                  <>
                    <Button
                      size="sm"
                      onClick={() => approveMutation.mutate(plan._id)}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const remarks = window.prompt("Rejection remarks");
                        if (remarks)
                          rejectMutation.mutate({ id: plan._id, remarks });
                      }}
                    >
                      Reject
                    </Button>
                  </>
                ) : null}
                {isAdmin && plan.status === "APPROVED" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => unlockMutation.mutate(plan._id)}
                  >
                    Unlock
                  </Button>
                ) : null}
              </div>
              <AcademicCommentsPanel
                entityType="LESSON_PLAN"
                entityId={plan._id}
                canComment={isAdmin || plan.status !== "APPROVED"}
              />
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
};
