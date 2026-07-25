import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AcademicCommentRecord } from "@phit-erp/shared";
import { MessageSquarePlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "components/ui/button";
import { Textarea } from "components/ui/textarea";
import { api, unwrap } from "lib/api";
import { parseErrorMessage } from "lib/utils";

interface AcademicCommentsPanelProps {
  entityType: "SYLLABUS" | "SESSION_PLAN" | "LESSON_PLAN" | "LOG_BOOK_ENTRY";
  entityId: string;
  canComment: boolean;
}

export const AcademicCommentsPanel = ({
  entityType,
  entityId,
  canComment,
}: AcademicCommentsPanelProps) => {
  const queryClient = useQueryClient();
  const [comment, setComment] = useState("");
  const hasEntity = Boolean(entityId?.trim());

  const commentsQuery = useQuery({
    queryKey: ["academic-management", "comments", entityType, entityId],
    queryFn: async () => {
      try {
        return await unwrap<AcademicCommentRecord[]>(
          api.get("/academic-management/comments", {
            params: { entityType, entityId },
          }),
        );
      } catch (error) {
        // Do not break the syllabus card if comments fail to load
        const status = (error as { response?: { status?: number } })?.response
          ?.status;
        if (status === 404) return [];
        throw error;
      }
    },
    enabled: hasEntity,
    retry: false,
  });

  const addMutation = useMutation({
    mutationFn: (text: string) =>
      unwrap(
        api.post("/academic-management/comments", {
          entityType,
          entityId,
          comment: text,
        }),
      ),
    onSuccess: () => {
      toast.success("Comment added");
      setComment("");
      void queryClient.invalidateQueries({
        queryKey: ["academic-management", "comments", entityType, entityId],
      });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  if (!hasEntity) return null;

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
      <p className="text-sm font-medium text-slate-800">
        Comments & Review Notes
      </p>
      {commentsQuery.isError ? (
        <p className="text-sm text-amber-700">
          Comments could not be loaded right now.
        </p>
      ) : (commentsQuery.data ?? []).length === 0 ? (
        <p className="text-sm text-slate-500">No comments yet.</p>
      ) : (
        <div className="space-y-2">
          {commentsQuery.data?.map((item) => (
            <div
              key={item._id}
              className="rounded-xl bg-slate-50 px-3 py-2 text-sm"
            >
              <p className="font-medium text-slate-800">
                {item.authorName} · {item.authorRole}
              </p>
              <p className="text-slate-600">{item.comment}</p>
            </div>
          ))}
        </div>
      )}
      {canComment ? (
        <div className="space-y-2">
          <Textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Add a comment or review note"
          />
          <Button
            size="sm"
            disabled={!comment.trim() || addMutation.isPending}
            onClick={() => addMutation.mutate(comment.trim())}
          >
            <MessageSquarePlus className="mr-2 h-4 w-4" />
            Add Comment
          </Button>
        </div>
      ) : null}
    </div>
  );
};
