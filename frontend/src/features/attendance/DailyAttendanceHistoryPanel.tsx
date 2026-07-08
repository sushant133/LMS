import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  type DailyAttendanceLogRecord,
  type DailyAttendanceRecord,
  type DailyAttendanceStatus,
  type DailyAttendanceUpdateInput
} from "@phit-erp/shared";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
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

const statuses: DailyAttendanceStatus[] = ["PRESENT", "ABSENT", "LATE", "LEAVE", "MEDICAL_LEAVE"];

interface EnrichedEntry {
  studentId: string;
  status: DailyAttendanceStatus;
  remarks?: string;
  student?: {
    fullName: string;
    rollNumber: number;
    admissionNumber: string;
    photoUrl?: string;
  };
}

interface EnrichedRecord extends DailyAttendanceRecord {
  groupLabel?: string;
  teacherName?: string;
  summary?: {
    present: number;
    absent: number;
    late: number;
    leave: number;
    medicalLeave: number;
    total: number;
  };
  entries: EnrichedEntry[];
}

interface DailyAttendanceHistoryPanelProps {
  records: DailyAttendanceRecord[];
  hasInstitutionRead: boolean;
  canWriteAdmin: boolean;
  isSuperAdmin: boolean;
  isLoading: boolean;
}

export const DailyAttendanceHistoryPanel = ({
  records,
  hasInstitutionRead,
  canWriteAdmin,
  isSuperAdmin,
  isLoading
}: DailyAttendanceHistoryPanelProps) => {
  const [selectedId, setSelectedId] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [statusMap, setStatusMap] = useState<Record<string, DailyAttendanceStatus>>({});
  const [remarksMap, setRemarksMap] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [assignedTeacherId, setAssignedTeacherId] = useState("");
  const [reassignReason, setReassignReason] = useState("");

  const teachersQuery = useQuery({
    queryKey: ["teachers"],
    queryFn: () => unwrap<Array<{ _id: string; user: { fullName: string } }>>(api.get("/teachers")),
    enabled: canWriteAdmin
  });

  const detailQuery = useQuery({
    queryKey: ["daily-attendance-detail", selectedId],
    queryFn: () => unwrap<EnrichedRecord>(api.get(`/daily-attendance/${selectedId}`)),
    enabled: Boolean(selectedId)
  });

  const logsQuery = useQuery({
    queryKey: ["daily-attendance-logs", selectedId],
    queryFn: () => unwrap<DailyAttendanceLogRecord[]>(api.get(`/daily-attendance/${selectedId}/logs`)),
    enabled: Boolean(selectedId) && showLogs && hasInstitutionRead
  });

  const unlockMutation = useMutation({
    mutationFn: async (reason: string) =>
      unwrap<DailyAttendanceRecord>(api.post(`/daily-attendance/${selectedId}/unlock`, { reason })),
    onSuccess: async () => {
      toast.success("Attendance unlocked");
      await queryClient.invalidateQueries({ queryKey: ["daily-attendance"] });
      await queryClient.invalidateQueries({ queryKey: ["daily-attendance-detail"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: DailyAttendanceUpdateInput) =>
      unwrap<DailyAttendanceRecord>(api.put(`/daily-attendance/${selectedId}`, payload)),
    onSuccess: async () => {
      toast.success("Attendance updated and re-synchronized");
      setIsEditing(false);
      await queryClient.invalidateQueries({ queryKey: ["daily-attendance"] });
      await queryClient.invalidateQueries({ queryKey: ["daily-attendance-detail"] });
      await queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const deleteMutation = useMutation({
    mutationFn: async () => unwrap<null>(api.delete(`/daily-attendance/${selectedId}`)),
    onSuccess: async () => {
      toast.success("Attendance record deleted");
      setSelectedId("");
      setIsEditing(false);
      setShowLogs(false);
      await queryClient.invalidateQueries({ queryKey: ["daily-attendance"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const selectedRecord = detailQuery.data;

  const beginEdit = () => {
    if (!selectedRecord) return;
    setAssignedTeacherId(selectedRecord.teacherId);
    setReassignReason("");
    setStatusMap(
      selectedRecord.entries.reduce<Record<string, DailyAttendanceStatus>>((acc, entry) => {
        acc[String(entry.studentId)] = entry.status;
        return acc;
      }, {})
    );
    setRemarksMap(
      selectedRecord.entries.reduce<Record<string, string>>((acc, entry) => {
        if (entry.remarks) acc[String(entry.studentId)] = entry.remarks;
        return acc;
      }, {})
    );
    setNotes(selectedRecord.notes ?? "");
    setIsEditing(true);
  };

  const handleUnlock = () => {
    const reason = window.prompt("Enter unlock reason:");
    if (!reason || reason.trim().length < 3) {
      toast.error("Unlock reason must be at least 3 characters.");
      return;
    }
    void unlockMutation.mutateAsync(reason.trim());
  };

  const handleSaveEdit = async () => {
    if (!selectedRecord) return;
    const teacherChanged = assignedTeacherId && assignedTeacherId !== selectedRecord.teacherId;
    if (teacherChanged && reassignReason.trim().length < 3) {
      toast.error("Enter a reason when reassigning the teacher (min 3 characters).");
      return;
    }

    await updateMutation.mutateAsync({
      ...(selectedRecord.batchId
        ? { batchId: selectedRecord.batchId, yearId: selectedRecord.yearId }
        : { classId: selectedRecord.classId, sectionId: selectedRecord.sectionId }),
      dateBs: selectedRecord.dateBs,
      notes,
      ...(teacherChanged
        ? { teacherId: assignedTeacherId, teacherReassignReason: reassignReason.trim() }
        : {}),
      entries: selectedRecord.entries.map((entry) => ({
        studentId: entry.studentId,
        status: statusMap[entry.studentId]!,
        remarks: remarksMap[entry.studentId]
      }))
    });
  };

  const statusBadge = useMemo(() => {
    if (!selectedRecord) return null;
    if (selectedRecord.status === "LOCKED") return <Badge className="bg-slate-100 text-slate-700">Locked</Badge>;
    return <Badge className="bg-amber-100 text-amber-800">Unlocked</Badge>;
  }, [selectedRecord]);

  return (
    <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <Card>
        <CardHeader>
          <CardTitle>Attendance History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <LoadingState />
          ) : records.length === 0 ? (
            <EmptyState title="No attendance history" description="Submitted records will appear here." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Class</Th>
                    <Th>Status</Th>
                    <Th>Students</Th>
                    <Th>Actions</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {records.map((record) => (
                    <tr key={record._id} className={selectedId === record._id ? "bg-brand-50" : undefined}>
                      <Td>{record.dateBs}</Td>
                      <Td>{record.batchId ? "College group" : "School group"}</Td>
                      <Td>
                        <Badge className="bg-slate-100 text-slate-700">{record.status}</Badge>
                      </Td>
                      <Td>{record.entries.length}</Td>
                      <Td>
                        <Button size="sm" variant="outline" onClick={() => setSelectedId(record._id)}>
                          View
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

      <Card>
        <CardHeader>
          <CardTitle>Record Details</CardTitle>
        </CardHeader>
        <CardContent>
          {!selectedId ? (
            <EmptyState title="Select a record" description="Choose an attendance record from the history table." />
          ) : detailQuery.isLoading ? (
            <LoadingState />
          ) : !selectedRecord ? (
            <EmptyState title="Record not found" description="This attendance record may have been deleted." />
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-slate-900">{selectedRecord.groupLabel}</p>
                  {statusBadge}
                </div>
                <p className="mt-2 text-slate-600">Date: {selectedRecord.dateBs}</p>
                <p className="text-slate-600">Teacher: {selectedRecord.teacherName}</p>
                <p className="text-slate-600">
                  Summary: {selectedRecord.summary?.present ?? 0} present, {selectedRecord.summary?.absent ?? 0} absent
                </p>
                {selectedRecord.syncedAttendanceId ? (
                  <p className="mt-2 text-sky-700">Synchronized with first-period subject attendance.</p>
                ) : null}
              </div>

              {hasInstitutionRead || canWriteAdmin ? (
                <div className="flex flex-wrap gap-2">
                  {canWriteAdmin ? (
                    <>
                      <Button size="sm" variant="outline" onClick={beginEdit} disabled={isEditing}>
                        {selectedRecord.status === "LOCKED" ? "Edit Locked Record" : "Edit"}
                      </Button>
                      {selectedRecord.status === "LOCKED" ? (
                        <Button size="sm" variant="outline" disabled={unlockMutation.isPending} onClick={handleUnlock}>
                          Unlock for Teacher
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                  {hasInstitutionRead ? (
                    <Button size="sm" variant="outline" onClick={() => setShowLogs((current) => !current)}>
                      {showLogs ? "Hide Logs" : "View Logs"}
                    </Button>
                  ) : null}
                  {isSuperAdmin ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        if (window.confirm("Delete this attendance record permanently?")) {
                          void deleteMutation.mutateAsync();
                        }
                      }}
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {showLogs && hasInstitutionRead ? (
                logsQuery.isLoading ? (
                  <LoadingState />
                ) : (
                  <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 p-3 text-sm">
                    {(logsQuery.data ?? []).length === 0 ? (
                      <p className="text-slate-500">No audit logs yet.</p>
                    ) : (
                      <ul className="space-y-2">
                        {(logsQuery.data ?? []).map((log) => (
                          <li key={log._id} className="border-b border-slate-100 pb-2 last:border-0">
                            <span className="font-medium">{log.action}</span> by {log.actorRole}
                            {log.synchronizationStatus ? ` · ${log.synchronizationStatus}` : ""}
                            {log.createdAt ? <span className="text-slate-500"> · {log.createdAt}</span> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              ) : null}

              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <tr>
                      <Th>Student</Th>
                      <Th>Roll</Th>
                      <Th>Status</Th>
                      <Th>Remarks</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {selectedRecord.entries.map((entry) => (
                      <tr key={entry.studentId}>
                        <Td>{entry.student?.fullName ?? entry.studentId}</Td>
                        <Td>{entry.student?.rollNumber ?? "—"}</Td>
                        <Td>
                          {isEditing ? (
                            <Select
                              value={statusMap[entry.studentId] ?? entry.status}
                              onChange={(event) =>
                                setStatusMap((current) => ({
                                  ...current,
                                  [entry.studentId]: event.target.value as DailyAttendanceStatus
                                }))
                              }
                            >
                              {statuses.map((status) => (
                                <option key={status} value={status}>
                                  {status.replace("_", " ")}
                                </option>
                              ))}
                            </Select>
                          ) : (
                            entry.status.replace("_", " ")
                          )}
                        </Td>
                        <Td>
                          {isEditing ? (
                            <Input
                              value={remarksMap[entry.studentId] ?? ""}
                              onChange={(event) =>
                                setRemarksMap((current) => ({
                                  ...current,
                                  [entry.studentId]: event.target.value
                                }))
                              }
                            />
                          ) : (
                            entry.remarks ?? "—"
                          )}
                        </Td>
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {isEditing ? (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">Assigned Teacher</label>
                      <Select value={assignedTeacherId} onChange={(event) => setAssignedTeacherId(event.target.value)}>
                        <option value="">Select teacher</option>
                        {(teachersQuery.data ?? []).map((teacher) => (
                          <option key={teacher._id} value={teacher._id}>
                            {teacher.user.fullName}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">Reassign Reason</label>
                      <Input
                        value={reassignReason}
                        onChange={(event) => setReassignReason(event.target.value)}
                        placeholder="Required if changing teacher"
                      />
                    </div>
                  </div>
                  <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Class notes" />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setIsEditing(false)}>
                      Cancel
                    </Button>
                    <Button disabled={updateMutation.isPending} onClick={() => void handleSaveEdit()}>
                      Save Changes
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};