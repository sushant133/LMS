export const TYPE_LABELS = {
    HOMEWORK: "Assignments",
    CAS: "CAS Activity",
    NOTE: "Class Note"
};
export const TYPE_COLORS = {
    HOMEWORK: "border-l-blue-500 bg-blue-50/40",
    CAS: "border-l-violet-500 bg-violet-50/40",
    NOTE: "border-l-amber-500 bg-amber-50/40"
};
export const TYPE_BADGE_COLORS = {
    HOMEWORK: "bg-blue-100 text-blue-800",
    CAS: "bg-violet-100 text-violet-800",
    NOTE: "bg-amber-100 text-amber-800"
};
export const DEADLINE_LABELS = {
    UPCOMING: "Upcoming",
    DUE_TODAY: "Due Today",
    OVERDUE: "Overdue"
};
export const DEADLINE_COLORS = {
    UPCOMING: "bg-sky-100 text-sky-800",
    DUE_TODAY: "bg-orange-100 text-orange-800",
    OVERDUE: "bg-red-100 text-red-800"
};
export const SUBMISSION_LABELS = {
    PENDING: "Not Submitted",
    SUBMITTED: "Submitted",
    GRADED: "Graded"
};
export const SUBMISSION_COLORS = {
    PENDING: "bg-slate-100 text-slate-700",
    SUBMITTED: "bg-emerald-100 text-emerald-800",
    GRADED: "bg-indigo-100 text-indigo-800"
};
export const formatPostDate = (iso) => {
    if (!iso)
        return "";
    return new Date(iso).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric"
    });
};
export const getDisplayStatus = (post) => {
    if (post.submissionStatus === "GRADED") {
        return { label: "Graded", className: SUBMISSION_COLORS.GRADED };
    }
    if (post.submissionStatus === "SUBMITTED") {
        return { label: "Submitted", className: SUBMISSION_COLORS.SUBMITTED };
    }
    if (post.deadlineStatus) {
        return {
            label: DEADLINE_LABELS[post.deadlineStatus],
            className: DEADLINE_COLORS[post.deadlineStatus]
        };
    }
    if (post.submissionStatus === "PENDING") {
        return { label: "Not Submitted", className: SUBMISSION_COLORS.PENDING };
    }
    return null;
};
