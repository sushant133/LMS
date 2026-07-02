import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Pin, X } from "lucide-react";
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
import { DEADLINE_COLORS, DEADLINE_LABELS, formatPostDate, SUBMISSION_COLORS, SUBMISSION_LABELS, TYPE_BADGE_COLORS, TYPE_LABELS } from "./homeworkUtils";
export const PostDetailPanel = ({ postId, canManage, studentId, onClose, onEdit, onDeleted }) => {
    const [commentText, setCommentText] = useState("");
    const [submissionContent, setSubmissionContent] = useState("");
    const [submissionAttachments, setSubmissionAttachments] = useState([]);
    const [gradeMarks, setGradeMarks] = useState({});
    const [gradeFeedback, setGradeFeedback] = useState({});
    const detailQuery = useQuery({
        queryKey: ["homework-detail", postId],
        queryFn: () => unwrap(api.get(`/homework/${postId}`))
    });
    const submissionsQuery = useQuery({
        queryKey: ["homework-submissions", postId],
        queryFn: () => unwrap(api.get(`/homework/${postId}/submissions`)),
        enabled: canManage && Boolean(detailQuery.data?.post.allowSubmission)
    });
    const commentMutation = useMutation({
        mutationFn: (content) => unwrap(api.post(`/homework/${postId}/comments`, { content })),
        onSuccess: async () => {
            setCommentText("");
            await queryClient.invalidateQueries({ queryKey: ["homework-detail", postId] });
            await queryClient.invalidateQueries({ queryKey: ["homework-feed"] });
        },
        onError: (error) => toast.error(parseErrorMessage(error))
    });
    const submitMutation = useMutation({
        mutationFn: () => unwrap(api.post("/homework/submissions", {
            assignmentId: postId,
            studentId,
            content: submissionContent,
            attachmentUrl: submissionAttachments[0]?.url ?? ""
        })),
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
        mutationFn: (isPinned) => unwrap(api.put(`/homework/${postId}/pin`, { isPinned })),
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
        mutationFn: ({ submissionId, marks, feedback }) => unwrap(api.put(`/homework/submissions/${submissionId}/grade`, { marks, feedback })),
        onSuccess: async () => {
            toast.success("Submission graded");
            await submissionsQuery.refetch();
            await queryClient.invalidateQueries({ queryKey: ["homework-feed"] });
        },
        onError: (error) => toast.error(parseErrorMessage(error))
    });
    const post = detailQuery.data?.post;
    const comments = detailQuery.data?.comments ?? [];
    const canSubmit = Boolean(studentId) &&
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
    const panel = (_jsxs("div", { className: "fixed inset-0 z-[60] flex justify-end bg-slate-900/40", children: [_jsx("button", { type: "button", "aria-label": "Close post details", className: "absolute inset-0", onClick: onClose }), _jsxs("div", { className: "relative z-10 h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl", children: [_jsxs("div", { className: "sticky top-0 z-10 flex items-center justify-between border-b bg-white px-4 py-3", children: [_jsx("h2", { className: "text-base font-semibold text-slate-900", children: "Post details" }), _jsx(Button, { type: "button", variant: "ghost", size: "sm", onClick: onClose, children: _jsx(X, { className: "h-4 w-4" }) })] }), detailQuery.isLoading || !post ? (_jsx("div", { className: "p-6 text-sm text-slate-500", children: "Loading..." })) : (_jsxs("div", { className: "space-y-6 p-4 sm:p-6", children: [_jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx(Badge, { className: TYPE_BADGE_COLORS[post.type], children: TYPE_LABELS[post.type] }), post.isPinned ? (_jsxs(Badge, { className: "bg-slate-100 text-slate-700", children: [_jsx(Pin, { className: "mr-1 inline h-3 w-3" }), "Pinned"] })) : null, post.deadlineStatus ? (_jsx(Badge, { className: DEADLINE_COLORS[post.deadlineStatus], children: DEADLINE_LABELS[post.deadlineStatus] })) : null, post.submissionStatus ? (_jsx(Badge, { className: SUBMISSION_COLORS[post.submissionStatus], children: SUBMISSION_LABELS[post.submissionStatus] })) : null] }), _jsx("h3", { className: "text-xl font-semibold text-slate-900", children: post.title }), _jsxs("p", { className: "text-sm text-slate-600", children: [post.teacherName, " \u00B7 ", post.subjectName, post.topic ? ` · ${post.topic}` : "", " \u00B7 Posted ", formatPostDate(post.createdAt)] }), post.dueDateBs ? _jsxs("p", { className: "text-sm font-medium text-slate-700", children: ["Due: ", post.dueDateBs, " (BS)"] }) : null, _jsx("p", { className: "whitespace-pre-wrap text-sm leading-relaxed text-slate-700", children: post.description }), post.rubric ? (_jsxs("div", { className: "rounded-xl bg-slate-50 p-3 text-sm text-slate-600", children: [_jsx("p", { className: "font-medium text-slate-800", children: "Instructions" }), _jsx("p", { className: "mt-1 whitespace-pre-wrap", children: post.rubric })] })) : null] }), post.attachments.length > 0 ? _jsx(AttachmentViewer, { attachments: post.attachments }) : null, (post.links?.length ?? 0) > 0 ? (_jsxs("div", { className: "space-y-2", children: [_jsx("h4", { className: "text-sm font-semibold text-slate-800", children: "Links" }), _jsx("div", { className: "space-y-2", children: post.links?.map((link, index) => (_jsxs("a", { href: link.url, target: "_blank", rel: "noopener noreferrer", className: "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm text-blue-700 hover:bg-blue-50", children: [_jsx(ExternalLink, { className: "h-4 w-4" }), link.title] }, `${link.url}-${index}`))) })] })) : null, canSubmit ? (_jsxs("div", { className: "space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4", children: [_jsx("h4", { className: "text-sm font-semibold text-slate-800", children: "Your work" }), _jsx(Textarea, { rows: 3, placeholder: "Write your answer or notes...", value: submissionContent, onChange: (event) => setSubmissionContent(event.target.value) }), _jsx(ClassroomAttachmentUpload, { attachments: submissionAttachments, onChange: setSubmissionAttachments }), _jsx(Button, { onClick: () => submitMutation.mutate(), disabled: submitMutation.isPending || (!submissionContent.trim() && submissionAttachments.length === 0), children: submitMutation.isPending ? "Submitting..." : "Turn in" })] })) : null, post.submissionStatus === "GRADED" && post.marks !== undefined ? (_jsxs("div", { className: "rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 text-sm", children: [_jsxs("p", { className: "font-semibold text-indigo-900", children: ["Grade: ", post.marks, post.maxMarks ? ` / ${post.maxMarks}` : ""] }), post.feedback ? _jsx("p", { className: "mt-1 text-indigo-800", children: post.feedback }) : null] })) : null, canManage ? (_jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsx(Button, { variant: "outline", size: "sm", onClick: () => onEdit(post), children: "Edit" }), _jsx(Button, { variant: "outline", size: "sm", onClick: () => pinMutation.mutate(!post.isPinned), disabled: pinMutation.isPending, children: post.isPinned ? "Unpin" : "Pin" }), _jsx(Button, { variant: "outline", size: "sm", className: "text-red-600", onClick: () => {
                                            if (window.confirm("Delete this post?"))
                                                deleteMutation.mutate();
                                        }, disabled: deleteMutation.isPending, children: "Delete" })] })) : null, canManage && post.allowSubmission !== false && post.type !== "NOTE" ? (_jsxs("div", { className: "space-y-3", children: [_jsx("h4", { className: "text-sm font-semibold text-slate-800", children: "Student submissions" }), (submissionsQuery.data ?? []).length === 0 ? (_jsx("p", { className: "text-sm text-slate-500", children: "No submissions yet." })) : (_jsx("div", { className: "space-y-3", children: (submissionsQuery.data ?? []).map((submission) => {
                                            const student = submission.studentId;
                                            const studentName = student.user?.fullName ?? "Student";
                                            return (_jsxs("div", { className: "rounded-xl border p-3 text-sm", children: [_jsxs("div", { className: "flex items-center justify-between gap-2", children: [_jsxs("p", { className: "font-medium text-slate-800", children: [studentName, student.rollNumber ? ` (#${student.rollNumber})` : ""] }), _jsx(Badge, { className: SUBMISSION_COLORS[submission.status], children: SUBMISSION_LABELS[submission.status] })] }), submission.content ? _jsx("p", { className: "mt-2 text-slate-600", children: submission.content }) : null, submission.attachmentUrl ? (_jsx("a", { href: resolveAttachmentUrl(submission.attachmentUrl), target: "_blank", rel: "noopener noreferrer", className: "mt-1 inline-block text-emerald-700 hover:underline", children: "View attachment" })) : null, submission.status !== "GRADED" ? (_jsxs("div", { className: "mt-3 grid gap-2 sm:grid-cols-[100px_1fr_auto]", children: [_jsx(Input, { type: "number", placeholder: "Marks", value: gradeMarks[submission._id] ?? "", onChange: (event) => setGradeMarks((current) => ({ ...current, [submission._id]: event.target.value })) }), _jsx(Input, { placeholder: "Feedback", value: gradeFeedback[submission._id] ?? "", onChange: (event) => setGradeFeedback((current) => ({ ...current, [submission._id]: event.target.value })) }), _jsx(Button, { size: "sm", onClick: () => gradeMutation.mutate({
                                                                    submissionId: submission._id,
                                                                    marks: Number(gradeMarks[submission._id] ?? 0),
                                                                    feedback: gradeFeedback[submission._id] ?? ""
                                                                }), children: "Grade" })] })) : (_jsxs("p", { className: "mt-2 text-indigo-700", children: ["Graded: ", submission.marks, submission.feedback ? ` — ${submission.feedback}` : ""] }))] }, submission._id));
                                        }) }))] })) : null, _jsxs("div", { className: "space-y-3 border-t pt-4", children: [_jsx("h4", { className: "text-sm font-semibold text-slate-800", children: "Class comments" }), _jsxs("div", { className: "space-y-2", children: [comments.length === 0 ? _jsx("p", { className: "text-sm text-slate-500", children: "No comments yet." }) : null, comments.map((comment) => (_jsxs("div", { className: "rounded-xl bg-slate-50 px-3 py-2 text-sm", children: [_jsxs("p", { className: "font-medium text-slate-800", children: [comment.authorName, _jsx("span", { className: "ml-2 text-xs font-normal text-slate-500", children: formatPostDate(comment.createdAt) })] }), _jsx("p", { className: "mt-1 text-slate-600", children: comment.content })] }, comment._id)))] }), _jsxs("div", { className: "flex flex-col gap-2 sm:flex-row", children: [_jsx(Input, { className: "min-w-0 flex-1", placeholder: "Add a class comment...", value: commentText, onChange: (event) => setCommentText(event.target.value) }), _jsx(Button, { className: "shrink-0", onClick: () => commentMutation.mutate(commentText.trim()), disabled: !commentText.trim() || commentMutation.isPending, children: "Post" })] })] })] }))] })] }));
    return createPortal(panel, document.body);
};
