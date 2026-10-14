import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "components/ui/button";
import { api, unwrap } from "lib/api";
import { parseErrorMessage } from "lib/utils";

type Resource = "session-plans" | "lesson-plans" | "log-book-entries";
type Verb = "unapprove" | "unverify" | "return";

const RETURNABLE = new Set([
  // plans
  "SUBMITTED",
  "PENDING_APPROVAL",
  "VERIFIED",
  "APPROVED",
  // log book
  "PENDING",
  "REVIEWED",
]);

/**
 * Undo a review decision made by mistake: Unapprove (Approved → Verified),
 * Unverify (Verified → Submitted / Pending) and Return to teacher (back for correction).
 * Only the actions valid for the current status are shown.
 */
export const ReviewUndoActions = ({
  resource,
  id,
  status,
  label,
  canVerify,
  canApprove,
}: {
  resource: Resource;
  id: string;
  /** Plan status, or log book reviewStatus. */
  status: string | null | undefined;
  /** e.g. "session plan" — used in prompts. */
  label: string;
  /** Can verify (Academic Management admin view). */
  canVerify: boolean;
  /** Administrator / Super Admin. */
  canApprove: boolean;
}) => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ verb, remarks }: { verb: Verb; remarks?: string }) =>
      unwrap(api.post(`/academic-management/${resource}/${id}/${verb}`, { remarks })),
    onSuccess: (_data, { verb }) => {
      toast.success(
        verb === "unapprove"
          ? `Approval undone — the ${label} is back to Verified`
          : verb === "unverify"
            ? `Verification undone — the ${label} is back to Submitted`
            : `The ${label} was returned to the teacher for correction`,
      );
      void queryClient.invalidateQueries({ queryKey: ["academic-management"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const s = String(status || "").toUpperCase();
  const approved = s === "APPROVED";
  const verified = s === "VERIFIED" || s === "REVIEWED";
  const showUnapprove = approved && canApprove;
  const showUnverify = verified && canVerify;
  const showReturn = RETURNABLE.has(s) && (approved ? canApprove : canVerify);
  if (!showUnapprove && !showUnverify && !showReturn) return null;

  return (
    <>
      {showUnapprove ? (
        <Button
          size="sm"
          variant="outline"
          className="text-amber-700"
          disabled={mutation.isPending}
          title="Approved by mistake? Move it back to Verified"
          onClick={() => {
            if (window.confirm(`Unapprove this ${label}? It goes back to Verified.`)) {
              mutation.mutate({ verb: "unapprove" });
            }
          }}
        >
          Unapprove
        </Button>
      ) : null}
      {showUnverify ? (
        <Button
          size="sm"
          variant="outline"
          className="text-amber-700"
          disabled={mutation.isPending}
          title="Verified by mistake? Move it back to Submitted"
          onClick={() => {
            if (window.confirm(`Unverify this ${label}? It goes back to Submitted.`)) {
              mutation.mutate({ verb: "unverify" });
            }
          }}
        >
          Unverify
        </Button>
      ) : null}
      {showReturn ? (
        <Button
          size="sm"
          variant="outline"
          className="text-rose-700"
          disabled={mutation.isPending}
          title="Send it back to the teacher to correct and resubmit"
          onClick={() => {
            const remarks = window.prompt(
              `Return this ${label} to the teacher — what should they correct?`,
            );
            if (remarks && remarks.trim()) {
              mutation.mutate({ verb: "return", remarks: remarks.trim() });
            } else if (remarks !== null) {
              toast.error("Write a reason so the teacher knows what to correct");
            }
          }}
        >
          Return to teacher
        </Button>
      ) : null}
    </>
  );
};
