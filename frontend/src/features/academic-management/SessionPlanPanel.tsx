import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type AcademicSessionPlanInput,
  type AcademicSessionPlanRecord,
  canManageInstitution,
} from "@phit-erp/shared";
import { Plus, Send, Trash2 } from "lucide-react";
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
import { useAuth } from "features/auth/AuthProvider";
import { api, unwrap } from "lib/api";
import { parseErrorMessage } from "lib/utils";
import { filtersToParams, statusBadgeClass } from "./academicManagementUtils";
import type { AcademicManagementFilters } from "@phit-erp/shared";
import { AcademicAttachmentUpload } from "./AcademicAttachmentUpload";
import { AcademicCommentsPanel } from "./AcademicCommentsPanel";

interface SessionPlanPanelProps {
  filters: AcademicManagementFilters;
  subjects: Array<{ _id: string; name: string }>;
  teacherId?: string;
  teachers?: Array<{ _id: string; user: { fullName: string } }>;
}

const emptyUnit = () => ({
  unitNo: 1,
  chapterName: "",
  estimatedTeachingHours: 0,
  learningOutcomes: "",
  topicsCovered: "",
  references: "",
  practicalRequired: false,
  internalAssessment: "",
  tentativeCompletionMonth: "",
  status: "PENDING" as const,
});

export const SessionPlanPanel = ({
  filters,
  subjects,
  teacherId,
  teachers = [],
}: SessionPlanPanelProps) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = canManageInstitution(user?.role ?? "");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<AcademicSessionPlanInput>({
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
    attachmentUrl: "",
    units: [emptyUnit()],
  });

  const queryKey = ["academic-management", "session-plans", filters];
  const plansQuery = useQuery({
    queryKey,
    queryFn: () =>
      unwrap<AcademicSessionPlanRecord[]>(
        api.get("/academic-management/session-plans", {
          params: filtersToParams(filters),
        }),
      ),
  });

  const createMutation = useMutation({
    mutationFn: (payload: AcademicSessionPlanInput) =>
      unwrap(api.post("/academic-management/session-plans", payload)),
    onSuccess: () => {
      toast.success("Session plan created");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
      setShowForm(false);
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const submitMutation = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.post(`/academic-management/session-plans/${id}/submit`)),
    onSuccess: () => {
      toast.success("Session plan submitted");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, remarks }: { id: string; remarks?: string }) =>
      unwrap(
        api.post(`/academic-management/session-plans/${id}/approve`, {
          remarks,
        }),
      ),
    onSuccess: () => {
      toast.success("Session plan approved");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, remarks }: { id: string; remarks: string }) =>
      unwrap(
        api.post(`/academic-management/session-plans/${id}/reject`, {
          remarks,
        }),
      ),
    onSuccess: () => {
      toast.success("Session plan rejected");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const unlockMutation = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.post(`/academic-management/session-plans/${id}/unlock`)),
    onSuccess: () => {
      toast.success("Session plan unlocked");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.delete(`/academic-management/session-plans/${id}`)),
    onSuccess: () => {
      toast.success("Session plan deleted");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const filteredPlans = useMemo(() => {
    const keyword = filters.keyword?.toLowerCase().trim();
    if (!keyword) return plansQuery.data ?? [];
    return (plansQuery.data ?? []).filter((plan) =>
      [plan.subject?.name, plan.teacher?.user?.fullName, plan.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword)),
    );
  }, [filters.keyword, plansQuery.data]);

  if (plansQuery.isLoading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Session Plan</h2>
          <p className="text-sm text-slate-600">
            Annual syllabus planning linked to lesson plans and log books.
          </p>
        </div>
        <Button onClick={() => setShowForm((current) => !current)}>
          <Plus className="mr-2 h-4 w-4" />
          New Session Plan
        </Button>
      </div>

      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle>Create Session Plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <Select
                value={form.subjectId}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    subjectId: event.target.value,
                  }))
                }
              >
                <option value="">Select subject</option>
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
                  <option value="">Select teacher</option>
                  {teachers.map((teacher) => (
                    <option key={teacher._id} value={teacher._id}>
                      {teacher.user.fullName}
                    </option>
                  ))}
                </Select>
              ) : null}
              <Input
                value={form.academicYearBs}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    academicYearBs: event.target.value,
                    session: event.target.value,
                  }))
                }
                placeholder="Academic Year"
              />
              <Input
                value={form.faculty}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    faculty: event.target.value,
                  }))
                }
                placeholder="Faculty"
              />
            </div>
            {form.units.map((unit, index) => (
              <div
                key={index}
                className="grid gap-3 rounded-2xl border border-slate-200 p-4 md:grid-cols-2"
              >
                <FormField label="Unit number">
                  <NumberInput
                    min={1}
                    value={unit.unitNo}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        units: current.units.map((row, rowIndex) =>
                          rowIndex === index
                            ? { ...row, unitNo: event.target.valueAsNumber }
                            : row,
                        ),
                      }))
                    }
                    placeholder="e.g. 1"
                  />
                </FormField>
                <FormField label="Chapter / unit name">
                  <Input
                    value={unit.chapterName}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        units: current.units.map((row, rowIndex) =>
                          rowIndex === index
                            ? { ...row, chapterName: event.target.value }
                            : row,
                        ),
                      }))
                    }
                    placeholder="Chapter name"
                  />
                </FormField>
                <FormField label="Estimated teaching hours">
                  <NumberInput
                    min={0}
                    value={unit.estimatedTeachingHours}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        units: current.units.map((row, rowIndex) =>
                          rowIndex === index
                            ? {
                                ...row,
                                estimatedTeachingHours:
                                  event.target.valueAsNumber,
                              }
                            : row,
                        ),
                      }))
                    }
                    placeholder="e.g. 12"
                  />
                </FormField>
                <FormField label="Tentative completion month">
                  <Input
                    value={unit.tentativeCompletionMonth}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        units: current.units.map((row, rowIndex) =>
                          rowIndex === index
                            ? {
                                ...row,
                                tentativeCompletionMonth: event.target.value,
                              }
                            : row,
                        ),
                      }))
                    }
                    placeholder="e.g. Baisakh"
                  />
                </FormField>
                <div className="md:col-span-2">
                  <FormField label="Learning outcomes">
                    <Textarea
                      value={unit.learningOutcomes}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          units: current.units.map((row, rowIndex) =>
                            rowIndex === index
                              ? { ...row, learningOutcomes: event.target.value }
                              : row,
                          ),
                        }))
                      }
                      placeholder="What students should achieve after this unit"
                    />
                  </FormField>
                </div>
              </div>
            ))}
            <AcademicAttachmentUpload
              attachmentUrl={form.attachmentUrl}
              onChange={(url) =>
                setForm((current) => ({ ...current, attachmentUrl: url }))
              }
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    units: [...current.units, emptyUnit()],
                  }))
                }
              >
                Add Unit
              </Button>
              <Button
                onClick={() =>
                  createMutation.mutate({
                    ...form,
                    teacherId: teacherId || form.teacherId,
                  })
                }
                disabled={!form.subjectId || !(form.teacherId || teacherId)}
              >
                Save Draft
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {filteredPlans.length === 0 ? (
        <EmptyState
          title="No session plans found"
          description="Create a session plan to start annual syllabus planning."
        />
      ) : (
        filteredPlans.map((plan) => (
          <Card key={plan._id} id="academic-print-area">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>
                  {plan.subject?.name} · {plan.academicYearBs}
                </CardTitle>
                <p className="text-sm text-slate-600">
                  {plan.teacher?.user?.fullName} · {plan.completedPercent}%
                  complete ·{" "}
                  <span className="font-medium text-amber-700">
                    {plan.remainingPercent}% remaining
                  </span>
                  {" · "}
                  {plan.completedUnits}/
                  {plan.completedUnits + plan.remainingUnits} units
                </p>
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
                      <Th>Unit</Th>
                      <Th>Chapter</Th>
                      <Th>Hours</Th>
                      <Th>Outcomes</Th>
                      <Th>Practical</Th>
                      <Th>Month</Th>
                      <Th>Status</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {plan.units.map((unit) => (
                      <tr key={unit._id}>
                        <Td>{unit.unitNo}</Td>
                        <Td>{unit.chapterName}</Td>
                        <Td>{unit.estimatedTeachingHours}</Td>
                        <Td className="max-w-xs truncate">
                          {unit.learningOutcomes}
                        </Td>
                        <Td>{unit.practicalRequired ? "Yes" : "No"}</Td>
                        <Td>{unit.tentativeCompletionMonth}</Td>
                        <Td>
                          <Badge className={statusBadgeClass(unit.status)}>
                            {unit.status}
                          </Badge>
                        </Td>
                      </tr>
                    ))}
                  </TableBody>
                </Table>
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
                {isAdmin &&
                (plan.status === "SUBMITTED" ||
                  plan.status === "PENDING_APPROVAL") ? (
                  <>
                    <Button
                      size="sm"
                      onClick={() => approveMutation.mutate({ id: plan._id })}
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
                {(plan.status === "DRAFT" ||
                  plan.status === "REJECTED" ||
                  isAdmin) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => deleteMutation.mutate(plan._id)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                )}
              </div>
              {plan.attachmentUrl ? (
                <a
                  href={plan.attachmentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-brand-700 hover:underline"
                >
                  View session plan attachment
                </a>
              ) : null}
              <AcademicCommentsPanel
                entityType="SESSION_PLAN"
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
