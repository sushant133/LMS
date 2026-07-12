import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { StudentSubjectDetail } from "@phit-erp/shared";
import { BookOpen, ChevronLeft, ExternalLink } from "lucide-react";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { AttachmentViewer } from "components/shared/AttachmentViewer";
import type { AssignmentAttachment } from "@phit-erp/shared";
import { PageContent } from "components/layout/PageContent";
import { FieldDutyPortalPanel } from "features/attendance/FieldDutyPortalPanel";
import { PostDetailPanel } from "features/homework/PostDetailPanel";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";

interface EnrolledSubject {
  _id: string;
  name: string;
  code: string;
  fullMarks: number;
  passMarks: number;
}

export const StudentSubjects = () => {
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(
    null,
  );
  const [openAssignmentId, setOpenAssignmentId] = useState<string | null>(null);

  const subjectsQuery = useQuery({
    queryKey: ["student-subjects"],
    queryFn: () => unwrap<EnrolledSubject[]>(api.get("/student/subjects")),
  });

  const detailQuery = useQuery({
    queryKey: ["student-subject-detail", selectedSubjectId],
    queryFn: () =>
      unwrap<StudentSubjectDetail & { studentId?: string }>(
        api.get(`/student/subjects/${selectedSubjectId}`),
      ),
    enabled: Boolean(selectedSubjectId),
  });

  const profileQuery = useQuery({
    queryKey: ["student-my-profile"],
    queryFn: () =>
      unwrap<{ studentId: string }>(api.get("/student/profile")),
    staleTime: 5 * 60 * 1000,
  });

  const resolvedStudentId =
    profileQuery.data?.studentId ?? detailQuery.data?.studentId;

  if (subjectsQuery.isLoading) {
    return <LoadingState />;
  }

  if (selectedSubjectId && detailQuery.isLoading) {
    return <LoadingState />;
  }

  if (selectedSubjectId && detailQuery.data) {
    const detail = detailQuery.data;
    const subject = detail.subject as EnrolledSubject;

    return (
      <PageContent className="space-y-6">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start">
          <Button
            className="shrink-0 self-start"
            variant="outline"
            size="sm"
            onClick={() => setSelectedSubjectId(null)}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            All subjects
          </Button>
          <PageHeader
            title={subject.name}
            description={`Subject code: ${subject.code} — attendance, marks, and assignments from your teachers. Open an assignment to view details or submit work.`}
          />
        </div>

        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Attendance</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.attendance.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No attendance records yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHead>
                      <tr>
                        <Th>Date (BS)</Th>
                        <Th>Status</Th>
                      </tr>
                    </TableHead>
                    <TableBody>
                      {detail.attendance.map((row) => (
                        <tr key={row.dateBs}>
                          <Td>{row.dateBs}</Td>
                          <Td>
                            <Badge>{row.status}</Badge>
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
              <CardTitle className="text-base">Marks & Grades</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.marks.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No published marks yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {detail.marks.map((mark, index) => (
                    <div
                      key={`${mark.examId}-${index}`}
                      className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm"
                    >
                      <p className="font-medium">
                        Obtained: {mark.obtainedMarks}
                      </p>
                      <p className="text-slate-600">
                        Grade {mark.grade} · GPA {mark.gpa} · {mark.percentage}%
                      </p>
                      {mark.publishedAtBs ? (
                        <p className="text-xs text-slate-500">
                          Published: {mark.publishedAtBs}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Assignments & CAS</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {detail.assignments.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No assignments published.
                </p>
              ) : (
                detail.assignments.map((item) => (
                  <button
                    key={item._id}
                    type="button"
                    onClick={() => setOpenAssignmentId(item._id)}
                    className="w-full rounded-xl border border-slate-100 p-3 text-left transition hover:border-brand-200 hover:bg-brand-50/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-slate-900">{item.title}</p>
                      <div className="flex items-center gap-2">
                        <Badge>{item.type}</Badge>
                        <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                      </div>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                      {item.description}
                    </p>
                    {item.dueDateBs ? (
                      <p className="mt-1 text-xs text-slate-500">
                        Due: {item.dueDateBs}
                      </p>
                    ) : null}
                    {(item.attachments?.length ?? 0) > 0 ? (
                      <div
                        className="mt-3"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <AttachmentViewer
                          attachments={
                            item.attachments as AssignmentAttachment[]
                          }
                          title="Attachments"
                        />
                      </div>
                    ) : null}
                    <p className="mt-2 text-xs font-medium text-brand-700">
                      Open to view details or turn in work
                    </p>
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Class Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {detail.notes.length === 0 ? (
                <p className="text-sm text-slate-500">No notes shared yet.</p>
              ) : (
                detail.notes.map((note) => (
                  <button
                    key={note._id}
                    type="button"
                    onClick={() => setOpenAssignmentId(note._id)}
                    className="w-full rounded-xl border border-slate-100 p-3 text-left transition hover:border-brand-200 hover:bg-brand-50/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-slate-900">{note.title}</p>
                      <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                      {note.description}
                    </p>
                    {(note.attachments?.length ?? 0) > 0 ? (
                      <div
                        className="mt-3"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <AttachmentViewer
                          attachments={
                            note.attachments as AssignmentAttachment[]
                          }
                          title="Attachments"
                        />
                      </div>
                    ) : null}
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Announcements</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {detail.notices.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No announcements for this subject.
                </p>
              ) : (
                detail.notices.map((notice) => (
                  <div
                    key={notice._id}
                    className="rounded-xl border border-brand-100 bg-brand-50/40 p-3"
                  >
                    <p className="font-medium text-brand-950">{notice.title}</p>
                    <p className="mt-1 text-sm text-slate-700">
                      {notice.content}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {notice.publishDateBs}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {openAssignmentId ? (
          <PostDetailPanel
            postId={openAssignmentId}
            canManage={false}
            studentId={resolvedStudentId}
            onClose={() => setOpenAssignmentId(null)}
            onEdit={() => undefined}
            onDeleted={async () => {
              setOpenAssignmentId(null);
              await queryClient.invalidateQueries({
                queryKey: ["student-subject-detail", selectedSubjectId],
              });
              await queryClient.invalidateQueries({
                queryKey: ["homework-feed"],
              });
            }}
          />
        ) : null}
      </PageContent>
    );
  }

  const subjects = subjectsQuery.data ?? [];

  return (
    <PageContent className="space-y-6">
      <PageHeader
        title="My Subjects"
        description="View all subjects you are enrolled in. Open a subject to see attendance, marks, assignments, notes, and announcements."
      />

      <FieldDutyPortalPanel title="Field / Hospital Duty Attendance" />

      {subjects.length === 0 ? (
        <EmptyState
          title="No subjects enrolled"
          description="Subjects are assigned based on your year. Contact your college admin if this looks wrong."
        />
      ) : (
        <div className="grid min-w-0 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {subjects.map((subject) => (
            <Card
              key={subject._id}
              className="min-w-0 cursor-pointer transition hover:border-brand-200 hover:shadow-md"
              onClick={() => setSelectedSubjectId(subject._id)}
            >
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{subject.name}</CardTitle>
                  <p className="text-sm text-slate-500">{subject.code}</p>
                </div>
                <div className="rounded-xl bg-brand-50 p-2">
                  <BookOpen className="h-5 w-5 text-brand-600" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-600">
                  Full marks: {subject.fullMarks} · Pass: {subject.passMarks}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => setSelectedSubjectId(subject._id)}
                >
                  View details
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageContent>
  );
};
