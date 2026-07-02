import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Pin, X } from "lucide-react";
import type { AssignmentCommentRecord, AssignmentSubmissionRecord, ClassroomPost } from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { Textarea } from "components/ui/textarea";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";
import { AttachmentViewer } from "components/shared/AttachmentViewer";
import { resolveAttachmentUrl } from "lib/attachments";
import { ClassroomAttachmentUpload } from "./ClassroomAttachmentUpload";
import {
  DEADLINE_COLORS,
  DEADLINE_LABELS,
  formatPostDate,
  SUBMISSION_COLORS,
  SUBMISSION_LABELS,
  TYPE_BADGE_COLORS,
  TYPE_LABELS
} from "./homeworkUtils";

interface AssignmentDetail {
  post: ClassroomPost;
  comments: AssignmentCommentRecord[];
}

interface PostDetailPanelProps {
  postId: string;
  canManage: boolean;
  studentId?: string;
  onClose: () => void;
  onEdit: (post: ClassroomPost) => void;
  onDeleted: () => void;
}

export const PostDetailPanel = ({
  postId,
  canManage,
  studentId,
  onClose,
  onEdit,
  onDeleted
}: PostDetailPanelProps) => {
  const [commentText, setCommentText] = useState("");
  const [submissionContent, setSubmissionContent] = useState("");
  const [submissionAttachments, setSubmissionAttachments] = useState<{ url: string; name: string }[]>([]);
  const [gradeMarks, setGradeMarks] = useState<Record<string, string>>({});
  const [gradeFeedback, setGradeFeedback] = useState<Record<string, string>>({});

  const detailQuery = useQuery({
    queryKey: ["homework-detail", postId],
    queryFn: () => unwrap<AssignmentDetail>(api.get(`/homework/${postId}`))
  });

  const submissionsQuery = useQuery({
    queryKey: ["homework-submissions", postId],
    queryFn: () =>
      unwrap<Array<AssignmentSubmissionRecord & { studentId: { _id: string; user?: { fullName?: string }; rollNumber?: number } }>>(
        api.get(`/homework/${postId}/submissions`)
      ),
    enabled: canManage && Boolean(detailQuery.data?.post.allowSubmission)
  });

  const commentMutation = useMutation({
    mutationFn: (content: string) => unwrap(api.post(`/homework/${postId}/comments`, { content })),
    onSuccess: async () => {
      setCommentText("");
      await queryClient.invalidateQueries({ queryKey: ["homework-detail", postId] });
      await queryClient.invalidateQueries({ queryKey: ["homework-feed"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      unwrap(
        api.post("/homework/submissions", {
          assignmentId: postId,
          studentId,
          content: submissionContent,
          attachmentUrl: submissionAttachments[0]?.url ?? ""
        })
      ),
    onSuccess: async () => {
      toast.success("Work submitted");
      setSubmissionContent("");
      setSubmissionAttachments([]);
      await queryClient.invalidateQueries({ queryKey: ["homework-detail", postId] });
      await queryClient.invalidateQueries({ queryKey: ["homework-feed"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const pinMutation = useMutation({
    mutationFn: (isPinned: boolean) => unwrap(api.put(`/homework/${postId}/pin`, { isPinned })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["homework-detail", postId] });
      await queryClient.invalidateQueries({ queryKey: ["homework-feed"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const deleteMutation = useMutation({
    mutationFn: () => unwrap(api.delete(`/homework/${postId}`)),
    onSuccess: () => {
      toast.success("Post deleted");
      onDeleted();
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const gradeMutation = useMutation({
    mutationFn: ({ submissionId, marks, feedback }: { submissionId: string; marks: number; feedback: string }) =>
      unwrap(api.put(`/homework/submissions/${submissionId}/grade`, { marks, feedback })),
    onSuccess: async () => {
      toast.success("Submission graded");
      await submissionsQuery.refetch();
      await queryClient.invalidateQueries({ queryKey: ["homework-feed"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const post = detailQuery.data?.post;
  const comments = detailQuery.data?.comments ?? [];
  const canSubmit =
    Boolean(studentId) &&
    post &&
    post.type !== "NOTE" &&
    post.allowSubmission !== false &&
    post.submissionStatus !== "SUBMITTED" &&
    post.submissionStatus !== "GRADED";

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const panel = (
    <div className="fixed inset-0 z-[60] flex justify-end bg-slate-900/40">
      <button
        type="button"
        aria-label="Close post details"
        className="absolute inset-0"
        onClick={onClose}
      />
      <div className="relative z-10 h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-4 py-3">
          <h2 className="text-base font-semibold text-slate-900">Post details</h2>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {detailQuery.isLoading || !post ? (
          <div className="p-6 text-sm text-slate-500">Loading...</div>
        ) : (
          <div className="space-y-6 p-4 sm:p-6">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={TYPE_BADGE_COLORS[post.type]}>{TYPE_LABELS[post.type]}</Badge>
                {post.isPinned ? (
                  <Badge className="bg-slate-100 text-slate-700">
                    <Pin className="mr-1 inline h-3 w-3" />
                    Pinned
                  </Badge>
                ) : null}
                {post.deadlineStatus ? (
                  <Badge className={DEADLINE_COLORS[post.deadlineStatus]}>{DEADLINE_LABELS[post.deadlineStatus]}</Badge>
                ) : null}
                {post.submissionStatus ? (
                  <Badge className={SUBMISSION_COLORS[post.submissionStatus]}>{SUBMISSION_LABELS[post.submissionStatus]}</Badge>
                ) : null}
              </div>

              <h3 className="text-xl font-semibold text-slate-900">{post.title}</h3>
              <p className="text-sm text-slate-600">
                {post.teacherName} · {post.subjectName}
                {post.topic ? ` · ${post.topic}` : ""} · Posted {formatPostDate(post.createdAt)}
              </p>
              {post.dueDateBs ? <p className="text-sm font-medium text-slate-700">Due: {post.dueDateBs} (BS)</p> : null}
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{post.description}</p>
              {post.rubric ? (
                <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                  <p className="font-medium text-slate-800">Instructions</p>
                  <p className="mt-1 whitespace-pre-wrap">{post.rubric}</p>
                </div>
              ) : null}
            </div>

            {post.attachments.length > 0 ? <AttachmentViewer attachments={post.attachments} /> : null}

            {(post.links?.length ?? 0) > 0 ? (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-slate-800">Links</h4>
                <div className="space-y-2">
                  {post.links?.map((link, index) => (
                    <a
                      key={`${link.url}-${index}`}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm text-blue-700 hover:bg-blue-50"
                    >
                      <ExternalLink className="h-4 w-4" />
                      {link.title}
                    </a>
                  ))}
                </div>
              </div>
            ) : null}

            {canSubmit ? (
              <div className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
                <h4 className="text-sm font-semibold text-slate-800">Your work</h4>
                <Textarea
                  rows={3}
                  placeholder="Write your answer or notes..."
                  value={submissionContent}
                  onChange={(event) => setSubmissionContent(event.target.value)}
                />
                <ClassroomAttachmentUpload
                  attachments={submissionAttachments}
                  onChange={setSubmissionAttachments}
                />
                <Button
                  onClick={() => submitMutation.mutate()}
                  disabled={submitMutation.isPending || (!submissionContent.trim() && submissionAttachments.length === 0)}
                >
                  {submitMutation.isPending ? "Submitting..." : "Turn in"}
                </Button>
              </div>
            ) : null}

            {post.submissionStatus === "GRADED" && post.marks !== undefined ? (
              <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 text-sm">
                <p className="font-semibold text-indigo-900">Grade: {post.marks}{post.maxMarks ? ` / ${post.maxMarks}` : ""}</p>
                {post.feedback ? <p className="mt-1 text-indigo-800">{post.feedback}</p> : null}
              </div>
            ) : null}

            {canManage ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => onEdit(post)}>
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => pinMutation.mutate(!post.isPinned)}
                  disabled={pinMutation.isPending}
                >
                  {post.isPinned ? "Unpin" : "Pin"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600"
                  onClick={() => {
                    if (window.confirm("Delete this post?")) deleteMutation.mutate();
                  }}
                  disabled={deleteMutation.isPending}
                >
                  Delete
                </Button>
              </div>
            ) : null}

            {canManage && post.allowSubmission !== false && post.type !== "NOTE" ? (
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-slate-800">Student submissions</h4>
                {(submissionsQuery.data ?? []).length === 0 ? (
                  <p className="text-sm text-slate-500">No submissions yet.</p>
                ) : (
                  <div className="space-y-3">
                    {(submissionsQuery.data ?? []).map((submission) => {
                      const student = submission.studentId as {
                        _id: string;
                        user?: { fullName?: string };
                        rollNumber?: number;
                      };
                      const studentName = student.user?.fullName ?? "Student";
                      return (
                        <div key={submission._id} className="rounded-xl border p-3 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-medium text-slate-800">
                              {studentName}
                              {student.rollNumber ? ` (#${student.rollNumber})` : ""}
                            </p>
                            <Badge className={SUBMISSION_COLORS[submission.status]}>{SUBMISSION_LABELS[submission.status]}</Badge>
                          </div>
                          {submission.content ? <p className="mt-2 text-slate-600">{submission.content}</p> : null}
                          {submission.attachmentUrl ? (
                            <a
                              href={resolveAttachmentUrl(submission.attachmentUrl)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 inline-block text-emerald-700 hover:underline"
                            >
                              View attachment
                            </a>
                          ) : null}
                          {submission.status !== "GRADED" ? (
                            <div className="mt-3 grid gap-2 sm:grid-cols-[100px_1fr_auto]">
                              <Input
                                type="number"
                                placeholder="Marks"
                                value={gradeMarks[submission._id] ?? ""}
                                onChange={(event) =>
                                  setGradeMarks((current) => ({ ...current, [submission._id]: event.target.value }))
                                }
                              />
                              <Input
                                placeholder="Feedback"
                                value={gradeFeedback[submission._id] ?? ""}
                                onChange={(event) =>
                                  setGradeFeedback((current) => ({ ...current, [submission._id]: event.target.value }))
                                }
                              />
                              <Button
                                size="sm"
                                onClick={() =>
                                  gradeMutation.mutate({
                                    submissionId: submission._id,
                                    marks: Number(gradeMarks[submission._id] ?? 0),
                                    feedback: gradeFeedback[submission._id] ?? ""
                                  })
                                }
                              >
                                Grade
                              </Button>
                            </div>
                          ) : (
                            <p className="mt-2 text-indigo-700">
                              Graded: {submission.marks}
                              {submission.feedback ? ` — ${submission.feedback}` : ""}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}

            <div className="space-y-3 border-t pt-4">
              <h4 className="text-sm font-semibold text-slate-800">Class comments</h4>
              <div className="space-y-2">
                {comments.length === 0 ? <p className="text-sm text-slate-500">No comments yet.</p> : null}
                {comments.map((comment) => (
                  <div key={comment._id} className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
                    <p className="font-medium text-slate-800">
                      {comment.authorName}
                      <span className="ml-2 text-xs font-normal text-slate-500">{formatPostDate(comment.createdAt)}</span>
                    </p>
                    <p className="mt-1 text-slate-600">{comment.content}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  className="min-w-0 flex-1"
                  placeholder="Add a class comment..."
                  value={commentText}
                  onChange={(event) => setCommentText(event.target.value)}
                />
                <Button
                  className="shrink-0"
                  onClick={() => commentMutation.mutate(commentText.trim())}
                  disabled={!commentText.trim() || commentMutation.isPending}
                >
                  Post
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(panel, document.body);
};