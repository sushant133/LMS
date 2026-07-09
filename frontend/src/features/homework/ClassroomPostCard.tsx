import { MessageSquare, Paperclip, Pin } from "lucide-react";
import type { ClassroomPost } from "@phit-erp/shared";
import { Badge } from "components/ui/badge";
import { cn } from "lib/utils";
import {
  formatPostDate,
  getDisplayStatus,
  TYPE_BADGE_COLORS,
  TYPE_COLORS,
  TYPE_LABELS,
} from "./homeworkUtils";

interface ClassroomPostCardProps {
  post: ClassroomPost;
  onOpen: (post: ClassroomPost) => void;
}

export const ClassroomPostCard = ({ post, onOpen }: ClassroomPostCardProps) => {
  const status = getDisplayStatus(post);
  const attachmentCount = post.attachments.length + (post.links?.length ?? 0);

  return (
    <button
      type="button"
      onClick={() => onOpen(post)}
      className={cn(
        "w-full min-w-0 rounded-2xl border border-slate-200 border-l-4 bg-white p-4 text-left shadow-sm transition hover:shadow-md",
        TYPE_COLORS[post.type],
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {post.isPinned ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600">
                <Pin className="h-3.5 w-3.5" />
                Pinned
              </span>
            ) : null}
            <Badge className={TYPE_BADGE_COLORS[post.type]}>
              {TYPE_LABELS[post.type]}
            </Badge>
            {status ? (
              <Badge className={status.className}>{status.label}</Badge>
            ) : null}
          </div>
          <h3 className="text-base font-semibold text-slate-900">
            {post.title}
          </h3>
          <p className="line-clamp-2 text-sm text-slate-600">
            {post.description}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span className="font-medium text-slate-700">{post.teacherName}</span>
        <span>·</span>
        <span>{post.subjectName}</span>
        {post.topic ? (
          <>
            <span>·</span>
            <span>{post.topic}</span>
          </>
        ) : null}
        <span>·</span>
        <span>{formatPostDate(post.createdAt)}</span>
        {post.dueDateBs ? (
          <>
            <span>·</span>
            <span>Due {post.dueDateBs}</span>
          </>
        ) : null}
      </div>

      <div className="mt-2 flex items-center gap-4 text-xs text-slate-500">
        {attachmentCount > 0 ? (
          <span className="inline-flex items-center gap-1">
            <Paperclip className="h-3.5 w-3.5" />
            {attachmentCount} attachment{attachmentCount === 1 ? "" : "s"}
          </span>
        ) : null}
        {post.commentCount > 0 ? (
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="h-3.5 w-3.5" />
            {post.commentCount} comment{post.commentCount === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>
    </button>
  );
};
