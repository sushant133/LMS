import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { noticeSchema, USER_ROLES, type NoticeInput, type NoticeRecord } from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { useAuth } from "features/auth/AuthProvider";
import { useTeacherScope } from "hooks/useTeacherScope";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { PageContent } from "components/layout/PageContent";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { Textarea } from "components/ui/textarea";
import { StudentNoticeBoard, type EnrichedNoticeRecord } from "features/notices/StudentNoticeBoard";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import {
  filterSectionsByClass,
  filterSubjectsByClass,
  hasSingleOption
} from "lib/teacherScopeUtils";
import { parseErrorMessage } from "lib/utils";

const adminDefaultNoticeValue: NoticeInput = {
  title: "",
  content: "",
  visibleTo: ["COLLEGE_ADMIN", "TEACHER", "STUDENT", "PARENT"],
  publishDateBs: "",
  expiresAtBs: ""
};

const teacherDefaultNoticeValue: NoticeInput = {
  title: "",
  content: "",
  visibleTo: ["STUDENT"],
  publishDateBs: "",
  expiresAtBs: ""
};

interface NoticeManagerProps {
  embedded?: boolean;
}

export const NoticeManager = ({ embedded = false }: NoticeManagerProps) => {
  const { user } = useAuth();
  const isTeacher = user?.role === "TEACHER";
  const teacherScopeQuery = useTeacherScope(isTeacher);
  const [form, setForm] = useState<NoticeInput>(adminDefaultNoticeValue);
  const [editingId, setEditingId] = useState<string | null>(null);
  const canManageNotices = user?.role === "SUPER_ADMIN" || user?.role === "COLLEGE_ADMIN" || isTeacher;
  const isReadOnlyViewer = user?.role === "STUDENT" || user?.role === "PARENT";

  useEffect(() => {
    if (isTeacher) {
      setForm((current) => ({ ...current, visibleTo: ["STUDENT"] }));
    }
  }, [isTeacher]);

  useEffect(() => {
    if (!isTeacher || !teacherScopeQuery.data) {
      return;
    }

    const { classes: scopedClasses, sections: scopedSectionsList, subjects: scopedSubjectsList } = teacherScopeQuery.data;

    setForm((current) => {
      const next = { ...current };
      if (hasSingleOption(scopedClasses)) {
        next.classId = scopedClasses[0]!._id;
      }
      const classSections = filterSectionsByClass(scopedSectionsList, next.classId ?? "");
      if (hasSingleOption(classSections)) {
        next.sectionId = classSections[0]!._id;
      }
      const classSubjects = filterSubjectsByClass(scopedSubjectsList, next.classId ?? "");
      if (hasSingleOption(classSubjects)) {
        next.subjectId = classSubjects[0]!._id;
      }
      return next;
    });
  }, [isTeacher, teacherScopeQuery.data]);

  const noticesQuery = useQuery({
    queryKey: ["notices"],
    queryFn: () => unwrap<NoticeRecord[]>(api.get("/notices"))
  });

  const noticeMutation = useMutation({
    mutationFn: async (payload: NoticeInput) =>
      editingId ? unwrap<NoticeRecord>(api.put(`/notices/${editingId}`, payload)) : unwrap<NoticeRecord>(api.post("/notices", payload)),
    onSuccess: async () => {
      toast.success(editingId ? "Notice updated" : "Notice published");
      setForm(isTeacher ? teacherDefaultNoticeValue : adminDefaultNoticeValue);
      setEditingId(null);
      await queryClient.invalidateQueries({ queryKey: ["notices"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/notices/${id}`);
    },
    onSuccess: async () => {
      toast.success("Notice deleted");
      setEditingId(null);
      setForm(isTeacher ? teacherDefaultNoticeValue : adminDefaultNoticeValue);
      await queryClient.invalidateQueries({ queryKey: ["notices"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const teacherClassMap = useMemo(
    () => new Map((teacherScopeQuery.data?.classes ?? []).map((item) => [item._id, item.name])),
    [teacherScopeQuery.data?.classes]
  );
  const teacherSectionMap = useMemo(
    () => new Map((teacherScopeQuery.data?.sections ?? []).map((item) => [item._id, item.name])),
    [teacherScopeQuery.data?.sections]
  );
  const teacherSubjectMap = useMemo(
    () => new Map((teacherScopeQuery.data?.subjects ?? []).map((item) => [item._id, item.name])),
    [teacherScopeQuery.data?.subjects]
  );

  const announcements = useMemo(() => {
    const notices = noticesQuery.data ?? [];
    if (!isTeacher) {
      return notices;
    }

    const teacherId = teacherScopeQuery.data?.scope.teacherId;
    return notices.filter((notice) => notice.teacherId === teacherId && notice.visibleTo.includes("STUDENT"));
  }, [isTeacher, noticesQuery.data, teacherScopeQuery.data?.scope.teacherId]);

  const formatTeacherAudience = (notice: NoticeRecord) => {
    const parts = ["Students"];
    if (notice.classId) {
      parts.push(teacherClassMap.get(notice.classId) ?? "Class");
    }
    if (notice.sectionId) {
      parts.push(teacherSectionMap.get(notice.sectionId) ?? "Section");
    }
    if (notice.subjectId) {
      parts.push(teacherSubjectMap.get(notice.subjectId) ?? "Subject");
    }
    return parts.join(" · ");
  };

  if (noticesQuery.isLoading) {
    return <EmptyState title="Loading notices" description="Please wait." />;
  }

  const content = (
    <>
      {!embedded ? (
        <PageHeader
          title="Notice Board"
          description={
            isReadOnlyViewer
              ? "Announcements for your class, subjects, and college."
              : isTeacher
                ? "Publish notices visible to your students in assigned classes and sections."
                : "Publish notices and control visibility by role."
          }
        />
      ) : null}

      {canManageNotices ? (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? "Edit Notice" : "Create Notice"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                const payload = isTeacher ? { ...form, visibleTo: ["STUDENT"] as NoticeInput["visibleTo"] } : form;
                const parsed = noticeSchema.safeParse(payload);
                if (!parsed.success) {
                  toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
                  return;
                }
                void noticeMutation.mutateAsync(parsed.data);
              }}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <FormField label="Title">
                  <Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
                </FormField>
                {isTeacher ? (
                  <FormField label="Visible To">
                    <Input value="Students" readOnly disabled />
                  </FormField>
                ) : (
                  <FormField label="Visible To">
                    <div className="grid grid-cols-2 gap-2">
                      {USER_ROLES.map((role) => (
                        <label key={role} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
                          <input
                            checked={form.visibleTo.includes(role)}
                            type="checkbox"
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                visibleTo: event.target.checked
                                  ? [...current.visibleTo, role]
                                  : current.visibleTo.filter((item) => item !== role)
                              }))
                            }
                          />
                          {role}
                        </label>
                      ))}
                    </div>
                  </FormField>
                )}
                <FormField label="Publish Date (BS)">
                  <NepaliDateField value={form.publishDateBs} onChange={(value) => setForm((current) => ({ ...current, publishDateBs: value }))} />
                </FormField>
                <FormField label="Expiry Date (BS)">
                  <NepaliDateField value={form.expiresAtBs ?? ""} onChange={(value) => setForm((current) => ({ ...current, expiresAtBs: value }))} />
                </FormField>
                {isTeacher ? (
                  <>
                    {(() => {
                      const scopedClasses = teacherScopeQuery.data?.classes ?? [];
                      const scopedSections = filterSectionsByClass(teacherScopeQuery.data?.sections ?? [], form.classId ?? "");
                      const scopedSubjects = filterSubjectsByClass(teacherScopeQuery.data?.subjects ?? [], form.classId ?? "");

                      return (
                        <>
                          {hasSingleOption(scopedClasses) ? (
                            <FormField label="Class">
                              <Input value={scopedClasses[0]!.name} readOnly disabled />
                            </FormField>
                          ) : (
                            <FormField label="Class (optional)">
                              <select
                                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                                value={form.classId ?? ""}
                                onChange={(event) =>
                                  setForm((current) => ({
                                    ...current,
                                    classId: event.target.value || undefined,
                                    sectionId: undefined,
                                    subjectId: undefined
                                  }))
                                }
                              >
                                <option value="">All assigned classes</option>
                                {scopedClasses.map((schoolClass) => (
                                  <option key={schoolClass._id} value={schoolClass._id}>
                                    {schoolClass.name}
                                  </option>
                                ))}
                              </select>
                            </FormField>
                          )}
                          {hasSingleOption(scopedSections) ? (
                            <FormField label="Section">
                              <Input value={scopedSections[0]!.name} readOnly disabled />
                            </FormField>
                          ) : (
                            <FormField label="Section (optional)">
                              <select
                                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                                value={form.sectionId ?? ""}
                                onChange={(event) =>
                                  setForm((current) => ({ ...current, sectionId: event.target.value || undefined }))
                                }
                                disabled={!form.classId}
                              >
                                <option value="">All assigned sections</option>
                                {scopedSections.map((section) => (
                                  <option key={section._id} value={section._id}>
                                    {section.name}
                                  </option>
                                ))}
                              </select>
                            </FormField>
                          )}
                          {hasSingleOption(scopedSubjects) ? (
                            <FormField label="Subject">
                              <Input value={scopedSubjects[0]!.name} readOnly disabled />
                            </FormField>
                          ) : (
                            <FormField label="Subject (optional)">
                              <select
                                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                                value={form.subjectId ?? ""}
                                onChange={(event) =>
                                  setForm((current) => ({ ...current, subjectId: event.target.value || undefined }))
                                }
                                disabled={!form.classId}
                              >
                                <option value="">College-wide notice</option>
                                {scopedSubjects.map((subject) => (
                                  <option key={subject._id} value={subject._id}>
                                    {subject.name}
                                  </option>
                                ))}
                              </select>
                            </FormField>
                          )}
                        </>
                      );
                    })()}
                  </>
                ) : null}
              </div>
              <FormField label="Content">
                <Textarea value={form.content} onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))} />
              </FormField>
              <div className="flex justify-end gap-2">
                {editingId ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditingId(null);
                      setForm(isTeacher ? teacherDefaultNoticeValue : adminDefaultNoticeValue);
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
                <Button type="submit">{editingId ? "Update Notice" : "Publish Notice"}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{isTeacher ? "My Student Announcements" : "Announcements"}</CardTitle>
        </CardHeader>
        <CardContent>
          {isReadOnlyViewer ? (
            <StudentNoticeBoard notices={(noticesQuery.data ?? []) as EnrichedNoticeRecord[]} />
          ) : announcements.length === 0 ? (
            <EmptyState
              title="No notices yet"
              description={
                isTeacher
                  ? "Your published student notices will appear here."
                  : "Published notices will appear here for the selected roles."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Title</Th>
                    <Th>{isTeacher ? "Audience" : "Visible To"}</Th>
                    <Th>Publish Date</Th>
                    <Th />
                  </tr>
                </TableHead>
                <TableBody>
                  {announcements.map((notice) => (
                    <tr key={notice._id}>
                      <Td>
                        <div className="font-medium text-slate-900">{notice.title}</div>
                        <div className="text-xs text-slate-500">{notice.content}</div>
                      </Td>
                      <Td>{isTeacher ? formatTeacherAudience(notice) : notice.visibleTo.join(", ")}</Td>
                      <Td>{notice.publishDateBs}</Td>
                      <Td className="text-right">
                        {canManageNotices ? (
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingId(notice._id);
                                setForm({
                                  title: notice.title,
                                  content: notice.content,
                                  visibleTo: isTeacher ? ["STUDENT"] : notice.visibleTo,
                                  publishDateBs: notice.publishDateBs,
                                  expiresAtBs: notice.expiresAtBs ?? "",
                                  classId: notice.classId,
                                  sectionId: notice.sectionId,
                                  subjectId: notice.subjectId
                                });
                              }}
                            >
                              Edit
                            </Button>
                            {isTeacher ? (
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={deleteMutation.isPending}
                                onClick={() => void deleteMutation.mutateAsync(notice._id)}
                              >
                                Delete
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </Td>
                    </tr>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );

  if (embedded) {
    return <div className="space-y-6">{content}</div>;
  }

  return <PageContent className="space-y-6">{content}</PageContent>;
};
