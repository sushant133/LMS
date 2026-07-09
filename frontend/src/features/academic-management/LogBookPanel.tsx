import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type AcademicLessonPlanRecord,
  type AcademicLogBookEntryInput,
  type AcademicLogBookEntryRecord,
  type TodayTimetableSlot,
  canManageInstitution,
} from "@phit-erp/shared";
import { getTodayBs } from "@munatech/nepali-datepicker";
import { CalendarPlus, CheckCircle2 } from "lucide-react";
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
import { filtersToParams, statusBadgeClass } from "./academicManagementUtils";
import type { AcademicManagementFilters } from "@phit-erp/shared";
import { AcademicAttachmentUpload } from "./AcademicAttachmentUpload";
import { AcademicCommentsPanel } from "./AcademicCommentsPanel";

const formatTodayBs = (): string => {
  const today = getTodayBs();
  return `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;
};

interface LogBookPanelProps {
  filters: AcademicManagementFilters;
  teacherId?: string;
  isTeacher: boolean;
  subjects?: Array<{ _id: string; name: string }>;
  teachers?: Array<{ _id: string; user: { fullName: string } }>;
}

export const LogBookPanel = ({
  filters,
  teacherId,
  isTeacher,
  subjects = [],
  teachers = [],
}: LogBookPanelProps) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = canManageInstitution(user?.role ?? "");
  const [showForm, setShowForm] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<TodayTimetableSlot | null>(
    null,
  );
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [form, setForm] = useState<AcademicLogBookEntryInput>({
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
    dateBs: filters.dateFrom || formatTodayBs(),
    lessonPlanItemId: undefined,
    lessonPlanId: undefined,
    topicCovered: "",
    unit: "",
    objectives: "",
    teachingMethod: "",
    teachingAids: "",
    theoryPractical: "THEORY",
    periodNumber: 1,
    homeworkGiven: "",
    assignment: "",
    feedback: "",
    difficultiesFaced: "",
    nextClassPlan: "",
    attachmentUrl: "",
  });

  const effectiveTeacherId =
    teacherId || form.teacherId || filters.teacherId || "";

  const entriesQuery = useQuery({
    queryKey: ["academic-management", "log-book", filters],
    queryFn: () =>
      unwrap<AcademicLogBookEntryRecord[]>(
        api.get("/academic-management/log-book-entries", {
          params: filtersToParams(filters),
        }),
      ),
  });

  const effectiveDateBs = form.dateBs || formatTodayBs();

  const timetableQuery = useQuery({
    queryKey: ["academic-management", "timetable-today", effectiveDateBs],
    queryFn: () =>
      unwrap<TodayTimetableSlot[]>(
        api.get("/academic-management/timetable/today", {
          params: { dateBs: effectiveDateBs },
        }),
      ),
    enabled: isTeacher && showForm,
  });

  // Open lesson-plan topics for linking progress (approved + in-flight plans)
  const lessonPlansQuery = useQuery({
    queryKey: [
      "academic-management",
      "lesson-plans-for-log",
      form.subjectId,
      effectiveTeacherId,
      filters.academicYearBs,
    ],
    queryFn: () =>
      unwrap<AcademicLessonPlanRecord[]>(
        api.get("/academic-management/lesson-plans", {
          params: filtersToParams({
            ...filters,
            subjectId: form.subjectId || filters.subjectId,
            teacherId: effectiveTeacherId || filters.teacherId,
          }),
        }),
      ),
    enabled: showForm && Boolean(form.subjectId || filters.subjectId),
  });

  const lessonItemOptions = useMemo(() => {
    const plans = lessonPlansQuery.data ?? [];
    return plans.flatMap((plan) =>
      plan.items
        .filter((item) => item.completionStatus !== "COMPLETED")
        .map((item) => ({
          id: item._id,
          planId: plan._id,
          label: `${plan.month} · ${item.plannedTopic} (${item.completedClasses}/${item.estimatedClasses}, ${item.remainingPercent ?? Math.max(0, 100 - item.completedPercent)}% left)`,
          topic: item.plannedTopic,
          unit: item.unit?.chapterName || item.subjectLabel || "",
          subjectId: plan.subjectId,
        })),
    );
  }, [lessonPlansQuery.data]);

  const createMutation = useMutation({
    mutationFn: (payload: AcademicLogBookEntryInput) =>
      unwrap(api.post("/academic-management/log-book-entries", payload)),
    onSuccess: () => {
      toast.success("Log book entry created");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
      setShowForm(false);
      setSelectedSlot(null);
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const reviewMutation = useMutation({
    mutationFn: ({
      id,
      reviewStatus,
    }: {
      id: string;
      reviewStatus: "REVIEWED" | "APPROVED" | "NEEDS_IMPROVEMENT";
    }) =>
      unwrap(
        api.post(`/academic-management/log-book-entries/${id}/review`, {
          reviewStatus,
        }),
      ),
    onSuccess: () => {
      toast.success("Log book entry reviewed");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const applyTimetableSlot = async (slot: TodayTimetableSlot) => {
    setSelectedSlot(slot);
    const attendance = await unwrap<{
      present: number;
      absent: number;
      percent: number;
      marked: boolean;
    }>(
      api.get("/academic-management/attendance/summary", {
        params: {
          subjectId: slot.subjectId,
          teacherId: teacherId || form.teacherId,
          dateBs: form.dateBs,
          classId: slot.classId,
          sectionId: slot.sectionId,
          batchId: slot.batchId,
          yearId: slot.yearId,
        },
      }),
    );

    setForm((current) => ({
      ...current,
      subjectId: slot.subjectId,
      classId: slot.classId,
      sectionId: slot.sectionId,
      batchId: slot.batchId,
      yearId: slot.yearId,
      periodNumber: slot.periodNumber,
      startTime: slot.startTime,
      endTime: slot.endTime,
      timetableSlotId: slot._id,
      topicCovered: current.topicCovered || slot.subjectName,
    }));

    if (attendance.marked) {
      toast.message(
        `Attendance loaded: ${attendance.present} present, ${attendance.absent} absent (${attendance.percent}%)`,
      );
    }
  };

  const filteredEntries = useMemo(() => {
    const keyword = filters.keyword?.toLowerCase().trim();
    if (!keyword) return entriesQuery.data ?? [];
    return (entriesQuery.data ?? []).filter((entry) =>
      [
        entry.topicCovered,
        entry.unit,
        entry.subject?.name,
        entry.teacher?.user?.fullName,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword)),
    );
  }, [entriesQuery.data, filters.keyword]);

  if (entriesQuery.isLoading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Log Book</h2>
          <p className="text-sm text-slate-600">
            Daily teaching diary with timetable and attendance integration.
          </p>
        </div>
        <Button onClick={() => setShowForm((current) => !current)}>
          <CalendarPlus className="mr-2 h-4 w-4" />
          New Entry
        </Button>
      </div>

      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle>Create Log Book Entry</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <FormField label="Date (BS)">
                <NepaliDateField
                  value={form.dateBs}
                  onChange={(value) =>
                    setForm((current) => ({ ...current, dateBs: value }))
                  }
                  placeholder="Select date"
                />
              </FormField>
              <FormField label="Period number">
                <NumberInput
                  min={1}
                  value={form.periodNumber}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      periodNumber: event.target.valueAsNumber,
                    }))
                  }
                  placeholder="e.g. 1"
                />
              </FormField>
              <FormField label="Theory / Practical">
                <Select
                  value={form.theoryPractical}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      theoryPractical: event.target
                        .value as AcademicLogBookEntryInput["theoryPractical"],
                    }))
                  }
                >
                  <option value="THEORY">Theory</option>
                  <option value="PRACTICAL">Practical</option>
                  <option value="BOTH">Both</option>
                </Select>
              </FormField>
              {isAdmin && teachers.length > 0 ? (
                <FormField label="Teacher">
                  <Select
                    value={form.teacherId}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        teacherId: event.target.value,
                        lessonPlanItemId: undefined,
                        lessonPlanId: undefined,
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
                </FormField>
              ) : null}
              <FormField label="Subject">
                <Select
                  value={form.subjectId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      subjectId: event.target.value,
                      lessonPlanItemId: undefined,
                      lessonPlanId: undefined,
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
              </FormField>
            </div>

            {isTeacher && (timetableQuery.data?.length ?? 0) > 0 ? (
              <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
                <p className="mb-2 text-sm font-medium text-brand-900">
                  Today's Timetable
                </p>
                <div className="flex flex-wrap gap-2">
                  {timetableQuery.data?.map((slot) => (
                    <Button
                      key={slot._id}
                      size="sm"
                      variant={
                        selectedSlot?._id === slot._id ? "default" : "outline"
                      }
                      onClick={() => void applyTimetableSlot(slot)}
                    >
                      P{slot.periodNumber} · {slot.subjectName}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}

            <FormField label="Link lesson plan topic (for progress %)">
              <Select
                value={form.lessonPlanItemId ?? ""}
                onChange={(event) => {
                  const option = lessonItemOptions.find(
                    (row) => row.id === event.target.value,
                  );
                  setForm((current) => ({
                    ...current,
                    lessonPlanItemId: event.target.value || undefined,
                    lessonPlanId: option?.planId,
                    topicCovered: option?.topic || current.topicCovered,
                    unit: option?.unit || current.unit,
                    subjectId: option?.subjectId || current.subjectId,
                  }));
                }}
              >
                <option value="">No link (progress will not update)</option>
                {lessonItemOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-slate-500">
                Select the planned topic taught today so remaining % and delayed
                status stay accurate.
              </p>
            </FormField>

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Unit">
                <Input
                  value={form.unit}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      unit: event.target.value,
                    }))
                  }
                  placeholder="Unit or chapter"
                />
              </FormField>
              <FormField label="Topic covered">
                <Input
                  value={form.topicCovered}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      topicCovered: event.target.value,
                    }))
                  }
                  placeholder="What was taught today"
                />
              </FormField>
              <FormField label="Objectives">
                <Textarea
                  value={form.objectives}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      objectives: event.target.value,
                    }))
                  }
                  placeholder="Class objectives"
                />
              </FormField>
              <FormField label="Next class plan">
                <Textarea
                  value={form.nextClassPlan}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      nextClassPlan: event.target.value,
                    }))
                  }
                  placeholder="Plan for next class"
                />
              </FormField>
            </div>
            <AcademicAttachmentUpload
              attachmentUrl={form.attachmentUrl}
              onChange={(url) =>
                setForm((current) => ({ ...current, attachmentUrl: url }))
              }
            />
            <Button
              onClick={() =>
                createMutation.mutate({
                  ...form,
                  teacherId: teacherId || form.teacherId,
                })
              }
              disabled={
                !form.dateBs ||
                !form.topicCovered ||
                !form.subjectId ||
                !(teacherId || form.teacherId)
              }
            >
              Save Entry
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {filteredEntries.length === 0 ? (
        <EmptyState
          title="No log book entries found"
          description="Record today's class from your timetable to start the digital log book."
        />
      ) : (
        <div className="space-y-4" id="academic-print-area">
          <Card>
            <CardContent className="overflow-x-auto pt-6">
              <Table>
                <TableHead>
                  <tr>
                    <Th>S.N.</Th>
                    <Th>Date</Th>
                    <Th>Subject</Th>
                    <Th>Unit</Th>
                    <Th>Topic</Th>
                    <Th>Period</Th>
                    <Th>Attendance</Th>
                    <Th>Review</Th>
                    <Th>Actions</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {filteredEntries.map((entry) => (
                    <tr key={entry._id}>
                      <Td>{entry.serialNo}</Td>
                      <Td>{entry.dateBs}</Td>
                      <Td>{entry.subject?.name}</Td>
                      <Td>{entry.unit}</Td>
                      <Td>{entry.topicCovered}</Td>
                      <Td>
                        P{entry.periodNumber}
                        {entry.startTime ? ` (${entry.startTime})` : ""}
                      </Td>
                      <Td>
                        {entry.attendancePercent}% ({entry.attendancePresent}/
                        {entry.attendancePresent + entry.attendanceAbsent})
                      </Td>
                      <Td>
                        <Badge className={statusBadgeClass(entry.reviewStatus)}>
                          {entry.reviewStatus}
                        </Badge>
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedEntryId(entry._id)}
                          >
                            Notes
                          </Button>
                          {isAdmin ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  reviewMutation.mutate({
                                    id: entry._id,
                                    reviewStatus: "APPROVED",
                                  })
                                }
                              >
                                <CheckCircle2 className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  reviewMutation.mutate({
                                    id: entry._id,
                                    reviewStatus: "NEEDS_IMPROVEMENT",
                                  })
                                }
                              >
                                Review
                              </Button>
                            </>
                          ) : (
                            <span className="text-xs text-slate-500">
                              {entry.teacherSignature || "—"}
                            </span>
                          )}
                        </div>
                      </Td>
                    </tr>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          {selectedEntryId ? (
            <AcademicCommentsPanel
              entityType="LOG_BOOK_ENTRY"
              entityId={selectedEntryId}
              canComment={isAdmin || isTeacher}
            />
          ) : null}
        </div>
      )}
    </div>
  );
};
