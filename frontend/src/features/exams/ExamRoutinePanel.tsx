import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ExamRecord, ExamRoutineInput, ExamRoutineRecord, SubjectRecord } from "@phit-erp/shared";
import { DAYS_OF_WEEK, examRoutineSchema } from "@phit-erp/shared";
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
import { defaultRoutineValue } from "features/exams/examDefaults";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";

interface EnrichedRoutine extends ExamRoutineRecord {
  subjectName?: string;
  subjectCode?: string;
}

interface ExamRoutinePanelProps {
  exam: ExamRecord;
  subjects: SubjectRecord[];
  isAdmin: boolean;
  readOnly?: boolean;
}

export const ExamRoutinePanel = ({ exam, subjects, isAdmin, readOnly = false }: ExamRoutinePanelProps) => {
  const [routineForm, setRoutineForm] = useState<ExamRoutineInput>(defaultRoutineValue);
  const [editingRoutineId, setEditingRoutineId] = useState<string | null>(null);

  const examSubjects = useMemo(() => {
    const yearIdSet = new Set(exam.yearIds ?? []);
    if (yearIdSet.size === 0) {
      return subjects;
    }
    return subjects.filter((subject) => (subject.yearIds ?? []).some((yearId) => yearIdSet.has(yearId)));
  }, [exam.yearIds, subjects]);

  const routinesQuery = useQuery({
    queryKey: ["exam-routines", exam._id],
    queryFn: () => unwrap<EnrichedRoutine[]>(api.get("/exams/routines", { params: { examId: exam._id } }))
  });

  const createMutation = useMutation({
    mutationFn: (payload: ExamRoutineInput) => unwrap(api.post(`/exams/${exam._id}/routines`, payload)),
    onSuccess: async () => {
      toast.success("Routine added");
      setRoutineForm(defaultRoutineValue);
      await queryClient.invalidateQueries({ queryKey: ["exam-routines", exam._id] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const updateMutation = useMutation({
    mutationFn: ({ routineId, payload }: { routineId: string; payload: ExamRoutineInput }) =>
      unwrap(api.put(`/exams/${exam._id}/routines/${routineId}`, payload)),
    onSuccess: async () => {
      toast.success("Routine updated");
      setRoutineForm(defaultRoutineValue);
      setEditingRoutineId(null);
      await queryClient.invalidateQueries({ queryKey: ["exam-routines", exam._id] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const deleteMutation = useMutation({
    mutationFn: (routineId: string) => unwrap(api.delete(`/exams/${exam._id}/routines/${routineId}`)),
    onSuccess: async () => {
      toast.success("Routine removed");
      await queryClient.invalidateQueries({ queryKey: ["exam-routines", exam._id] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const publishMutation = useMutation({
    mutationFn: () => unwrap(api.post(`/exams/${exam._id}/routines/publish`)),
    onSuccess: async () => {
      toast.success("Exam routine published");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["exam-routines", exam._id] }),
        queryClient.invalidateQueries({ queryKey: ["exams"] })
      ]);
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const unpublishMutation = useMutation({
    mutationFn: () => unwrap(api.post(`/exams/${exam._id}/routines/unpublish`)),
    onSuccess: async () => {
      toast.success("Exam routine unpublished");
      await queryClient.invalidateQueries({ queryKey: ["exams"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const routines = routinesQuery.data ?? [];
  const scheduledSubjectIds = new Set(routines.map((routine) => routine.subjectId));
  const availableSubjects = examSubjects.filter((subject) => !scheduledSubjectIds.has(subject._id) || editingRoutineId);

  if (routinesQuery.isLoading) {
    return <LoadingState />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={exam.routinePublished ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-700"}>
          {exam.routinePublished ? "Routine Published" : "Routine Draft"}
        </Badge>
        {isAdmin && !readOnly ? (
          <div className="ml-auto flex flex-wrap gap-2">
            {exam.routinePublished ? (
              <Button size="sm" variant="outline" onClick={() => void unpublishMutation.mutateAsync()} disabled={unpublishMutation.isPending}>
                Unpublish Routine
              </Button>
            ) : (
              <Button size="sm" onClick={() => void publishMutation.mutateAsync()} disabled={publishMutation.isPending || routines.length === 0}>
                Publish Routine
              </Button>
            )}
          </div>
        ) : null}
      </div>

      {routines.length === 0 ? (
        <EmptyState
          title="No routine entries"
          description={isAdmin ? "Add subject-wise exam schedules below." : "The exam routine will appear here once published."}
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <Table>
            <TableHead>
              <tr>
                <Th>Subject</Th>
                <Th>Date</Th>
                <Th>Day</Th>
                <Th>Time</Th>
                <Th>Duration</Th>
                <Th>Hall</Th>
                <Th>Invigilator</Th>
                {isAdmin && !readOnly ? <Th /> : null}
              </tr>
            </TableHead>
            <TableBody>
              {routines.map((routine) => (
                <tr key={routine._id}>
                  <Td>
                    <div className="font-medium">{routine.subjectName ?? "Subject"}</div>
                    {routine.subjectCode ? <div className="text-xs text-slate-500">{routine.subjectCode}</div> : null}
                  </Td>
                  <Td>{routine.examDateBs}</Td>
                  <Td>{routine.day}</Td>
                  <Td>
                    {routine.startTime} – {routine.endTime}
                  </Td>
                  <Td>{routine.durationMinutes} min</Td>
                  <Td>{routine.examHall || "—"}</Td>
                  <Td>{routine.invigilator || "—"}</Td>
                  {isAdmin && !readOnly ? (
                    <Td>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingRoutineId(routine._id);
                            setRoutineForm({
                              subjectId: routine.subjectId,
                              examDateBs: routine.examDateBs,
                              day: routine.day,
                              startTime: routine.startTime,
                              endTime: routine.endTime,
                              durationMinutes: routine.durationMinutes,
                              examHall: routine.examHall ?? "",
                              invigilator: routine.invigilator ?? "",
                              remarks: routine.remarks ?? ""
                            });
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={deleteMutation.isPending}
                          onClick={() => {
                            const subjectLabel = routine.subjectName ?? "this subject";
                            if (window.confirm(`Delete the exam routine for ${subjectLabel}?`)) {
                              void deleteMutation.mutateAsync(routine._id);
                            }
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </Td>
                  ) : null}
                </tr>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {isAdmin && !readOnly ? (
        <Card>
          <CardHeader>
            <CardTitle>{editingRoutineId ? "Edit Routine Entry" : "Add Routine Entry"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                const parsed = examRoutineSchema.safeParse(routineForm);
                if (!parsed.success) {
                  toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
                  return;
                }
                if (editingRoutineId) {
                  void updateMutation.mutateAsync({ routineId: editingRoutineId, payload: parsed.data });
                } else {
                  void createMutation.mutateAsync(parsed.data);
                }
              }}
            >
              <FormField label="Subject">
                <Select
                  value={routineForm.subjectId}
                  onChange={(event) => setRoutineForm((current) => ({ ...current, subjectId: event.target.value }))}
                  disabled={Boolean(editingRoutineId)}
                >
                  <option value="">Select subject</option>
                  {(editingRoutineId ? examSubjects : availableSubjects).map((subject) => (
                    <option key={subject._id} value={subject._id}>
                      {subject.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Exam Date (BS)">
                <NepaliDateField value={routineForm.examDateBs} onChange={(value) => setRoutineForm((current) => ({ ...current, examDateBs: value }))} />
              </FormField>
              <FormField label="Day">
                <Select value={routineForm.day} onChange={(event) => setRoutineForm((current) => ({ ...current, day: event.target.value }))}>
                  <option value="">Select day</option>
                  {DAYS_OF_WEEK.map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Duration (minutes)">
                <Input
                  type="number"
                  min={1}
                  value={routineForm.durationMinutes}
                  onChange={(event) => setRoutineForm((current) => ({ ...current, durationMinutes: event.target.valueAsNumber }))}
                />
              </FormField>
              <FormField label="Start Time">
                <Input type="time" value={routineForm.startTime} onChange={(event) => setRoutineForm((current) => ({ ...current, startTime: event.target.value }))} />
              </FormField>
              <FormField label="End Time">
                <Input type="time" value={routineForm.endTime} onChange={(event) => setRoutineForm((current) => ({ ...current, endTime: event.target.value }))} />
              </FormField>
              <FormField label="Exam Hall (optional)">
                <Input value={routineForm.examHall ?? ""} onChange={(event) => setRoutineForm((current) => ({ ...current, examHall: event.target.value }))} />
              </FormField>
              <FormField label="Invigilator (optional)">
                <Input value={routineForm.invigilator ?? ""} onChange={(event) => setRoutineForm((current) => ({ ...current, invigilator: event.target.value }))} />
              </FormField>
              <div className="md:col-span-2">
                <FormField label="Remarks (optional)">
                  <Textarea value={routineForm.remarks ?? ""} onChange={(event) => setRoutineForm((current) => ({ ...current, remarks: event.target.value }))} />
                </FormField>
              </div>
              <div className="md:col-span-2 flex justify-end gap-2">
                {editingRoutineId ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditingRoutineId(null);
                      setRoutineForm(defaultRoutineValue);
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {editingRoutineId ? "Update Routine" : "Add Routine"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};

interface TeacherRoutineListProps {
  examId?: string;
}

export const TeacherRoutineList = ({ examId }: TeacherRoutineListProps) => {
  const routinesQuery = useQuery({
    queryKey: ["exam-routines", "teacher", examId],
    queryFn: () => unwrap<EnrichedRoutine[]>(api.get("/exams/routines", { params: { examId: examId || undefined } })),
    enabled: Boolean(examId)
  });

  if (!examId) {
    return <EmptyState title="Select an exam" description="Choose an exam to view your assigned subject routines." />;
  }

  if (routinesQuery.isLoading) {
    return <LoadingState />;
  }

  const routines = routinesQuery.data ?? [];
  if (routines.length === 0) {
    return <EmptyState title="No routines" description="Exam routines for your subjects will appear here once published." />;
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200">
      <Table>
        <TableHead>
          <tr>
            <Th>Subject</Th>
            <Th>Date</Th>
            <Th>Day</Th>
            <Th>Time</Th>
            <Th>Duration</Th>
            <Th>Hall</Th>
          </tr>
        </TableHead>
        <TableBody>
          {routines.map((routine) => (
            <tr key={routine._id}>
              <Td>{routine.subjectName ?? "Subject"}</Td>
              <Td>{routine.examDateBs}</Td>
              <Td>{routine.day}</Td>
              <Td>
                {routine.startTime} – {routine.endTime}
              </Td>
              <Td>{routine.durationMinutes} min</Td>
              <Td>{routine.examHall || "—"}</Td>
            </tr>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};