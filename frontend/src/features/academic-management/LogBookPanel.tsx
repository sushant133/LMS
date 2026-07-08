import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type AcademicLogBookEntryInput,
  type AcademicLogBookEntryRecord,
  type TodayTimetableSlot,
  canManageInstitution
} from "@phit-erp/shared";
import { CalendarPlus, CheckCircle2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, TableHead, Td, Th } from "components/ui/table";
import { Textarea } from "components/ui/textarea";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { useAuth } from "features/auth/AuthProvider";
import { api, unwrap } from "lib/api";
import { parseErrorMessage } from "lib/utils";
import { filtersToParams, statusBadgeClass } from "./academicManagementUtils";
import type { AcademicManagementFilters } from "@phit-erp/shared";
import { AcademicAttachmentUpload } from "./AcademicAttachmentUpload";
import { AcademicCommentsPanel } from "./AcademicCommentsPanel";

interface LogBookPanelProps {
  filters: AcademicManagementFilters;
  teacherId?: string;
  isTeacher: boolean;
}

export const LogBookPanel = ({ filters, teacherId, isTeacher }: LogBookPanelProps) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = canManageInstitution(user?.role ?? "");
  const [showForm, setShowForm] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<TodayTimetableSlot | null>(null);
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
    dateBs: filters.dateFrom || "",
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
    attachmentUrl: ""
  });

  const entriesQuery = useQuery({
    queryKey: ["academic-management", "log-book", filters],
    queryFn: () =>
      unwrap<AcademicLogBookEntryRecord[]>(api.get("/academic-management/log-book-entries", { params: filtersToParams(filters) }))
  });

  const timetableQuery = useQuery({
    queryKey: ["academic-management", "timetable-today", form.dateBs],
    queryFn: () =>
      unwrap<TodayTimetableSlot[]>(
        api.get("/academic-management/timetable/today", { params: { dateBs: form.dateBs || new Date().toISOString().slice(0, 10) } })
      ),
    enabled: isTeacher && showForm
  });

  const createMutation = useMutation({
    mutationFn: (payload: AcademicLogBookEntryInput) => unwrap(api.post("/academic-management/log-book-entries", payload)),
    onSuccess: () => {
      toast.success("Log book entry created");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
      setShowForm(false);
      setSelectedSlot(null);
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, reviewStatus }: { id: string; reviewStatus: "REVIEWED" | "APPROVED" | "NEEDS_IMPROVEMENT" }) =>
      unwrap(api.post(`/academic-management/log-book-entries/${id}/review`, { reviewStatus })),
    onSuccess: () => {
      toast.success("Log book entry reviewed");
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const applyTimetableSlot = async (slot: TodayTimetableSlot) => {
    setSelectedSlot(slot);
    const attendance = await unwrap<{ present: number; absent: number; percent: number; marked: boolean }>(
      api.get("/academic-management/attendance/summary", {
        params: {
          subjectId: slot.subjectId,
          teacherId: teacherId || form.teacherId,
          dateBs: form.dateBs,
          classId: slot.classId,
          sectionId: slot.sectionId,
          batchId: slot.batchId,
          yearId: slot.yearId
        }
      })
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
      topicCovered: current.topicCovered || slot.subjectName
    }));

    if (attendance.marked) {
      toast.message(`Attendance loaded: ${attendance.present} present, ${attendance.absent} absent (${attendance.percent}%)`);
    }
  };

  const filteredEntries = useMemo(() => {
    const keyword = filters.keyword?.toLowerCase().trim();
    if (!keyword) return entriesQuery.data ?? [];
    return (entriesQuery.data ?? []).filter((entry) =>
      [entry.topicCovered, entry.unit, entry.subject?.name, entry.teacher?.user?.fullName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword))
    );
  }, [entriesQuery.data, filters.keyword]);

  if (entriesQuery.isLoading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Log Book</h2>
          <p className="text-sm text-slate-600">Daily teaching diary with timetable and attendance integration.</p>
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
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <span className="text-sm font-medium text-slate-700">Date</span>
                <NepaliDateField value={form.dateBs} onChange={(value) => setForm((current) => ({ ...current, dateBs: value }))} placeholder="Select date" />
              </div>
              <Input
                type="number"
                value={form.periodNumber}
                onChange={(event) => setForm((current) => ({ ...current, periodNumber: Number(event.target.value) }))}
                placeholder="Period"
              />
              <Select
                value={form.theoryPractical}
                onChange={(event) => setForm((current) => ({ ...current, theoryPractical: event.target.value as AcademicLogBookEntryInput["theoryPractical"] }))}
              >
                <option value="THEORY">Theory</option>
                <option value="PRACTICAL">Practical</option>
                <option value="BOTH">Both</option>
              </Select>
            </div>

            {isTeacher && (timetableQuery.data?.length ?? 0) > 0 ? (
              <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
                <p className="mb-2 text-sm font-medium text-brand-900">Today's Timetable</p>
                <div className="flex flex-wrap gap-2">
                  {timetableQuery.data?.map((slot) => (
                    <Button
                      key={slot._id}
                      size="sm"
                      variant={selectedSlot?._id === slot._id ? "default" : "outline"}
                      onClick={() => void applyTimetableSlot(slot)}
                    >
                      P{slot.periodNumber} · {slot.subjectName}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2">
              <Input value={form.unit} onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value }))} placeholder="Unit" />
              <Input
                value={form.topicCovered}
                onChange={(event) => setForm((current) => ({ ...current, topicCovered: event.target.value }))}
                placeholder="Topic Covered"
              />
              <Textarea value={form.objectives} onChange={(event) => setForm((current) => ({ ...current, objectives: event.target.value }))} placeholder="Objectives" />
              <Textarea
                value={form.nextClassPlan}
                onChange={(event) => setForm((current) => ({ ...current, nextClassPlan: event.target.value }))}
                placeholder="Next Class Plan"
              />
            </div>
            <AcademicAttachmentUpload
              attachmentUrl={form.attachmentUrl}
              onChange={(url) => setForm((current) => ({ ...current, attachmentUrl: url }))}
            />
            <Button
              onClick={() =>
                createMutation.mutate({
                  ...form,
                  teacherId: teacherId || form.teacherId
                })
              }
              disabled={!form.dateBs || !form.topicCovered}
            >
              Save Entry
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {filteredEntries.length === 0 ? (
        <EmptyState title="No log book entries found" description="Record today's class from your timetable to start the digital log book." />
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
                      {entry.attendancePercent}% ({entry.attendancePresent}/{entry.attendancePresent + entry.attendanceAbsent})
                    </Td>
                    <Td>
                      <Badge className={statusBadgeClass(entry.reviewStatus)}>{entry.reviewStatus}</Badge>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="outline" onClick={() => setSelectedEntryId(entry._id)}>
                          Notes
                        </Button>
                        {isAdmin ? (
                          <>
                            <Button size="sm" variant="outline" onClick={() => reviewMutation.mutate({ id: entry._id, reviewStatus: "APPROVED" })}>
                              <CheckCircle2 className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => reviewMutation.mutate({ id: entry._id, reviewStatus: "NEEDS_IMPROVEMENT" })}>
                              Review
                            </Button>
                          </>
                        ) : (
                          <span className="text-xs text-slate-500">{entry.teacherSignature || "—"}</span>
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
          <AcademicCommentsPanel entityType="LOG_BOOK_ENTRY" entityId={selectedEntryId} canComment={isAdmin || isTeacher} />
        ) : null}
        </div>
      )}
    </div>
  );
};